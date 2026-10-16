/**
 * One Zombies game in a room (owner: zombies): the round director, the undead bodies, points,
 * downs and revives, game over and the state pushed to clients. Buyables (wall-buys, Perk-a-Colas,
 * the Mystery Box) live in buy.ts, power-ups in powerups.ts, spawn picking in spawner.ts and the
 * zombie brain in brain.ts. Formulas and numbers: src/shared/defs/zombies.ts.
 *
 * Bodies: zombies and hellhounds are bots on team 1 (core players), so every gun, grenade, knife and
 * wonder weapon, hitboxes (headshots), lag compensation, hitmarkers and the killfeed work on them
 * unchanged. They are pooled: a corpse lies for `corpseSec`, then the body is reused for the next
 * spawn. The bots feature's soldier brain never drives them (its brain is dropped on join and the
 * room's bot count is not managed in Zombies); `ZombieBrain` does.
 */
import { HEALTH, type Team } from '../../../shared/constants';
import { DOGS, POINTS, dogHealth, dogSpawnWait, dogsForRound, downedLoss, firstDogRound, killPoints, newDropTracker, nextDogRound, PERK_COLA_BY_ID, PERK_EFFECTS, rollGait, roundUpToTen, roundXp, scaledPoints, spawnDelay, STARTING_WEAPON, ZOMBIE_SPEED, zombieDamageMult, zombieHealth, ZOMBIES, ZOMBIES_LOADOUT, ZOMBIES_TEAMS, zombiesForRound, type DropTracker, type PerkColaId, type ZombiesEventPayload, type ZombiesPhase, type ZombiesPlayerInfo, type ZombiesStatePayload } from '../../../shared/defs/zombies';
import { MOVE } from '../../../shared/constants';
import { EQUIPMENT_BY_ID } from '../../../shared/defs/equipment';
import { cloneLoadout, type Loadout } from '../../../shared/loadout';
import type { MatchResults } from '../../../shared/events';
import type { SpawnPoint } from '../../../shared/maps/types';
import { zombiesLayer, type ZombiesLayer } from '../../../shared/maps/zombies/index';
import type { Vec3 } from '../../../shared/math';
import { forceSlot } from '../../combat';
import { standardResults } from '../../modes/index';
import { makeWeapon, type PlayerState, type WeaponState } from '../../player';
import type { Room } from '../../room';
import { getRoomBots, configureRoomBots } from '../bots/api';
import { enterLastStand, reviveFromLastStand } from '../perks/laststand';
import { getLobbyBotSettings } from '../frontend/index';
import { createHorde, ZombieBrain, type Horde } from './brain';
import { Buyables } from './buy';
import { Powerups } from './powerups';
import { pickZombieSpawn, spawnCandidates } from './spawner';
import { newSurvivor, survivorOf, undeadOf, type SurvivorExt, type UndeadExt } from './state';
import '../weapons/state';
import '../pickups/drops';
import '../progression/events';

const P = ZOMBIES_TEAMS.players as Team;
const Z = ZOMBIES_TEAMS.zombies as Team;
const STATE_EVERY = 1;
/** Spare bodies kept beyond the alive cap (corpses waiting to be reused). */
const SPARE_BODIES = 10;
const DOG_BODIES = 12;
/** Ally bots in co-op at most (humans + allies <= 4). */
const MAX_SURVIVORS = 4;

/** Pistols a downed survivor fights with, best first (BO1: the Ray Gun if you have it, else a pistol, else an M1911). */
const LAST_STAND_PICKS = ['raygun', 'python', 'asp', 'm1911'];

export interface ZombiesResultsExt {
  round: number;
  map: string;
  players: { id: string; name: string; bot: boolean; kills: number; headshots: number; downs: number; revives: number; points: number }[];
}

export class ZombiesGame {
  layer: ZombiesLayer | null;
  horde: Horde;
  buy: Buyables;
  powerups: Powerups;
  round = 0;
  phase: ZombiesPhase = 'pre';
  phaseEndsAt: number | null = null;
  dogRound = false;
  /** Dog rounds so far (1 = the first). */
  dogRounds = 0;
  nextDog: number;
  /** Zombies (or dogs) still to spawn this round. */
  queue = 0;
  nextSpawnAt = 0;
  lastSpawn: Vec3 | null = null;
  /** Every undead body (alive or a corpse). */
  readonly bodies: PlayerState[] = [];
  readonly brains = new Map<string, ZombieBrain>();
  drops: DropTracker;
  instaUntil = 0;
  doubleUntil = 0;
  /** Solo Quick Revive purchases left. */
  soloLives: number = ZOMBIES.soloReviveLives;
  survived: number | null = null;
  gameOverAt: number | null = null;
  dirty = true;
  private lastPush = -999;
  private adding: 'zombie' | 'dog' | null = null;
  private candidates: Vec3[] = [];
  /** Points lost when a survivor went down (paid to whoever revives them). */
  private lostOnDown = new Map<string, number>();
  private downPrevSlot = new Map<string, number>();
  private rnd: () => number;

