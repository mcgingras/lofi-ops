/**
 * Kill replays' recorder and the final killcam. A 20 Hz pose history of every player (position,
 * view, stance and state flags, health %, the weapon in their hands, frost) plus projectiles in
 * flight and hitscan shots, kept for the last few seconds. Core's lag-comp history only keeps 1 s
 * of hitboxes without view angles, so this keeps its own; the per-death killcam (deathcam.ts) cuts
 * its clips from it too.
 *
 * Final killcam (BO1, see defs/killcam.ts): every enemy kill opens a capture (5 s before it, and
 * frames keep being added for 2 s after). At match end the capture to show is picked by BO1's
 * rule (the latest kill, if it came at most 2 s before the end: the kill that ended the match, or
 * one just before a time-out or objective) or, in Kill Confirmed and Infected, MW3's (the last
 * kill by the winning team), and goes to everyone as `modes.killcam`. The clip starts no earlier
 * than the killer's spawn (no camera sweep from their corpse), keeps only players near the killer
 * or the victim, and frames stop at the match end (everyone is frozen and dead after it).
 */
import type { Team } from '../../../shared/constants';
import { NADE_ENTITY, TOMAHAWK_ENTITY } from '../../../shared/defs/equipment';
import { BLADE_ENTITY, BOLT_ENTITY } from '../../../shared/defs/economy';
import { gearKey, packClip, type DeathcamShot } from '../../../shared/defs/deathcam';
import { FINAL_KILLCAM, WINNING_TEAM_KILLCAM_MODES, type FinalKillcamPayload, type FinalKillcamTuning } from '../../../shared/defs/killcam';
import { KS_ENTITY } from '../../../shared/defs/killstreaks';
import type { KillcamFrame, ProjectileSample } from '../../../shared/defs/modestate';
import { WONDER_ENTITY } from '../../../shared/defs/wonder';
import type { DeathEvent, MatchResults } from '../../../shared/events';
import type { Vec3 } from '../../../shared/math';
import { PlayerFlags, stanceFlags } from '../../../shared/protocol';
import { currentWeapon, type PlayerState } from '../../player';
import type { Room } from '../../room';
import { keepPlayers, nearbyIds, teamsOf, type KillView } from './deathcam';

/** Seconds of history kept (the final killcam reaches 5 s back; deathcam clips 4 s). */
const KEEP_SEC = 8;
const RATE = 20;

/** Entity kinds recorded as projectiles (drawn in replays; grenade and launcher kills follow them). */
export const PROJECTILE_KINDS: ReadonlySet<string> = new Set([NADE_ENTITY, TOMAHAWK_ENTITY, BOLT_ENTITY, BLADE_ENTITY, WONDER_ENTITY.bolt, WONDER_ENTITY.scav, KS_ENTITY.missile]);

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function poseFrame(room: Room): KillcamFrame {
  const p: KillcamFrame['p'] = [];
  for (const q of room.players.values()) {
    const m = q.move;
    let f = 0;
    if (q.alive) f |= PlayerFlags.ALIVE;
    f |= stanceFlags(m);
    if (m.sprinting) f |= PlayerFlags.SPRINT;
    if (m.ads > 0.5) f |= PlayerFlags.ADS;
    if (m.onGround) f |= PlayerFlags.GROUND;
    if (room.time - q.lastFireTime < 0.12) f |= PlayerFlags.FIRING;
    const w = currentWeapon(q);
    const gear = w ? gearKey(w.def.base.id, w.camo, w.def.attachmentIds) : '';
    const frost = Math.round(100 * Math.min(1, q.ext.wonder?.frost ?? 0));
    const row: KillcamFrame['p'][number] = [q.id, r3(m.x), r3(m.y), r3(m.z), r3(q.yaw), r3(q.pitch), f, Math.round((100 * Math.max(0, q.health)) / Math.max(1, q.maxHealth)), gear];
    if (frost > 0) row.push(frost);
    p.push(row);
  }
  const e: ProjectileSample[] = [];
  for (const en of room.entities.all()) {
    if (!PROJECTILE_KINDS.has(en.kind)) continue;
    e.push([en.id, en.kind, en.owner ?? '', r3(en.x), r3(en.y), r3(en.z), String(en.s?.e ?? '')]);
  }
  const out: KillcamFrame = { t: r3(room.time), p };
  if (e.length) out.e = e;
  return out;
}

