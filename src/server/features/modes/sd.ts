/**
 * Search and Destroy: one life per round. Rounds run prep (frozen, `prepSec`) -> live
 * (`roundSec`) -> planted (bomb timer `bombSec`) -> post (`postSec`), then the next round with
 * everyone respawned. Team 0 attacks first; sides switch after `halftimeAfter` rounds. First to
 * `roundsToWin` (ModeDef.scoreLimit) takes the match.
 *
 * - The bomb starts on a random attacker. A carrier who dies drops it where they fell; any living
 *   attacker picks it up by walking over it (`pickupRadius`).
 * - Plant: the carrier holds USE inside a site (MapData.objectives.sd, radius per site) for
 *   `plantSec`; defuse: a defender holds USE within `defuseReach` of the bomb for `defuseSec`.
 *   Letting go, leaving or dying resets the progress. Planting/defusing players can't move.
 * - Round wins: attackers eliminated before a plant (defenders), defenders eliminated
 *   (attackers, planted or not), time out before a plant (defenders), bomb defused (defenders),
 *   bomb detonates (attackers; it also kills everyone within `explosionRadius`). A team with no
 *   players at all can't be eliminated (so solo practice doesn't loop).
 * - Spawns: attackers at the side away from the sites (site `team` = the defending side's spawn
 *   index, default 1), defenders at the sites' side.
 */
import type { Team } from '../../../shared/constants';
import type { MatchResults } from '../../../shared/events';
import { MODE_TUNING, MODE_XP } from '../../../shared/defs/modes';
import { MODE_ENTITY, type BombState, type ModeStatePayload, type SdPhase, type SdRoundReason } from '../../../shared/defs/modestate';
import { Buttons } from '../../../shared/input';
import type { ObjectivePoint, SpawnPoint } from '../../../shared/maps/types';
import type { Vec3 } from '../../../shared/math';
import type { Entity } from '../../entities';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import type { BotObjective } from './bots';
import { announce, award, groundAt, objectivePoints, otherTeam, q2, qt, rankSpawns, resetModeExt, scoreKill, teamCounts } from './common';
import { TdmRules } from './tdm';

const T = MODE_TUNING.sd;

interface Site {
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;
}

interface Acting {
  kind: 'plant' | 'defuse';
  t: number;
  site: string;
}

export class SdRules extends TdmRules {
  override readonly id = 'sd';
  override readonly statKeys = ['plants', 'defuses'];
  round = 0;
  roundsPlayed = 0;
  attackers: Team = 0;
  switched = false;
  phase: SdPhase = 'prep';
  endsAt = 0;
  sites: Site[] = [];
  /** Spawn side (index into map.spawns.teams) of the defenders. */
  private defendSide: 0 | 1 = 1;
  bomb: { state: BombState; carrier: PlayerState | null; pos: Vec3; site: string | null; planter: PlayerState | null } = { state: 'carried', carrier: null, pos: { x: 0, y: 0, z: 0 }, site: null, planter: null };
  private bombEnt: Entity | null = null;
  readonly acting = new Map<PlayerState, Acting>();
  lastRound: { winner: Team; reason: SdRoundReason } | null = null;
  private lastAliveWarned: [boolean, boolean] = [false, false];

  get defenders(): Team {
    return otherTeam(this.attackers);
  }

