/**
 * The soldier from reference/yard-lab.html (`figure`), rebuilt as a small rig so it can animate:
 * legs are hip -> knee pivots (walk cycle, crouch), the head and the arms+rifle pitch with aim,
 * and a `fall` pivot at the feet does the death topple. Lit by a per-object light (dyn materials).
 * Feet at the origin, facing +z (set `root.rotation.y = yaw + PI` to face a game yaw).
 */
import * as THREE from 'three';
import { makeLookMaterial, setDynLight, type LookMaterial } from '../shader';
import { unbindTexture } from '../textures';

export interface SoldierLook {
  /** Vest tint (team colour). */
  vest: number;
  /** Helmet tint. */
  helmet: number;
  /** Uniform camo tint. */
  camo?: number;
}

export const TEAM_LOOKS: SoldierLook[] = [
  { vest: 0xe0b48a, helmet: 0xb0a080, camo: 0xf0e0c8 },
  { vest: 0x9ab4dc, helmet: 0x8898a8, camo: 0xc8d4e0 },
];
export const FFA_LOOK: SoldierLook = { vest: 0xffffff, helmet: 0xa8ad90 };

const UP = new THREE.Vector3(0, 1, 0);

function worldUVBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const n = geo.attributes.normal!;
  const uv = geo.attributes.uv!;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const [su, sv] = ax > 0.5 ? [d, h] : ay > 0.5 ? [w, d] : [w, h];
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  return geo;
}

export class Soldier {
  readonly root = new THREE.Group();
  /** Pivot at the feet for the death fall. */
  readonly fall = new THREE.Group();
  readonly body = new THREE.Group();
  readonly head = new THREE.Group();
  readonly aim = new THREE.Group();
  readonly hips: THREE.Group[] = [];
  readonly knees: THREE.Group[] = [];
  readonly mats: LookMaterial[] = [];
  /** Muzzle position (child of `aim`) for remote muzzle flashes/tracers. */
  readonly muzzle = new THREE.Object3D();
  private flash: THREE.Mesh;
  private phase = 0;
  private fallT = 0;
  private fallDir = 1;
  private deadSide = 0;

