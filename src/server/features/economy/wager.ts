/**
 * Wager matches: matchmaking by mode + ante, bot backfill, escrow, payouts, and the live "in the
 * money" HUD.
 *
 * Flow (rooms created by `economy.wagerQueue`, "managed"):
 *   lobby  - humans gather. The match starts when the lobby is full, when someone asks to start,
 *            or after MATCHMAKING_WAIT_SEC; empty slots are backfilled with bots. In a staked tier
 *            the bots' skill comes from the tier (TIER_BOT_SKILL); Practice uses the lobby's
 *            LobbyBotSettings. With bot fill on, one human is enough for real stakes.
 *   start  - every human's ante goes into escrow (`profile.ext.economy.escrow`, saved at once in
 *            the same row write as the debit). The house covers each bot's ante, so the pot is
 *            ante x entrants (humans + bots). Fewer than WAGER_MIN_ENTRANTS entrants, nobody able
 *            to pay, or the Practice tier means practice: no escrow, no payouts.
 *   leave  - during the countdown, or when the room closes (server shutdown): refunded.
 *            Mid-match: forfeited to the pot. A wager that started with WAGER_MIN_HUMANS+ staked
 *            humans is void (every ante refunded, forfeits too) once leavers drop it below that;
 *            a solo wager (one human against bots) is never voided: leaving forfeits, full stop.
 *   end    - the pot is split PAYOUT_SPLITS-style by placement among ALL entrants (the mode's
 *            ranking); a bot's share goes back to the house.
 *   crash  - an escrow whose match no longer exists is refunded: at boot (a scan of the store),
 *            by the sweeper (every 5 s for connected sessions) and on wager RPCs.
 *
 * Wager-mode rooms made elsewhere (quick play, the frontend's custom lobbies) are practice unless
 * an ante was set with `setWagerAnte`.
 */
import { BOT_DIFFICULTY_BY_ID, BOT_SKILL_RANGES, DEFAULT_TARGET_PLAYERS, MATCHMAKING_WAIT_SEC, skillFor, type BotSkill, type LobbyBotSettings } from '../../../shared/defs/bots';
import { ANTE_TIERS, ANTES, EARN_CP_HINT, isWagerMode, opponentsLabel, paidPlaces, tierBotDifficulties, tierBotDifficulty, WAGER_BOT_VARIANCE, WAGER_MIN_ENTRANTS, WAGER_MIN_HUMANS, wagerPayouts, WAGER_MODES } from '../../../shared/defs/economy';
import type { EconomyResultsExt, WagerBotRequest, WagerHud, WagerPayoutLine, WagerPlacing, WagerRecord, WagerRoomSummary, WagerStanding } from '../../../shared/defs/economy-net';
import { mapsForMode } from '../../../shared/defs/maps';
import { MODE_BY_ID } from '../../../shared/defs/modes';
import type { MatchResults } from '../../../shared/events';
import { bumpStat, type Profile } from '../../../shared/profile';
import type { ServerApi } from '../../feature';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { RpcError } from '../../rpc';
import type { Session } from '../../session';
import { configureRoomBots, getRoomBots } from '../bots/api';
import { credit, debit, econ, recordWager } from './ledger';
import { byScore, isWagerRules, wx } from './modes/common';

/** Practice lobbies start this soon after the first human arrives. */
export const PRACTICE_START_SEC = 3;
/** After a wager match, the lobby restarts this soon (same players, new antes). */
export const REMATCH_SEC = 12;
export const WAGER_COUNTDOWN_SEC = 5;

interface Stake {
  profile: Profile;
  playerId: string;
  name: string;
  amount: number;
  session: Session | null;
  /** The forfeit entry written to the profile's wager record (removed again if the wager is void). */
  record?: WagerRecord;
}

/** A bot in the money race: the house covers its ante (virtual CP, never escrowed). */
interface HouseStake {
  playerId: string;
  name: string;
}

