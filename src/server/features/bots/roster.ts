/**
 * Per-room bot controller: applies a room's LobbyBotSettings (DESIGN.md section 8a).
 *
 *   - Backfill: at every match start (countdown or play) the room is topped up to
 *     `targetPlayers` with bots, teams balanced (bots are re-teamed while everyone is still dead).
 *     Quick-play rooms that start on creation first wait MATCHMAKING_WAIT_SEC for humans.
 *   - A human leaving mid-match is replaced by a bot on the same team.
 *   - A human joining mid-match retires a bot of their team at that bot's next death (a dead bot
 *     goes at once); teams that drift apart get re-balanced by moving a bot at its next death.
 *   - Back in the lobby phase bots leave; they come back at the next start.
 *   - Brains for every bot in the room (also bots other areas add), with per-bot variance and a
 *     loadout picked from the defs; hearing, hurt and streak events are fed to the brains.
 *   - `results.ext.bots` tells economy/progression how many bots played (wagers with bots are
 *     practice only; bots have no profile, so they never earn CoD Points or XP).
 */
import type { Team } from '../../../shared/constants';
import { MATCHMAKING_WAIT_SEC, skillFor, type BotSkill, type BotsState, type LobbyBotSettings } from '../../../shared/defs/bots';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { Brain, streaksEarnedAt, type BrainWorld } from './brain';
import { botBrainFactory } from './hooks';
import { chooseBotLoadout, pickBotName } from './loadout';
import { navFor } from './nav';
import { PathUsage } from './roles';
import type { MapData } from '../../../shared/maps/types';
import { applyVariance, defaultSettings, rollBot, sanitizeSettings, skillRating, type BotRolls } from './skill';

declare module '../../player' {
  interface PlayerExt {
    /** `skill` is the bot's current (varied) skill; other features read it, e.g. killstreaks' `streakUse`. */
    bots?: { rolls: BotRolls; skill?: BotSkill };
  }
}

export interface RoomBotsOptions {
  /** Manage the bot count (default: true unless core botFill is set or LOFI_BOTS=off). */
  managed?: boolean;
  /** Seconds to wait for humans before the first backfill (default: MATCHMAKING_WAIT_SEC for rooms that start on creation, else 0). */
  waitSec?: number;
  /** Session id of the host (may change settings). */
  hostId?: string | null;
}

/** Room time between a marked bot's death and its removal (killfeed still shows its name). */
const RETIRE_DELAY = 1.2;
/** View knock when a bot is hit, degrees (before the flinchMultiplier modifier). */
const FLINCH_DEG = 2.5;

export class RoomBots {
  settings: LobbyBotSettings;
  /** Target comes from the mode default until someone sets it explicitly. */
  targetFromMode = true;
  hostId: string | null = null;
  managed: boolean;
  /** Room time the matchmaking wait ends; null once filling. */
  fillAt: number | null = null;
  readonly brains = new Map<string, Brain>();
  /** Bots to remove at their next death / to move to the other team at their next death. */
  readonly retiring = new Set<string>();
  readonly switching = new Set<string>();
  readonly world: BrainWorld = { fights: [], claims: new Map(), usage: null, nav: { tick: -1, used: 0 } };
  private cancelWait: (() => void) | null = null;
  private offs: (() => void)[] = [];
  private lastMode: string;
  private usageMap: MapData | null = null;

  constructor(
    readonly room: Room,
    opts: RoomBotsOptions = {},
  ) {
    this.settings = defaultSettings(room.mode.id, room.options.maxPlayers);
    this.lastMode = room.mode.id;
    const envOff = typeof process !== 'undefined' && /^(0|off|false|no)$/i.test(process.env.LOFI_BOTS ?? '');
    this.managed = opts.managed ?? (!envOff && room.options.botFill <= 0);
    this.hostId = opts.hostId ?? null;
    this.setWait(opts.waitSec ?? (room.options.autoStart ? MATCHMAKING_WAIT_SEC : 0));
    this.subscribe();
  }

  // -------------------------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------------------------

  /** The skill (before variance) bots get. */
  baseSkill(): BotSkill {
    return skillFor(this.settings);
  }

  /** humans + bots the room aims for. */
  target(): number {
    if (this.targetFromMode && this.room.mode.id !== this.lastMode) {
      this.lastMode = this.room.mode.id;
      this.settings.targetPlayers = defaultSettings(this.room.mode.id, this.room.options.maxPlayers).targetPlayers;
    }
    return Math.max(0, Math.min(this.settings.targetPlayers, this.room.options.maxPlayers));
  }

