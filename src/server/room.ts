/**
 * One match instance: players (humans and bots), the 60 Hz tick loop, 20 Hz snapshots, scores,
 * the match phase machine and the per-room extension points (bus, modifiers, entities, timers).
 *
 * Phases: 'lobby' (waiting; players not spawned) -> 'countdown' (spawned, frozen) -> 'playing'
 * -> 'ended' (results shown) -> rotate to the next map / back to 'lobby' / close.
 */
import { randomUUID } from 'node:crypto';
import { SNAPSHOT_EVERY, SNAPSHOT_RATE, TICK_DT, TICK_RATE, type Team } from '../shared/constants';
import { MAP_BY_ID, getMapData, mapsForMode } from '../shared/defs/maps';
import { MODE_BY_ID, type ModeDef } from '../shared/defs/modes';
import type { MatchPhase, MatchResults } from '../shared/events';
import { buildCollisionWorld, type MapData } from '../shared/maps/types';
import { bumpStat } from '../shared/profile';
import type { CollisionWorld } from '../shared/collision';
import { PlayerFlags, q3, stanceFlags, type FeatureId, type FeatureMessages, type InputCmd, type MeSnap, type PlayerSnap, type RoomSummary, type ServerMsg, type ServerMsgOf, type ShotSnap } from '../shared/protocol';
import { copyMoveState, movePose } from '../shared/movement';
import { EventBus, type ServerEvents } from './bus';
import { damage as applyDamage, fire as doFire, kill as doKill, radiusDamage, spawn as doSpawn, updateCombat, type ShotRequest } from './combat';
import { EntityStore } from './entities';
import type { Feature } from './feature';
import { HitboxHistory, type Pose } from './lagcomp';
import { createRules, smallerTeam, standardResults, type ModeRules } from './modes/index';
import { ModifierRegistry } from './modifiers';
import { createPlayer, currentWeapon, emptyStats, type PlayerState } from './player';
import type { Session } from './session';
import { moveParamsFor, stepPlayer } from './sim';
import type { Store } from './store';
import type { DamageInfo } from '../shared/events';
import type { Loadout } from '../shared/loadout';

export interface RoomOptions {
  id?: string;
  name?: string;
  mode: string;
  /** Map id; default: a random map that supports the mode. */
  map?: string;
  /** Default: the mode's maxPlayers. */
  maxPlayers?: number;
  /** Not listed and not used by quick play. */
  private?: boolean;
  /** Start the match on creation (quick play). False: stays in 'lobby' until `startMatch()`. Default true. */
  autoStart?: boolean;
  /** Frozen countdown before play (seconds). Default 0. */
  countdownSec?: number;
  /** Results screen time after a match (seconds). Default 10. */
  postMatchSec?: number;
  /** After the results: next map and play again, back to the lobby phase, or close. Default 'rotate'. */
  onEnd?: 'rotate' | 'lobby' | 'close';
  /** Keep humans + bots at least this many (bots leave as humans join). Default 0. */
  botFill?: number;
  /** Close a few seconds after the last human leaves. Default true. */
  closeWhenEmpty?: boolean;
  /** Save human profiles at match end (default true). */
  persist?: boolean;
}

export interface RoomDeps {
  store: Store | null;
  features: readonly Feature[];
  log: (msg: string) => void;
  /** Run the tick loop on a timer (false in unit tests that call `step()` themselves). */
  autoTick: boolean;
  onClose?: (room: Room) => void;
}

interface Timer {
  at: number;
  fn: () => void;
  every: number | null;
  id: number;
}

const EMPTY_CLOSE_SEC = 5;

export class Room {
  readonly id: string;
  name: string;
  mode: ModeDef;
  mapId: string;
  map: MapData;
  world: CollisionWorld;
  rules: ModeRules;
  readonly options: Required<Omit<RoomOptions, 'id' | 'map' | 'name'>>;

  readonly bus: EventBus<ServerEvents>;
  readonly modifiers = new ModifierRegistry();
  readonly entities = new EntityStore();
  readonly history = new HitboxHistory();
  readonly players = new Map<string, PlayerState>();

