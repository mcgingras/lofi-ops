/**
 * Camera effects timing (pure): explosion shake and concussion wobble strength at room time `now`.
 * Times are room times, so an effect stamped in another room (whose clock was further along)
 * reads as being in the future; it must count as over, not as an ever-growing shake.
 */
import { EQUIPMENT_BY_ID, GL_ROUND, killRadius, type BlastProfile } from '../../../shared/defs/equipment';
import { LAUNCHERS } from '../../../shared/defs/launchers';
import { PAP_WEAPONS } from '../../../shared/defs/pack-a-punch';

/**
 * The blast behind a `weapons.boom` id: a secondary launcher (`rpg`), a China Beach bomblet
 * (`china_lake.bomblet`), a Killer Bee flak burst (`stinger.flak`, high up: no blast here), or null
 * for equipment / the underbarrel `gl`.
 */
export function launcherBlast(e: string): BlastProfile | null {
  const [id, part] = e.split('.') as [string, string | undefined];
  const t = LAUNCHERS[id];
  if (!t) return null;
  if (part === 'bomblet') {
    const c = PAP_WEAPONS[id]?.effect;
    return c?.kind === 'cluster' ? { radius: c.radius, max: c.max, min: c.min } : t.blast;
  }
  if (part === 'flak') return { radius: 0, max: 0, min: 0 };
  return t.blast;
}

export interface ShakeState {
  at: number;
  amount: number;
}
export interface StunState extends ShakeState {
  dur: number;
}

/** Positional/roll jitter amplitude of an explosion shake (0 when none). */
export function shakeAmplitude(now: number, s: ShakeState): number {
  const t = now - s.at;
  return t >= 0 && t < SHAKE.sec ? s.amount * (1 - t / SHAKE.sec) * SHAKE.amp : 0;
}

/** Explosion shake: length (s), peak jitter (m / rad) at full strength, and how far a lethal reaches (m). */
export const SHAKE = { sec: 0.6, amp: 0.045, reach: 18 } as const;

/**
 * How a lethal / launcher blast at distance `d` feels: shake 0..1 (full inside the kill radius,
 * fading out to `SHAKE.reach`) and ringing ears 0..1 (inside about 1.6 kill radii: you were nearly
 * in it). Equipment ids: frag, semtex, gl, the secondary launchers (`launcherBlast`), else the frag.
 */
export function blastFeel(equip: string, d: number): [shake: number, ring: number] {
  const def = EQUIPMENT_BY_ID.get(equip);
  const lb = launcherBlast(equip);
  if (lb && lb.radius <= 0) return [0, 0];
  const kr = lb ? killRadius(lb) : equip === 'gl' ? killRadius(GL_ROUND) : killRadius(def && def.max > 0 ? def : EQUIPMENT_BY_ID.get('frag')!);
  const shake = d <= kr ? 1 : Math.max(0, 1 - (d - kr) / Math.max(1, SHAKE.reach - kr));
  const ring = Math.max(0, Math.min(1, 1.6 - d / Math.max(0.5, kr)));
  return [shake, ring];
}

/** Concussion strength 0..amount, fading over the last 1.2 s (0 when none). */
export function stunStrength(now: number, s: StunState): number {
  const t = now - s.at;
  return t >= 0 && t < s.dur ? s.amount * Math.min(1, (s.dur - t) / 1.2) : 0;
}