  override setup(room: Room): void {
    this.setupController(room);
    room.bus.on('death', (e) => {
      scoreKill(room, e, false);
      const v = e.victim;
      this.acting.delete(v);
      if (this.bomb.carrier === v) this.dropBomb(v.move);
      this.dirty = true;
    });
    room.bus.on('playerLeave', ({ player }) => {
      this.acting.delete(player);
      if (this.bomb.carrier === player) this.dropBomb(player.move);
      this.dirty = true;
    });
    room.bus.on('playerJoin', ({ player }) => {
      // Joining during prep: in for this round. Otherwise they wait (one life).
      if (room.phase === 'playing' && this.phase === 'prep' && !player.alive) {
        room.spawn(player);
        // The round started with no attackers: the first one in gets the bomb.
        if (player.team === this.attackers && this.bomb.state === 'dropped' && this.round > 0) {
          this.bomb = { ...this.bomb, state: 'carried', carrier: player };
          this.syncBombEntity();
        }
      }
      this.dirty = true;
    });
    room.bus.on('matchStart', () => this.startRound(true));
    room.bus.on('tick', ({ dt }) => this.tick(dt));
    // Frozen during prep, and while planting/defusing.
    room.modifiers.add('speedMultiplier', (p) => (room.phase === 'playing' && (this.phase === 'prep' || this.acting.has(p)) ? 0 : undefined), 'modes.sd.freeze');
    room.modifiers.add('sprintMultiplier', (p) => (room.phase === 'playing' && (this.phase === 'prep' || this.acting.has(p)) ? 0 : undefined), 'modes.sd.freeze');
    room.bus.on('beforeDamage', (e) => {
      if (room.phase === 'playing' && this.phase === 'prep') e.cancel = true;
    });
    // Plant / defuse own the USE key where they are possible (weapon pickups stand aside).
    room.modifiers.add('useClaimed', (p) => (room.phase === 'playing' && this.canUseObjective(p) ? true : undefined), 'modes.sd.use');
  }

  /** Could `p` plant or defuse right here by holding USE? */
  canUseObjective(p: PlayerState): boolean {
    if (!p.alive) return false;
    if (this.acting.has(p)) return true;
    if (this.phase === 'live' && this.bomb.state === 'carried' && this.bomb.carrier === p) return !!this.inSite(p);
    return this.phase === 'planted' && this.canDefuse(p);
  }

  override reset(room: Room): void {
    resetModeExt(room);
    const pts = objectivePoints(room.map, 'sd');
    this.defendSide = (pts[0]?.team ?? 1) as 0 | 1;
    this.sites = pts.map((p: ObjectivePoint) => ({ id: p.id, x: p.x, y: groundAt(room, p.x, p.z, p.y), z: p.z, r: p.radius }));
    this.round = 0;
    this.roundsPlayed = 0;
    this.attackers = 0;
    this.switched = false;
    this.phase = 'prep';
    this.endsAt = room.time + T.prepSec;
    this.lastRound = null;
    this.acting.clear();
    this.bombEnt = null;
    this.bomb = { state: 'carried', carrier: null, pos: { x: 0, y: 0, z: 0 }, site: null, planter: null };
    this.dirty = true;
  }

  /** One life: nobody respawns mid-round. */
  override respawnDelay(): number | null {
    return null;
  }

  override spawnPoints(room: Room, p: PlayerState): SpawnPoint[] {
    if (p.team === null) return room.map.spawns.ffa;
    const pts = this.roleSpawns(p.team === this.attackers ? 'attackers' : 'defenders');
    return pts.length ? rankSpawns(room, p, pts) : room.map.spawns.ffa;
  }

  /**
   * Spawns for a role: the map's `modeSpawns.sd.attackers` / `.defenders` when it has them (they stay
   * with the role when teams swap at halftime), else the team spawn side for that role.
   */
  roleSpawns(role: 'attackers' | 'defenders'): SpawnPoint[] {
    const own = this.room.map.modeSpawns?.sd?.[role];
    if (own && own.length) return own;
    return this.room.map.spawns.teams[role === 'attackers' ? otherSide(this.defendSide) : this.defendSide];
  }

  override checkEnd(room: Room): MatchResults['reason'] | null {
    const limit = room.mode.scoreLimit || T.roundsToWin;
    return room.teamScores[0] >= limit || room.teamScores[1] >= limit ? 'rounds' : null;
  }

  // -------------------------------------------------------------------------------------------
  // Rounds
  // -------------------------------------------------------------------------------------------