  phase: MatchPhase = 'lobby';
  /** Seconds since the room was created (sim time; the clock clients sync to). */
  time = 0;
  tick = 0;
  matchStartTime = 0;
  /** Room time the current phase ends (countdown / ended), or null. */
  phaseEndsAt: number | null = null;
  teamScores: [number, number] = [0, 0];
  results: MatchResults | null = null;
  /**
   * Set by a feature that has decided how this match ends (the Tactical Nuke): scores freeze and
   * only `endMatch(endLock)` ends it (score/time/round ends wait). Cleared at each match start.
   */
  endLock: MatchResults['reason'] | null = null;
  closed = false;
  private closing = false;

  private timers: Timer[] = [];
  private timerSeq = 0;
  private shots: ShotSnap[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastWall = 0;
  private acc = 0;
  private botSeq = 0;
  private emptySince: number | null = null;
  private lastEndCheck = 0;
  private scoreDirty = false;

  constructor(
    opts: RoomOptions,
    readonly deps: RoomDeps,
  ) {
    const mode = MODE_BY_ID.get(opts.mode);
    if (!mode) throw new Error(`unknown mode: ${opts.mode}`);
    this.mode = mode;
    this.id = opts.id ?? randomUUID().slice(0, 8);
    this.name = opts.name ?? `${mode.name}`;
    this.mapId = opts.map && MAP_BY_ID.has(opts.map) ? opts.map : pickMap(mode.id);
    this.map = getMapData(this.mapId);
    this.world = buildCollisionWorld(this.map);
    this.options = {
      mode: mode.id,
      maxPlayers: opts.maxPlayers ?? mode.maxPlayers,
      private: opts.private ?? false,
      autoStart: opts.autoStart ?? true,
      countdownSec: opts.countdownSec ?? 0,
      postMatchSec: opts.postMatchSec ?? 10,
      onEnd: opts.onEnd ?? 'rotate',
      botFill: opts.botFill ?? 0,
      closeWhenEmpty: opts.closeWhenEmpty ?? true,
      persist: opts.persist ?? true,
    };
    this.bus = new EventBus<ServerEvents>((name, err) => this.log(`event ${name} handler failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`));
    this.rules = createRules(mode.id, mode.teams);
    this.setupRules();
    for (const f of deps.features) {
      try {
        f.room?.(this);
      } catch (err) {
        this.log(`feature ${f.id} room() failed: ${String(err)}`);
      }
    }
    if (this.options.autoStart) this.startMatch();
    if (deps.autoTick) this.startLoop();
  }

  /** Rules' bus handlers and modifiers are owned by the rules object so `setMode` can drop them. */
  private setupRules() {
    this.bus.withOwner(this.rules, () => this.modifiers.withOwner(this.rules, () => this.rules.setup(this)));
  }

  log(msg: string) {
    this.deps.log(`[room ${this.id}] ${msg}`);
  }

  // -------------------------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------------------------

  private startLoop() {
    this.lastWall = performance.now();
    this.interval = setInterval(() => {
      const now = performance.now();
      this.acc += Math.min(0.25, (now - this.lastWall) / 1000);
      this.lastWall = now;
      let n = 0;
      while (this.acc >= TICK_DT && n < 8) {
        this.acc -= TICK_DT;
        this.step();
        n++;
        if (this.closed) return;
      }
    }, 1000 / TICK_RATE);
  }

  /** Advance one fixed tick. Public so tests can drive a room without timers. */
  step(): void {
    if (this.closed) return;
    const dt = TICK_DT;
    this.time += dt;
    this.tick += 1;
    this.runTimers();
    if (this.phase === 'playing' || this.phase === 'countdown') {
      for (const p of this.players.values()) stepPlayer(this, p);
      for (const p of this.players.values()) updateCombat(this, p, dt);
    }
    this.history.record(
      this.time,
      [...this.players.values()].map((p) => [p.id, { ...movePose(p.move, p.yaw), alive: p.alive }] as [string, Pose]),
    );
    this.updatePhase();
    this.bus.emit('tick', { dt, time: this.time, tick: this.tick });
    this.flushScore();
    if (this.tick % SNAPSHOT_EVERY === 0) this.sendSnapshots();
    this.checkEmpty();
  }

  private updatePhase() {
    if (this.phase === 'countdown' && this.phaseEndsAt !== null && this.time >= this.phaseEndsAt) this.beginPlay();
    else if (this.phase === 'playing') {
      const limit = this.mode.timeLimitSec;
      if (limit > 0 && this.time - this.matchStartTime >= limit) this.endMatch('time');
      else if (this.time - this.lastEndCheck >= 1) {
        this.lastEndCheck = this.time;
        this.checkEnd();
      }
    } else if (this.phase === 'ended' && this.phaseEndsAt !== null && this.time >= this.phaseEndsAt) this.afterMatch();
  }

  private checkEmpty() {
    if (!this.options.closeWhenEmpty) return;
    const humans = this.humans().length;
    if (humans > 0) this.emptySince = null;
    else if (this.emptySince === null) this.emptySince = this.time;
    else if (this.time - this.emptySince >= EMPTY_CLOSE_SEC) this.close();
  }

  /** Run `fn` after `delaySec` of room time. Returns a cancel function. */
  schedule(delaySec: number, fn: () => void): () => void {
    return this.addTimer(this.time + delaySec, fn, null);
  }

  /** Run `fn` every `intervalSec` of room time. Returns a cancel function. */
  every(intervalSec: number, fn: () => void): () => void {
    return this.addTimer(this.time + intervalSec, fn, intervalSec);
  }

  private addTimer(at: number, fn: () => void, every: number | null): () => void {
    const t: Timer = { at, fn, every, id: ++this.timerSeq };
    this.timers.push(t);
    return () => {
      this.timers = this.timers.filter((x) => x !== t);
    };
  }

  private runTimers() {
    if (!this.timers.length) return;
    const due = this.timers.filter((t) => t.at <= this.time);
    if (!due.length) return;
    for (const t of due) {
      if (t.every !== null) t.at += t.every;
      else this.timers = this.timers.filter((x) => x !== t);
      try {
        t.fn();
      } catch (err) {
        this.log(`timer failed: ${String(err)}`);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Players
  // -------------------------------------------------------------------------------------------

  humans(): PlayerState[] {
    return [...this.players.values()].filter((p) => !p.isBot);
  }

  bots(): PlayerState[] {
    return [...this.players.values()].filter((p) => p.isBot);
  }

  get isFull(): boolean {
    return this.humans().length >= this.options.maxPlayers;
  }

  /** Add a connected human. The lobby calls this; features use lobby.join/quickPlay. */
  addHuman(session: Session): PlayerState {
    if (session.room && session.room !== this) session.room.removePlayer(session.player!.id, 'left');
    // Make room: a bot gives up its place.
    if (this.players.size >= this.options.maxPlayers) {
      const bot = this.bots()[0];
      if (bot) this.removePlayer(bot.id, 'kicked');
    }
    const p = createPlayer(session.id, session.profile.name, { session, profile: session.profile, time: this.time });
    session.room = this;
    session.player = p;
    this.admit(p, undefined, () => session.send(this.joinedMsg(p)));
    this.fillBots();
    return p;
  }

  /** Add a bot (bots feature attaches `player.brain` on `playerJoin` or here). */
  addBot(opts: { name?: string; team?: Team | null; loadout?: Loadout } = {}): PlayerState {
    const id = `bot-${++this.botSeq}`;
    const p = createPlayer(id, opts.name ?? `Bot ${this.botSeq}`, { isBot: true, time: this.time });
    if (opts.loadout) p.nextLoadout = opts.loadout;
    this.admit(p, opts.team);
    return p;
  }

  /** Order matters for clients: joined, then roster, then spawned, then score. */
  private admit(p: PlayerState, team?: Team | null, announce?: () => void) {
    p.team = this.mode.teams ? (team !== undefined && team !== null ? team : (this.rules.assignTeam?.(this, p) ?? smallerTeam(this, p))) : (this.rules.assignTeam?.(this, p) ?? null);
    this.players.set(p.id, p);
    announce?.();
    this.bus.emit('playerJoin', { player: p });
    this.broadcastRoster();
    if (this.phase === 'playing' || this.phase === 'countdown') {
      if (this.phase === 'countdown' || this.mode.respawn) doSpawn(this, p);
    }
    this.broadcastScore();
  }

  removePlayer(id: string, reason: ServerEvents['playerLeave']['reason'] = 'left'): void {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.bus.emit('playerLeave', { player: p, reason });
    if (p.session) {
      if (p.session.room === this) {
        p.session.room = null;
        p.session.player = null;
      }
      if (reason !== 'disconnect') p.session.send({ t: 'left', reason });
      if (p.profile && this.options.persist) this.deps.store?.save(p.profile);
    }
    for (const e of [...this.entities.all()]) if (e.owner === id) this.entities.remove(e.id);
    this.broadcastRoster();
    this.broadcastScore();
    if (!p.isBot) this.fillBots();
  }

  /** Keep humans + bots at `options.botFill` (no-op when 0). */
  fillBots(): void {
    const target = Math.min(this.options.botFill, this.options.maxPlayers);
    if (target <= 0 || this.closing) return;
    while (this.players.size < target) this.addBot();
    while (this.players.size > target && this.bots().length) this.removePlayer(this.bots().at(-1)!.id, 'kicked');
  }

  /** Queue inputs from the network (validated by the caller). */
  queueInputs(p: PlayerState, cmds: InputCmd[]) {
    for (const c of cmds) if (c.seq > p.lastSeq) p.inputQueue.push(c);
    if (p.inputQueue.length > 120) p.inputQueue.splice(0, p.inputQueue.length - 120);
  }

  isEnemy(a: PlayerState, b: PlayerState): boolean {
    if (a === b) return false;
    if (!this.mode.teams) return true;
    return a.team === null || b.team === null || a.team !== b.team;
  }

  /** Friendly fire is off: only enemies (or yourself, for explosives) take damage. */
  canDamage(attacker: PlayerState, victim: PlayerState): boolean {
    return attacker === victim || this.isEnemy(attacker, victim);
  }

  enemiesOf(p: PlayerState): PlayerState[] {
    return [...this.players.values()].filter((q) => this.isEnemy(p, q));
  }

  // -------------------------------------------------------------------------------------------
  // Combat API (thin wrappers so features don't import combat.ts)
  // -------------------------------------------------------------------------------------------

  /** Fire the player's current weapon (bots call this; human shots come from `fire` messages). */
  fire(p: PlayerState, req: Partial<ShotRequest> & { dir: ShotRequest['dir'] }) {
    return doFire(this, p, { time: req.time ?? this.time, origin: req.origin ?? null, dir: req.dir, shot: req.shot ?? Math.floor(Math.random() * 1e9) });
  }
  damage(info: DamageInfo<PlayerState>) {
    return applyDamage(this, info);
  }
  kill(victim: PlayerState, attacker: PlayerState | null, how: Parameters<typeof doKill>[3]) {
    doKill(this, victim, attacker, how);
  }
  radiusDamage(...args: Parameters<typeof radiusDamage> extends [Room, ...infer R] ? R : never) {
    return radiusDamage(this, ...args);
  }
  spawn(p: PlayerState, point?: Parameters<typeof doSpawn>[2]) {
    doSpawn(this, p, point);
  }

  recordShot(s: ShotSnap) {
    this.shots.push(s);
  }

  // -------------------------------------------------------------------------------------------
  // Scores and match flow
  // -------------------------------------------------------------------------------------------

  addTeamScore(team: Team, delta: number, reason: string, player: PlayerState | null = null): void {
    if (this.phase !== 'playing' || this.endLock) return;
    this.teamScores[team] += delta;
    this.bus.emit('scoreChange', { team, player, delta, reason, teamScores: [this.teamScores[0], this.teamScores[1]] });
    this.broadcastScore();
    this.checkEnd();
  }

  addPlayerScore(p: PlayerState, delta: number, reason: string): void {
    if (this.phase !== 'playing' || this.endLock) return;
    p.stats.score += delta;
    this.bus.emit('scoreChange', { team: p.team, player: p, delta, reason, teamScores: [this.teamScores[0], this.teamScores[1]] });
    this.broadcastScore();
    this.checkEnd();
  }

  private checkEnd() {
    if (this.phase !== 'playing') return;
    const reason = this.rules.checkEnd?.(this);
    if (reason) this.endMatch(reason);
  }

  private setPhase(phase: MatchPhase, endsAt: number | null) {
    const prev = this.phase;
    this.phase = phase;
    this.phaseEndsAt = endsAt;
    this.bus.emit('phase', { phase, prev });
    this.broadcast({ t: 'phase', phase, time: this.time, endsAt });
  }

  /** Start a match (from 'lobby' or after results). Resets scores and spawns everyone. */
  startMatch(): void {
    if (this.closed) return;
    this.teamScores = [0, 0];
    this.results = null;
    this.endLock = null;
    this.entities.clear();
    this.history.clear();
    for (const p of this.players.values()) {
      p.stats = emptyStats();
      p.alive = false;
      p.respawnAt = null;
      p.joinTime = this.time;
    }
    this.rules.reset?.(this);
    const countdown = this.options.countdownSec;
    if (countdown > 0) {
      this.setPhase('countdown', this.time + countdown);
      for (const p of this.players.values()) doSpawn(this, p);
    } else {
      this.beginPlay();
    }
    this.broadcastScore();
  }

  private beginPlay() {
    this.matchStartTime = this.time;
    this.lastEndCheck = this.time;
    this.setPhase('playing', this.mode.timeLimitSec > 0 ? this.time + this.mode.timeLimitSec : null);
    for (const p of this.players.values()) if (!p.alive) doSpawn(this, p);
    this.bus.emit('matchStart', { time: this.time });
  }

  /** End the match now: results, `matchEnd` event, profile stats + save, results to clients. */
  endMatch(reason: MatchResults['reason'], results?: MatchResults): void {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    if (this.endLock && reason !== this.endLock) return;
    const res = results ?? this.rules.results?.(this, reason) ?? standardResults(this, reason);
    this.results = res;
    this.setPhase('ended', this.time + this.options.postMatchSec);
    for (const p of this.players.values()) {
      p.alive = false;
      p.respawnAt = null;
    }
    this.recordCareerStats(res);
    this.bus.emit('matchEnd', { results: res });
    this.flushScore();
    this.broadcast({ t: 'matchEnd', results: res });
    for (const p of this.humans()) {
      if (!p.profile) continue;
      if (this.options.persist) this.deps.store?.save(p.profile);
      p.session?.send({ t: 'profile', profile: p.profile });
    }
  }

  /** Core career stats (features add their own in `matchEnd` handlers). */
  private recordCareerStats(res: MatchResults) {
    for (const r of res.players) {
      const p = this.players.get(r.id);
      const prof = p?.profile;
      if (!prof) continue;
      const m = `mode.${res.mode}.`;
      for (const [k, v] of [['kills', r.kills], ['deaths', r.deaths], ['assists', r.assists], ['headshots', r.headshots], ['score', r.score]] as const) {
        bumpStat(prof, k, v);
        bumpStat(prof, m + k, v);
      }
      bumpStat(prof, 'matches');
      bumpStat(prof, m + 'matches');
      const draw = res.winners.length === 0;
      if (!draw) {
        bumpStat(prof, r.won ? 'wins' : 'losses');
        bumpStat(prof, m + (r.won ? 'wins' : 'losses'));
      }
      bumpStat(prof, 'timePlayed', Math.round(r.timePlayed));
      prof.stats.bestStreak = Math.max(prof.stats.bestStreak ?? 0, r.bestStreak);
    }
  }

  private afterMatch() {
    const what = this.options.onEnd;
    if (what === 'close') return this.close();
    if (what === 'lobby') return this.returnToLobby();
    const maps = mapsForMode(this.mode.id).map((m) => m.id);
    const next = maps.length > 1 ? maps.filter((m) => m !== this.mapId)[Math.floor(Math.random() * (maps.length - 1))]! : this.mapId;
    this.setMap(next);
    this.startMatch();
  }

  /** Back to the waiting phase (custom lobbies: map vote, countdown...). */
  returnToLobby(): void {
    for (const p of this.players.values()) {
      p.alive = false;
      p.respawnAt = null;
    }
    this.entities.clear();
    this.setPhase('lobby', null);
  }

  /** Change map (lobby/ended phases). Re-sends `joined` so clients load it. */
  setMap(mapId: string): void {
    if (!MAP_BY_ID.has(mapId)) throw new Error(`unknown map: ${mapId}`);
    this.mapId = mapId;
    this.map = getMapData(mapId);
    this.world = buildCollisionWorld(this.map);
    this.history.clear();
    for (const p of this.humans()) p.session?.send(this.joinedMsg(p));
  }

  /** Change mode (lobby phase): new rules instance. Features' room hooks are NOT re-run. */
  setMode(modeId: string): void {
    const mode = MODE_BY_ID.get(modeId);
    if (!mode) throw new Error(`unknown mode: ${modeId}`);
    this.bus.offOwner(this.rules);
    this.modifiers.offOwner(this.rules);
    this.mode = mode;
    this.rules = createRules(mode.id, mode.teams);
    this.setupRules();
    for (const p of this.players.values()) p.team = mode.teams ? smallerTeam(this, p) : null;
    for (const p of this.humans()) p.session?.send(this.joinedMsg(p));
    this.broadcastRoster();
  }

  close(): void {
    if (this.closed) return;
    this.closing = true;
    for (const p of [...this.players.values()]) this.removePlayer(p.id, 'closed');
    this.closed = true;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.timers = [];
    this.bus.clear();
    this.modifiers.clear();
    this.deps.onClose?.(this);
  }

  // -------------------------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------------------------

  send(p: PlayerState, msg: ServerMsg): void {
    p.session?.send(msg);
  }

  broadcast(msg: ServerMsg, except?: PlayerState): void {
    for (const p of this.players.values()) if (p !== except) p.session?.send(msg);
  }

  /** Feature push to one player, or everyone (`to` = null). */
  sendFeature<K extends FeatureId>(to: PlayerState | null, id: K, data: FeatureMessages[K]): void {
    if (to) to.session?.sendFeature(id, data);
    else for (const p of this.players.values()) p.session?.sendFeature(id, data);
  }

  joinedMsg(p: PlayerState): ServerMsgOf<'joined'> {
    return {
      t: 'joined',
      roomId: this.id,
      you: p.id,
      mode: this.mode.id,
      map: this.mapId,
      team: p.team,
      phase: this.phase,
      tickRate: TICK_RATE,
      snapshotRate: SNAPSHOT_RATE,
      time: this.time,
      timeLimit: this.mode.timeLimitSec,
      scoreLimit: this.mode.scoreLimit,
    };
  }

  broadcastRoster(): void {
    const players = [...this.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.isBot, level: p.profile?.level ?? 1, prestige: p.profile?.prestige ?? 0 }));
    this.broadcast({ t: 'roster', players });
  }

  /** Mark the scoreboard changed; it goes out once at the end of the tick (or before results). */
  broadcastScore(): void {
    this.scoreDirty = true;
  }

  private flushScore(): void {
    if (!this.scoreDirty) return;
    this.scoreDirty = false;
    const players = [...this.players.values()].map((p) => ({ id: p.id, kills: p.stats.kills, deaths: p.stats.deaths, assists: p.stats.assists, score: p.stats.score, headshots: p.stats.headshots, streak: p.stats.streak }));
    this.broadcast({ t: 'score', teams: this.mode.teams ? [this.teamScores[0], this.teamScores[1]] : null, players });
  }

  /** Enemy ids on `viewer`'s radar: modifiers first, then the fired-recently default. */
  radarFor(viewer: PlayerState): string[] {
    const out: string[] = [];
    for (const q of this.players.values()) {
      if (!q.alive || !this.isEnemy(viewer, q)) continue;
      const vote = this.modifiers.any('radarVisible', q, viewer);
      if (vote === true || (vote === undefined && !q.lastFireSuppressed && this.time - q.lastFireTime < 1.5)) out.push(q.id);
    }
    return out;
  }

  private playerSnap(p: PlayerState): PlayerSnap {
    const m = p.move;
    const w = currentWeapon(p);
    let f = 0;
    if (p.alive) f |= PlayerFlags.ALIVE;
    f |= stanceFlags(m);
    if (m.sprinting) f |= PlayerFlags.SPRINT;
    if (m.ads > 0.5) f |= PlayerFlags.ADS;
    if (m.onGround) f |= PlayerFlags.GROUND;
    if (p.reloadEnd > 0) f |= PlayerFlags.RELOADING;
    if (this.time - p.lastFireTime < 0.12) f |= PlayerFlags.FIRING;
    if (this.time < p.swapEnd) f |= PlayerFlags.SWITCHING;
    return { id: p.id, x: q3(m.x), y: q3(m.y), z: q3(m.z), vx: q3(m.vx), vy: q3(m.vy), vz: q3(m.vz), yaw: q3(p.yaw), pitch: q3(p.pitch), f, w: w?.def.base.id ?? '', c: w?.camo ?? 'none' };
  }

  private meSnap(p: PlayerState): MeSnap {
    return {
      id: p.id,
      alive: p.alive,
      health: Math.ceil(p.health),
      maxHealth: p.maxHealth,
      move: copyMoveState(p.move),
      params: moveParamsFor(this, p),
      slot: p.slot,
      weapons: p.weapons.map((w) => ({ id: w.def.base.id, attachments: w.def.attachmentIds, camo: w.camo, mag: w.mag, reserve: w.reserve })),
      reloadEnd: p.reloadEnd,
      swapEnd: p.swapEnd > this.time ? p.swapEnd : 0,
      respawnAt: p.respawnAt,
      streak: p.stats.streak,
    };
  }

  private sendSnapshots() {
    const players = [...this.players.values()].map((p) => this.playerSnap(p));
    const ents = this.entities.snapshot();
    const shots = this.shots;
    this.shots = [];
    const teams: [number, number] | null = this.mode.teams ? [this.teamScores[0], this.teamScores[1]] : null;
    const timeLeft = this.phase === 'playing' && this.mode.timeLimitSec > 0 ? Math.max(0, this.matchStartTime + this.mode.timeLimitSec - this.time) : null;
    for (const p of this.players.values()) {
      const s = p.session;
      if (!s || !s.open || s.congested) continue;
      s.send({
        t: 'snap',
        tick: this.tick,
        time: this.time,
        ack: p.lastSeq,
        phase: this.phase,
        me: this.meSnap(p),
        players,
        ents,
        shots: shots.filter((x) => x.p !== p.id),
        teams,
        timeLeft,
        radar: this.radarFor(p),
        jammed: this.modifiers.any('radarJammed', p) === true,
      });
    }
  }

  summary(): RoomSummary {
    return {
      id: this.id,
      mode: this.mode.id,
      map: this.mapId,
      phase: this.phase,
      players: this.players.size,
      humans: this.humans().length,
      maxPlayers: this.options.maxPlayers,
      private: this.options.private,
      name: this.name,
    };
  }
}

function pickMap(mode: string): string {
  const maps = mapsForMode(mode);
  if (!maps.length) return 'yard';
  return maps[Math.floor(Math.random() * maps.length)]!.id;
}
