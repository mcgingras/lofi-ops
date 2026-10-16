/**
 * Infected (Modern Warfare 3, adapted; data in src/shared/defs/infected.ts):
 *
 *   - Everybody starts a Survivor (team 0). `firstSec` after the start a random player (of at
 *     least `minPlayers`) becomes the First Infected (team 1) where they stand.
 *   - Every Survivor who dies (an Infected's kill, a fall, their own grenade...) comes back
 *     Infected. Deaths before the first pick just respawn as a Survivor.
 *   - Loadouts are forced at spawn: Survivors the SPAS-12 and M1911 with Scavenger, Steady Aim and
 *     double reserve; Infected the knife and a tomahawk with Lightweight, Marathon and a speed
 *     boost. The First Infected keeps the Survivor guns (plus tomahawk and Infected perks) until a
 *     second player is infected, then drops to the knife (MW3).
 *   - The last Survivor gets "LAST ONE STANDING": an RPK in place of the pistol, full ammo, and a
 *     radar of every Infected; the Infected see the last Survivor in a sweep every 30 s (Ghosts).
 *   - Scoring: kills/assists as usual; Infected +100 per infection; every living Survivor +50 when
 *     another Survivor is infected (MW3) and every 30 s alive.
 *   - The Infected win when no Survivor is left; Survivors win when the time limit is reached
 *     with one of them alive (alive Survivors then get OUTLASTED, a lone one FINAL STAND).
 *   - If every Infected leaves, a new First Infected is picked after `repickSec`; if the Infected
 *     are down to one, that one is the First Infected again (MW3).
 *
 * Teams are owned by these rules (`ModeDef.teamsByRules`): lobby/bot balancing leaves them alone,
 * and the rules re-assert a player's team from their role at every spawn.
 */
import { RESPAWN_DELAY, TICK_DT, type Team } from '../../../shared/constants';
import { FIRST_INFECTED_LOADOUT, INFECTED, INFECTED_LOADOUT, INFECTED_TEAMS, INFECTED_WEAPON, INFECTED_XP, LAST_SURVIVOR_WEAPON, SURVIVOR_LOADOUT, type InfectedRole } from '../../../shared/defs/infected';
import type { ModeEventPayload, ModeStatePayload } from '../../../shared/defs/modestate';
import { XP_SOURCES } from '../../../shared/defs/progression';
import type { DeathEvent, MatchResults } from '../../../shared/events';
import { cloneLoadout, type Loadout } from '../../../shared/loadout';
import type { SpawnPoint } from '../../../shared/maps/types';
import { forceSlot } from '../../combat';
import { standardResults } from '../../modes/common';
import type { ModeRules } from '../../modes/types';
import { makeWeapon, type PlayerState } from '../../player';
import type { Room } from '../../room';
import { equipAtSpawn } from '../weapons/equipment';
import type { BotObjective } from './bots';
import { allSpawns, award, isEnemyKill, modeExt, qt, rankSpawns, resetModeExt, setController, type ModeController } from './common';
import { InfectedIntel, registerInfectedBots } from './infected-bots';

const S: Team = INFECTED_TEAMS.survivors;
const I: Team = INFECTED_TEAMS.infected;
const teamOf = (r: InfectedRole): Team => (r === 'survivor' ? S : I);

export class InfectedRules implements ModeRules, ModeController {
  readonly id = 'infected';
  readonly statKeys = ['infections', 'survivals'];
  dirty = false;
  /** Random source for the First Infected pick (tests seed it). */
  rng: () => number = Math.random;
  room!: Room;
  /** Role by player id (players not in the map get one on join / spawn). */
  readonly roles = new Map<string, InfectedRole>();
  /** True once the first infection happened this match. */
  started = false;
  /** Room time the (next) First Infected is picked; null when not counting down. */
  pickAt: number | null = null;
  /** The First Infected (bonus loadout) until a second player is infected. */
  firstId: string | null = null;
  /** The last Survivor, once the bonus was handed out. */
  lastId: string | null = null;
  /** Next radar sweep of the last Survivor, and when the current one ends. */
  sweepNext = 0;
  sweepUntil = 0;
  /** Room time of the next survival points. */
  surviveNext = 0;
  /** Who knows where the Survivors are (Infected bots hunt by it). */
  readonly intel = new InfectedIntel();
  private finished = false;