  private startRound(first: boolean): void {
    const room = this.room;
    if (room.phase !== 'playing') return;
    this.round += 1;
    this.phase = 'prep';
    this.endsAt = room.time + T.prepSec;
    this.acting.clear();
    this.lastAliveWarned = [false, false];
    if (this.bombEnt) room.entities.remove(this.bombEnt.id);
    this.bombEnt = null;
    // Everyone back at their side (the first round's spawns already came from core).
    if (!first) for (const p of room.players.values()) room.spawn(p);
    const atk = [...room.players.values()].filter((p) => p.team === this.attackers && p.alive);
    const carrier = atk.length ? atk[Math.floor(Math.random() * atk.length)]! : null;
    this.bomb = { state: 'carried', carrier, pos: carrier ? { ...carrier.move } : { x: 0, y: 0, z: 0 }, site: null, planter: null };
    if (!carrier) this.dropBomb(this.attackSpawnCentre());
    room.bus.emit('modes.roundStart', { round: this.round, attackers: this.attackers, carrier });
    // Who carries is only told to the attackers.
    announce(room, { kind: 'sd.round_start', team: this.attackers, player: carrier?.id ?? null, points: this.round }, carrier, this.attackers);
    for (const p of room.players.values()) if (p.team === this.defenders) room.sendFeature(p, 'modes.event', { kind: 'sd.round_start', team: this.attackers, player: null, points: this.round });
    this.dirty = true;
  }

  private attackSpawnCentre(): Vec3 {
    const pts = this.roleSpawns('attackers');
    if (!pts.length) return { x: 0, y: 0, z: 0 };
    const p = pts[0]!;
    return { x: p.x, y: p.y, z: p.z };
  }

  private endRound(winner: Team, reason: SdRoundReason): void {
    const room = this.room;
    if (this.phase === 'post') return;
    this.phase = 'post';
    this.endsAt = room.time + T.postSec;
    this.acting.clear();
    this.lastRound = { winner, reason };
    this.roundsPlayed += 1;
    room.bus.emit('modes.roundEnd', { round: this.round, winner, reason });
    announce(room, { kind: 'sd.round_end', team: winner, player: null, reason, points: this.round });
    this.dirty = true;
    room.addTeamScore(winner, 1, 'round');
  }

  private nextRound(): void {
    if (!this.switched && this.roundsPlayed >= T.halftimeAfter) {
      this.switched = true;
      this.attackers = otherTeam(this.attackers);
      announce(this.room, { kind: 'sd.halftime', team: this.attackers, player: null });
    }
    this.startRound(false);
  }

  // -------------------------------------------------------------------------------------------
  // Bomb
  // -------------------------------------------------------------------------------------------

  private dropBomb(at: Vec3): void {
    const room = this.room;
    const carrier = this.bomb.carrier;
    const y = groundAt(room, at.x, at.z, at.y);
    this.bomb = { ...this.bomb, state: 'dropped', carrier: null, pos: { x: at.x, y, z: at.z } };
    this.syncBombEntity();
    if (carrier && room.phase === 'playing' && this.phase !== 'post') announce(room, { kind: 'sd.drop', team: this.attackers, player: carrier.id }, carrier, this.attackers);
  }

  private syncBombEntity(): void {
    const room = this.room;
    const b = this.bomb;
    if (b.state === 'carried') {
      if (this.bombEnt) room.entities.remove(this.bombEnt.id);
      this.bombEnt = null;
      return;
    }
    if (!this.bombEnt || !room.entities.get(this.bombEnt.id)) this.bombEnt = room.entities.add({ kind: MODE_ENTITY.bomb, x: b.pos.x, y: b.pos.y, z: b.pos.z, yaw: 0, team: this.attackers, s: {} });
    const e = this.bombEnt;
    e.x = b.pos.x;
    e.y = b.pos.y;
    e.z = b.pos.z;
    e.team = this.attackers;
    e.s = { st: b.state, site: b.site ?? '', end: b.state === 'planted' ? qt(this.endsAt) : 0 };
  }

  private plant(p: PlayerState, site: Site): void {
    const room = this.room;
    this.phase = 'planted';
    this.endsAt = room.time + T.bombSec;
    this.bomb = { state: 'planted', carrier: null, pos: { x: p.move.x, y: groundAt(room, p.move.x, p.move.z, p.move.y), z: p.move.z }, site: site.id, planter: p };
    this.acting.clear();
    this.syncBombEntity();
    award(room, p, 'plant', MODE_XP.plant, 'plants');
    announce(room, { kind: 'sd.plant', team: this.attackers, player: p.id, obj: site.id }, p);
  }

  private defuse(p: PlayerState): void {
    const room = this.room;
    this.bomb = { ...this.bomb, state: 'defused' };
    this.syncBombEntity();
    award(room, p, 'defuse', MODE_XP.defuse, 'defuses');
    announce(room, { kind: 'sd.defuse', team: this.defenders, player: p.id, obj: this.bomb.site ?? undefined }, p);
    this.endRound(this.defenders, 'defused');
  }