  constructor(
    readonly room: Room,
    rnd: () => number = Math.random,
  ) {
    this.rnd = rnd;
    this.layer = zombiesLayer(room.mapId);
    this.horde = createHorde(room, (a, v, amount, weapon) => this.swipe(a, v, amount, weapon));
    this.drops = newDropTracker(1);
    this.nextDog = firstDogRound(rnd());
    this.buy = new Buyables(this);
    this.powerups = new Powerups(this);
  }

  // -------------------------------------------------------------------------------------------
  // Wiring (called from the rules' setup, so `room.setMode` drops everything)
  // -------------------------------------------------------------------------------------------

  setup(): void {
    const room = this.room;
    room.bus.on('playerJoin', ({ player }) => this.onJoin(player), { priority: 100 });
    room.bus.on('playerJoin', ({ player }) => {
      // Our bodies: the bots feature attached its soldier brain to the bot as it joined; drop it.
      if (undeadOf(player)) getRoomBots(room)?.brains.delete(player.id);
    }, { priority: -100 });
    room.bus.on('playerLeave', ({ player, reason }) => this.onLeave(player, reason));
    room.bus.on('beforeSpawn', (e) => {
      // Forced loadout: after progression's gate (100), the frontend trim (90) and economy (-50).
      e.loadout = this.loadoutFor(e.player);
    }, { priority: -60 });
    room.bus.on('spawn', ({ player }) => this.afterSpawn(player), { priority: -10 });
    room.bus.on('beforeDamage', (ev) => this.beforeDamage(ev), { priority: 50 });
    room.bus.on('damage', (ev) => {
      // +10 for a hit that didn't kill (BO1 `damage` / `damage_light`).
      if (ev.health > 0 && ev.attacker && undeadOf(ev.victim) && survivorOf(ev.attacker) && ev.means !== 'world') this.award(ev.attacker, 10, 'hit');
    });
    room.bus.on('death', (e) => this.onDeath(e.victim, e.attacker, e.part, e.means, e.headshot), { priority: 10 });
    room.bus.on('perks.revived', ({ player, by }) => this.onRevived(player, by));
    // A survivor's gun never drops on the floor in Zombies.
    room.bus.on('pickups.dropped', ({ entity }) => room.entities.remove(entity));
    room.bus.on('matchStart', () => this.onMatchStart());
    room.bus.on('matchEnd', () => {
      // Combat record: the best round reached (the Zombies menu shows it).
      const round = this.survived ?? this.round;
      for (const p of room.humans()) {
        const prof = p.profile;
        if (prof && round > (prof.stats['zombies.bestRound'] ?? 0)) prof.stats['zombies.bestRound'] = round;
      }
    });
    room.bus.on('tick', ({ dt }) => this.tick(dt));

    const m = room.modifiers;
    m.add('speedMultiplier', (p) => {
      const z = undeadOf(p);
      if (!z) return undefined;
      // Dogs run crouched (a low body): crouch speed is x0.55 of the walk.
      return z.kind === 'dog' ? ZOMBIE_SPEED.dog / (MOVE.walk * MOVE.crouch) : ZOMBIE_SPEED[z.gait] / MOVE.walk;
    }, 'zombies.speed');
    m.add('canSprint', (p) => (undeadOf(p) ? false : undefined), 'zombies.sprint');
    m.add('regenDelayMultiplier', (p) => (undeadOf(p) ? 1e6 : undefined), 'zombies.regen');
    m.add('damageDealt', (a, info) => (survivorOf(a) && undeadOf(info.victim) ? zombieDamageMult(info.weapon, info.means) : undefined), 'zombies.damage');
    m.add('reloadMultiplier', (p) => (this.hasPerk(p, 'speed') ? PERK_EFFECTS.speedReload : undefined), 'zombies.speedcola');
    m.add('fireRateMultiplier', (p) => (this.hasPerk(p, 'doubletap') ? PERK_EFFECTS.doubleTapRate : undefined), 'zombies.doubletap');
    m.add('useClaimed', (p) => (this.buy.claimsUse(p) ? true : undefined), 'zombies.use');
    // Grenades: carry up to four (BO1), refilled each round.
    m.add('equipmentCountOffset', (p, kind) => {
      if (!survivorOf(p) || kind !== 'lethal') return undefined;
      const id = p.ext.weapons?.lethal ?? p.loadout?.lethal;
      const base = id ? (EQUIPMENT_BY_ID.get(id)?.count ?? 1) : 1;
      return ZOMBIES.maxGrenades - base;
    }, 'zombies.grenades');
  }