  get rules(): ModeRules {
    return this;
  }

  setup(room: Room): void {
    this.room = room;
    setController(room, this);
    registerInfectedBots();
    // After the bots roster (priority 0) and before nothing else that cares: score, then convert.
    room.bus.on('death', (e) => this.onDeath(e), { priority: -20 });
    // Forced class: after progression's gate (100), the frontend trim (90) and economy's
    // ownership check (-50), so nothing swaps it back.
    room.bus.on('beforeSpawn', (e) => this.beforeSpawn(e.player, e), { priority: -60 });
    room.bus.on('spawn', ({ player }) => this.afterSpawn(player));
    room.bus.on('playerLeave', ({ player }) => this.onLeave(player));
    room.bus.on('matchStart', () => {
      this.pickAt = room.time + INFECTED.firstSec;
      this.surviveNext = room.time + INFECTED.surviveEverySec;
      this.dirty = true;
    });
    room.bus.on('tick', ({ dt }) => this.tick(dt));
    room.modifiers.add('speedMultiplier', (p) => (room.phase === 'playing' && this.roleOf(p) === 'infected' ? INFECTED.infectedSpeed : undefined), 'modes.infected.speed');
    room.modifiers.add(
      'radarVisible',
      (target, viewer) => {
        if (!target.alive || !this.started) return undefined;
        // The last Survivor sees every Infected; the Infected see the last Survivor during a sweep.
        if (viewer.id === this.lastId && this.roleOf(target) === 'infected') return true;
        if (target.id === this.lastId && this.roleOf(viewer) === 'infected' && room.time < this.sweepUntil) return true;
        return undefined;
      },
      'modes.infected.radar',
    );
  }

  reset(room: Room): void {
    resetModeExt(room);
    this.roles.clear();
    this.started = false;
    this.finished = false;
    this.pickAt = null;
    this.firstId = null;
    this.lastId = null;
    this.sweepUntil = 0;
    this.intel.clear();
    for (const p of room.players.values()) {
      this.roles.set(p.id, 'survivor');
      p.team = S;
    }
    room.broadcastRoster();
    this.syncCounts();
  }

  // -------------------------------------------------------------------------------------------
  // Roles
  // -------------------------------------------------------------------------------------------

  /** A player's role (late joiners are Infected once the infection has started, as in MW3). */
  roleOf(p: PlayerState): InfectedRole {
    let r = this.roles.get(p.id);
    if (!r) {
      r = this.started ? 'infected' : 'survivor';
      this.roles.set(p.id, r);
    }
    return r;
  }

  /** Players in the room with a role. */
  members(role: InfectedRole): PlayerState[] {
    return [...this.room.players.values()].filter((p) => this.roleOf(p) === role);
  }

  counts(): { survivors: number; infected: number } {
    let survivors = 0;
    let infected = 0;
    for (const p of this.room.players.values()) {
      if (this.roleOf(p) === 'survivor') survivors++;
      else infected++;
    }
    return { survivors, infected };
  }

  private setRole(p: PlayerState, role: InfectedRole): void {
    this.roles.set(p.id, role);
    if (p.team !== teamOf(role)) {
      p.team = teamOf(role);
      this.room.broadcastRoster();
    }
    this.dirty = true;
  }

  /** Team scores carry the live counts (scoreboard headers, summary): [Survivors, Infected]. */
  private syncCounts(): void {
    const c = this.counts();
    const ts = this.room.teamScores;
    if (ts[S] !== c.survivors || ts[I] !== c.infected) {
      ts[S] = c.survivors;
      ts[I] = c.infected;
      this.room.broadcastScore();
    }
  }

  assignTeam(_room: Room, p: PlayerState): Team {
    return teamOf(this.roleOf(p));
  }

  // -------------------------------------------------------------------------------------------
  // Loadouts
  // -------------------------------------------------------------------------------------------

  /** The class a player spawns with right now. */
  loadoutFor(p: PlayerState): Loadout {
    if (this.roleOf(p) === 'survivor') return cloneLoadout(SURVIVOR_LOADOUT);
    return cloneLoadout(p.id === this.firstId ? FIRST_INFECTED_LOADOUT : INFECTED_LOADOUT);
  }