  /** Apply (validated) settings; live: re-skills current bots and re-balances now if a match is on. */
  update(input: unknown): LobbyBotSettings {
    const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    if (typeof src.targetPlayers === 'number') this.targetFromMode = false;
    this.target();
    this.settings = sanitizeSettings(input, this.settings, this.room.options.maxPlayers);
    for (const [id, brain] of this.brains) {
      const p = this.room.players.get(id);
      if (p) brain.skill = this.skillFor(p);
    }
    if (this.playing() && this.fillAt === null) this.rebalance(false);
    this.broadcast();
    return this.settings;
  }

  /** Set the matchmaking wait (0 = fill now). */
  setWait(sec: number) {
    this.cancelWait?.();
    this.cancelWait = null;
    if (sec > 0) {
      this.fillAt = this.room.time + sec;
      this.cancelWait = this.room.schedule(sec, () => {
        this.fillAt = null;
        this.cancelWait = null;
        if (this.playing()) this.rebalance(false);
        this.broadcast();
      });
    } else {
      this.fillAt = null;
      if (this.playing()) this.rebalance(false);
    }
  }

  skillFor(p: PlayerState): BotSkill {
    const ext = (p.ext.bots ??= { rolls: rollBot() });
    ext.skill = applyVariance(this.baseSkill(), this.settings.variance, ext.rolls);
    return ext.skill;
  }

  state(forSessionId: string | null = null): BotsState {
    return {
      roomId: this.room.id,
      settings: { ...this.settings, custom: this.settings.custom ? { ...this.settings.custom } : undefined },
      skill: this.baseSkill(),
      editable: forSessionId !== null && this.canEdit(forSessionId),
      target: this.target(),
      humans: this.room.humans().length,
      bots: this.room.bots().length,
      fillAt: this.fillAt,
      managed: this.managed,
    };
  }

  /** Host of a private room (the creator, else the longest-present human). */
  host(): string | null {
    if (this.hostId && this.room.humans().some((p) => p.session?.id === this.hostId)) return this.hostId;
    return this.room.humans()[0]?.session?.id ?? this.hostId;
  }

  canEdit(sessionId: string): boolean {
    return this.room.options.private && this.host() === sessionId;
  }

  broadcast() {
    if (this.room.closed) return;
    for (const p of this.room.humans()) if (p.session) p.session.sendFeature('bots.status', this.state(p.session.id));
  }

  // -------------------------------------------------------------------------------------------
  // Room events
  // -------------------------------------------------------------------------------------------

  private playing(): boolean {
    return this.room.phase === 'playing' || this.room.phase === 'countdown';
  }

