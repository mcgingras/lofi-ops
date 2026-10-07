/**
 * Third-person weapons on remote soldiers: the same kit builders as the viewmodels, scaled down
 * and put in the soldier's hands (replacing the soldier's default rifle), muzzle moved to the new
 * tip. Remotes knifing / throwing swing their arms. Snapshots carry only the weapon id, so remote
 * guns show without attachments.
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
  const build = model ? GUNS[model] : undefined;
  if (!build) {
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
      return m;
    },
    camoTex,
    FURNITURE[model] ?? 'poly',
  );
  const b = build(kit, []);
  obj.scale.setScalar(SCALE);
  obj.quaternion.copy(ROT);
  const grip = b.grip.clone().multiplyScalar(SCALE).applyQuaternion(ROT);
  obj.position.copy(RIGHT_HAND).sub(grip);
  s.aim.add(obj);
  const tip = b.muzzle.clone().multiplyScalar(SCALE).applyQuaternion(ROT).add(obj.position);
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