  // -------------------------------------------------------------------------------------------
  // Players
  // -------------------------------------------------------------------------------------------

  private onJoin(p: PlayerState): void {
    if (this.adding) {
      const kind = this.adding;
      const z: UndeadExt = { kind, gait: kind === 'dog' ? 'sprint' : 'walk', spawnedAt: this.room.time, progressAt: this.room.time, bestDist: Infinity, nuked: false, lastPart: null };
      p.ext.zombies = z;
      const brain = new ZombieBrain(this.horde, p);
      this.brains.set(p.id, brain);
      p.brain = brain;
      p.team = Z;
      this.bodies.push(p);
      return;
    }
    p.team = P;
    p.ext.zombies = newSurvivor(ZOMBIES.startPoints);
    // Joining mid-game: wait for the next round (BO1 spectators respawn between rounds).
    if (this.room.phase === 'playing' && this.phase !== 'pre') survivorOf(p)!.dead = true;
    this.dirty = true;
  }

  private onLeave(p: PlayerState, _reason: string): void {
    const z = undeadOf(p);
    if (z) {
      const i = this.bodies.indexOf(p);
      if (i >= 0) this.bodies.splice(i, 1);
      this.brains.delete(p.id);
      // A body kicked by core (room full) mid-round goes back in the queue.
      if (p.alive && this.phase === 'active') this.queue++;
      return;
    }
    this.lostOnDown.delete(p.id);
    this.dirty = true;
  }

  loadoutFor(_p: PlayerState): Loadout {
    return cloneLoadout(ZOMBIES_LOADOUT);
  }

  private afterSpawn(p: PlayerState): void {
    if (undeadOf(p)) {
      p.weapons = [];
      p.slot = 0;
      return;
    }
    const s = survivorOf(p);
    if (!s) return;
    // BO1: the M1911 with 8 + 32, two frag grenades, no perks.
    const w = makeWeapon({ weapon: STARTING_WEAPON.weapon, attachments: [], camo: 'none' }, STARTING_WEAPON.weapon);
    w.mag = STARTING_WEAPON.mag;
    w.reserve = STARTING_WEAPON.reserve;
    p.weapons = [w];
    p.slot = 0;
    s.perks = [];
    s.dead = false;
    s.selfReviveAt = null;
    s.downedWeapons = null;
    s.drinkingUntil = 0;
    p.maxHealth = HEALTH.max;
    p.health = p.maxHealth;
    if (p.isBot) this.armAlly(p);
    const x = p.ext.weapons;
    if (x && x.lethal) x.lethalN = ZOMBIES.startGrenades;
    this.dirty = true;
  }

  /** Ally bots (co-op fill) scavenge a gun each life and round: no points, no buying. */
  private armAlly(p: PlayerState): void {
    const guns = ['mp5k', 'ak74u', 'm16a4', 'mpl', 'olympia', 'stakeout'];
    const pick = guns[Math.floor(this.rnd() * guns.length)]!;
    const w = makeWeapon({ weapon: pick, attachments: [], camo: 'none' }, pick);
    if (p.weapons.length < 2) p.weapons.unshift(w);
    else p.weapons[0] = w;
    for (const g of p.weapons) g.reserve = g.def.reserve * 2;
    p.slot = 0;
  }

  /** Survivors in the room (humans and ally bots). */
  survivors(): PlayerState[] {
    const out: PlayerState[] = [];
    for (const p of this.room.players.values()) if (survivorOf(p)) out.push(p);
    return out;
  }

  get solo(): boolean {
    return this.survivors().length <= 1;
  }

  hasPerk(p: PlayerState, id: PerkColaId): boolean {
    return !!survivorOf(p)?.perks.includes(id);
  }

  isDown(p: PlayerState): boolean {
    return !!p.ext.perks?.lastStand;
  }

  /** Up and able to act (alive, not down). */
  isUp(p: PlayerState): boolean {
    return p.alive && !this.isDown(p) && !!survivorOf(p);
  }

  // -------------------------------------------------------------------------------------------
  // Points
  // -------------------------------------------------------------------------------------------

  doubled(): boolean {
    return this.room.time < this.doubleUntil;
  }

