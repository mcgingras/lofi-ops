/**
 * Rocket cam maths (Valkyrie Rockets), pure (no DOM, no three.js) so it is unit-tested:
 *
 * - `rocketStateOf(ent)`: the server's rocket from a snapshot entity (position, yaw, `s.p` pitch,
 *   `s.v` speed, `s.f` fuel, `s.b` boost).
 * - `predictRocket(base, want, boost, ahead)`: the same flight steps the server runs
 *   (`stepRocket`), from the last snapshot to now plus the time our input takes to get there,
 *   steered by our current aim. The camera rides this prediction, so it turns the frame you push
 *   the stick or mouse, at the rocket's own turn rate.
 * - `predictAhead`: how far ahead of the snapshot that is.
 * - `followRocket`: eases the camera onto the prediction (snapshots arrive 20 times a second).
 * - `holdView`: where the camera waits on the blast (BO1 holds 1 s on it before you are back).
 * - `launcherPhase` / `rocketHudInfo`: what the launcher HUD and the rocket overlay show.
 */
import { clamp, viewDir, type Vec3 } from '../../../shared/math';
import { dirAngles, steerToward, stepRocket, VALKYRIE, type RocketState } from '../../../shared/defs/valkyrie';

export interface RocketEnt {
  x: number;
  y: number;
  z: number;
  yaw: number;
  s?: Record<string, unknown>;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The server's rocket from its snapshot entity. */
export function rocketStateOf(e: RocketEnt): RocketState {
  return {
    pos: { x: e.x, y: e.y, z: e.z },
    dir: viewDir(e.yaw, num(e.s?.p, 0)),
    speed: num(e.s?.v, VALKYRIE.speed),
    fuel: num(e.s?.f, VALKYRIE.fuel),
    boost: e.s?.b === 1,
  };
}

/** Seconds to predict past a snapshot taken at server time `snapTime`: up to now, plus half a round trip (when our input lands), capped. */
export function predictAhead(serverNow: number, snapTime: number, rtt: number, max = 0.35): number {
  return clamp(serverNow - snapTime + Math.max(0, rtt) / 2, 0, max);
}

/** Fly `base` forward `ahead` seconds in server-sized steps, steered at `want` (null: straight), boost held or not. */
export function predictRocket(base: RocketState, want: Vec3 | null, boost: boolean, ahead: number, step = 1 / 60): RocketState {
  let s = base;
  let t = Math.max(0, ahead);
  while (t > 1e-6) {
    const dt = Math.min(step, t);
    s = stepRocket(s, want, boost, dt);
    t -= dt;
  }
  return s;
}

export interface CamPose {
  pos: Vec3;
  dir: Vec3;
}

/**
 * Ease the camera onto the predicted rocket: position with an exponential follow (`rate` per
 * second), direction turned toward it at most as fast as that too. A big jump (a new rocket,
 * more than `snap` metres) cuts straight to it.
 */
export function followRocket(cam: CamPose | null, target: CamPose, dt: number, rate = 22, snap = 6): CamPose {
  if (!cam) return { pos: { ...target.pos }, dir: { ...target.dir } };
  const d = Math.hypot(target.pos.x - cam.pos.x, target.pos.y - cam.pos.y, target.pos.z - cam.pos.z);
  if (d > snap) return { pos: { ...target.pos }, dir: { ...target.dir } };
  const k = 1 - Math.exp(-dt * rate);
  const pos = { x: cam.pos.x + (target.pos.x - cam.pos.x) * k, y: cam.pos.y + (target.pos.y - cam.pos.y) * k, z: cam.pos.z + (target.pos.z - cam.pos.z) * k };
  const dot = clamp(cam.dir.x * target.dir.x + cam.dir.y * target.dir.y + cam.dir.z * target.dir.z, -1, 1);
  const dir = steerToward(cam.dir, target.dir, Math.acos(dot) * k);
  return { pos, dir };
}

/** The camera while it holds on the blast: pulled back along the last heading and up a little, looking at it. */
export function holdView(at: Vec3, lastDir: Vec3, back = 4, up = 1.2): CamPose {
  const pos = { x: at.x - lastDir.x * back, y: at.y - lastDir.y * back + up, z: at.z - lastDir.z * back };
  const v = { x: at.x - pos.x, y: at.y - pos.y, z: at.z - pos.z };
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { pos, dir: { x: v.x / l, y: v.y / l, z: v.z / l } };
}

/** Camera angles for a pose. */
export const poseAngles = (p: CamPose) => dirAngles(p.dir);

/** What the launcher is doing, for its HUD and first-person pose. */
export type LauncherPhase = 'raising' | 'ready' | 'reloading' | 'flying' | 'empty';

/** Phase and progress (0..1 through raising / reloading) of the launcher. */
export function launcherPhase(l: { left: number; ready: number; fired: boolean }, serverNow: number, steering: boolean): { phase: LauncherPhase; k: number } {
  if (steering) return { phase: 'flying', k: 1 };
  if (l.left <= 0) return { phase: 'empty', k: 1 };
  if (serverNow < l.ready) {
    const dur = l.fired ? VALKYRIE.reloadSec : VALKYRIE.raiseSec;
    return { phase: l.fired ? 'reloading' : 'raising', k: clamp(1 - (l.ready - serverNow) / dur, 0, 1) };
  }
  return { phase: 'ready', k: 1 };
}

/** The rocket overlay's readouts: fuel left (0..1), boosted, the feed's white (out of bounds), rocket number. */
export function rocketHudInfo(s: Record<string, unknown> | undefined, left: number | null): { fuel: number; boost: boolean; white: number; rocket: number } {
  const fuel = clamp(num(s?.f, VALKYRIE.fuel) / VALKYRIE.fuel, 0, 1);
  // `left` is what is still in the launcher after this rocket left it.
  const rocket = left === null ? 1 : clamp(VALKYRIE.rockets - left, 1, VALKYRIE.rockets);
  return { fuel, boost: s?.b === 1, white: clamp(num(s?.w, 0), 0, 1), rocket };
}
