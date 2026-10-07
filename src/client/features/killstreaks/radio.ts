/**
 * The radio of the tactical map (BO1 brings up a handset for Napalm, Mortar Team, Rolling Thunder
 * and the Attack Helicopter):
 * - first person: an olive handset with an antenna raised in the gloved right hand while the map is
 *   up (the gun is lowered out of view); it rides the camera and draws over the world;
 * - third person: the server puts a `ks_radio` entity on whoever holds it; its renderer lowers that
 *   soldier's rifle and puts a handset to their ear.
 */
import * as THREE from 'three';
import { KS_ENTITY } from '../../../shared/defs/killstreaks';
import type { Match } from '../../game/match';
import { registerEntityRenderer } from '../../registry';
import type { Soldier } from '../../render/models/soldier';
import { makeLookMaterial, setDynLight, type LookMaterial } from '../../render/shader';
import { unbindTexture } from '../../render/textures';

function buildHandset(mats: LookMaterial[], hand: boolean): THREE.Group {
  const mk = (texture: string, o: { rep?: number; tint?: number; emissive?: number } = {}) => {
    const m = makeLookMaterial({ texture, dyn: true, ...o });
    mats.push(m);
    return m;
  };
  const olive = mk('ks_olive', { rep: 0.2 });
  const dark = mk('rubber', { rep: 0.2, tint: 0x6c6e58 });
  const steel = mk('gunmetal', { rep: 0.2 });
  const glow = mk('ks_glass', { emissive: 1, tint: 0x9fe08a });
  const glove = mk('glove', { rep: 0.25 });
  const g = new THREE.Group();
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, order = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.renderOrder = order;
    g.add(mesh);
    return mesh;
  };
  box(0.075, 0.17, 0.05, olive, 0, 0, 0, 1);
  box(0.08, 0.035, 0.055, dark, 0, -0.07, 0, 2);
  box(0.05, 0.03, 0.004, glow, 0, 0.045, 0.026, 3);
  box(0.012, 0.012, 0.004, dark, -0.015, 0.0, 0.026, 3);
  box(0.012, 0.012, 0.004, dark, 0.015, 0.0, 0.026, 3);
  box(0.008, 0.14, 0.008, steel, 0.026, 0.15, -0.01, 2);
  box(0.016, 0.02, 0.016, dark, 0.026, 0.085, -0.01, 2);
  if (hand) {
    box(0.09, 0.08, 0.07, glove, 0.01, -0.035, -0.03, 0);
    box(0.08, 0.06, 0.2, mk('camo', { rep: 0.4 }), 0.03, -0.07, 0.11, 0);
  }
  return g;
}

/** First-person radio: `raise` 0 (down, hidden) .. 1 (up in front of the face). */
export class FirstPersonRadio {
  private group: THREE.Group | null = null;
  private mats: LookMaterial[] = [];
  private readonly off = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.28, -0.42, 0.18));

  update(m: Match, raise: number): void {
    if (raise <= 0.001) {
      if (this.group) this.group.visible = false;
      return;
    }
    if (!this.group) {
      this.group = buildHandset(this.mats, true);
      for (const o of this.group.children) {
        const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial;
        mat.depthTest = false; // never clips into a wall you stand against
        o.renderOrder += 900;
      }
      this.group.frustumCulled = false;
    }
    if (this.group.parent !== m.renderer.scene) m.renderer.scene.add(this.group);
    this.group.visible = true;
    const cam = m.renderer.cam;
    cam.updateMatrixWorld();
    const k = 1 - Math.pow(1 - Math.min(1, raise), 3);
    this.off.set(0.13, -0.42 + 0.27 * k, -0.34);
    this.group.position.copy(this.off).applyMatrix4(cam.matrixWorld);
    this.group.quaternion.copy(cam.getWorldQuaternion(this.q)).multiply(this.tilt);
    if (m.map) setDynLight(this.mats, m.map.lightAt(cam.position.x, cam.position.y, cam.position.z));
  }

  dispose(): void {
    if (!this.group) return;
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const mat of this.mats) {
      unbindTexture(mat);
      mat.dispose();
    }
    this.mats = [];
    this.group = null;
  }
}

// Third person: rifle down, handset at the ear.
const worn = new WeakMap<Soldier, { obj: THREE.Group; mats: LookMaterial[] }>();

function wear(s: Soldier): void {
  if (worn.has(s)) return;
  const mats: LookMaterial[] = [];
  // Handset held to the side of the head by a raised forearm (body space: model faces +z, shoulders at y 1.45-1.5).
  const obj = new THREE.Group();
  const set = buildHandset(mats, false);
  set.scale.setScalar(1.25);
  set.position.set(0.17, 1.7, 0.09);
  set.rotation.set(0.15, 0, -0.25);
  obj.add(set);
  const camo = makeLookMaterial({ texture: 'camo', dyn: true, rep: 0.45 });
  const glove = makeLookMaterial({ texture: 'glove', dyn: true, rep: 0.25 });
  mats.push(camo, glove);
  const A = new THREE.Vector3(0.25, 1.36, 0.06);
  const Bv = new THREE.Vector3(0.2, 1.6, 0.16);
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, A.distanceTo(Bv), 6, 1), camo);
  fore.position.copy(A).add(Bv).multiplyScalar(0.5);
  fore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize());
  obj.add(fore);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.1), glove);
  hand.position.set(0.19, 1.63, 0.12);
  obj.add(hand);
  s.body.add(obj);
  s.mats.push(...mats);
  worn.set(s, { obj, mats });
}

function unwear(s: Soldier): void {
  const w = worn.get(s);
  if (!w) return;
  w.obj.removeFromParent();
  w.obj.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  for (const m of w.mats) {
    const i = s.mats.indexOf(m);
    if (i >= 0) s.mats.splice(i, 1);
    unbindTexture(m);
    m.dispose();
  }
  worn.delete(s);
}

registerEntityRenderer(KS_ENTITY.radio, (e) => {
  let soldier: Soldier | null = null;
  return {
    object: new THREE.Group(),
    update(ent, _dt, m) {
      if (ent.owner === m.myId) return false;
      const v = ent.owner ? m.remotes.views.get(ent.owner) : undefined;
      if (!v || !v.alive) return false;
      if (soldier && soldier !== v.soldier) unwear(soldier);
      soldier = v.soldier;
      wear(soldier);
      // Rifle slung low and to the side, head tipped towards the handset.
      soldier.aim.rotation.x = 1.05;
      soldier.aim.rotation.y = 0.45;
      soldier.head.rotation.z = -0.18;
      return false;
    },
    dispose() {
      if (soldier) {
        soldier.head.rotation.z = 0;
        unwear(soldier);
      }
      soldier = null;
      void e;
    },
  };
});
