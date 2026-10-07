/**
 * A dropped gun in the world: the weapons area's kit builders (the same model as the viewmodel and
 * the third-person gun, with its attachments and camo), at third-person scale, lying on its side.
 * It tumbles while it falls and settles flat when the server says it landed; lit by the bake at
 * its position like other dynamic objects.
 */
import * as THREE from 'three';
import { dropAttachments, PICKUP, type DropSnapState } from '../../../shared/defs/pickups';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import type { EntitySnap } from '../../../shared/protocol';
import type { Match } from '../../game/match';
import type { EntityView } from '../../registry';
import { makeLookMaterial, setDynLight, type LookMaterial } from '../../render/shader';
import { hasTexture, unbindTexture } from '../../render/textures';
import { FURNITURE, GUNS, Kit } from '../weapons/gunkit';

/** Viewmodel units -> world (matches the third-person guns). */
const SCALE = 0.7;

export const dropState = (e: EntitySnap): DropSnapState | null => {
  const s = e.s as Partial<DropSnapState> | undefined;
  return s && typeof s.w === 'string' ? (s as DropSnapState) : null;
};

/** Build the gun lying flat: origin at its middle, bottom touching y = -restHeight. */
export function buildDroppedGun(weaponId: string, attachments: readonly string[], camo: string): { root: THREE.Group; mats: LookMaterial[] } {
  const model = WEAPON_BY_ID.get(weaponId)?.model ?? 'ak47';
  const build = GUNS[model] ?? GUNS['ak47'];
  const mats: LookMaterial[] = [];
  const gun = new THREE.Group();
  const camoTex = camo !== 'none' && hasTexture(`camo.${camo}`) ? `camo.${camo}` : null;
  if (build) {
    const kit = new Kit(
      gun,
      (texture, o = {}) => {
        const m = makeLookMaterial({ texture, rep: o.rep, tint: o.tint, emissive: o.emissive, dyn: true });
        mats.push(m);
        return m;
      },
      camoTex,
      FURNITURE[model] ?? 'poly',
    );
    build(kit, attachments);
  }
  gun.scale.setScalar(SCALE);
  // On its side (left side down), then centred over the origin and resting on the floor.
  const lie = new THREE.Group();
  lie.rotation.z = Math.PI / 2;
  lie.add(gun);
  const root = new THREE.Group();
  root.add(lie);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(lie);
  if (!box.isEmpty()) {
    const c = box.getCenter(new THREE.Vector3());
    lie.position.set(-c.x, -box.min.y - PICKUP.restHeight, -c.z);
  }
  return { root, mats };
}

export function dropRenderer(e: EntitySnap, match: Match): EntityView | null {
  const st = dropState(e);
  if (!st) return null;
  const { root, mats } = buildDroppedGun(st.w, dropAttachments(st), st.c);
  const tumble = new THREE.Group();
  tumble.add(root);
  const object = new THREE.Group();
  object.add(tumble);
  const pos = new THREE.Vector3(e.x, e.y, e.z);
  let yaw = e.yaw;
  let t = Math.random() * 3;
  let lightT = 0;
  let first = true;
  return {
    object,
    update(snap, dt) {
      const s = dropState(snap);
      const landed = !!s?.l;
      t += dt;
      // Follow the server: quick while falling, snap once it has landed.
      const k = landed ? 1 - Math.exp(-dt * 25) : 1 - Math.exp(-dt * 14);
      pos.lerp(new THREE.Vector3(snap.x, snap.y, snap.z), first ? 1 : k);
      let dy = snap.yaw - yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      yaw += dy * Math.min(1, dt * 14);
      first = false;
      object.position.copy(pos);
      object.rotation.y = yaw;
      if (landed) {
        tumble.rotation.x *= Math.exp(-dt * 18);
        tumble.rotation.z *= Math.exp(-dt * 18);
      } else {
        tumble.rotation.x = Math.sin(t * 9) * 0.9;
        tumble.rotation.z = Math.cos(t * 7) * 0.5;
      }
      lightT -= dt;
      if (lightT <= 0 && match.map) {
        lightT = 0.25;
        setDynLight(mats, match.map.lightAt(pos.x, pos.y + 0.3, pos.z));
      }
      return false;
    },
    dispose() {
      object.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const m of mats) {
        unbindTexture(m);
        m.dispose();
      }
    },
  };
}