  private beforeSpawn(p: PlayerState, e: { loadout: Loadout }): void {
    const role = this.roleOf(p);
    if (p.team !== teamOf(role)) {
      p.team = teamOf(role);
      this.room.broadcastRoster();
    }
    const camo = e.loadout.primary.camo;
    e.loadout = this.loadoutFor(p);
    e.loadout.primary.camo = camo;
  }

  private afterSpawn(p: PlayerState): void {
    const role = this.roleOf(p);
    if (role === 'survivor') {
      for (const w of p.weapons) w.reserve = w.def.reserve * INFECTED.survivorReserveMul;
      if (p.id === this.lastId) this.giveLastBonus(p);
    } else if (p.id !== this.firstId) this.giveKnife(p);
    this.dirty = true;
  }

  /** Knife only (slot 0), the tomahawk stays as the lethal. */
  private giveKnife(p: PlayerState): void {
    p.weapons = [makeWeapon({ weapon: INFECTED_WEAPON, attachments: [], camo: 'none' }, INFECTED_WEAPON)];
    p.reloadEnd = 0;
    if (p.alive && this.room.phase === 'playing') forceSlot(this.room, p, 0);
    else p.slot = 0;
  }

  /** Re-equip a living player in place with their role's class (conversion, bonus removed). */
  private reequip(p: PlayerState, keepGuns: boolean): void {
    const l = (p.loadout = this.loadoutFor(p));
    if (!keepGuns) this.giveKnife(p);
    else if (p.weapons.every((w) => w.def.base.id === INFECTED_WEAPON)) {
      // Back to the guns (an Infected made First Infected again): fresh Survivor guns, primary up.
      p.weapons = [makeWeapon(l.primary, 'spas12'), makeWeapon(l.secondary, 'm1911')];
      p.reloadEnd = 0;
      p.swapEnd = this.room.time + 0.5;
      forceSlot(this.room, p, 0);
    }
    equipAtSpawn(this.room, p);
  }