/** One kill's recording: frames and shots from `beforeSec` before it, growing until `afterSec` after. */
export interface KillCapture {
  killer: PlayerState;
  victim: PlayerState;
  killerTeam: number | null;
  weapon: string;
  means: string;
  headshot: boolean;
  at: number;
  view: KillView;
  frames: KillcamFrame[];
  shots: DeathcamShot[];
  /** Everyone's team at the kill (Infected moves the victim right after). */
  teams: Map<string, number | null>;
}

/**
 * Which capture is the final killcam. BO1: the latest kill, if the match ended at most `recentSec`
 * after it (else none). MW3's modes (Kill Confirmed, Infected): the winning team's last kill.
 */
export function pickFinalKill(o: { mode: string; endTime: number; winnerTeam: Team | null; latest: KillCapture | null; byTeam: ReadonlyMap<number, KillCapture> }, k: FinalKillcamTuning = FINAL_KILLCAM): KillCapture | null {
  if (WINNING_TEAM_KILLCAM_MODES.has(o.mode)) return o.winnerTeam === null ? null : (o.byTeam.get(o.winnerTeam) ?? null);
  const c = o.latest;
  return c && o.endTime - c.at <= k.recentSec + 1e-6 ? c : null;
}

export class KillcamRecorder {
  frames: KillcamFrame[] = [];
  /** Hitscan shots of the last few seconds (tracers and the killer's trigger pulls). */
  shots: DeathcamShot[] = [];
  /** The latest kill, and each team's latest kill (still collecting their after-kill frames). */
  latest: KillCapture | null = null;
  byTeam = new Map<number, KillCapture>();
  private every = Math.max(1, Math.round(60 / RATE));

  constructor(
    private room: Room,
    private k: FinalKillcamTuning = FINAL_KILLCAM,
  ) {}

  clear(): void {
    this.frames = [];
    this.shots = [];
    this.latest = null;
    this.byTeam.clear();
  }

  /** A new round: earlier rounds' kills are no one's final killcam. */
  forgetKills(): void {
    this.latest = null;
    this.byTeam.clear();
  }

  private open(t: number): KillCapture[] {
    const out = new Set<KillCapture>();
    for (const c of [this.latest, ...this.byTeam.values()]) if (c && t <= c.at + this.k.afterSec + 1e-6) out.add(c);
    return [...out];
  }

  /** `walls`: entry and exit points of the walls the bullet went through (impact puffs in the replay). */
  onShot(player: PlayerState, end: Vec3, hit: boolean, walls: readonly Vec3[] = []): void {
    if (this.room.phase !== 'playing') return;
    const pen = walls.map((w): [number, number, number] => [r3(w.x), r3(w.y), r3(w.z)]);
    const shot: DeathcamShot = { t: r3(this.room.time), id: player.id, end: [r3(end.x), r3(end.y), r3(end.z)], hit, ...(pen.length ? { pen } : {}) };
    this.shots.push(shot);
    for (const c of this.open(shot.t)) c.shots.push(shot);
    const cut = this.room.time - KEEP_SEC;
    while (this.shots.length && this.shots[0]!.t < cut) this.shots.shift();
  }

  /** Frames and shots recorded between two room times (inclusive). */
  between(from: number, to: number): { frames: KillcamFrame[]; shots: DeathcamShot[] } {
    return { frames: this.frames.filter((f) => f.t >= from - 1e-6 && f.t <= to + 1e-6), shots: this.shots.filter((s) => s.t >= from && s.t <= to) };
  }

  onTick(tick: number): void {
    if (this.room.phase !== 'playing' || tick % this.every !== 0) return;
    this.push(poseFrame(this.room));
  }