export interface WagerState {
  room: Room;
  mode: string;
  ante: number;
  practiceRequested: boolean;
  /** Created by economy.wagerQueue: economy runs the lobby timer. */
  managed: boolean;
  bots: LobbyBotSettings;
  target: number;
  waitSince: number | null;
  forceStart: boolean;
  match: number;
  /** A wager match is running (between start and matchEnd). */
  active: boolean;
  practice: boolean;
  /** Humans with real CP in escrow, by profile id. */
  staked: Map<string, Stake>;
  /** Bots the house covers, by player id (still in the match). */
  house: Map<string, HouseStake>;
  forfeits: Stake[];
  /** ante x entrants. */
  pot: number;
  /** Humans who staked at the start. */
  stakedAtStart: number;
  /** Staked humans + house bots at the start (places paid follow it). */
  entrantsAtStart: number;
  /** Bots dealt a tier preset so far (alternates the tier's two presets). */
  botSeq: number;
  /** Bots may still join during the countdown (the bots feature fills after us): check entrants at play. */
  checkAtPlay: boolean;
  hudDirty: boolean;
  lastHud: number;
  lastLobbyCheck: number;
}

export class WagerManager {
  readonly states = new Map<string, WagerState>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  /** Bot skill jitter (tests seed it). */
  random: () => number = Math.random;

  constructor(private api: ServerApi) {}

  start(): void {
    this.api.lobby.onRoomClosed((room) => this.onClosed(room));
    this.recoverEscrows();
    this.sweepTimer = setInterval(() => this.sweep(), 5000);
    this.sweepTimer.unref?.();
  }

  // -------------------------------------------------------------------------------------------
  // Queue / lobbies
  // -------------------------------------------------------------------------------------------

  queue(session: Session, req: { mode?: unknown; ante?: unknown; bots?: unknown }): { roomId: string; practice: boolean } {
    const mode = typeof req.mode === 'string' ? WAGER_MODES.find((m) => m.id === req.mode) : undefined;
    if (!mode) throw new RpcError('bad_request', 'unknown wager mode');
    if (typeof req.ante !== 'number' || !ANTES.includes(req.ante)) throw new RpcError('bad_request', 'ante must be one of ' + ANTES.join(', '));
    const ante = req.ante;
    const practice = ante === 0;
    const prof = session.profile;
    this.sweepProfile(prof);
    if (econ(prof).escrow) throw new RpcError('busy', 'already staked in a wager');
    if (!practice && prof.codPoints < ante)
      throw new RpcError('funds', `not enough CoD Points for the ante (${prof.codPoints.toLocaleString('en-US')} of ${ante.toLocaleString('en-US')}). ${EARN_CP_HINT}`);
    const bots = sanitizeBots(mode.id, req.bots, ante);

    let state: WagerState | undefined;
    if (!practice)
      state = [...this.states.values()].find((s) => s.managed && !s.practiceRequested && s.mode === mode.id && s.ante === ante && !s.room.closed && s.room.phase === 'lobby' && !s.room.isFull && s.room !== session.room);
    if (!state) {
      const tier = ANTE_TIERS.find((t) => t.ante === ante)!;
      const room = this.api.lobby.createRoom({
        mode: mode.id,
        map: pickWagerMap(mode.id),
        name: `${mode.name} - ${tier.name}`,
        autoStart: false,
        onEnd: 'lobby',
        countdownSec: WAGER_COUNTDOWN_SEC,
        postMatchSec: 12,
        private: true,
        botFill: 0,
      });
      state = this.create(room, { ante, practiceRequested: practice, managed: true, bots });
      // Economy owns the bot count here (core botFill at match start); the bots feature only
      // supplies brains, at the lobby's skill settings.
      configureRoomBots(room, bots, { managed: false, waitSec: 0 });
    }
    return { roomId: state.room.id, practice: state.practiceRequested };
  }

  list(): WagerRoomSummary[] {
    return [...this.states.values()]
      .filter((s) => s.managed && !s.room.closed && !s.practiceRequested)
      .map((s) => ({ roomId: s.room.id, mode: s.mode, ante: s.ante, practice: s.practiceRequested, humans: s.room.humans().length, players: s.room.players.size, target: s.target, phase: s.room.phase, startsIn: this.startsIn(s), opponents: opponentsLabel(s.ante, s.bots.difficulty) }));
  }