  private subscribe() {
    const bus = this.room.bus;
    this.offs.push(
      bus.on('playerJoin', ({ player }) => {
        if (player.isBot) {
          // Core backfill (lobby botFill) names bots "Bot 7": give them a callsign like ours.
          if (/^Bot \d+$/.test(player.name)) player.name = pickBotName([...this.room.players.values()].filter((p) => p !== player).map((p) => p.name));
          this.attachBrain(player);
        } else if (this.managed && this.playing() && this.fillAt === null) {
          this.trimExcess(player.team);
          this.balanceTeams();
        }
        if (!player.isBot) this.room.schedule(0, () => this.broadcast());
      }),
      bus.on('playerLeave', ({ player, reason }) => {
        if (player.isBot) {
          this.world.claims?.delete(player.id);
          this.world.usage?.clear(player.id);
          this.brains.delete(player.id);
          this.retiring.delete(player.id);
          this.switching.delete(player.id);
          return;
        }
        if (reason === 'closed' || this.room.closed) return;
        if (this.managed && this.playing() && this.fillAt === null && this.settings.fill) {
          // Keep the leaver's team whole: a bot takes their place.
          if (this.room.players.size < this.target()) {
            const keep = [...this.retiring].find((id) => this.room.players.get(id)?.team === player.team);
            if (keep) this.retiring.delete(keep);
            else this.addBot(this.room.mode.teams ? player.team : null);
          }
          this.balanceTeams();
        }
        this.broadcast();
      }),
      bus.on('phase', ({ phase, prev }) => {
        if (!this.managed) return;
        const start = phase === 'countdown' || (phase === 'playing' && prev !== 'countdown');
        if (start && this.fillAt === null) this.rebalance(true);
        if (phase === 'lobby') {
          for (const b of this.room.bots()) this.room.removePlayer(b.id, 'kicked');
          this.retiring.clear();
          this.switching.clear();
        }
        this.broadcast();
      }, { priority: 50 }),
      bus.on('spawn', ({ player }) => {
        this.brains.get(player.id)?.onSpawn(player, this.room.time, this.room);
      }),
      bus.on('death', (e) => {
        const v = e.victim;
        if (v.isBot && this.retiring.has(v.id)) {
          v.respawnAt = null;
          this.room.schedule(RETIRE_DELAY, () => {
            if (this.retiring.delete(v.id)) this.room.removePlayer(v.id, 'kicked');
            this.broadcast();
          });
        } else if (v.isBot && this.switching.has(v.id) && v.team !== null) {
          this.switching.delete(v.id);
          v.team = (1 - v.team) as Team;
          this.room.broadcastRoster();
        }
        const a = e.attacker;
        if (a && a.isBot && e.attackerStreak > 0) {
          const brain = this.brains.get(a.id);
          if (brain) for (const id of streaksEarnedAt(this.room, a, e.attackerStreak)) brain.onStreakEarned(id, this.room.time);
        }
      }),
      bus.on('fire', ({ player, origin }) => {
        const now = this.room.time;
        const f = this.world.fights;
        f.push({ x: origin.x, y: origin.y, z: origin.z, t: now, by: player.id, team: player.team });
        if (f.length > 48) f.splice(0, f.length - 48);
        if (player.lastFireSuppressed) return;
        for (const [id, brain] of this.brains) {
          const b = this.room.players.get(id);
          if (!b || b === player || !b.alive || !this.room.isEnemy(b, player)) continue;
          const d = Math.hypot(b.move.x - player.move.x, b.move.y - player.move.y, b.move.z - player.move.z);
          if (d <= brain.cur.hearingRange) brain.onHeard(player.move, now);
        }
      }),
      bus.on('damage', ({ victim, attacker, means }) => {
        // Flinch like a player: ~2.5 degrees, scaled by the flinchMultiplier modifier (Hardened Pro),
        // and for blasts by explosiveFlinchMultiplier (Flak Jacket Pro "Shockproof").
        const blast = means === 'explosive' ? this.room.modifiers.mul('explosiveFlinchMultiplier', victim) : 1;
        if (victim.isBot) this.brains.get(victim.id)?.onHurt(attacker, this.room.time, FLINCH_DEG * this.room.modifiers.mul('flinchMultiplier', victim) * blast);
      }),
      bus.on('matchEnd', ({ results }) => {
        const bots = results.players.filter((p) => p.bot).length;
        results.ext.bots = {
          bots,
          humans: results.players.length - bots,
          difficulty: this.settings.difficulty,
          /** Wager matches with bots in them pay nothing (DESIGN 8a): economy should honour this. */
          practice: !!this.room.mode.wager && bots > 0,
        };
      }),
    );
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs = [];
    this.cancelWait?.();
  }

  // -------------------------------------------------------------------------------------------
  // Bots in and out
  // -------------------------------------------------------------------------------------------

  /** Give a bot (ours or another feature's) a brain and a loadout. */
  attachBrain(p: PlayerState): Brain {
    const existing = this.brains.get(p.id);
    if (existing) return existing;
    const skill = this.skillFor(p);
    const brain = new Brain(skill, this.world);
    this.brains.set(p.id, brain);
    if (!p.nextLoadout) p.nextLoadout = chooseBotLoadout(skillRating(skill));
    // A mode with its own brains (Blackout): no default brain, no nav grid for its map.
    const own = botBrainFactory(this.room.mode.id);
    if (own) {
      if (!p.brain) p.brain = own(this.room, p, skill);
      return brain;
    }
    if (!p.brain) p.brain = brain;
    // Warm the nav grid for this map (built once, shared), and the team path usage for it.
    navFor(this.room.map);
    if (!this.world.usage || this.usageMap !== this.room.map) {
      this.world.usage = new PathUsage(this.room.map);
      this.usageMap = this.room.map;
    }
    return brain;
  }

  addBot(team: Team | null | undefined = undefined): PlayerState {
    const names = [...this.room.players.values()].map((p) => p.name);
    return this.room.addBot({ name: pickBotName(names), team: team ?? undefined });
  }

  private teamCounts(exclude: ReadonlySet<string> = this.retiring): [number, number] {
    const n: [number, number] = [0, 0];
    for (const p of this.room.players.values()) if (p.team !== null && !exclude.has(p.id)) n[p.team]++;
    return n;
  }

