/**
 * Low-poly killstreak hardware in the yard-lab style: boxes and cylinders with world-scaled UVs and
 * look materials lit per object from the bake. Every model faces -z (game yaw 0), so core's
 * `rotation.y = yaw` points it the right way.
 */
import * as THREE from 'three';
import { makeLookMaterial, setDynLight, type LookMaterial } from '../../render/shader';
import { getTexture, unbindTexture } from '../../render/textures';

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

/** Builds one model: tracks its materials and geometries for lighting and disposal. */
export class Kit {
  readonly root = new THREE.Group();
  readonly mats: LookMaterial[] = [];
  private extra: THREE.Material[] = [];
  private lightT = 0;

  mat(texture: string, o: { rep?: number; tint?: number; emissive?: number } = {}): LookMaterial {
    const m = makeLookMaterial({ texture, dyn: true, rep: o.rep ?? 0.5, tint: o.tint, emissive: o.emissive });
    this.mats.push(m);
    return m;
  }

  box(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(worldUVBox(w, h, d), m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  /** Cylinder along z (noses, barrels, tubes) unless `axis` says otherwise. */
  cyl(parent: THREE.Object3D, r0: number, r1: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0, axis: 'x' | 'y' | 'z' = 'z', sides = 6): THREE.Mesh {
    const geo = new THREE.CylinderGeometry(r1, r0, len, sides, 1);
    if (axis === 'z') geo.rotateX(-Math.PI / 2);
    else if (axis === 'x') geo.rotateZ(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  sprite(texture: string, size: number, color = 0xffffff): THREE.Sprite {
    const m = new THREE.SpriteMaterial({ map: getTexture(texture), color, alphaTest: 0.5, depthWrite: true });
    this.extra.push(m);
    const s = new THREE.Sprite(m);
    s.scale.setScalar(size);
    return s;
  }

  flat(texture: string, size: number): THREE.Mesh {
    const m = new THREE.MeshBasicMaterial({ map: getTexture(texture), transparent: true, alphaTest: 0.4, depthWrite: false, side: THREE.DoubleSide });
    this.extra.push(m);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), m);
    return mesh;
  }

  /** Re-sample the bake light now and then. */
  light(dt: number, lightAt: ((x: number, y: number, z: number) => number[]) | null, at: THREE.Vector3, force = false): void {
    this.lightT -= dt;
    if (!lightAt || (!force && this.lightT > 0)) return;
    this.lightT = 0.25;
    setDynLight(this.mats, lightAt(at.x, Math.max(at.y, -50), at.z), 0.1);
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose(); // sprites share one geometry: leave it
    });
    for (const m of this.mats) {
      unbindTexture(m);
      m.dispose();
    }
    for (const m of this.extra) m.dispose();
  }
}

export interface Rotors {
  main: THREE.Object3D[];
  tail: THREE.Object3D[];
}