  private giveLastBonus(p: PlayerState): void {
    const primary = p.weapons[0];
    if (primary) {
      primary.mag = primary.def.magazine;
      primary.reserve = Math.max(primary.reserve, primary.def.reserve * INFECTED.survivorReserveMul);
    }
    const rpk = makeWeapon(LAST_SURVIVOR_WEAPON, 'rpk');
    if (p.weapons.length >= 2) p.weapons[1] = rpk;
    else p.weapons.push(rpk);
    if (p.slot === 1) {
      p.reloadEnd = 0;
      p.swapEnd = this.room.time + 0.6;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Spawns
  // -------------------------------------------------------------------------------------------

  spawnPoints(room: Room, p: PlayerState): SpawnPoint[] {
    const pool = allSpawns(room.map);
    if (this.roleOf(p) === 'survivor') return rankSpawns(room, p, pool);
    // Infected: the hard rules of spawns.ts (not next to a Survivor, out of their sight), the
    // usual danger and distance scoring, and not across the map from the nearest Survivor.
    const survivors = [...room.players.values()].filter((q) => q.alive && this.roleOf(q) === 'survivor');
    return rankSpawns(room, p, pool, (pt) => {
      let near = Infinity;
      for (const q of survivors) near = Math.min(near, Math.hypot(q.move.x - pt.x, q.move.z - pt.z));
      return near === Infinity ? 0 : -Math.max(0, near - INFECTED.spawnFar);
    });
  }

  respawnDelay(): number {
    return RESPAWN_DELAY;
  }

  // -------------------------------------------------------------------------------------------
  // Flow
  // -------------------------------------------------------------------------------------------

  private tick(_dt: number): void {
    const room = this.room;
    if (room.phase !== 'playing' || this.finished) return;
    if (!this.started && this.pickAt !== null && room.time >= this.pickAt) this.pickFirst();
    if (this.started) {
      if (room.time >= this.surviveNext) {
        this.surviveNext = room.time + INFECTED.surviveEverySec;
        for (const s of this.members('survivor')) if (s.alive) this.surviveBonus(s);
      }
      if (this.lastId && room.time >= this.sweepNext) {
        this.sweepNext = room.time + INFECTED.sweepEverySec;
        this.sweepUntil = room.time + INFECTED.sweepSec;
        this.dirty = true;
      }
    }
    if (room.tick % 15 === 0) this.intel.update(room, this);
    if (room.tick % 30 === 0) this.syncCounts();
    // Time limit: decide it here, a tick before core's own check would, so the Survivors'
    // OUTLASTED / FINAL STAND awards land while the match is still playing.
    const limit = room.mode.timeLimitSec;
    if (limit > 0 && room.time - room.matchStartTime + TICK_DT >= limit - 1e-6) this.endOnTime();
  }

  /** Pick the First Infected (random living player; needs `minPlayers`). */
  pickFirst(): PlayerState | null {
    const room = this.room;
    if (room.players.size < INFECTED.minPlayers) {
      this.pickAt = room.time + 1;
      this.dirty = true;
      return null;
    }
    const pool = this.members('survivor').filter((p) => p.alive);
    const list = pool.length ? pool : this.members('survivor');
    if (!list.length) return null;
    const p = list[Math.min(list.length - 1, Math.floor(this.rng() * list.length))]!;
    this.makeFirst(p, true);
    return p;
  }

  /** `p` becomes the First Infected where they stand (new: the infection starts with them). */
  makeFirst(p: PlayerState, fresh = true): void {
    const room = this.room;
    this.started = true;
    this.pickAt = null;
    this.firstId = p.id;
    this.setRole(p, 'infected');
    if (p.alive) this.reequip(p, true);
    room.sendFeature(null, 'modes.event', { kind: 'infected.first', team: I, player: p.id, reason: fresh ? 'start' : 'again' });
    if (fresh) room.bus.emit('objective', { kind: 'infected.first', team: I, player: p, data: {} });
    this.syncCounts();
    this.checkLast();
    this.checkInfectedWin();
  }

  private onDeath(e: DeathEvent<PlayerState>): void {
    const room = this.room;
    if (room.phase !== 'playing' || this.finished) return;
    const v = e.victim;
    const credited = isEnemyKill(room, e);
    if (credited) {
      award(room, e.attacker!, 'kill', XP_SOURCES.kill);
      if (e.headshot) award(room, e.attacker!, 'headshot', XP_SOURCES.headshot);
    }
    for (const s of e.assisters) award(room, s, 'assist', XP_SOURCES.assist);
    if (this.roleOf(v) !== 'survivor' || !this.started) return;

    // A Survivor died: they come back Infected.
    const by = credited && this.roleOf(e.attacker!) === 'infected' ? e.attacker! : null;
    this.setRole(v, 'infected');
    this.intel.forget(v.id);
    if (by) award(room, by, 'infect', INFECTED_XP.infect, 'infections');
    this.tell(null, { kind: 'infected.infect', team: I, player: by?.id ?? null, reason: v.id, points: by ? INFECTED_XP.infect : undefined }, by);
    // The First Infected's bonus lasts until a second player is infected.
    if (this.firstId && this.firstId !== v.id) {
      const first = room.players.get(this.firstId);
      this.firstId = null;
      if (first?.alive) this.reequip(first, false);
    }
    // MW3: every other living Survivor scores when one is infected.
    for (const s of this.members('survivor')) if (s.alive) this.surviveBonus(s);
    this.syncCounts();
    if (!this.checkInfectedWin()) this.checkLast();
  }

  private onLeave(p: PlayerState): void {
    const room = this.room;
    const role = this.roles.get(p.id);
    this.roles.delete(p.id);
    this.intel.forget(p.id);
    if (p.id === this.lastId) this.lastId = null;
    if (room.phase !== 'playing' || this.finished || !this.started) return;
    const left = this.members('infected');
    if (role === 'infected' && left.length === 0) {
      // Every Infected is gone: pick a new First Infected after a short countdown.
      this.started = false;
      this.firstId = null;
      this.pickAt = room.time + INFECTED.repickSec;
      room.sendFeature(null, 'modes.event', { kind: 'infected.countdown', team: null, player: null, reason: 'repick', points: INFECTED.repickSec });
    } else if (role === 'infected' && left.length === 1 && this.firstId !== left[0]!.id) {
      // Down to one Infected: they are the First Infected again (MW3).
      this.makeFirst(left[0]!, false);
    } else if (p.id === this.firstId) this.firstId = null;
    this.syncCounts();
    if (!this.checkInfectedWin()) this.checkLast();
    this.dirty = true;
  }

  /** Exactly one Survivor left: LAST ONE STANDING (once). */
  private checkLast(): void {
    if (!this.started) return;
    const s = this.members('survivor');
    if (s.length !== 1 || s[0]!.id === this.lastId) return;
    const last = s[0]!;
    this.lastId = last.id;
    this.sweepNext = this.room.time + INFECTED.sweepEverySec;
    if (last.alive) this.giveLastBonus(last);
    award(this.room, last, 'lastAlive', INFECTED_XP.lastAlive);
    this.tell(null, { kind: 'infected.last_alive', team: S, player: last.id, points: INFECTED_XP.lastAlive }, last);
  }

  /** Nobody left to infect: the Infected win. */
  private checkInfectedWin(): boolean {
    if (!this.started || this.finished) return false;
    const c = this.counts();
    if (c.survivors > 0 || c.infected === 0) return false;
    this.finished = true;
    this.room.endMatch('score');
    return true;
  }

  checkEnd(): MatchResults['reason'] | null {
    if (!this.started || this.finished) return null;
    const c = this.counts();
    return c.survivors === 0 && c.infected > 0 ? 'score' : null;
  }

  private endOnTime(): void {
    const room = this.room;
    const alive = this.members('survivor');
    if (this.started) {
      for (const s of alive) {
        award(room, s, 'outlast', INFECTED_XP.outlast, 'survivals');
        this.tell(s, { kind: 'infected.outlast', team: S, player: s.id, points: INFECTED_XP.outlast }, s);
      }
      if (alive.length === 1 && alive[0]!.id === this.lastId) {
        const s = alive[0]!;
        award(room, s, 'finalStand', INFECTED_XP.finalStand);
        this.tell(null, { kind: 'infected.final_stand', team: S, player: s.id, points: INFECTED_XP.finalStand }, s);
      }
    }
    this.finished = true;
    room.endMatch('time');
  }

  private surviveBonus(s: PlayerState): void {
    award(this.room, s, 'survive', INFECTED.survivePoints);
    this.tell(s, { kind: 'infected.survive', team: S, player: s.id, points: INFECTED.survivePoints }, s);
  }

  /**
   * Push an announcer event (to one player, or everyone) and emit the core `objective` event
   * for `player` (progression XP and challenges).
   */
  private tell(to: PlayerState | null, ev: ModeEventPayload, player: PlayerState | null): void {
    this.room.sendFeature(to, 'modes.event', ev);
    if (player) this.room.bus.emit('objective', { kind: ev.kind, team: ev.team, player, data: { obj: ev.obj, reason: ev.reason, points: ev.points } });
    this.dirty = true;
  }

  results(room: Room, reason: MatchResults['reason']): MatchResults {
    const res = standardResults(room, reason);
    const c = this.counts();
    res.teamScores = [c.survivors, c.infected];
    if (reason === 'aborted' || reason === 'nuke') return res;
    const survivorsWin = c.survivors > 0;
    res.winnerTeam = survivorsWin ? S : I;
    const won = new Set([...room.players.values()].filter((p) => this.roleOf(p) === (survivorsWin ? 'survivor' : 'infected')).map((p) => p.id));
    res.winners = [...won];
    for (const r of res.players) r.won = won.has(r.id);
    return res;
  }

  // -------------------------------------------------------------------------------------------
  // HUD / bots
  // -------------------------------------------------------------------------------------------

  state(viewer: PlayerState): ModeStatePayload {
    const c = this.counts();
    return {
      mode: 'infected',
      time: qt(this.room.time),
      infected: {
        role: this.roleOf(viewer),
        survivors: c.survivors,
        infected: c.infected,
        pickAt: this.started || this.pickAt === null ? null : qt(this.pickAt),
        waiting: !this.started && this.room.players.size < INFECTED.minPlayers,
        first: this.firstId,
        last: this.lastId,
        sweepUntil: this.lastId && this.room.time < this.sweepUntil ? qt(this.sweepUntil) : null,
      },
    };
  }

  /** Infected bots get their goals from infected-bots.ts (registerBotGoal), not objectives. */
  objectives(): BotObjective[] {
    return [];
  }

  /** Per-player tallies (summary). */
  stat(p: PlayerState, key: string): number {
    return modeExt(p).stats[key] ?? 0;
  }
}
