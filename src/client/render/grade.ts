/**
 * Per-map / time-of-day colour grade (the 'map' grade, default) and backdrop haze.
 *
 * Crow Country's trick (docs/art/retro-references.md): every scene has a colour script. Shadows
 * are lifted towards the fog/ambient colour instead of crushing to neutral black, highlights take
 * a little of the key light's hue, and the loudest colours are reined in so no single texture
 * (lime grass, orange dirt) shouts over the rest. The grade is derived from the time preset (fog,
 * sun) so every map and time of day gets one, and `OVERRIDES` tunes the ones that need it.
 */
import * as THREE from 'three';
import type { TimePreset } from '../../shared/maps/types';
import { G } from './shader';

export interface GradeParams {
  /** Added in the shadows (0..~0.1 per channel). */
  lift: [number, number, number];
  /** Multiplier in the highlights. */
  gain: [number, number, number];
  /** Saturation kept for strongly saturated colours (1 = untouched; mild colours are left alone). */
  sat: number;
  /** Gamma (>1 darkens mids). */
  gamma: number;
  /** Max haze on unfogged backdrops (mountains, hills). */
  haze: number;
}

/** Post-pass uniforms (shared with the renderer's post material). */
export const GRADE = {
  uLift: { value: new THREE.Vector3(0, 0, 0) },
  uGain: { value: new THREE.Vector3(1, 1, 1) },
  uSat: { value: 1 },
  uGamma: { value: 1 },
};

/** Tuning per `${sky}:${timeId}` (sky ids are map-specific for the default times). */
const OVERRIDES: Record<string, Partial<GradeParams>> = {
  // Nuketown noon: the lawns are the loudest colour on any map; pull them towards the desert.
  'nt_skyNoon:noon': { sat: 0.68 },
};

const lum = (c: readonly number[]) => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;
const hue = (c: readonly number[]): [number, number, number] => {
  const l = Math.max(lum(c), 1e-3);
  return [c[0]! / l, c[1]! / l, c[2]! / l];
};

export function gradeFor(T: TimePreset): GradeParams {
  const sun = hue(T.sun);
  const auto: GradeParams = {
    lift: [T.fog[0] * 0.06, T.fog[1] * 0.06, T.fog[2] * 0.06],
    gain: [1 + (sun[0] - 1) * 0.06, 1 + (sun[1] - 1) * 0.06, 1 + (sun[2] - 1) * 0.06],
    sat: 0.78,
    gamma: 1,
    haze: 0.6,
  };
  return { ...auto, ...OVERRIDES[`${T.sky}:${T.id}`] };
}

export function applyGrade(T: TimePreset): void {
  const g = gradeFor(T);
  GRADE.uLift.value.set(...g.lift);
  GRADE.uGain.value.set(...g.gain);
  GRADE.uSat.value = g.sat;
  GRADE.uGamma.value = g.gamma;
  G.uHaze.value = g.haze;
}