/** Fixed-wing planes. */
export function buildPlane(kit: Kit, kind: 'uav' | 'cuav' | 'blackbird' | 'jet' | 'bomber'): void {
  const r = kit.root;
  if (kind === 'blackbird') {
    const black = kit.mat('ks_dark', { tint: 0x8a8a90 });
    kit.box(r, 1.6, 0.6, 18, black, 0, 0, 0);
    kit.cyl(r, 0.45, 0.05, 4, black, 0, 0, -11);
    kit.box(r, 12, 0.18, 6, black, 0, 0, 3);
    for (const s of [-1, 1]) {
      kit.cyl(r, 0.6, 0.55, 7, black, 3 * s, 0, 2.5);
      kit.box(r, 0.15, 2.2, 2, black, 3 * s, 1.2, 5);
    }
    return;
  }
  if (kind === 'bomber') {
    const grey = kit.mat('ks_grey', { tint: 0xc8ccd0 });
    const dark = kit.mat('ks_dark');
    kit.cyl(r, 1.6, 1.6, 30, grey, 0, 0, 0);
    kit.cyl(r, 1.6, 0.6, 4, grey, 0, 0, -17);
    kit.box(r, 46, 0.4, 5, grey, 0, 0.6, -1);
    kit.box(r, 0.3, 6, 4, grey, 0, 3.5, 13);
    kit.box(r, 14, 0.3, 3, grey, 0, 0.6, 13);
    for (const x of [-18, -12, 12, 18]) kit.cyl(r, 0.6, 0.6, 3.5, dark, x, -0.6, -2);
    return;
  }
  if (kind === 'jet') {
    const olive = kit.mat('ks_olive', { tint: 0xc0c0b0 });
    const glass = kit.mat('ks_glass');
    kit.box(r, 1.4, 1.2, 14, olive, 0, 0, 0);
    kit.cyl(r, 0.65, 0.1, 3, olive, 0, 0, -8.4);
    kit.box(r, 0.9, 0.6, 2.4, glass, 0, 0.75, -3.6);
    kit.box(r, 10, 0.2, 4, olive, 0, -0.2, 1);
    kit.box(r, 0.2, 2.6, 2.4, olive, 0, 1.6, 5.8);
    kit.box(r, 4.4, 0.15, 1.6, olive, 0, 0.3, 6.2);
    return;
  }
  const tint = kind === 'cuav' ? 0x9aa4b4 : 0xd0d0c8;
  const body = kit.mat('ks_grey', { tint });
  const glass = kit.mat('ks_glass');
  kit.box(r, 1.0, 1.0, 10, body, 0, 0, 0);
  kit.cyl(r, 0.5, 0.1, 2, body, 0, 0, -6);
  kit.box(r, 0.7, 0.4, 1.4, glass, 0, 0.6, -3.2);
  kit.box(r, 24, 0.15, 2, body, 0, 0.2, -0.5);
  kit.box(r, 0.15, 2.2, 1.6, body, 0, 1.4, 4.4);
  kit.box(r, 5, 0.12, 1.2, body, 0, 0.3, 4.6);
  if (kind === 'cuav') for (const s of [-1, 1]) kit.cyl(r, 0.25, 0.25, 1.4, kit.mat('ks_dark'), 6 * s, -0.3, -0.5);
}

/** Helicopters: an attack Cobra, the Chopper Gunner's Huey, the drop Chinook. Returns rotor parts to spin. */
export function buildHeli(kit: Kit, kind: 'heli' | 'gunner' | 'drop'): Rotors {
  const r = kit.root;
  const olive = kit.mat('ks_olive');
  const dark = kit.mat('ks_dark');
  const glass = kit.mat('ks_glass');
  const rot: Rotors = { main: [], tail: [] };
  const rotor = (y: number, z: number, len: number) => {
    const g = new THREE.Group();
    g.position.set(0, y, z);
    kit.box(g, len, 0.06, 0.32, dark);
    kit.box(g, 0.32, 0.06, len, dark);
    kit.cyl(g, 0.15, 0.15, 0.4, dark, 0, -0.2, 0, 'y');
    r.add(g);
    rot.main.push(g);
  };
  if (kind === 'drop') {
    kit.box(r, 2.4, 2.4, 11, olive, 0, 0, 0);
    kit.box(r, 1.6, 0.8, 1.2, glass, 0, 0.5, -5.6);
    kit.box(r, 1.2, 1.2, 2, olive, 0, 1.6, 4.4);
    rotor(1.4, -4.2, 11);
    rotor(2.4, 4.4, 11);
    for (const s of [-1, 1]) kit.box(r, 0.4, 0.8, 4, dark, 1.3 * s, -1.2, 0);
    return rot;
  }
  const wide = kind === 'gunner';
  kit.box(r, wide ? 2.2 : 1.2, wide ? 2 : 1.6, wide ? 5 : 5.4, olive, 0, 0, 0);
  kit.box(r, wide ? 1.8 : 1.0, 0.9, 1.6, glass, 0, 0.3, wide ? -2.8 : -2.6);
  kit.box(r, 0.5, 0.6, 6, olive, 0, 0.3, 5);
  kit.box(r, 0.15, 1.4, 1, olive, 0, 1, 7.8);
  if (!wide) {
    kit.box(r, 3.2, 0.15, 0.9, olive, 0, -0.1, 0.2);
    for (const s of [-1, 1]) kit.cyl(r, 0.2, 0.2, 1.4, dark, 1.4 * s, -0.35, 0.2);
    kit.cyl(r, 0.05, 0.05, 1.2, dark, 0, -0.9, -2.6);
  } else {
    for (const s of [-1, 1]) {
      kit.box(r, 0.12, 0.12, 3.4, dark, 1.1 * s, -1.3, 0);
      kit.cyl(r, 0.08, 0.08, 1.4, dark, 1.2 * s, -0.4, -0.6);
    }
  }
  rotor(1.2, 0, wide ? 12 : 10);
  const tail = new THREE.Group();
  tail.position.set(0.2, 1.1, 7.8);
  kit.box(tail, 0.05, 1.8, 0.2, dark);
  r.add(tail);
  rot.tail.push(tail);
  return rot;
}