  private explode(): void {
    const room = this.room;
    this.bomb = { ...this.bomb, state: 'exploded' };
    this.syncBombEntity();
    announce(room, { kind: 'sd.explode', team: this.attackers, player: this.bomb.planter?.id ?? null, obj: this.bomb.site ?? undefined });
    const c = this.bomb.pos;
    room.radiusDamage({ x: c.x, y: c.y + 0.5, z: c.z }, T.explosionRadius, T.explosionDamage, T.explosionDamage * 0.5, { attacker: null, weapon: 'bomb', means: 'explosive' });
    this.endRound(this.attackers, 'detonated');
  }

  // -------------------------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------------------------

  private tick(dt: number): void {
    const room = this.room;
    if (room.phase !== 'playing' || this.round === 0) return;
    const now = room.time;
    if (this.phase === 'prep') {
      if (now >= this.endsAt) {
        this.phase = 'live';
        this.endsAt = now + T.roundSec;
        this.dirty = true;
      }
      return;
    }
    if (this.phase === 'post') {
      if (now >= this.endsAt) this.nextRound();
      return;
    }
    // Carrier follows / pickup.
    const b = this.bomb;
    if (b.state === 'carried' && b.carrier) b.pos = { x: b.carrier.move.x, y: b.carrier.move.y, z: b.carrier.move.z };
    if (b.state === 'dropped' && this.phase === 'live') {
      for (const p of room.players.values()) {
        if (!p.alive || p.team !== this.attackers) continue;
        if (Math.hypot(p.move.x - b.pos.x, p.move.z - b.pos.z) <= T.pickupRadius && Math.abs(p.move.y - b.pos.y) < 2) {
          this.bomb = { ...b, state: 'carried', carrier: p };
          this.syncBombEntity();
          announce(room, { kind: 'sd.pickup', team: this.attackers, player: p.id }, p, this.attackers);
          break;
        }
      }
    }
    this.updateActions(dt);
    if (this.phase !== 'live' && this.phase !== 'planted') return;
    // Win conditions.
    const { total, alive } = teamCounts(room);
    const atk = this.attackers;
    const def = this.defenders;
    for (const t of [0, 1] as const) {
      if (total[t] > 1 && alive[t] === 1 && !this.lastAliveWarned[t]) {
        this.lastAliveWarned[t] = true;
        const last = [...room.players.values()].find((p) => p.team === t && p.alive);
        announce(room, { kind: 'sd.last_alive', team: t, player: last?.id ?? null }, last ?? null);
      }
    }
    if (this.phase === 'live') {
      if (total[atk] > 0 && alive[atk] === 0) return this.endRound(def, 'eliminated');
      if (total[def] > 0 && alive[def] === 0) return this.endRound(atk, 'eliminated');
      if (now >= this.endsAt) return this.endRound(def, 'time');
    } else {
      if (total[def] > 0 && alive[def] === 0) return this.endRound(atk, 'eliminated');
      if (now >= this.endsAt) return this.explode();
    }
  }

  private inSite(p: PlayerState): Site | null {
    for (const s of this.sites) if (Math.hypot(p.move.x - s.x, p.move.z - s.z) <= s.r && Math.abs(p.move.y - s.y) < 2.5) return s;
    return null;
  }

  private canDefuse(p: PlayerState): boolean {
    const b = this.bomb;
    return b.state === 'planted' && p.team === this.defenders && Math.hypot(p.move.x - b.pos.x, p.move.z - b.pos.z) <= T.defuseReach && Math.abs(p.move.y - b.pos.y) < 2.5;
  }