  constructor(look: SoldierLook = FFA_LOOK, flashTex?: THREE.Texture) {
    const mk = (texture: string, o: { rep?: number; tint?: number } = {}) => {
      const m = makeLookMaterial({ texture, dyn: true, ...o });
      this.mats.push(m);
      return m;
    };
    const camo = mk('camo', { rep: 0.45, tint: look.camo ?? 0xffffff });
    const vest = mk('vest', { rep: 0.4, tint: look.vest });
    const boot = mk('rubber', { rep: 0.3 });
    const glove = mk('glove', { rep: 0.25 });
    const knit = mk('knit', { rep: 0.3 });
    const mask = mk('mask');
    const helm = mk('camo', { rep: 0.35, tint: look.helmet });
    const steel = mk('gunmetal', { rep: 0.25 });

    this.root.add(this.fall);
    this.fall.add(this.body);

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const seg = (parent: THREE.Object3D, a: number[], b: number[], r0: number, r1: number, mat: THREE.Material, sides = 6) => {
      const A = new THREE.Vector3(a[0], a[1], a[2]);
      const B = new THREE.Vector3(b[0], b[1], b[2]);
      const dir = B.clone().sub(A);
      const len = dir.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, sides, 1), mat);
      m.position.copy(A).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(UP, dir.normalize());
      parent.add(m);
      return m;
    };
    const bar = (parent: THREE.Object3D, a: number[], b: number[], w: number, h: number, mat: THREE.Material) => {
      const A = new THREE.Vector3(a[0], a[1], a[2]);
      const B = new THREE.Vector3(b[0], b[1], b[2]);
      const dir = B.clone().sub(A);
      const len = dir.length();
      const m = new THREE.Mesh(worldUVBox(w, len, h), mat);
      m.position.copy(A).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(UP, dir.normalize());
      parent.add(m);
      return m;
    };

    // Legs: hip pivot -> thigh, knee pivot -> shin, boot, knee pad.
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.11 * s, 0.96, 0);
      this.body.add(hip);
      seg(hip, [0, 0, 0], [0.005 * s, -0.46, 0.03], 0.088, 0.07, camo);
      const knee = new THREE.Group();
      knee.position.set(0.005 * s, -0.46, 0.03);
      hip.add(knee);
      seg(knee, [0, 0, 0], [-0.005 * s, -0.4, -0.04], 0.066, 0.05, camo);
      add(knee, worldUVBox(0.13, 0.12, 0.28), boot, -0.005 * s, -0.44, 0.01);
      add(knee, worldUVBox(0.11, 0.08, 0.1), steel, 0.025 * s, 0.02, 0.05);
      this.hips.push(hip);
      this.knees.push(knee);
    }
    // Hips, torso, vest, pouches.
    add(this.body, worldUVBox(0.36, 0.2, 0.24), camo, 0, 0.98, 0);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.2, 0.54, 4, 1).rotateY(Math.PI / 4), camo);
    torso.scale.set(1, 1, 0.62);
    torso.position.set(0, 1.33, 0);
    this.body.add(torso);
    add(this.body, worldUVBox(0.4, 0.36, 0.3), vest, 0, 1.33, 0.005);
    for (const x of [-0.11, 0, 0.11]) add(this.body, worldUVBox(0.09, 0.12, 0.06), vest, x, 1.22, 0.17);
    add(this.body, worldUVBox(0.16, 0.1, 0.07), vest, -0.1, 1.42, 0.17);
    // Head (pivot at the neck).
    this.head.position.set(0, 1.58, 0);
    this.body.add(this.head);
    seg(this.head, [0, 0, 0], [0, 0.08, 0], 0.06, 0.055, knit);
    add(this.head, new THREE.BoxGeometry(0.2, 0.24, 0.23), [knit, knit, knit, knit, mask, knit], 0, 0.19, 0.01);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.155, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), helm);
    lid.scale.set(1, 0.82, 1.1);
    lid.position.set(0, 0.25, 0);
    this.head.add(lid);
    add(this.head, worldUVBox(0.06, 0.05, 0.05), steel, 0, 0.32, 0.15);
    // Arms + rifle at low ready (pivot at the shoulders so it pitches with aim).
    const pivot = [0, 1.45, 0];
    this.aim.position.set(pivot[0]!, pivot[1]!, pivot[2]!);
    this.body.add(this.aim);
    const L = (p: number[]) => [p[0]! - pivot[0]!, p[1]! - pivot[1]!, p[2]! - pivot[2]!];
    const A = [0.13, 1.4, 0.08];
    const Bp = [-0.02, 1.3, 0.78];
    const at = (t: number) => A.map((v, i) => v + (Bp[i]! - v) * t);
    bar(this.aim, L(A), L(Bp), 0.055, 0.08, steel);
    bar(this.aim, L(at(0.05)), L(at(-0.25)), 0.05, 0.1, steel);
    const mag = at(0.42);
    bar(this.aim, L(mag), L([mag[0]!, mag[1]! - 0.17, mag[2]! + 0.03]), 0.045, 0.07, steel);
    const grip = at(0.3);
    const fore = at(0.62);
    const rh = [grip[0]! + 0.02, grip[1]! - 0.04, grip[2]!];
    const lh = [fore[0]!, fore[1]! - 0.04, fore[2]!];
    seg(this.aim, L([0.23, 1.5, 0]), L([0.28, 1.25, 0.12]), 0.058, 0.05, camo);
    seg(this.aim, L([0.28, 1.25, 0.12]), L(rh), 0.05, 0.042, camo);
    seg(this.aim, L([-0.23, 1.5, 0]), L([-0.2, 1.28, 0.3]), 0.058, 0.05, camo);
    seg(this.aim, L([-0.2, 1.28, 0.3]), L(lh), 0.05, 0.042, camo);
    for (const h of [rh, lh]) add(this.aim, worldUVBox(0.085, 0.085, 0.1), glove, ...(L(h) as [number, number, number]));
    const tip = L(at(1.06));
    this.muzzle.position.set(tip[0]!, tip[1]!, tip[2]!);
    this.aim.add(this.muzzle);
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), new THREE.MeshBasicMaterial({ map: flashTex ?? null, alphaTest: 0.5, color: 0xffffff, side: THREE.DoubleSide }));
    this.flash.visible = false;
    this.muzzle.add(this.flash);
  }

  setLight(rgb: readonly number[]): void {
    setDynLight(this.mats, rgb);
  }

  /**
   * Pose for this frame. `speed` m/s along the ground, `forward` sign of motion relative to facing,
   * `pitch` aim pitch, `crouch` 0..1, `firing` shows a flash, `alive` false topples.
   */
  animate(dt: number, s: { speed: number; forward: number; pitch: number; crouch: number; sprint: boolean; firing: boolean; alive: boolean; time: number }): void {
    const amp = Math.min(1, s.speed / 5) * (s.sprint ? 1.25 : 0.85);
    this.phase += dt * s.speed * (s.sprint ? 2.0 : 2.4) * (s.forward < 0 ? -1 : 1);
    const crouch = s.crouch;
    this.body.position.y = -0.5 * crouch;
    for (let i = 0; i < 2; i++) {
      const ph = this.phase + i * Math.PI;
      const swing = Math.sin(ph) * 0.62 * amp;
      const bend = Math.max(0, -Math.cos(ph)) * 0.9 * amp;
      this.hips[i]!.rotation.x = swing * (1 - crouch * 0.6) - 1.2 * crouch;
      this.knees[i]!.rotation.x = bend + 2.0 * crouch;
    }
    this.body.rotation.z = Math.sin(this.phase) * 0.03 * amp;
    this.body.rotation.x = s.sprint ? 0.15 : 0;
    this.aim.rotation.x = s.sprint ? 0.5 : -s.pitch;
    this.aim.rotation.y = s.sprint ? 0.5 : 0;
    this.head.rotation.x = -s.pitch * 0.6;
    this.flash.visible = s.firing && s.alive && Math.floor(s.time * 30) % 2 === 0;
    if (this.flash.visible) this.flash.rotation.z = Math.random() * 6;
    // Death: topple at the feet, knees buckle.
    if (!s.alive) {
      if (this.fallT === 0) {
        this.fallDir = Math.random() < 0.7 ? 1 : -1;
        this.deadSide = (Math.random() - 0.5) * 0.8;
      }
      this.fallT = Math.min(1, this.fallT + dt * 2.2);
      const k = this.fallT * this.fallT;
      this.fall.rotation.x = -1.5 * k * this.fallDir;
      this.fall.rotation.z = this.deadSide * k;
      for (const kn of this.knees) kn.rotation.x = 0.9 * Math.min(1, this.fallT * 2);
      this.aim.rotation.x = 0.9 * k;
    } else if (this.fallT) {
      this.fallT = 0;
      this.fall.rotation.set(0, 0, 0);
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (o.material instanceof THREE.MeshBasicMaterial) o.material.dispose();
      }
    });
    for (const m of this.mats) {
      unbindTexture(m);
      m.dispose();
    }
    this.root.removeFromParent();
  }
}