export function buildCrate(kit: Kit): void {
  const m = kit.mat('ks_crate', { rep: 1.2 });
  kit.box(kit.root, 1.2, 0.9, 1.2, m, 0, 0.45, 0);
}

/** Sentry Gun (`head` turns with the entity yaw already, so it is one piece). */
export function buildSentry(kit: Kit): THREE.Object3D {
  const r = kit.root;
  const dark = kit.mat('ks_dark');
  const grey = kit.mat('ks_olive');
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = kit.box(r, 0.06, 0.8, 0.06, dark, Math.sin(a) * 0.3, 0.32, Math.cos(a) * 0.3);
    leg.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5);
  }
  kit.box(r, 0.5, 0.36, 0.7, grey, 0, 0.82, 0);
  kit.box(r, 0.56, 0.3, 0.06, grey, 0, 0.92, -0.38);
  kit.cyl(r, 0.05, 0.05, 0.8, dark, 0, 0.84, -0.7);
  const flash = kit.sprite('flash', 0.5);
  flash.position.set(0, 0.84, -1.15);
  r.add(flash);
  return flash;
}

export function buildSam(kit: Kit): void {
  const r = kit.root;
  const dark = kit.mat('ks_dark');
  const olive = kit.mat('ks_olive');
  kit.cyl(r, 0.35, 0.45, 0.5, dark, 0, 0.25, 0, 'y');
  kit.box(r, 0.2, 0.6, 0.2, dark, 0, 0.75, 0);
  const pod = new THREE.Group();
  pod.position.set(0, 1.15, 0);
  pod.rotation.x = 0.5;
  for (const [x, y] of [[-0.18, 0.12], [0.18, 0.12], [-0.18, -0.12], [0.18, -0.12]] as const) kit.cyl(pod, 0.1, 0.1, 1.4, olive, x, y, 0);
  r.add(pod);
}

export function buildMissile(kit: Kit, big: boolean): THREE.Object3D {
  const r = kit.root;
  const pitch = new THREE.Group();
  r.add(pitch);
  const body = kit.mat('ks_grey', { tint: 0xe0e0d8 });
  const s = big ? 1.4 : 1;
  kit.cyl(pitch, 0.1 * s, 0.1 * s, 1.4 * s, body, 0, 0, 0);
  kit.cyl(pitch, 0.1 * s, 0.01, 0.35 * s, body, 0, 0, -0.85 * s);
  kit.box(pitch, 0.5 * s, 0.04, 0.25 * s, body, 0, 0, 0.6 * s);
  kit.box(pitch, 0.04, 0.5 * s, 0.25 * s, body, 0, 0, 0.6 * s);
  const glow = kit.sprite('glow', 1.1 * s, 0xffb050);
  glow.position.set(0, 0, 0.9 * s);
  pitch.add(glow);
  return pitch;
}

export interface DogRig {
  legs: THREE.Object3D[];
  head: THREE.Object3D;
}

