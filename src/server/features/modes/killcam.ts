/**
 * Final killcam: a short pose history of every player (20 Hz, last few seconds) and the last
 * credited kill. When the match ends shortly after a kill, the clip (3.5 s up to the kill) goes
 * to everyone as `modes.killcam`; the client replays it from the killer's eyes before the summary.
 * Core's lag-comp history only keeps 1 s of hitboxes without view angles, so this keeps its own.
 */
import { PlayerFlags } from '../../../shared/protocol';
import type { KillcamFrame, KillcamPayload } from '../../../shared/defs/modestate';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';

export const KILLCAM_BEFORE = 3.5;
const KEEP_SEC = 5;
const RATE = 20;
/** Only a kill this recent counts as the match's final kill. */
const MAX_AGE = 8;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function poseFrame(room: Room): KillcamFrame {
  const p: KillcamFrame['p'] = [];
  for (const q of room.players.values()) {
    const m = q.move;
    let f = 0;
    if (q.alive) f |= PlayerFlags.ALIVE;
    if (m.crouched) f |= PlayerFlags.CROUCH;
    if (m.sprinting) f |= PlayerFlags.SPRINT;
    if (m.ads > 0.5) f |= PlayerFlags.ADS;
    if (m.onGround) f |= PlayerFlags.GROUND;
    if (room.time - q.lastFireTime < 0.12) f |= PlayerFlags.FIRING;
    p.push([q.id, r3(m.x), r3(m.y), r3(m.z), r3(q.yaw), r3(q.pitch), f]);
  }
  return { t: r3(room.time), p };
}

export class KillcamRecorder {
  frames: KillcamFrame[] = [];
  last: { killer: PlayerState; victim: PlayerState; weapon: string; headshot: boolean; at: number; frames: KillcamFrame[] } | null = null;
  private every = Math.max(1, Math.round(60 / RATE));

  constructor(private room: Room) {}

  clear(): void {
    this.frames = [];
    this.last = null;
  }

  onTick(tick: number): void {
    if (this.room.phase !== 'playing' || tick % this.every !== 0) return;
    this.push(poseFrame(this.room));
  }

  private push(f: KillcamFrame): void {
    this.frames.push(f);
    const cut = this.room.time - KEEP_SEC;
    while (this.frames.length && this.frames[0]!.t < cut) this.frames.shift();
  }

  onKill(killer: PlayerState, victim: PlayerState, weapon: string, headshot: boolean): void {
    if (this.room.phase !== 'playing') return;
    // The kill's own instant (the tick's regular frame comes after the match may already be over).
    this.push(poseFrame(this.room));
    const at = this.room.time;
    this.last = { killer, victim, weapon, headshot, at, frames: this.frames.filter((f) => f.t >= at - KILLCAM_BEFORE) };
  }

  /** The final killcam clip, or null if the match didn't end on a recent kill. */
  clip(): KillcamPayload | null {
    const k = this.last;
    if (!k || this.room.time - k.at > MAX_AGE) return null;
    const frames = k.frames;
    if (frames.length < 4) return null;
    return { killer: k.killer.id, victim: k.victim.id, weapon: k.weapon, headshot: k.headshot, at: r3(k.at), frames };
  }
}