  /** Add a frame; one at the same instant as the last replaces it (the kill's own pose wins over the tick's). */
  private push(f: KillcamFrame): void {
    const prev = this.frames.at(-1);
    if (prev?.t === f.t) {
      this.frames[this.frames.length - 1] = f;
      for (const c of this.open(f.t)) if (c.frames.at(-1) === prev) c.frames[c.frames.length - 1] = f;
      return;
    }
    this.frames.push(f);
    for (const c of this.open(f.t)) if (c.frames.at(-1) !== f) c.frames.push(f);
    const cut = this.room.time - KEEP_SEC;
    while (this.frames.length && this.frames[0]!.t < cut) this.frames.shift();
  }

  /** An enemy kill (call at the kill, before mode rules may end the match on it). */
  onKill(e: DeathEvent<PlayerState> & { attacker: PlayerState }, view: KillView): void {
    if (this.room.phase !== 'playing') return;
    // The kill's own instant (the tick's regular frame comes after the match may already be over).
    this.push(poseFrame(this.room));
    const at = this.room.time;
    const got = this.between(at - this.k.beforeSec, at);
    const ids = new Set<string>();
    for (const f of got.frames) for (const p of f.p) ids.add(p[0]);
    const c: KillCapture = {
      killer: e.attacker,
      victim: e.victim,
      killerTeam: e.attacker.team,
      weapon: e.weapon,
      means: e.means,
      headshot: e.headshot,
      at,
      view,
      frames: got.frames,
      shots: got.shots,
      teams: teamsOf(this.room, ids),
    };
    this.latest = c;
    if (c.killerTeam !== null) this.byTeam.set(c.killerTeam, c);
  }

  /** The final killcam for a match that just ended, or null (no qualifying kill, or too short). */
  finalClip(results: Pick<MatchResults, 'winnerTeam'>): FinalKillcamPayload | null {
    const c = pickFinalKill({ mode: this.room.mode.id, endTime: this.room.time, winnerTeam: results.winnerTeam, latest: this.latest, byTeam: this.byTeam }, this.k);
    return c ? buildFinalClip(c, this.k) : null;
  }
}

/** Cut, filter and pack a capture into the final killcam payload (null if too short). */
export function buildFinalClip(c: KillCapture, k: FinalKillcamTuning = FINAL_KILLCAM): FinalKillcamPayload | null {
  const killer = c.killer.id;
  const victim = c.victim.id;
  let frames = c.frames;
  // Start at the killer's spawn when it came inside the window (no sweep from where they died).
  const ki = frames.findIndex((f) => f.t >= c.at - 1e-6);
  const aliveAt = (f: KillcamFrame) => ((f.p.find((p) => p[0] === killer)?.[6] ?? 0) & PlayerFlags.ALIVE) !== 0;
  if (ki >= 0 && aliveAt(frames[ki]!)) {
    let s = ki;
    while (s > 0 && aliveAt(frames[s - 1]!)) s--;
    frames = frames.slice(s);
  }
  if (frames.length < 4) return null;
  const from = frames[0]!.t;
  const to = c.at + k.afterSec;
  if (to - from < k.minSec) return null;
  const keep = nearbyIds(frames, killer, victim, c.at, k);
  const kept = keepPlayers(frames, keep).map((f) => (f.e ? { ...f, e: f.e.filter((x) => !x[2] || keep.has(x[2])) } : f));
  const shots = c.shots.filter((s) => s.t >= from - 1e-6 && keep.has(s.id));
  const out: FinalKillcamPayload = {
    killer,
    victim,
    weapon: c.weapon,
    means: c.means,
    headshot: c.headshot,
    at: r3(c.at),
    to: r3(to),
    card: c.view.card,
    vname: c.victim.name,
    view: c.view.streak ? 'streak' : 'eyes',
    clip: packClip(kept, shots, c.teams),
    endsAt: null,
  };
  if (c.view.cam) out.cam = c.view.cam;
  if (c.view.vm) out.vm = c.view.vm;
  return out;
}