export function buildDog(kit: Kit): DogRig {
  const r = kit.root;
  const fur = kit.mat('ks_fur', { rep: 0.3 });
  const dark = kit.mat('ks_dark');
  kit.box(r, 0.3, 0.32, 0.9, fur, 0, 0.6, 0);
  const head = new THREE.Group();
  head.position.set(0, 0.8, -0.48);
  kit.box(head, 0.24, 0.24, 0.26, fur, 0, 0, 0);
  kit.box(head, 0.14, 0.12, 0.22, fur, 0, -0.05, -0.2);
  kit.box(head, 0.05, 0.12, 0.05, fur, -0.08, 0.15, 0.05);
  kit.box(head, 0.05, 0.12, 0.05, fur, 0.08, 0.15, 0.05);
  kit.box(head, 0.06, 0.04, 0.04, dark, 0, -0.03, -0.32);
  r.add(head);
  const tail = kit.box(r, 0.05, 0.05, 0.35, fur, 0, 0.72, 0.58);
  tail.rotation.x = -0.6;
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.1, -0.32], [0.1, -0.32], [-0.1, 0.32], [0.1, 0.32]] as const) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.5, z);
    kit.box(hip, 0.08, 0.5, 0.08, fur, 0, -0.25, 0);
    r.add(hip);
    legs.push(hip);
  }
  return { legs, head };
}

export function buildRcxd(kit: Kit): THREE.Object3D[] {
  const r = kit.root;
  const body = kit.mat('ks_olive', { tint: 0xd8c890 });
  const dark = kit.mat('ks_dark');
  kit.box(r, 0.34, 0.14, 0.56, body, 0, 0.17, 0);
  kit.box(r, 0.26, 0.08, 0.2, dark, 0, 0.27, 0.05);
  kit.cyl(r, 0.01, 0.01, 0.5, dark, 0.12, 0.5, 0.18, 'y', 3);
  const wheels: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]] as const) wheels.push(kit.cyl(r, 0.09, 0.09, 0.08, dark, x, 0.09, z, 'x', 8));
  return wheels;
}

export function buildPack(kit: Kit): void {
  const m = kit.mat('ks_pack', { rep: 0.3 });
  kit.box(kit.root, 0.4, 0.22, 0.28, m, 0, 0.11, 0);
  kit.box(kit.root, 0.2, 0.06, 0.06, kit.mat('ks_dark'), 0, 0.25, 0);
}

/**
 * Care Package marker: a smoke canister (M18-style can, olive with a blue band; BO1's supply drop
 * marker smokes blue), standing on its base at the origin, ~0.15 m tall: body, crimped top, the
 * fuse head with its spoon down one side and the pull ring. Returns the group (y up).
 */
export function buildMarkerCanister(kit: Kit, parent: THREE.Object3D = kit.root): THREE.Group {
  const g = new THREE.Group();
  const body = kit.mat('ks_canister', { rep: 1 });
  const dark = kit.mat('ks_dark');
  const steel = kit.mat('gunmetal', { rep: 0.3 });
  kit.cyl(g, 0.032, 0.032, 0.12, body, 0, 0.06, 0, 'y', 8);
  kit.cyl(g, 0.034, 0.034, 0.008, dark, 0, 0.004, 0, 'y', 8);
  kit.cyl(g, 0.034, 0.028, 0.012, dark, 0, 0.126, 0, 'y', 8);
  kit.cyl(g, 0.012, 0.012, 0.022, steel, 0, 0.142, 0, 'y', 6);
  // Spoon: up over the head and down the side.
  kit.box(g, 0.012, 0.006, 0.03, steel, 0, 0.155, 0.012);
  kit.box(g, 0.012, 0.09, 0.005, steel, 0, 0.11, 0.036);
  // Pull ring.
  const ring = kit.cyl(g, 0.014, 0.014, 0.003, steel, -0.02, 0.15, -0.004, 'x', 8);
  ring.rotation.y = 0.4;
  parent.add(g);
  return g;
}