  /** Ask the lobby to start now (needs 2+ humans for stakes; practice starts anyway). */
  requestStart(session: Session): boolean {
    const room = session.room;
    const s = room ? this.states.get(room.id) : undefined;
    if (!s || !s.managed || room!.phase !== 'lobby') return false;
    if (!s.practiceRequested && room!.humans().length < WAGER_MIN_HUMANS && !s.bots.fill) return false;
    s.forceStart = true;
    return true;
  }

  /** For rooms other areas create in a wager mode (custom lobbies): set the stakes. */
  setWagerAnte(room: Room, ante: number, bots?: WagerBotRequest): void {
    if (!ANTES.includes(ante)) throw new Error(`bad ante ${ante}`);
    const s = this.stateFor(room);
    if (!s) throw new Error('not a wager room');
    s.ante = ante;
    s.practiceRequested = ante === 0;
    if (bots || tierBotDifficulties(ante)) {
      s.bots = sanitizeBots(room.mode.id, bots ?? s.bots, ante);
      const rb = getRoomBots(room);
      if (rb) rb.update({ difficulty: s.bots.difficulty, custom: s.bots.custom, variance: s.bots.variance });
    }
    s.hudDirty = true;
  }

  private create(room: Room, o: { ante: number; practiceRequested: boolean; managed: boolean; bots: LobbyBotSettings }): WagerState {
    const s: WagerState = {
      room,
      mode: room.mode.id,
      ante: o.ante,
      practiceRequested: o.practiceRequested,
      managed: o.managed,
      bots: o.bots,
      target: Math.min(o.bots.targetPlayers, room.options.maxPlayers),
      waitSince: null,
      forceStart: false,
      match: 0,
      active: false,
      practice: true,
      staked: new Map(),
      house: new Map(),
      forfeits: [],
      pot: 0,
      stakedAtStart: 0,
      entrantsAtStart: 0,
      botSeq: 0,
      checkAtPlay: false,
      hudDirty: true,
      lastHud: -99,
      lastLobbyCheck: -99,
    };
    this.states.set(room.id, s);
    return s;
  }

  /** The wager state of a room in a wager mode (created on demand, as practice). */
  stateFor(room: Room): WagerState | null {
    if (!isWagerMode(room.mode.id)) return null;
    let s = this.states.get(room.id);
    if (!s || s.room !== room) s = this.create(room, { ante: 0, practiceRequested: true, managed: false, bots: sanitizeBots(room.mode.id, { fill: room.options.botFill > 0, targetPlayers: room.options.botFill || undefined }) });
    if (s.mode !== room.mode.id) {
      s.mode = room.mode.id;
      s.hudDirty = true;
    }
    return s;
  }

  private startsIn(s: WagerState): number | null {
    if (s.room.phase !== 'lobby' || !s.managed || s.waitSince === null) return null;
    if (!s.practiceRequested && s.room.humans().length < WAGER_MIN_HUMANS && !s.bots.fill) return null;
    return Math.max(0, this.waitFor(s) - (s.room.time - s.waitSince));
  }

  private waitFor(s: WagerState): number {
    if (s.practiceRequested) return PRACTICE_START_SEC;
    return s.match > 0 ? REMATCH_SEC : MATCHMAKING_WAIT_SEC;
  }

  private lobbyTick(s: WagerState): void {
    const room = s.room;
    if (!s.managed || room.phase !== 'lobby' || room.time - s.lastLobbyCheck < 0.25) return;
    s.lastLobbyCheck = room.time;
    const humans = room.humans().length;
    if (humans === 0) {
      s.waitSince = null;
      return;
    }
    s.waitSince ??= room.time;
    const ready = humans >= s.target || s.forceStart || room.time - s.waitSince >= this.waitFor(s);
    if (!ready) return;
    if (!s.practiceRequested && humans < WAGER_MIN_HUMANS && !s.bots.fill) return; // need a second human
    s.forceStart = false;
    room.options.botFill = s.bots.fill ? s.target : 0;
    room.fillBots();
    room.startMatch();
  }

  // -------------------------------------------------------------------------------------------
  // Per-room wiring (every room; handlers no-op outside wager modes)
  // -------------------------------------------------------------------------------------------