  /**
   * Give points (rounded up to 5 and doubled by Double Points unless `raw`). Downed players earn
   * nothing (wiki: "while down, the player cannot earn points from any source"). Returns the amount.
   */
  award(p: PlayerState, amount: number, reason: string, opts: { raw?: boolean; quiet?: boolean } = {}): number {
    const s = survivorOf(p);
    if (!s || !p.alive || this.isDown(p) || amount <= 0 || this.phase === 'over' || p.isBot) return 0;
    const pts = opts.raw ? amount : scaledPoints(amount, this.doubled());
    s.points += pts;
    s.total += pts;
    p.stats.score = s.total;
    this.room.broadcastScore();
    if (!opts.quiet) this.event({ kind: 'points', player: p.id, amount: pts, text: reason }, p);
    this.dirty = true;
    return pts;
  }

  /** Spend points if there are enough. */
  spend(p: PlayerState, cost: number): boolean {
    const s = survivorOf(p);
    if (!s || s.points < cost) return false;
    s.points -= cost;
    this.event({ kind: 'points', player: p.id, amount: -cost }, p);
    this.dirty = true;
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Match flow
  // -------------------------------------------------------------------------------------------

  /** Each match start (the rules' reset, before the phase changes). */
  reset(): void {
    const room = this.room;
    this.layer = zombiesLayer(room.mapId);
    this.horde = createHorde(room, (a, v, amount, weapon) => this.swipe(a, v, amount, weapon));
    this.round = 0;
    this.phase = 'pre';
    this.phaseEndsAt = null;
    this.dogRound = false;
    this.dogRounds = 0;
    this.nextDog = firstDogRound(this.rnd());
    this.queue = 0;
    this.instaUntil = 0;
    this.doubleUntil = 0;
    this.soloLives = ZOMBIES.soloReviveLives;
    this.survived = null;
    this.gameOverAt = null;
    this.lostOnDown.clear();
    this.downPrevSlot.clear();
    this.candidates = spawnCandidates(room.map, this.layer);
    // Zombies own the bot count: no bots-feature backfill or core botFill (either would trim our bodies).
    configureRoomBots(room, {}, { managed: false });
    for (const b of room.bots()) if (undeadOf(b)) room.removePlayer(b.id, 'kicked');
    this.bodies.length = 0;
    this.brains.clear();
    this.fillAllies();
    room.options.botFill = 0;
    for (const p of room.players.values()) {
      p.team = P;
      p.ext.zombies = newSurvivor(ZOMBIES.startPoints);
    }
    room.broadcastRoster();
    this.drops = newDropTracker(this.survivors().length);
    this.dirty = true;
  }

  /** Co-op lobbies with bot fill on: ally bots up to the target (at most 4 survivors). */
  private fillAllies(): void {
    const room = this.room;
    const s = getLobbyBotSettings(room);
    const humans = room.humans().length;
    const want = s && s.fill ? Math.max(0, Math.min(MAX_SURVIVORS, s.targetPlayers) - humans) : 0;
    const allies = room.bots().filter((b) => !undeadOf(b));
    for (const b of allies.slice(want)) room.removePlayer(b.id, 'kicked');
    for (let i = allies.length; i < want; i++) room.addBot({ team: P, loadout: cloneLoadout(ZOMBIES_LOADOUT) });
  }

  private onMatchStart(): void {
    this.phase = 'pre';
    this.phaseEndsAt = this.room.time + ZOMBIES.firstRoundDelay;
    this.buy.reset();
    this.powerups.reset();
    this.dirty = true;
  }

  private startRound(r: number): void {
    const room = this.room;
    this.round = r;
    this.phase = 'active';
    this.phaseEndsAt = null;
    const players = Math.max(1, this.survivors().length);
    this.dogRound = r === this.nextDog;
    let count: number;
    if (this.dogRound) {
      this.dogRounds++;
      this.nextDog = nextDogRound(r, this.rnd());
      count = dogsForRound(this.dogRounds, players);
      this.nextSpawnAt = room.time + DOGS.introSec;
    } else {
      count = zombiesForRound(r, players);
      this.nextSpawnAt = room.time + (r === 1 ? 0.5 : 1.5);
    }
    this.queue = count;
    this.drops.dropsThisRound = 0;
    // BO1: spectators respawn between rounds; survivors get grenades topped up.
    for (const p of this.survivors()) {
      const s = survivorOf(p)!;
      s.boardPoints = 0;
      if (!p.alive || s.dead) {
        if (room.phase === 'playing') room.spawn(p);
      } else if (r > 1) this.topUpGrenades(p);
      if (p.isBot && p.alive) this.armAlly(p);
    }
    this.event({ kind: this.dogRound ? 'dog_round' : 'round_start', round: r });
    room.bus.emit('zombies.roundStart', { round: r, dogs: this.dogRound, count });
    this.dirty = true;
  }

  private endRound(): void {
    const room = this.room;
    const r = this.round;
    this.phase = 'break';
    this.phaseEndsAt = room.time + ZOMBIES.betweenRoundSec;
    for (const p of room.humans()) {
      if (!survivorOf(p)) continue;
      room.bus.emit('progression.xp', { player: p, key: 'zombies.round', label: 'ROUND SURVIVED', amount: roundXp(r) });
      room.bus.emit('progression.metric', { player: p, metric: 'zombies_round', amount: r });
    }
    this.event({ kind: 'round_end', round: r });
    room.bus.emit('zombies.roundEnd', { round: r });
    this.dirty = true;
  }

  private topUpGrenades(p: PlayerState): void {
    const x = p.ext.weapons;
    if (!x || !x.lethal) return;
    // `award_grenades_for_survivors`: under a quarter -> 2, under half -> 3, else 4.
    const n = x.lethalN;
    const want = n < 1 ? 2 : n < 2 ? 3 : ZOMBIES.maxGrenades;
    if (want > n) this.room.bus.emit('perks.resupply', { player: p, lethal: want - n, tactical: 0 });
  }

  // -------------------------------------------------------------------------------------------
  // Bodies
  // -------------------------------------------------------------------------------------------

  aliveUndead(): PlayerState[] {
    return this.bodies.filter((b) => b.alive);
  }

  private addBody(kind: 'zombie' | 'dog'): PlayerState {
    this.adding = kind;
    try {
      return this.room.addBot({ name: kind === 'dog' ? 'Hellhound' : 'Zombie', team: Z, loadout: cloneLoadout(ZOMBIES_LOADOUT) });
    } finally {
      this.adding = null;
    }
  }

  /** Spawn one zombie or hellhound out of sight. False when there is no body or spot for it now. */
  spawnOne(kind: 'zombie' | 'dog'): boolean {
    const room = this.room;
    const now = room.time;
    const watchers = this.survivors().filter((s) => s.alive);
    const at = pickZombieSpawn(room.world, this.candidates, watchers, this.lastSpawn, this.rnd);
    if (!at) return false;
    let body = this.bodies.find((b) => !b.alive && undeadOf(b)?.kind === kind && now - b.diedAt >= ZOMBIES.corpseSec);
    if (!body) {
      const ofKind = this.bodies.filter((b) => undeadOf(b)?.kind === kind).length;
      const cap = kind === 'dog' ? DOG_BODIES : ZOMBIES.maxAlive + SPARE_BODIES;
      if (ofKind >= cap) return false;
      body = this.addBody(kind);
    }
    const z = undeadOf(body)!;
    z.gait = kind === 'dog' ? 'sprint' : rollGait(this.round, this.rnd());
    z.spawnedAt = now;
    z.progressAt = now;
    z.bestDist = Infinity;
    z.nuked = false;
    z.lastPart = null;
    let near = watchers[0];
    let bd = Infinity;
    for (const s of watchers) {
      const d = Math.hypot(s.move.x - at.x, s.move.z - at.z);
      if (d < bd) {
        bd = d;
        near = s;
      }
    }
    const yaw = near ? Math.atan2(-(near.move.x - at.x), -(near.move.z - at.z)) : 0;
    const point: SpawnPoint = { x: at.x + (this.rnd() - 0.5) * 0.6, y: at.y, z: at.z + (this.rnd() - 0.5) * 0.6, yaw };
    if (!room.world.free(point.x, point.y + 0.05, point.z)) {
      point.x = at.x;
      point.z = at.z;
    }
    room.spawn(body, point);
    const hp = kind === 'dog' ? dogHealth(this.dogRounds) : zombieHealth(this.round);
    body.maxHealth = hp;
    body.health = hp;
    body.damageLog = [];
    this.brains.get(body.id)?.reset(now);
    this.lastSpawn = at;
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Damage, kills
  // -------------------------------------------------------------------------------------------

  private swipe(attacker: PlayerState, victim: PlayerState, amount: number, weapon: string): void {
    if (!this.isUp(victim)) return;
    this.room.damage({ victim, attacker, amount, weapon, part: 'torso', means: 'melee', from: { x: attacker.move.x, y: attacker.move.y + 1.2, z: attacker.move.z }, distance: Math.hypot(attacker.move.x - victim.move.x, attacker.move.z - victim.move.z) });
  }

  private beforeDamage(ev: { victim: PlayerState; attacker: PlayerState | null; amount: number; weapon: string; part: 'head' | 'torso' | 'legs' | null; means: string; cancel: boolean }): void {
    if (ev.cancel) return;
    const v = ev.victim;
    const z = undeadOf(v);
    if (z) {
      const a = ev.attacker;
      if (a && undeadOf(a)) {
        ev.cancel = true;
        return;
      }
      z.lastPart = ev.part;
      // Insta-Kill: anything kills.
      if (a && survivorOf(a) && this.room.time < this.instaUntil) ev.amount = Math.max(ev.amount, v.health + 1);
      return;
    }
    const s = survivorOf(v);
    if (!s) return;
    if (this.phase === 'over') return;
    // Down players are left alone; friendly fire (and your own splash) never downs you twice.
    if (this.isDown(v)) {
      ev.cancel = true;
      return;
    }
    if (ev.amount < v.health) return;
    ev.cancel = true;
    v.health = 1;
    v.lastDamageTime = this.room.time;
    this.goDown(v, ev.attacker, ev.weapon, ev.means);
    v.session?.send({ t: 'hurt', attacker: ev.attacker?.id ?? null, amount: Math.round(ev.amount), from: null, health: Math.ceil(v.health) });
  }

  private onDeath(victim: PlayerState, attacker: PlayerState | null, part: 'head' | 'torso' | 'legs' | null, means: string, headshot: boolean): void {
    const z = undeadOf(victim);
    if (z) {
      const failsafe = means === 'world' && !attacker && !z.nuked;
      if (failsafe && this.phase === 'active') this.queue++;
      const credited = attacker && survivorOf(attacker) && !z.nuked && !failsafe;
      if (credited) {
        const s = survivorOf(attacker)!;
        s.kills++;
        if (headshot) s.headshots++;
        this.award(attacker, killPoints(part ?? z.lastPart, means), headshot ? 'headshot' : means === 'melee' ? 'knife' : 'kill');
      }
      if (!failsafe) this.powerups.onKill(victim, z);
      this.dirty = true;
      return;
    }
    const s = survivorOf(victim);
    if (s) {
      s.dead = true;
      this.dirty = true;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Downs and revives (perks/laststand.ts machinery)
  // -------------------------------------------------------------------------------------------

  goDown(p: PlayerState, attacker: PlayerState | null, weapon: string, means: string): void {
    const room = this.room;
    const s = survivorOf(p)!;
    s.downs++;
    const solo = this.solo;
    if (solo && !s.perks.includes('revive')) {
      // Solo without Quick Revive: that's the game.
      this.event({ kind: 'down', player: p.id });
      room.kill(p, null, { weapon: 'downed', means: 'world' });
      this.checkGameOver();
      return;
    }
    const lost = downedLoss(s.points);
    s.points -= lost;
    this.lostOnDown.set(p.id, lost);
    this.losePerks(p);
    this.downPrevSlot.set(p.id, p.slot);
    enterLastStand(room, p, {
      attacker,
      weapon,
      means,
      durationSec: solo ? ZOMBIES.soloReviveSec + 5 : ZOMBIES.bleedOutSec,
      revivable: !solo,
      reviveSecFor: (r) => ZOMBIES.reviveSec * (this.hasPerk(r, 'revive') ? PERK_EFFECTS.reviveSpeed : 1),
      reviveScore: 0,
      onBleedOut: () => this.bleedOut(p),
      pistol: false,
    });
    // The pistol in hand while down (BO1: the Ray Gun or your pistol, else a loaner M1911).
    s.downedWeapons = p.weapons;
    let pistol: WeaponState | undefined;
    for (const id of LAST_STAND_PICKS) {
      pistol = p.weapons.find((w) => w.def.base.id === id && w.mag + w.reserve > 0);
      if (pistol) break;
    }
    if (!pistol) {
      pistol = makeWeapon({ weapon: 'm1911', attachments: [], camo: 'none' }, 'm1911');
      pistol.mag = 8;
      pistol.reserve = 24;
    }
    p.weapons = [pistol];
    p.slot = 0;
    p.reloadEnd = 0;
    p.swapEnd = room.time + 0.5;
    p.slotLock = { slot: 0, until: room.time + 1.5 };
    if (solo) s.selfReviveAt = room.time + ZOMBIES.soloReviveSec;
    this.event({ kind: 'down', player: p.id });
    this.dirty = true;
  }

  private losePerks(p: PlayerState): void {
    const s = survivorOf(p)!;
    s.perks = [];
    s.drinkingUntil = 0;
    p.maxHealth = HEALTH.max;
    p.health = Math.min(p.health, p.maxHealth);
  }

  private onRevived(p: PlayerState, by: PlayerState): void {
    const s = survivorOf(p);
    if (!s) return;
    const room = this.room;
    s.selfReviveAt = null;
    if (s.downedWeapons) {
      p.weapons = s.downedWeapons;
      s.downedWeapons = null;
    }
    const prev = this.downPrevSlot.get(p.id) ?? 0;
    const slot = prev < p.weapons.length ? prev : 0;
    p.slot = -1;
    forceSlot(room, p, slot);
    room.sendFeature(p, 'perks.lastStand', { until: null, revive: 0, slot });
    p.health = p.maxHealth;
    const lost = this.lostOnDown.get(p.id) ?? 0;
    this.lostOnDown.delete(p.id);
    if (by !== p) {
      const bs = survivorOf(by);
      if (bs) bs.revives++;
      // Wiki: reviving pays 5% of the downed player's points (what they lost going down).
      if (lost > 0) this.award(by, lost, 'revive', { raw: true });
      room.bus.emit('progression.xp', { player: by, key: 'zombies.revive', label: 'REVIVE', amount: 50 });
    }
    this.event({ kind: 'revived', player: p.id });
    this.dirty = true;
  }

  private bleedOut(p: PlayerState): void {
    const room = this.room;
    const s = survivorOf(p);
    if (s?.downedWeapons) s.downedWeapons = null;
    room.kill(p, null, { weapon: 'bleedout', means: 'world' });
    // `penalty_no_revive`: everyone else up loses 10%.
    for (const q of this.survivors()) {
      const qs = survivorOf(q)!;
      if (q === p || !this.isUp(q)) continue;
      qs.points -= Math.min(qs.points, roundUpToTen(Math.trunc(qs.points * ZOMBIES.noRevivePenalty)));
    }
    this.event({ kind: 'bleedout', player: p.id });
    this.dirty = true;
  }

  /** Every human down (no self-revive coming) or dead: the game is over. */
  private checkGameOver(): void {
    if (this.phase === 'over') return;
    const humans = this.room.humans().filter((h) => survivorOf(h));
    if (!humans.length) return;
    for (const h of humans) {
      const s = survivorOf(h)!;
      if (h.alive && !this.isDown(h)) return;
      if (h.alive && s.selfReviveAt !== null) return;
    }
    this.gameOver();
  }

  gameOver(): void {
    const room = this.room;
    this.phase = 'over';
    this.survived = Math.max(1, this.round);
    this.queue = 0;
    this.horde.frozen = true;
    this.gameOverAt = room.time + ZOMBIES.gameOverSec;
    this.phaseEndsAt = this.gameOverAt;
    for (const p of this.survivors()) {
      const s = survivorOf(p)!;
      s.selfReviveAt = null;
      if (p.alive) room.kill(p, null, { weapon: 'gameover', means: 'world' });
    }
    this.event({ kind: 'game_over', round: this.survived });
    room.bus.emit('zombies.gameOver', { round: this.survived });
    this.dirty = true;
  }

  // -------------------------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------------------------

  private tick(dt: number): void {
    const room = this.room;
    if (room.phase !== 'playing') return;
    const now = room.time;
    // Who the horde hunts, and the bodies it keeps its distance from.
    this.horde.targets = this.survivors().filter((p) => this.isUp(p));
    this.horde.bodies = this.aliveUndead();

    // Everyone down or dead (checked before the between-rounds respawn below brings the dead back).
    if (this.phase !== 'over' && this.phase !== 'pre') this.checkGameOver();
    if (this.phase === 'pre' || this.phase === 'break') {
      // Late joiners and the dead come in between rounds (BO1 `spectators_respawn`).
      for (const p of this.survivors()) if (!p.alive) room.spawn(p);
    }
    if (this.phase === 'pre' && this.phaseEndsAt !== null && now >= this.phaseEndsAt) this.startRound(1);
    else if (this.phase === 'break' && this.phaseEndsAt !== null && now >= this.phaseEndsAt) this.startRound(this.round + 1);
    else if (this.phase === 'active') this.director(now);
    else if (this.phase === 'over' && this.gameOverAt !== null && now >= this.gameOverAt) {
      room.endMatch('score');
      return;
    }

    // Solo Quick Revive.
    for (const p of this.survivors()) {
      const s = survivorOf(p)!;
      if (s.selfReviveAt !== null && now >= s.selfReviveAt && p.alive && this.isDown(p)) reviveFromLastStand(room, p, p);
    }
    if (this.phase !== 'over') {
      this.buy.tick(dt);
      this.powerups.tick(dt);
      this.checkGameOver();
    }
    if (this.dirty || now - this.lastPush >= STATE_EVERY) this.pushState();
  }

  private director(now: number): void {
    const room = this.room;
    const alive = this.horde.bodies.length;
    const kind = this.dogRound ? 'dog' : 'zombie';
    const cap = this.dogRound ? Math.max(1, this.horde.targets.length) * DOGS.alivePerPlayer : ZOMBIES.maxAlive;
    if (this.queue > 0 && alive < cap && now >= this.nextSpawnAt) {
      if (this.spawnOne(kind)) {
        this.queue--;
        if (this.dogRound) {
          const max = dogsForRound(this.dogRounds, Math.max(1, this.survivors().length));
          this.nextSpawnAt = now + Math.max(0.2, dogSpawnWait(this.dogRounds, max - this.queue, max));
        } else this.nextSpawnAt = now + spawnDelay(this.round);
        this.dirty = true;
      } else this.nextSpawnAt = now + 0.5;
    }
    // `zombie_speed_up`: rounds 4-9, the last zombie standing sprints.
    if (!this.dogRound && this.round > 3 && this.round < 10 && this.queue === 0 && alive === 1) {
      const z = undeadOf(this.horde.bodies[0]!);
      if (z) z.gait = 'sprint';
    }
    // `round_spawn_failsafe`: a zombie that got no closer to anyone for a long time comes back elsewhere.
    for (const b of this.horde.bodies) {
      const z = undeadOf(b)!;
      if (now - z.progressAt > ZOMBIES.failsafeSec && now - z.spawnedAt > ZOMBIES.failsafeSec) room.kill(b, null, { weapon: 'failsafe', means: 'world' });
    }
    if (this.queue <= 0 && this.aliveUndead().length === 0) this.endRound();
  }

  // -------------------------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------------------------

  event(e: ZombiesEventPayload, to: PlayerState | null = null): void {
    this.room.sendFeature(to, 'zombies.event', e);
  }

  state(): ZombiesStatePayload {
    const players: ZombiesPlayerInfo[] = [];
    for (const p of this.survivors()) {
      const s = survivorOf(p)!;
      const ls = p.ext.perks?.lastStand ?? null;
      players.push({ id: p.id, points: s.points, perks: [...s.perks], down: !!ls && p.alive, downUntil: ls ? (s.selfReviveAt ?? ls.until) : null, selfRevive: s.selfReviveAt !== null, revive: ls && ls.reviveBy ? ls.revive / (ls.reviveSecFor ? Math.max(0.1, ls.reviveSecFor(this.room.players.get(ls.reviveBy) ?? p)) : ZOMBIES.reviveSec) : 0, dead: s.dead || !p.alive, kills: s.kills, headshots: s.headshots, downs: s.downs, revives: s.revives, ...(s.drinkingUntil > this.room.time ? { drinking: s.drinkingUntil } : {}) });
    }
    return {
      round: this.round,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      dogRound: this.dogRound,
      left: this.queue + this.aliveUndead().length,
      solo: this.solo,
      players,
      insta: this.instaUntil > this.room.time ? this.instaUntil : 0,
      double: this.doubleUntil > this.room.time ? this.doubleUntil : 0,
      dogs: this.bodies.filter((b) => undeadOf(b)?.kind === 'dog').map((b) => b.id),
      soloLives: this.soloLives,
      survived: this.survived,
    };
  }

  pushState(): void {
    this.dirty = false;
    this.lastPush = this.room.time;
    if (this.room.phase === 'lobby') return;
    const st = this.state();
    for (const p of this.room.humans()) this.room.sendFeature(p, 'zombies.state', st);
  }

  results(reason: MatchResults['reason']): MatchResults {
    const room = this.room;
    const res = standardResults(room, reason);
    res.players = res.players.filter((r) => {
      const p = room.players.get(r.id);
      return !p || !undeadOf(p);
    });
    res.players.forEach((r, i) => {
      r.place = i + 1;
      r.won = false;
    });
    res.winners = [];
    res.winnerTeam = null;
    res.teamScores = [this.survived ?? this.round, 0];
    const ext: ZombiesResultsExt = {
      round: this.survived ?? this.round,
      map: room.mapId,
      players: this.survivors().map((p) => {
        const s = survivorOf(p) as SurvivorExt;
        return { id: p.id, name: p.name, bot: p.isBot, kills: s.kills, headshots: s.headshots, downs: s.downs, revives: s.revives, points: s.total };
      }),
    };
    res.ext.zombies = ext;
    return res;
  }

  /** Destroyed windows (Carpenter needs 5); no barriers on a layer = none. */
  brokenWindows(): number {
    return 0;
  }

  /** Carpenter: every board back up, +200 to everyone up. */
  carpenter(): void {
    for (const q of this.survivors()) this.award(q, POINTS.carpenter, 'carpenter');
  }

  /** Perk bought: the drink, then the perk (buy.ts). */
  givePerk(p: PlayerState, id: PerkColaId): void {
    const s = survivorOf(p);
    if (!s || s.perks.includes(id)) return;
    s.perks.push(id);
    if (id === 'jugg') p.maxHealth = ZOMBIES.jugHealth;
    this.event({ kind: 'perk', player: p.id, id, text: PERK_COLA_BY_ID.get(id)!.name });
    this.dirty = true;
  }
}