  private updateActions(dt: number): void {
    const room = this.room;
    for (const p of room.players.values()) {
      const holding = p.alive && (p.buttons & Buttons.USE) !== 0;
      const cur = this.acting.get(p);
      let want: Acting | null = null;
      if (holding && this.phase === 'live' && this.bomb.state === 'carried' && this.bomb.carrier === p && p.move.onGround) {
        const site = this.inSite(p);
        if (site) want = { kind: 'plant', t: cur?.kind === 'plant' && cur.site === site.id ? cur.t : 0, site: site.id };
      } else if (holding && this.phase === 'planted' && this.canDefuse(p)) {
        want = { kind: 'defuse', t: cur?.kind === 'defuse' ? cur.t : 0, site: this.bomb.site ?? '' };
      }
      if (!want) {
        if (cur) {
          this.acting.delete(p);
          this.dirty = true;
        }
        continue;
      }
      if (!cur) this.dirty = true;
      want.t += dt;
      this.acting.set(p, want);
      if (want.kind === 'plant' && want.t >= T.plantSec) {
        const site = this.sites.find((s) => s.id === want.site)!;
        this.plant(p, site);
        return;
      }
      if (want.kind === 'defuse' && want.t >= T.defuseSec) {
        this.defuse(p);
        return;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // State for clients and bots
  // -------------------------------------------------------------------------------------------

  override state(viewer: PlayerState): ModeStatePayload {
    const { alive } = teamCounts(this.room);
    const b = this.bomb;
    const attacker = viewer.team === this.attackers;
    // The carrier is only told to the attackers.
    const showCarrier = b.state === 'carried' && attacker;
    const pos = b.state === 'carried' && !attacker ? { x: 0, y: 0, z: 0 } : b.pos;
    const act = this.acting.get(viewer);
    return {
      mode: 'sd',
      time: qt(this.room.time),
      sd: {
        round: this.round,
        attackers: this.attackers,
        phase: this.phase,
        endsAt: qt(this.endsAt),
        bomb: { state: b.state, x: q2(pos.x), y: q2(pos.y), z: q2(pos.z), site: b.site, carrier: showCarrier ? (b.carrier?.id ?? null) : null },
        sites: this.sites.map((s) => ({ id: s.id, x: q2(s.x), y: q2(s.y), z: q2(s.z), r: s.r })),
        alive,
        switched: this.switched,
        lastRound: this.lastRound,
      },
      me: act ? { kind: act.kind, target: act.site, progress: q2(act.t / (act.kind === 'plant' ? T.plantSec : T.defuseSec)), rate: q2(1 / (act.kind === 'plant' ? T.plantSec : T.defuseSec)) } : null,
    };
  }

  override objectives(p: PlayerState): BotObjective[] {
    if (p.team === null || (this.phase !== 'live' && this.phase !== 'planted')) return [];
    const b = this.bomb;
    const out: BotObjective[] = [];
    const sitePos = (s: Site) => ({ x: s.x, y: s.y, z: s.z });
    if (p.team === this.attackers) {
      if (b.state === 'carried' && b.carrier === p) {
        // Carrier: plant at the nearer site (stable per round so it doesn't dither).
        const site = this.sites[(this.round + p.id.length) % Math.max(1, this.sites.length)];
        for (const s of this.sites) out.push({ kind: 'plant', id: s.id, pos: sitePos(s), radius: s.r * 0.8, priority: s === site ? 1 : 0.7, holdUse: true, stay: true });
      } else if (b.state === 'dropped') {
        out.push({ kind: 'pickup', id: 'bomb', pos: { ...b.pos }, radius: T.pickupRadius, priority: 0.95 });
      } else if (b.state === 'carried' && b.carrier) {
        out.push({ kind: 'escort', id: 'bomb', pos: { ...b.carrier.move }, radius: 6, priority: 0.5 });
      } else if (b.state === 'planted') {
        out.push({ kind: 'defend', id: b.site ?? 'bomb', pos: { ...b.pos }, radius: 8, priority: 0.9, stay: true });
      }
    } else {
      if (b.state === 'planted') out.push({ kind: 'defuse', id: b.site ?? 'bomb', pos: { ...b.pos }, radius: T.defuseReach * 0.8, priority: 1, holdUse: true, stay: true });
      else {
        // Hold the site (stay): without it defenders walked to a site, "arrived" and went hunting.
        for (const s of this.sites) out.push({ kind: 'defend', id: s.id, pos: sitePos(s), radius: s.r * 2.5, priority: 0.6, stay: true });
        if (b.state === 'dropped') out.push({ kind: 'defend', id: 'bomb', pos: { ...b.pos }, radius: 5, priority: 0.55 });
      }
    }
    return out;
  }
}

const otherSide = (s: 0 | 1): 0 | 1 => (s === 0 ? 1 : 0);