  attach(room: Room): void {
    room.bus.on(
      'phase',
      ({ phase, prev }) => {
        const s = this.stateFor(room);
        if (!s) return;
        s.hudDirty = true;
        if ((phase === 'countdown' || phase === 'playing') && (prev === 'lobby' || prev === 'ended')) this.begin(s);
        if (phase === 'playing' && s.checkAtPlay) this.checkEntrants(s);
        if (phase === 'lobby' && prev === 'ended' && s.managed) {
          s.waitSince = room.time;
          const next = pickWagerMap(room.mode.id, room.mapId);
          if (next !== room.mapId) room.setMap(next);
        }
        if (phase === 'lobby') this.flushHud(s, true);
      },
      { priority: 100 },
    );
    room.bus.on('playerJoin', ({ player }) => {
      const s = this.stateFor(room);
      if (!s) return;
      s.hudDirty = true;
      if (player.isBot) {
        const tier = s.practiceRequested ? null : tierBotDifficulty(s.ante, s.botSeq);
        if (tier) s.botSeq += 1;
        const base = tier ? { ...BOT_DIFFICULTY_BY_ID.get(tier)!.skill } : skillFor(s.bots);
        const variance = tier ? Math.min(s.bots.variance, WAGER_BOT_VARIANCE) : s.bots.variance;
        const skill = (wx(player).skill = jitterSkill(base, variance, this.random));
        wx(player).difficulty = tier ?? s.bots.difficulty;
        // The bots feature's brain plays at exactly this (jittered) skill.
        const brain = getRoomBots(room)?.attachBrain(player);
        if (brain) brain.skill = { ...skill };
        // A bot that joins during the countdown (the bots feature fills after begin()) is in.
        if (s.active && !s.practice && room.phase === 'countdown') {
          s.house.set(player.id, { playerId: player.id, name: player.name });
          this.recount(s);
        }
      }
    });
    room.bus.on('playerLeave', ({ player, reason }) => {
      const s = this.stateFor(room);
      if (!s) return;
      s.hudDirty = true;
      this.onLeave(s, player, reason);
    });
    room.bus.on('scoreChange', () => {
      const s = this.states.get(room.id);
      if (s) s.hudDirty = true;
    });
    room.bus.on('death', () => {
      const s = this.states.get(room.id);
      if (s) s.hudDirty = true;
    });
    room.bus.on('matchEnd', ({ results }) => {
      const s = this.stateFor(room);
      if (s) this.settle(s, results);
    });
    room.bus.on('tick', () => {
      if (!isWagerMode(room.mode.id)) return;
      const s = this.stateFor(room)!;
      this.lobbyTick(s);
      const every = room.phase === 'lobby' ? 1 : 0.5;
      if ((s.hudDirty || room.phase === 'lobby') && room.time - s.lastHud >= every) this.flushHud(s);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Escrow
  // -------------------------------------------------------------------------------------------

  private begin(s: WagerState): void {
    const room = s.room;
    s.match += 1;
    s.active = true;
    s.staked = new Map();
    s.house = new Map();
    s.forfeits = [];
    s.pot = 0;
    s.stakedAtStart = 0;
    s.entrantsAtStart = 0;
    s.checkAtPlay = false;
    s.practice = s.practiceRequested || s.ante <= 0;
    if (s.practice) {
      room.sendFeature(null, 'core.notice', { text: 'Practice wager: nothing at stake' });
      return;
    }
    const label = `${room.mode.name} ante`;
    for (const p of room.humans()) {
      const prof = p.profile;
      if (!prof) continue;
      if (s.staked.has(prof.id)) continue; // same account twice: one stake
      this.sweepProfile(prof);
      if (econ(prof).escrow || !debit(prof, s.ante, 'ante', label)) {
        room.sendFeature(p, 'core.notice', { text: 'Not enough CoD Points for the ante' });
        room.removePlayer(p.id, 'kicked');
        continue;
      }
      // Debit and escrow land in one row write: a crash leaves either neither or both.
      econ(prof).escrow = { roomId: room.id, match: s.match, amount: s.ante, mode: room.mode.id, at: Date.now() };
      s.staked.set(prof.id, { profile: prof, playerId: p.id, name: p.name, amount: s.ante, session: p.session });
      this.api.store.save(prof);
      p.session?.send({ t: 'profile', profile: prof });
    }
    for (const b of room.bots()) s.house.set(b.id, { playerId: b.id, name: b.name });
    s.stakedAtStart = s.staked.size;
    this.recount(s);
    if (s.staked.size === 0) {
      this.voidWager(s, 'Nobody could cover the ante: practice match');
      return;
    }
    // The bots feature tops a custom lobby up during the countdown, after this handler.
    if (s.entrantsAtStart < WAGER_MIN_ENTRANTS && room.phase === 'countdown' && getRoomBots(room)?.managed) {
      s.checkAtPlay = true;
      return;
    }
    this.checkEntrants(s);
  }

  /** Pot and entrant count from who is in (start and countdown only; frozen once play starts). */
  private recount(s: WagerState): void {
    s.entrantsAtStart = s.staked.size + s.house.size;
    s.pot = s.ante * s.entrantsAtStart;
    s.hudDirty = true;
  }

  private checkEntrants(s: WagerState): void {
    s.checkAtPlay = false;
    if (!s.active || s.practice) return;
    if (s.entrantsAtStart < WAGER_MIN_ENTRANTS) {
      this.voidWager(s, 'Not enough players to wager: practice match, antes refunded');
      return;
    }
    const bots = s.house.size;
    s.room.sendFeature(null, 'core.notice', {
      text: `${s.ante.toLocaleString('en-US')} CP ante in escrow. Pot ${s.pot.toLocaleString('en-US')} CP${bots ? ` (house covers ${bots} bot${bots === 1 ? '' : 's'})` : ''}, top ${paidPlaces(s.entrantsAtStart)} paid`,
    });
  }

  private refund(s: WagerState, st: Stake, why: string): void {
    credit(st.profile, st.amount, 'refund', why);
    const e = econ(st.profile);
    if (e.escrow && e.escrow.roomId === s.room.id && e.escrow.match === s.match) e.escrow = null;
    if (st.record) {
      const i = e.wagerHistory.indexOf(st.record);
      if (i >= 0) e.wagerHistory.splice(i, 1);
      st.record = undefined;
    }
    this.api.store.save(st.profile);
    const session = this.liveSession(st);
    session?.sendFeature('economy.award', { reason: 'refund', lines: [{ label: why, cp: st.amount }], total: st.amount, codPoints: st.profile.codPoints });
    session?.send({ t: 'profile', profile: st.profile });
  }

  /** Give back a forfeited ante (multi-human void / shutdown): undo the loss it booked. */
  private unforfeit(s: WagerState, st: Stake, why: string): void {
    econ(st.profile).wagerLost -= st.amount;
    bumpStat(st.profile, 'wager.matches', -1);
    this.refund(s, st, why);
  }

  private voidWager(s: WagerState, why: string): void {
    for (const st of s.staked.values()) this.refund(s, st, 'Wager void: ante refunded');
    for (const st of s.forfeits) this.unforfeit(s, st, 'Wager void: ante refunded');
    s.staked.clear();
    s.house.clear();
    s.forfeits = [];
    s.pot = 0;
    s.practice = true;
    s.checkAtPlay = false;
    s.hudDirty = true;
    s.room.sendFeature(null, 'core.notice', { text: why });
  }

  private onLeave(s: WagerState, player: PlayerState, reason: string): void {
    if (!s.active || s.practice) return;
    const early = s.room.phase === 'countdown' || reason === 'closed';
    if (player.isBot) {
      if (!s.house.delete(player.id)) return;
      // Mid-match its covered ante stays in the pot; it just can't place.
      if (early) this.recount(s);
      return;
    }
    const prof = player.profile;
    if (!prof) return;
    const st = s.staked.get(prof.id);
    if (!st || st.playerId !== player.id) return;
    s.staked.delete(prof.id);
    if (early) {
      if (reason !== 'closed') this.recount(s);
      this.refund(s, st, reason === 'closed' ? 'Match closed: ante refunded' : 'Left before the start: ante refunded');
    } else {
      // Forfeit: the ante stays in the pot. Booked and saved now, so a later crash can't refund it.
      s.forfeits.push(st);
      const e = econ(prof);
      e.escrow = null;
      e.wagerLost += st.amount;
      bumpStat(prof, 'wager.forfeits');
      bumpStat(prof, 'wager.matches');
      st.record = { at: Date.now(), mode: s.mode, ante: st.amount, place: 0, entrants: s.entrantsAtStart, humans: s.stakedAtStart, payout: 0, net: -st.amount, forfeit: true };
      recordWager(prof, st.record);
      this.api.store.save(prof);
      this.liveSession(st)?.send({ t: 'profile', profile: prof });
    }
    // 2+ humans staked: the original void rule. Solo against bots: never void, the leaver forfeits.
    if (s.stakedAtStart >= WAGER_MIN_HUMANS && s.staked.size < WAGER_MIN_HUMANS && reason !== 'closed' && s.room.phase !== 'ended') this.voidWager(s, 'Wager void: not enough players left. Antes refunded');
  }

  private onClosed(room: Room): void {
    const s = this.states.get(room.id);
    if (!s || s.room !== room) return;
    if (s.active && !s.practice) {
      for (const st of s.staked.values()) this.refund(s, st, 'Match closed: ante refunded');
      // A solo forfeit is final; with 2+ humans the original rule refunds forfeits on a close.
      if (s.stakedAtStart >= WAGER_MIN_HUMANS) for (const st of s.forfeits) this.unforfeit(s, st, 'Match closed: ante refunded');
    }
    this.states.delete(room.id);
  }

  private isEntrant(s: WagerState, p: { id: string; bot: boolean; profileId: string | null }): boolean {
    if (p.bot) return s.house.has(p.id);
    return !!p.profileId && s.staked.get(p.profileId)?.playerId === p.id;
  }

  private settle(s: WagerState, results: MatchResults): void {
    const ext = (results.ext.economy ??= { awards: {}, wager: null }) as EconomyResultsExt;
    if (!s.active) return;
    s.active = false;
    if (s.practice) {
      ext.wager = { ante: 0, pot: 0, practice: true, staked: 0, entrants: 0, payouts: [], lines: [], placings: [], house: 0, forfeits: [] };
      return;
    }
    const present = results.players.filter((r) => this.isEntrant(s, r));
    const pay = wagerPayouts(s.pot, s.entrantsAtStart, present.length);
    const lines: WagerPayoutLine[] = [];
    const placings: WagerPlacing[] = [];
    let house = 0;
    present.forEach((r, i) => {
      const rank = i + 1;
      const amount = pay[i] ?? 0;
      placings.push({ id: r.id, name: r.name, bot: r.bot, rank, payout: amount });
      if (r.bot) {
        house += amount; // a bot in the money: its share goes back to the house
        return;
      }
      const st = s.staked.get(r.profileId!)!;
      const prof = st.profile;
      const e = econ(prof);
      if (amount > 0) credit(prof, amount, 'payout', `${results.mode} #${rank}`);
      e.escrow = null;
      if (amount > st.amount) e.wagerWon += amount - st.amount;
      else e.wagerLost += st.amount - amount;
      bumpStat(prof, 'wager.matches');
      if (amount > 0) bumpStat(prof, 'wager.inMoney');
      if (rank === 1) bumpStat(prof, 'wager.wins');
      recordWager(prof, { at: Date.now(), mode: results.mode, ante: st.amount, place: rank, entrants: s.entrantsAtStart, humans: s.stakedAtStart, payout: amount, net: amount - st.amount });
      this.api.store.save(prof);
      lines.push({ id: r.id, profileId: prof.id, name: r.name, rank, ante: st.amount, payout: amount, net: amount - st.amount });
      const player = s.room.players.get(r.id) ?? null;
      s.room.bus.emit('economy.payout', { player, profileId: prof.id, amount, rank });
      this.liveSession(st)?.sendFeature('economy.award', {
        reason: 'payout',
        lines: [
          { label: 'Ante', cp: -st.amount },
          { label: amount > 0 ? `In the money (#${rank} of ${s.entrantsAtStart})` : `Out of the money (#${rank} of ${s.entrantsAtStart})`, cp: amount },
        ],
        total: amount - st.amount,
        codPoints: prof.codPoints,
      });
    });
    ext.wager = { ante: s.ante, pot: s.pot, practice: false, staked: s.stakedAtStart, entrants: s.entrantsAtStart, payouts: pay, lines, placings, house, forfeits: s.forfeits.map((f) => f.name) };
    s.staked.clear();
    s.house.clear();
    s.forfeits = [];
    s.hudDirty = true;
  }

  private liveSession(st: Stake): Session | null {
    for (const session of this.api.sessions()) if (session.profile === st.profile && session.open) return session;
    return st.session?.open ? st.session : null;
  }

  // -------------------------------------------------------------------------------------------
  // Stale escrow (server restarts, crashes)
  // -------------------------------------------------------------------------------------------

  /** True when this profile's escrow belongs to a match that is still running. */
  escrowLive(prof: Profile): boolean {
    const esc = econ(prof).escrow;
    if (!esc) return false;
    const s = this.states.get(esc.roomId);
    return !!s && !s.room.closed && s.active && !s.practice && s.match === esc.match && s.staked.get(prof.id)?.profile === prof;
  }

  /** Refund an escrow whose match is gone (returns the amount refunded). */
  sweepProfile(prof: Profile, why = 'Unsettled wager: ante refunded'): number {
    const e = econ(prof);
    if (!e.escrow || this.escrowLive(prof)) return 0;
    const amount = e.escrow.amount;
    e.escrow = null;
    credit(prof, amount, 'refund', why);
    this.api.store.save(prof);
    return amount;
  }

  /**
   * Boot: every escrow in the store belongs to a match that died with the previous process (a
   * crash, or a kill that skipped the graceful drain), so each is refunded. Forfeits were cleared
   * and saved when they happened, so they stay lost. Returns how many profiles were refunded.
   */
  recoverEscrows(): number {
    let n = 0;
    for (const id of this.api.store.idsWithExt('$.economy.escrow')) {
      const live = [...this.api.sessions()].find((x) => x.profile.id === id)?.profile;
      const prof = live ?? this.api.store.load(id);
      if (prof && this.sweepProfile(prof, 'Server restarted mid-wager: ante refunded') > 0) n += 1;
    }
    if (n) this.api.log(`economy: refunded ${n} escrowed ante${n === 1 ? '' : 's'} left by a restart`);
    return n;
  }

  sweep(): void {
    for (const session of this.api.sessions()) {
      const amount = this.sweepProfile(session.profile);
      if (amount > 0) {
        session.sendFeature('economy.award', { reason: 'refund', lines: [{ label: 'Unsettled wager: ante refunded', cp: amount }], total: amount, codPoints: session.profile.codPoints });
        session.send({ t: 'profile', profile: session.profile });
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------------------------

  hudFor(s: WagerState): WagerHud {
    const room = s.room;
    const order = isWagerRules(room.rules) ? room.rules.rank(room) : [...room.players.values()].sort(byScore);
    const humans = room.humans().length;
    let pot = s.pot;
    let staked = s.stakedAtStart;
    let entrants = s.entrantsAtStart;
    let practice = s.practice;
    let isEntrant = (p: PlayerState) => this.isEntrant(s, { id: p.id, bot: p.isBot, profileId: p.profile?.id ?? null });
    let present = order.filter(isEntrant).length;
    if (room.phase === 'lobby' || !s.active) {
      // Projection for the next match: everyone here stakes, bot fill tops the room up.
      entrants = Math.max(room.players.size, s.bots.fill && s.managed ? s.target : room.players.size);
      practice = s.practiceRequested || s.ante <= 0 || humans === 0 || entrants < WAGER_MIN_ENTRANTS;
      if (practice) entrants = 0;
      staked = practice ? 0 : humans;
      pot = entrants * s.ante;
      isEntrant = () => !practice;
      present = entrants;
    }
    const payouts = wagerPayouts(pot, entrants, present);
    let rank = 0;
    const standings: WagerStanding[] = order.map((p, i) => {
      const inIt = isEntrant(p);
      if (inIt) rank += 1;
      const st: WagerStanding = { id: p.id, name: p.name, bot: p.isBot, place: i + 1, rank: inIt ? rank : 0, payout: inIt ? (payouts[rank - 1] ?? 0) : 0, score: p.stats.score, staked: inIt && !p.isBot };
      const d = p.isBot ? wx(p).difficulty : undefined;
      if (d) st.difficulty = d;
      return st;
    });
    return {
      roomId: room.id,
      mode: room.mode.id,
      ante: s.ante,
      pot,
      practice,
      staked,
      entrants,
      payouts,
      standings,
      phase: room.phase,
      startsIn: this.startsIn(s),
      humans,
      target: s.target,
      bots: { fill: s.bots.fill, difficulty: s.bots.difficulty, opponents: opponentsLabel(s.practiceRequested ? 0 : s.ante, s.bots.difficulty) },
    };
  }

  private flushHud(s: WagerState, force = false): void {
    const room = s.room;
    if (!force && room.time - s.lastHud < 0.2) return;
    s.lastHud = room.time;
    s.hudDirty = false;
    if (!room.humans().length) return;
    room.sendFeature(null, 'economy.wager', this.hudFor(s));
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

export function pickWagerMap(mode: string, avoid?: string): string {
  const own = mapsForMode(mode).map((m) => m.id);
  const pool = own.length ? own : mapsForMode('ffa').map((m) => m.id);
  const choices = pool.length > 1 && avoid ? pool.filter((m) => m !== avoid) : pool;
  return choices[Math.floor(Math.random() * choices.length)] ?? 'yard';
}

/**
 * Clamp an untrusted bot request into LobbyBotSettings for a wager mode. For a staked ante the tier
 * decides the bots (TIER_BOT_SKILL): the request's difficulty and custom skill are ignored and its
 * variance is capped, so nobody stakes against recruits at High Roller.
 */
export function sanitizeBots(mode: string, raw: unknown, ante = 0): LobbyBotSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as WagerBotRequest;
  const max = MODE_BY_ID.get(mode)?.maxPlayers ?? 8;
  const def = DEFAULT_TARGET_PLAYERS[mode] ?? max;
  const target = typeof r.targetPlayers === 'number' && Number.isFinite(r.targetPlayers) ? Math.round(r.targetPlayers) : def;
  const difficulty = r.difficulty === 'custom' || (typeof r.difficulty === 'string' && BOT_DIFFICULTY_BY_ID.has(r.difficulty)) ? r.difficulty : 'regular';
  const out: LobbyBotSettings = {
    fill: r.fill !== false,
    targetPlayers: Math.max(2, Math.min(max, target)),
    difficulty,
    variance: typeof r.variance === 'number' && Number.isFinite(r.variance) ? Math.max(0, Math.min(1, r.variance)) : 0.15,
  };
  if (difficulty === 'custom') {
    const base = skillFor({ ...out, difficulty: 'regular' });
    const c = (r.custom && typeof r.custom === 'object' ? r.custom : {}) as Partial<Record<keyof BotSkill, unknown>>;
    for (const k of Object.keys(BOT_SKILL_RANGES) as (keyof BotSkill)[]) {
      const v = c[k];
      const [lo, hi] = BOT_SKILL_RANGES[k];
      if (typeof v === 'number' && Number.isFinite(v)) base[k] = Math.max(lo, Math.min(hi, v));
    }
    out.custom = base;
  }
  const tier = tierBotDifficulties(ante);
  if (tier) {
    out.difficulty = tier[1];
    delete out.custom;
    out.variance = Math.min(out.variance, WAGER_BOT_VARIANCE);
  }
  return out;
}

/** Spread a skill a little per bot (variance 0..1), staying inside the slider ranges. */
export function jitterSkill(skill: BotSkill, variance: number, random: () => number = Math.random): BotSkill {
  const out = { ...skill };
  if (variance <= 0) return out;
  for (const k of Object.keys(BOT_SKILL_RANGES) as (keyof BotSkill)[]) {
    const [lo, hi] = BOT_SKILL_RANGES[k];
    const span = (hi - lo) * 0.25 * variance;
    out[k] = Math.max(lo, Math.min(hi, out[k] + (random() * 2 - 1) * span));
  }
  return out;
}
