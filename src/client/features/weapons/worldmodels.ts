/**
 * Third-person weapons on remote soldiers: the same kit builders as the viewmodels, scaled down
 * and put in the soldier's hands (replacing the soldier's default rifle), muzzle moved to the new
 * tip. The knife has its own third-person model (`WORLD_ONLY`). Remotes knifing / throwing swing
 * their arms. Snapshots carry only the weapon id, so remote guns show without attachments.
 */
import * as THREE from 'three';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { onFeature, registerMatchHook } from '../../registry';
import type { Soldier } from '../../render/models/soldier';
import { makeLookMaterial } from '../../render/shader';
import { hasTexture, unbindTexture } from '../../render/textures';
import { FURNITURE, GUNS, Kit } from './gunkit';

/** Scale from viewmodel units to the soldier (rifle ~0.85 m). */
const SCALE = 0.7;
// The soldier's rifle line in aim space (see soldier.ts): shoulder pivot at (0, 1.45, 0), facing +z.
const A = new THREE.Vector3(0.13, -0.05, 0.08);
const B = new THREE.Vector3(-0.02, -0.15, 0.78);
const DIR = B.clone().sub(A).normalize();
const RIGHT_HAND = A.clone().lerp(B, 0.3).add(new THREE.Vector3(0.02, -0.02, 0));
const ROT = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), DIR);

interface Worn {
  key: string;
  obj: THREE.Group;
  mats: THREE.Material[];
}

const worn = new WeakMap<Soldier, Worn>();
const actions = new Map<string, { kind: 'melee' | 'throw'; at: number }>();
/** Materials of worn weapons (they live in `Soldier.mats` for the light; tints skip them). */
const wornMats = new WeakSet<THREE.Material>();
export const isWornMaterial = (m: THREE.Material): boolean => wornMats.has(m);

/**
 * Third-person builders that replace the kit's: the kit's knife is sized for first person and
 * held along the rifle line, a sliver in a soldier's fist. Returns where the fist closes and the
 * tip (both in the builder's own space) and the scale to wear it at.
 */
const WORLD_ONLY: Record<string, (k: Kit) => { grip: THREE.Vector3; muzzle: THREE.Vector3; scale: number }> = {
  // A combat knife (BO1's Ka-Bar-like MP knife) a little oversized so it reads at range: blade
  // forward out of the fist and tipped up, clip point, guard, ribbed grip, pommel.
  knife(k) {
    const { M } = k;
    const blade = new THREE.Group();
    blade.rotation.x = 0.45;
    k.root.add(blade);
    k.box(0.014, 0.05, 0.25, M.steel, 0, 0.004, -0.165, 0, 0, 0, blade);
    k.box(0.01, 0.026, 0.07, M.steel, 0, 0.014, -0.315, 0.35, 0, 0, blade);
    k.box(0.016, 0.012, 0.2, M.metal, 0, 0.032, -0.15, 0, 0, 0, blade); // spine
    k.box(0.09, 0.022, 0.024, M.metal, 0, 0, -0.035);
    k.box(0.036, 0.044, 0.12, M.poly, 0, -0.002, 0.04);
    for (let i = 0; i < 3; i++) k.box(0.04, 0.048, 0.008, M.metal, 0, -0.002, 0.0 + i * 0.035);
    k.box(0.042, 0.042, 0.022, M.metal, 0, 0, 0.11);
    return { grip: new THREE.Vector3(0, 0, 0.04), muzzle: new THREE.Vector3(0, 0.15, -0.34), scale: 1.6 };
  },
};

function strip(s: Soldier, w: Worn) {
  w.obj.removeFromParent();
  w.obj.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  for (const m of w.mats) {
    const i = s.mats.indexOf(m as never);
    if (i >= 0) s.mats.splice(i, 1);
    unbindTexture(m as never);
    m.dispose();
  }
}

export function dressSoldier(s: Soldier, weaponId: string, camo = 'none'): void {
  const model = WEAPON_BY_ID.get(weaponId)?.model ?? (weaponId ? 'ak47' : '');
  const key = `${model}|${camo}`;
  const cur = worn.get(s);
  if (cur?.key === key) return;
  if (cur) strip(s, cur);
  s.gun.visible = false;
  const special = model ? WORLD_ONLY[model] : undefined;
  const build = model ? GUNS[model] : undefined;
  if (!build && !special) {
    worn.set(s, { key, obj: new THREE.Group(), mats: [] });
    return;
  }
  const obj = new THREE.Group();
  const mats: THREE.Material[] = [];
  const camoTex = camo !== 'none' && hasTexture(`camo.${camo}`) ? `camo.${camo}` : null;
  const kit = new Kit(
    obj,
    (texture, o = {}) => {
      const m = makeLookMaterial({ texture, rep: o.rep, tint: o.tint, emissive: o.emissive, dyn: true });
      mats.push(m);
      s.mats.push(m);
      wornMats.add(m);
      return m;
    },
    camoTex,
    FURNITURE[model] ?? 'poly',
  );
  const b = special ? special(kit) : build!(kit, []);
  const scale = special ? (b as { scale: number }).scale : SCALE;
  obj.scale.setScalar(scale);
  obj.quaternion.copy(ROT);
  const grip = b.grip.clone().multiplyScalar(scale).applyQuaternion(ROT);
  obj.position.copy(RIGHT_HAND).sub(grip);
  s.aim.add(obj);
  const tip = b.muzzle.clone().multiplyScalar(scale).applyQuaternion(ROT).add(obj.position);
  s.muzzle.position.copy(tip);
  worn.set(s, { key, obj, mats });
}

registerMatchHook('weapons.worldmodels', {
  start() {
    actions.clear();
    const offs = [onFeature('weapons.melee', (d) => actions.set(d.p, { kind: 'melee', at: performance.now() / 1000 })), onFeature('weapons.throw', (d) => actions.set(d.p, { kind: 'throw', at: performance.now() / 1000 }))];
    return () => offs.forEach((f) => f());
  },
  frame(m) {
    const now = performance.now() / 1000;
    for (const v of m.remotes.views.values()) {
      dressSoldier(v.soldier, v.weapon, (m.net.lastSnap?.players.find((p) => p.id === v.id)?.c as string | undefined) ?? 'none');
      const a = actions.get(v.id);
      if (!a || !v.alive) continue;
      const t = now - a.at;
      if (t > 0.6) {
        actions.delete(v.id);
        continue;
      }
      const k = Math.sin((t / 0.6) * Math.PI);
      if (a.kind === 'melee') {
        v.soldier.aim.rotation.y -= 0.8 * k;
        v.soldier.aim.rotation.x -= 0.3 * k;
      } else {
        v.soldier.aim.rotation.x += 0.7 * k;
      }
    }
  },
});