  /** Smaller team (ties: team 0). */
  private smaller(): Team {
    const [a, b] = this.teamCounts();
    return a <= b ? 0 : 1;
  }

  /** A bot to retire: on `team` if given (team modes), dead first, then the lowest score. */
  private pickBot(team: Team | null, exclude: ReadonlySet<string> = this.retiring): PlayerState | null {
    const bots = this.room.bots().filter((b) => !exclude.has(b.id) && (team === null || !this.room.mode.teams || b.team === team));
    bots.sort((x, y) => Number(x.alive) - Number(y.alive) || x.stats.score - y.stats.score);
    return bots[0] ?? null;
  }

  /**
   * Top up to the target / trim to it. `matchStart`: between lives (everyone is dead), so extra
   * bots leave at once and bots are re-teamed freely; otherwise extras retire at their next death.
   */
  rebalance(matchStart: boolean): void {
    if (!this.managed || this.room.closed) return;
    const room = this.room;
    const target = this.target();
    const humans = room.humans().length;
    const want = this.settings.fill ? Math.max(0, target - humans) : 0;
    // Bots marked to retire count as gone; un-retire them first if we need bots back.
    let active = room.bots().filter((b) => !this.retiring.has(b.id));
    while (active.length < want && this.retiring.size) {
      const id = [...this.retiring][0]!;
      this.retiring.delete(id);
      active = room.bots().filter((b) => !this.retiring.has(b.id));
    }
    // Trim.
    let extra = active.length - want;
    while (extra > 0) {
      const [a, b] = this.teamCounts();
      const team: Team | null = room.mode.teams ? (a >= b ? 0 : 1) : null;
      const bot = this.pickBot(team) ?? this.pickBot(null);
      if (!bot) break;
      if (matchStart || !bot.alive) room.removePlayer(bot.id, 'kicked');
      else this.retiring.add(bot.id);
      extra--;
    }
    // Fill.
    for (let i = active.length; i < want; i++) this.addBot(room.mode.teams ? this.smaller() : null);
    if (room.mode.teamsByRules) {
      // The mode decides teams (Infected): no re-teaming.
    } else if (matchStart && room.mode.teams) {
      // Re-team bots so sides are even (everyone is dead at this point of a match start).
      for (let guard = 0; guard < 32; guard++) {
        const [a, b] = this.teamCounts();
        if (Math.abs(a - b) <= 1) break;
        const big: Team = a > b ? 0 : 1;
        const bot = this.room.bots().find((x) => x.team === big && !x.alive);
        if (!bot) break;
        bot.team = (1 - big) as Team;
      }
      room.broadcastRoster();
    } else this.balanceTeams();
  }

  /** A human joined mid-match: retire a bot of their team if we're over the target. */
  private trimExcess(team: Team | null) {
    const over = this.room.players.size - this.retiring.size - (this.settings.fill ? this.target() : this.room.humans().length);
    for (let i = 0; i < over; i++) {
      const bot = this.pickBot(this.room.mode.teams ? team : null) ?? this.pickBot(null);
      if (!bot) return;
      if (!bot.alive) this.room.removePlayer(bot.id, 'kicked');
      else this.retiring.add(bot.id);
    }
  }

  /** Mid-match: sides more than one apart move a bot over at its next death (dead ones now). */
  balanceTeams() {
    if (!this.room.mode.teams || this.room.mode.teamsByRules) return;
    const [a, b] = this.teamCounts(new Set([...this.retiring, ...this.switching]));
    const pending = [...this.switching].map((id) => this.room.players.get(id)?.team);
    const toOne = pending.filter((t) => t === 0).length;
    const toZero = pending.filter((t) => t === 1).length;
    const a2 = a + toZero;
    const b2 = b + toOne;
    if (Math.abs(a2 - b2) <= 1) return;
    const big: Team = a2 > b2 ? 0 : 1;
    const bot = this.room.bots().filter((x) => x.team === big && !this.retiring.has(x.id) && !this.switching.has(x.id)).sort((x, y) => Number(x.alive) - Number(y.alive))[0];
    if (!bot) return;
    if (!bot.alive) {
      bot.team = (1 - big) as Team;
      this.room.broadcastRoster();
    } else this.switching.add(bot.id);
  }
}

const controllers = new WeakMap<Room, RoomBots>();

export function roomBots(room: Room): RoomBots | undefined {
  return controllers.get(room);
}

export function createRoomBots(room: Room, opts?: RoomBotsOptions): RoomBots {
  const rb = new RoomBots(room, opts);
  controllers.set(room, rb);
  return rb;
}
