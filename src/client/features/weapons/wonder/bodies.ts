/**
 * What wonder weapons do to a remote soldier's body as drawn: an icy tint while frosted (Winter's
 * Howl), tiny while shrunk (Baby Gun), swollen and flushed while the Wave Gun cooks them. Effects
 * that follow a player (their entity renderers) call `bodyLook(id, {...})` every frame; the match
 * hook applies the result to the soldier (tint on its look materials, scale on its root) and puts
 * it back once nobody has asked for a few frames.
 */
import * as THREE from 'three';
import type { Match } from '../../../game/match';
import { registerMatchHook } from '../../../registry';
import type { LookMaterial } from '../../../render/shader';
import { isWornMaterial } from '../worldmodels';

export interface BodyLook {
  /** Ice 0..1: tints the body pale blue (1 = frozen solid). */
  ice: number;
  /** Heat 0..1: flushes the body red (the Wave Gun's swell). */
  heat: number;
  /** Uniform scale of the whole soldier (shrunk ~0.45, swollen up to ~1.5). */
  scale: number;
}

const ICE = new THREE.Color(0.62, 0.86, 1.35);
const HEAT = new THREE.Color(1.6, 0.55, 0.45);
/** A look not refreshed for this long (s) is dropped and the body put back. */
const STALE = 0.25;

const looks = new Map<string, BodyLook & { at: number }>();
const base = new WeakMap<LookMaterial, THREE.Color>();
const touched = new Set<string>();
let clock = 0;

/** Ask for a look on player `id` this frame (merged with what other effects asked for). */
export function bodyLook(id: string, part: Partial<BodyLook>): void {
  const l = looks.get(id) ?? { ice: 0, heat: 0, scale: 1, at: clock };
  if (part.ice !== undefined) l.ice = part.ice;
  if (part.heat !== undefined) l.heat = part.heat;
  if (part.scale !== undefined) l.scale = part.scale;
  l.at = clock;
  looks.set(id, l);
}

/** The look asked for on `id` (tests, the HUD), or null. */
export const lookOf = (id: string): BodyLook | null => looks.get(id) ?? null;

const tmp = new THREE.Color();

function apply(m: Match, id: string, l: BodyLook | null): void {
  const v = m.remotes.views.get(id);
  if (!v) return;
  const s = v.soldier;
  for (const mat of s.mats) {
    if (isWornMaterial(mat)) continue;
    let b = base.get(mat);
    if (!b) {
      b = mat.uniforms.uTint.value.clone();
      base.set(mat, b);
    }
    tmp.copy(b);
    if (l && l.ice > 0) tmp.lerp(b.clone().multiply(ICE), Math.min(1, l.ice));
    if (l && l.heat > 0) tmp.lerp(tmp.clone().multiply(HEAT), Math.min(1, l.heat));
    mat.uniforms.uTint.value.copy(tmp);
  }
  s.root.scale.setScalar(l ? l.scale : 1);
}

registerMatchHook('weapons.wonderBodies', {
  start(m) {
    looks.clear();
    touched.clear();
    clock = 0;
    return () => {
      for (const id of touched) apply(m, id, null);
      looks.clear();
      touched.clear();
    };
  },
  frame(m, dt) {
    clock += dt;
    for (const [id, l] of looks) {
      if (clock - l.at > STALE) {
        looks.delete(id);
        apply(m, id, null);
        touched.delete(id);
        continue;
      }
      apply(m, id, l);
      touched.add(id);
    }
  },
});
