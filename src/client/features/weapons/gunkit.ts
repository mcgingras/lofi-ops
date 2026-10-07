/**
 * Procedural low-poly guns (in the prototype viewmodel's style: boxes and 6-sided cylinders with
 * world-scaled photo textures). One builder per model id draws the gun along -z with the receiver
 * centred on the origin, in viewmodel units (the AK prototype's scale); the third-person models
 * reuse the same builders scaled down, so first- and third-person guns match.
 *
 * A build returns where the muzzle is, the iron-sight / optic line height, hand positions and the
 * moving parts (bolt, pump, magazine, slide, barrels, cylinder) for animation.
 */
import * as THREE from 'three';
import { worldUV } from '../../render/models/viewmodels';

export type MatFn = (texture: string, o?: { rep?: number; tint?: number; emissive?: number }) => THREE.Material;

export interface GunParts {
  bolt?: THREE.Object3D;
  pump?: THREE.Object3D;
  mag?: THREE.Object3D;
  slide?: THREE.Object3D;
  barrels?: THREE.Object3D;
  cylinder?: THREE.Object3D;
  /** A second pistol (dual wield). */
  offhand?: THREE.Object3D;
}

export interface GunBuild {
  muzzle: THREE.Vector3;
  /** Height of the sight line (iron sights or optic centre). */
  sightY: number;
  /** ADS distance in front of the eye (negative z). */
  adsZ: number;
  /** Right hand (pistol grip) and left hand (fore-end) positions. */
  grip: THREE.Vector3;
  fore: THREE.Vector3;
  parts: GunParts;
  /** One-handed weapons (pistols). */
  pistol: boolean;
  /** No ADS pose (dual wield). */
  noAds?: boolean;
}

/** Adds meshes to a parent. */
export class Kit {
  readonly M: Record<'metal' | 'wood' | 'poly' | 'olive' | 'tan' | 'steel' | 'lens' | 'red' | 'brass' | 'shell' | 'body' | 'furn', THREE.Material>;
  constructor(
    readonly root: THREE.Object3D,
    mat: MatFn,
    camo: string | null,
    furniture: 'wood' | 'poly' | 'olive' | 'tan' = 'poly',
  ) {
    const metal = mat('gunmetal', { rep: 0.25 });
    const wood = mat('gunwood', { rep: 0.3 });
    const poly = mat('weapons.poly', { rep: 0.3 });
    const olive = mat('weapons.olive', { rep: 0.3 });
    const tan = mat('weapons.tan', { rep: 0.3 });
    const camoM = camo ? mat(camo, { rep: 0.3 }) : null;
    const furn = camoM ?? { wood, poly, olive, tan }[furniture];
    this.M = {
      metal,
      wood,
      poly,
      olive,
      tan,
      steel: mat('weapons.steel', { rep: 0.2 }),
      lens: mat('weapons.lens', { rep: 0.05 }),
      red: mat('weapons.red', { emissive: 1 }),
      brass: mat('weapons.brass', { rep: 0.1 }),
      shell: mat('weapons.shell', { rep: 0.05 }),
      body: camoM ?? metal,
      furn,
    };
  }

  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = this.root): THREE.Mesh {
    const m = new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, h, d), w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  }

  /** Cylinder along z (default) centred at x,y,z. */
  cyl(r: number, len: number, mat: THREE.Material, x: number, y: number, z: number, sides = 6, parent: THREE.Object3D = this.root, axis: 'x' | 'y' | 'z' = 'z', r2 = r): THREE.Mesh {
    const g = new THREE.CylinderGeometry(r2, r, len, sides);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    else if (axis === 'x') g.rotateZ(Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  /** Open tube along z (a ring of thin slats) so sight pictures can be seen through it. */
  tube(r: number, len: number, mat: THREE.Material, x: number, y: number, z: number, sides = 8, wall = 0.005): void {
    const w = 2 * r * Math.tan(Math.PI / sides) + 0.001;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const m = this.box(w, wall, len, mat, x + Math.sin(a) * r, y + Math.cos(a) * r, z);
      m.rotation.z = -a;
    }
  }

  group(x: number, y: number, z: number, parent: THREE.Object3D = this.root): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  // ------------------------------------------------------------------------- common parts

  /** Barrel from z0 forward by len; returns the tip z. */
  barrel(z0: number, len: number, r: number, y: number, mat = this.M.metal, parent?: THREE.Object3D): number {
    this.cyl(r, len, mat, 0, y, z0 - len / 2, 6, parent);
    return z0 - len;
  }

  frontPost(z: number, y: number, h = 0.05): void {
    this.box(0.012, h, 0.012, this.M.metal, 0, y - h / 2, z);
    this.box(0.03, 0.012, 0.03, this.M.metal, 0, y - h, z);
  }

  rearSight(z: number, y: number): void {
    this.box(0.035, 0.022, 0.02, this.M.metal, 0, y - 0.011, z);
  }

  /** Pistol grip under the receiver (z = its top centre). */
  pistolGrip(z: number, y: number, mat = this.M.furn, tilt = -0.32): void {
    this.box(0.045, 0.13, 0.06, mat, 0, y - 0.065, z + 0.02, tilt);
    this.box(0.012, 0.02, 0.07, this.M.metal, 0, y - 0.01, z - 0.06); // trigger guard
  }

  /** A curved (AK-style) magazine hanging from (z, y); `len` total. */
  curvedMag(parent: THREE.Object3D, len: number, w = 0.045, d = 0.075, mat = this.M.metal): void {
    const a = len * 0.5;
    this.box(w, a, d, mat, 0, -a / 2, 0, 0.18, 0, 0, parent);
    this.box(w, a, d, mat, 0, -a * 1.35, -a * 0.22, 0.48, 0, 0, parent);
  }

  straightMag(parent: THREE.Object3D, len: number, w = 0.04, d = 0.07, mat = this.M.metal, tilt = 0.08): void {
    this.box(w, len, d, mat, 0, -len / 2, 0, tilt, 0, 0, parent);
    this.box(w + 0.006, 0.014, d + 0.008, this.M.poly, 0, -len, len * tilt * 0.5, tilt, 0, 0, parent);
  }

  /** Magazine group at the mag well, built by `fill`; handles extended / dual mag attachments. */
  magazine(z: number, y: number, atts: readonly string[], fill: (g: THREE.Object3D, lenMul: number) => void): THREE.Group {
    const g = this.group(0, y, z);
    const lenMul = atts.includes('extmag') ? 1.45 : 1;
    fill(g, lenMul);
    if (atts.includes('dualmag')) {
      const g2 = this.group(0.05, 0, 0.01, g);
      fill(g2, 1);
      this.box(0.1, 0.03, 0.085, this.M.tan, 0.025, -0.07, 0.02, 0.15, 0, 0, g); // tape
    }
    return g;
  }

  /** Fixed stock from z0 rearward. */
  stock(z0: number, len: number, y: number, h = 0.1, mat = this.M.furn, drop = 0.02): void {
    this.box(0.055, h * 0.7, len * 0.5, mat, 0, y - drop * 0.4, z0 + len * 0.25);
    this.box(0.06, h, len * 0.5, mat, 0, y - drop - h * 0.1, z0 + len * 0.75);
    this.box(0.064, h * 1.05, 0.02, this.M.poly, 0, y - drop - h * 0.1, z0 + len);
  }

  /** Skeleton / folding frame stock (two rods and a butt plate). */
  skeletonStock(z0: number, len: number, y: number, mat = this.M.metal): void {
    this.box(0.012, 0.012, len, mat, 0, y + 0.01, z0 + len / 2);
    this.box(0.012, 0.012, len, mat, 0, y - 0.06, z0 + len / 2, -0.12);
    this.box(0.05, 0.11, 0.02, mat, 0, y - 0.03, z0 + len);
  }

  /** Carry handle with the rear aperture on top (M16/FAMAS). Returns the sight line height. */
  carryHandle(z0: number, z1: number, y: number, h = 0.055, mat = this.M.poly): number {
    this.box(0.018, h, 0.025, mat, 0, y + h / 2, z0);
    this.box(0.018, h, 0.025, mat, 0, y + h / 2, z1);
    this.box(0.022, 0.016, Math.abs(z1 - z0) + 0.03, mat, 0, y + h, (z0 + z1) / 2);
    // Peep: a ring of four bars around the sight line (see-through centre).
    const sy = y + h + 0.026;
    const zr = Math.max(z0, z1) - 0.01;
    this.box(0.026, 0.006, 0.012, this.M.metal, 0, sy + 0.009, zr);
    this.box(0.026, 0.006, 0.012, this.M.metal, 0, sy - 0.009, zr);
    this.box(0.006, 0.024, 0.012, this.M.metal, -0.01, sy, zr);
    this.box(0.006, 0.024, 0.012, this.M.metal, 0.01, sy, zr);
    return sy;
  }

  /** A rail strip on top. */
  rail(z0: number, z1: number, y: number): void {
    this.box(0.03, 0.012, Math.abs(z1 - z0), this.M.metal, 0, y + 0.006, (z0 + z1) / 2);
    for (let z = Math.min(z0, z1) + 0.01; z < Math.max(z0, z1); z += 0.025) this.box(0.034, 0.006, 0.008, this.M.poly, 0, y + 0.013, z);
  }

  /** Built-in or attached rifle scope; returns the scope's axis height. */
  scope(zc: number, y: number, len = 0.3, r = 0.03, big = false): number {
    const cy = y + r + 0.03;
    this.cyl(r, len, this.M.poly, 0, cy, zc, 8);
    this.cyl(r * 1.35, 0.08, this.M.poly, 0, cy, zc - len / 2 - 0.02, 8, this.root, 'z', r * 1.5);
    this.cyl(r * 1.2, 0.06, this.M.poly, 0, cy, zc + len / 2 + 0.01, 8);
    this.cyl(r * 1.2, 0.005, this.M.lens, 0, cy, zc - len / 2 - 0.062, 8);
    this.cyl(0.012, 0.04, this.M.poly, 0, cy + r + 0.012, zc, 6, this.root, 'y'); // turret
    if (big) this.cyl(0.012, 0.05, this.M.poly, r + 0.02, cy, zc, 6, this.root, 'x');
    this.box(0.02, 0.03, 0.03, this.M.metal, 0, y + 0.015, zc - len * 0.3);
    this.box(0.02, 0.03, 0.03, this.M.metal, 0, y + 0.015, zc + len * 0.3);
    return cy;
  }

  /**
   * Optic attachments on a mount at height `y` around `z`. Returns the new sight line and ADS
   * distance, or null when no optic is fitted.
   */
  optic(atts: readonly string[], z: number, y: number): { sightY: number; adsZ: number } | null {
    const M = this.M;
    if (atts.includes('reddot')) {
      this.box(0.03, 0.02, 0.06, M.metal, 0, y + 0.01, z);
      const cy = y + 0.045;
      this.box(0.02, 0.025, 0.04, M.metal, 0, y + 0.02, z);
      this.tube(0.024, 0.085, M.poly, 0, cy, z - 0.01, 8, 0.006);
      this.box(0.007, 0.007, 0.002, M.red, 0, cy, z - 0.05);
      return { sightY: cy, adsZ: -0.44 };
    }
    if (atts.includes('reflex')) {
      this.box(0.04, 0.012, 0.06, M.metal, 0, y + 0.006, z);
      const cy = y + 0.04;
      // Thin square frame with a ring reticle on the glass.
      this.box(0.05, 0.006, 0.008, M.poly, 0, cy + 0.025, z - 0.02);
      this.box(0.006, 0.05, 0.008, M.poly, -0.025, cy, z - 0.02);
      this.box(0.006, 0.05, 0.008, M.poly, 0.025, cy, z - 0.02);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.008, 0.011, 10), M.red);
      ring.position.set(0, cy, z - 0.024);
      ring.rotation.y = Math.PI;
      this.root.add(ring);
      this.box(0.004, 0.004, 0.002, M.red, 0, cy, z - 0.024);
      return { sightY: cy, adsZ: -0.42 };
    }
    if (atts.includes('acog')) {
      this.box(0.03, 0.02, 0.08, M.metal, 0, y + 0.01, z);
      const cy = y + 0.05;
      this.box(0.04, 0.02, 0.1, M.tan, 0, y + 0.025, z);
      this.tube(0.026, 0.16, M.tan, 0, cy, z, 8, 0.008);
      this.tube(0.031, 0.03, M.tan, 0, cy, z - 0.09, 8, 0.008);
      this.box(0.012, 0.014, 0.03, M.tan, 0, cy + 0.032, z);
      // Chevron reticle with a post below it.
      this.box(0.006, 0.0018, 0.002, M.red, -0.0022, cy - 0.0016, z - 0.07, 0, 0, 0.7);
      this.box(0.006, 0.0018, 0.002, M.red, 0.0022, cy - 0.0016, z - 0.07, 0, 0, -0.7);
      this.box(0.0012, 0.014, 0.002, M.poly, 0, cy - 0.011, z - 0.07);
      return { sightY: cy, adsZ: -0.36 };
    }
    return null;
  }

  /** Suppressor on the muzzle; returns the new tip z. */
  suppressor(tip: number, y: number, r = 0.024, len = 0.22): number {
    this.cyl(r, len, this.M.poly, 0, y, tip - len / 2 + 0.02, 8);
    this.cyl(r * 0.6, 0.006, this.M.metal, 0, y, tip - len + 0.018, 8);
    return tip - len + 0.02;
  }

  /** Vertical foregrip under the handguard. */
  foregrip(z: number, y: number): void {
    this.box(0.035, 0.11, 0.04, this.M.poly, 0, y - 0.055, z, 0.12);
  }

  /** M203-style launcher under the handguard (z = its rear). */
  launcher(z: number, y: number): void {
    this.cyl(0.03, 0.28, this.M.metal, 0, y - 0.03, z - 0.14, 8);
    this.cyl(0.022, 0.004, this.M.poly, 0, y - 0.03, z - 0.282, 8);
    this.box(0.03, 0.03, 0.06, this.M.metal, 0, y - 0.065, z - 0.02);
    this.box(0.012, 0.03, 0.05, this.M.metal, 0, y - 0.075, z + 0.04); // trigger
    this.box(0.004, 0.04, 0.03, this.M.metal, 0.028, y + 0.03, z - 0.06); // ladder sight
  }
}

// -------------------------------------------------------------------------------------------
// Gun builders. Each draws into kit.root and returns the build info.
// -------------------------------------------------------------------------------------------

export type GunBuilder = (k: Kit, atts: readonly string[]) => GunBuild;
export const FURNITURE: Record<string, 'wood' | 'poly' | 'olive' | 'tan'> = {
  ak47: 'wood',
  ak74u: 'wood',
  rpk: 'wood',
  dragunov: 'wood',
  olympia: 'wood',
  stakeout: 'wood',
  python: 'wood',
  m1911: 'wood',
  l96a1: 'olive',
  aug: 'olive',
};

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Rifle tail: optics + muzzle + underbarrel attachments shared by long guns. */
function longGunAttachments(k: Kit, atts: readonly string[], o: { mountZ: number; mountY: number; tip: number; boreY: number; guardZ: number; guardY: number; sightY: number; adsZ: number }): { sightY: number; adsZ: number; tip: number } {
  let { sightY, adsZ, tip } = o;
  const opt = k.optic(atts, o.mountZ, o.mountY);
  if (opt) ({ sightY, adsZ } = opt);
  if (atts.includes('suppressor')) tip = k.suppressor(tip, o.boreY);
  if (atts.includes('grip')) k.foregrip(o.guardZ, o.guardY);
  if (atts.includes('gl')) k.launcher(o.guardZ + 0.12, o.guardY);
  return { sightY, adsZ, tip };
}

export const GUNS: Record<string, GunBuilder> = {
  // The prototype AK (wood furniture), with attachments and a moving magazine.
  ak47(k, atts) {
    const { M } = k;
    k.box(0.07, 0.09, 0.38, M.body, 0, 0, 0);
    k.box(0.06, 0.02, 0.3, M.metal, 0, 0.055, -0.02);
    k.box(0.078, 0.078, 0.28, M.furn, 0, -0.005, -0.32);
    k.box(0.05, 0.03, 0.2, M.metal, 0, 0.045, -0.32); // gas tube
    const tip = k.barrel(-0.43, 0.34, 0.013, 0.012);
    k.cyl(0.018, 0.04, M.metal, 0, 0.012, tip + 0.02);
    k.frontPost(-0.66, 0.088, 0.05);
    k.rearSight(-0.1, 0.085);
    const mag = k.magazine(-0.08, -0.045, atts, (g, l) => k.curvedMag(g, 0.2 * l, 0.05, 0.085));
    k.pistolGrip(0.11, -0.045);
    k.stock(0.19, 0.27, -0.02, 0.11, M.furn, 0.03);
    const r = longGunAttachments(k, atts, { mountZ: -0.06, mountY: 0.065, tip: tip, boreY: 0.012, guardZ: -0.36, guardY: -0.045, sightY: 0.088, adsZ: -0.46 });
    return { muzzle: V(0, 0.012, r.tip), sightY: r.sightY, adsZ: r.adsZ, grip: V(0.005, -0.1, 0.11), fore: V(-0.012, -0.05, -0.32), parts: { mag }, pistol: false };
  },

  m16(k, atts) {
    const { M } = k;
    k.box(0.065, 0.085, 0.34, M.body, 0, 0, 0);
    k.box(0.06, 0.035, 0.1, M.body, 0, -0.06, -0.08); // mag well
    // Round, ribbed handguard.
    k.cyl(0.04, 0.3, M.furn, 0, 0.0, -0.32, 6);
    k.cyl(0.044, 0.02, M.metal, 0, 0.0, -0.18, 6);
    const tip = k.barrel(-0.47, 0.3, 0.012, 0.0);
    k.cyl(0.016, 0.05, M.metal, 0, 0, tip + 0.02); // flash hider
    // Triangle front sight post.
    k.box(0.012, 0.09, 0.02, M.metal, 0, 0.045, -0.56, 0.2);
    k.box(0.01, 0.03, 0.01, M.metal, 0, 0.11, -0.565);
    const sightY = k.carryHandle(-0.12, 0.12, 0.042);
    const mag = k.magazine(-0.08, -0.075, atts, (g, l) => k.straightMag(g, 0.17 * l, 0.042, 0.07, M.metal, 0.12));
    k.pistolGrip(0.12, -0.04, M.poly);
    k.stock(0.17, 0.3, -0.005, 0.1, M.furn, 0.035);
    const r = longGunAttachments(k, atts, { mountZ: 0, mountY: sightY - 0.01, tip, boreY: 0, guardZ: -0.34, guardY: -0.04, sightY: 0.114, adsZ: -0.46 });
    return { muzzle: V(0, 0, r.tip), sightY: r.sightY, adsZ: r.adsZ, grip: V(0.005, -0.1, 0.13), fore: V(-0.012, -0.045, -0.3), parts: { mag }, pistol: false };
  },

  commando(k, atts) {
    const { M } = k;
    k.box(0.065, 0.085, 0.34, M.body, 0, 0, 0);
    k.box(0.06, 0.035, 0.1, M.body, 0, -0.06, -0.08);
    k.cyl(0.04, 0.18, M.furn, 0, 0, -0.26, 6);
    const tip0 = k.barrel(-0.35, 0.1, 0.012, 0);
    k.cyl(0.022, 0.12, M.metal, 0, 0, tip0 - 0.05, 6); // moderator
    const tip = tip0 - 0.11;
    k.box(0.012, 0.09, 0.02, M.metal, 0, 0.045, -0.37, 0.2);
    k.box(0.01, 0.03, 0.01, M.metal, 0, 0.11, -0.375);
    const sightY = k.carryHandle(-0.12, 0.12, 0.042);
    const mag = k.magazine(-0.08, -0.075, atts, (g, l) => k.straightMag(g, 0.17 * l, 0.042, 0.07, M.metal, 0.12));
    k.pistolGrip(0.12, -0.04, M.poly);
    // Collapsible stock: buffer tube + short butt.
    k.cyl(0.02, 0.2, M.metal, 0, 0.0, 0.27, 6);
    k.box(0.05, 0.1, 0.09, M.poly, 0, -0.025, 0.34);
    const r = longGunAttachments(k, atts, { mountZ: 0, mountY: sightY - 0.01, tip, boreY: 0, guardZ: -0.26, guardY: -0.04, sightY: 0.114, adsZ: -0.44 });
    return { muzzle: V(0, 0, r.tip), sightY: r.sightY, adsZ: r.adsZ, grip: V(0.005, -0.1, 0.13), fore: V(-0.012, -0.045, -0.24), parts: { mag }, pistol: false };
  },

  famas(k, atts) {
    const { M } = k;
    // Bullpup: long receiver, grip forward, magazine behind the grip, full-length carry handle.
    k.box(0.07, 0.1, 0.62, M.body, 0, -0.005, 0.06);
    k.box(0.074, 0.06, 0.2, M.furn, 0, -0.03, -0.32);
    k.box(0.06, 0.11, 0.06, M.poly, 0, -0.02, 0.4); // butt
    const tip = k.barrel(-0.42, 0.2, 0.012, 0.0);
    k.cyl(0.016, 0.05, M.metal, 0, 0, tip + 0.02);
    // Handle from front post to rear.
    k.box(0.02, 0.07, 0.025, M.poly, 0, 0.08, -0.36);
    k.box(0.02, 0.07, 0.025, M.poly, 0, 0.08, 0.1);
    k.box(0.024, 0.02, 0.5, M.poly, 0, 0.12, -0.12);
    k.box(0.02, 0.02, 0.02, M.metal, 0, 0.14, 0.08);
    k.box(0.008, 0.025, 0.008, M.metal, 0, 0.142, -0.36);
    const mag = k.magazine(0.18, -0.055, atts, (g, l) => k.straightMag(g, 0.16 * l, 0.04, 0.07, M.metal, 0.15));
    k.pistolGrip(-0.06, -0.055, M.poly);
    // Folded bipod legs under the handguard.
    k.box(0.008, 0.008, 0.22, M.metal, 0.02, -0.065, -0.3);
    k.box(0.008, 0.008, 0.22, M.metal, -0.02, -0.065, -0.3);
    const r = longGunAttachments(k, atts, { mountZ: -0.1, mountY: 0.13, tip, boreY: 0, guardZ: -0.3, guardY: -0.06, sightY: 0.152, adsZ: -0.48 });
    return { muzzle: V(0, 0, r.tip), sightY: r.sightY, adsZ: r.adsZ, grip: V(0.005, -0.12, -0.05), fore: V(-0.012, -0.07, -0.33), parts: { mag }, pistol: false };
  },

  galil(k, atts) {
    const { M } = k;
    k.box(0.07, 0.09, 0.4, M.body, 0, 0, 0);
    k.box(0.06, 0.02, 0.3, M.metal, 0, 0.055, -0.02);
    k.box(0.08, 0.075, 0.22, M.furn, 0, -0.005, -0.31);
    const tip = k.barrel(-0.42, 0.3, 0.013, 0.012);
    k.cyl(0.018, 0.06, M.metal, 0, 0.012, tip + 0.03, 6);
    k.box(0.012, 0.07, 0.014, M.metal, 0, 0.06, -0.62);
    k.box(0.012, 0.025, 0.012, M.metal, 0, 0.078, -0.1); // rear flip sight
    const mag = k.magazine(-0.08, -0.045, atts, (g, l) => k.curvedMag(g, 0.22 * l, 0.05, 0.085, M.metal));
    k.pistolGrip(0.11, -0.045, M.poly);
    k.skeletonStock(0.2, 0.3, -0.01, M.metal);
    // Carry handle on the left (Galil).
    k.box(0.01, 0.015, 0.08, M.metal, -0.04, 0.04, -0.2);
    const r = longGunAttachments(k, atts, { mountZ: -0.04, mountY: 0.066, tip, boreY: 0.012, guardZ: -0.33, guardY: -0.045, sightY: 0.095, adsZ: -0.46 });
    return { muzzle: V(0, 0.012, r.tip), sightY: r.sightY, adsZ: r.adsZ, grip: V(0.005, -0.1, 0.11), fore: V(-0.012, -0.05, -0.31), parts: { mag }, pistol: false };
  },

  aug(k, atts) {
    const { M } = k;
    // Bullpup with green furniture, swept body, forward folding grip, rail on top.
    k.box(0.08, 0.11, 0.5, M.furn, 0, -0.01, 0.1);
    k.box(0.06, 0.07, 0.16, M.furn, 0, 0.0, -0.22);
    k.box(0.07, 0.06, 0.14, M.furn, 0, -0.04, 0.0, 0.35); // trigger guard sweep
    const tip = k.barrel(-0.3, 0.3, 0.013, 0.01);
    k.cyl(0.017, 0.06, M.metal, 0, 0.01, tip + 0.03);
    k.rail(-0.2, 0.1, 0.045);
    k.box(0.03, 0.03, 0.02, M.metal, 0, 0.075, 0.05);
    k.box(0.008, 0.03, 0.008, M.metal, 0, 0.074, -0.22);
    const mag = k.magazine(0.18, -0.065, atts, (g, l) => k.straightMag(g, 0.15 * l, 0.04, 0.07, M.poly, 0.15));
    k.box(0.04, 0.11, 0.05, M.furn, 0, -0.11, -0.03, -0.25); // pistol grip
    if (!atts.includes('gl') && !atts.includes('grip')) k.box(0.035, 0.1, 0.035, M.furn, 0, -0.09, -0.23, 0.1); // folding foregrip
    const r = longGunAttachments(k, atts, { mountZ: -0.05, mountY: 0.058, tip, boreY: 0.01, guardZ: -0.23, guardY: -0.04, sightY: 0.09, adsZ: -0.48 });
    return { muzzle: V(0, 0.01, r.tip), sightY: r.sightY, adsZ: r.adsZ, grip: V(0.005, -0.13, -0.02), fore: V(-0.012, -0.12, -0.23), parts: { mag }, pistol: false };
  },

  mp5k(k, atts) {
    const { M } = k;
    k.box(0.06, 0.08, 0.3, M.body, 0, 0, 0);
    k.box(0.064, 0.05, 0.12, M.poly, 0, -0.02, -0.18);
    const tip = k.barrel(-0.24, 0.06, 0.012, 0.0);
    k.box(0.014, 0.05, 0.02, M.metal, 0, 0.055, -0.2); // front sight hood
    k.box(0.03, 0.03, 0.03, M.metal, 0, 0.06, 0.12); // drum rear sight
    if (!atts.includes('grip')) k.box(0.035, 0.11, 0.04, M.poly, 0, -0.1, -0.18, 0.15); // vertical grip
    const mag = k.magazine(-0.06, -0.04, atts, (g, l) => k.curvedMag(g, 0.16 * l, 0.036, 0.06, M.metal));
    k.pistolGrip(0.08, -0.04, M.poly);
    k.box(0.05, 0.06, 0.03, M.poly, 0, -0.0, 0.16); // end cap
    const r = longGunAttachments(k, atts, { mountZ: 0, mountY: 0.05, tip, boreY: 0, guardZ: -0.18, guardY: -0.045, sightY: 0.08, adsZ: -0.4 });
    return { muzzle: V(0, 0, r.tip), sightY: r.sightY, adsZ: r.adsZ, grip: V(0.005, -0.1, 0.09), fore: V(-0.012, -0.12, -0.18), parts: { mag }, pistol: false };
  },

  ak74u(k, atts) {
    const { M } = k;
    k.box(0.068, 0.088, 0.34, M.body, 0, 0, 0);
    k.box(0.06, 0.03, 0.26, M.metal, 0, 0.055, -0.01); // hinged top cover
    k.box(0.076, 0.074, 0.14, M.furn, 0, -0.005, -0.24);
    const tip0 = k.barrel(-0.31, 0.06, 0.013, 0.012);
    k.cyl(0.025, 0.08, M.metal, 0, 0.012, tip0 - 0.04, 6); // booster
    const tip = tip0 - 0.08;
    k.box(0.012, 0.05, 0.012, M.metal, 0, 0.065, -0.3);
    k.rearSight(0.12, 0.085);
    const mag = k.magazine(-0.07, -0.044, atts, (g, l) => k.curvedMag(g, 0.18 * l, 0.048, 0.08, M.wood));
    k.pistolGrip(0.1, -0.044, M.furn);
    k.skeletonStock(0.17, 0.26, -0.01, M.metal);
    const r = longGunAttachments(k, atts, { mountZ: -0.04, mountY: 0.07, tip, boreY: 0.012, guardZ: -0.24, guardY: -0.045, sightY: 0.088, adsZ: -0.42 });
    return { muzzle: V(0, 0.012, r.tip), sightY: r.sightY, adsZ: r.adsZ, grip: V(0.005, -0.1, 0.1), fore: V(-0.012, -0.05, -0.24), parts: { mag }, pistol: false };
  },

  mpl(k, atts) {
    const { M } = k;
    k.box(0.06, 0.07, 0.34, M.body, 0, 0, 0);
    k.cyl(0.03, 0.12, M.metal, 0, 0.0, -0.22, 8); // barrel shroud
    for (let i = 0; i < 4; i++) k.box(0.062, 0.006, 0.01, M.poly, 0, 0.0, -0.18 - i * 0.025);
    const tip = k.barrel(-0.28, 0.06, 0.011, 0.0);
    k.box(0.012, 0.045, 0.014, M.metal, 0, 0.055, -0.15);
    k.box(0.03, 0.03, 0.02, M.metal, 0, 0.055, 0.14);
    const mag = k.magazine(-0.07, -0.035, atts, (g, l) => k.straightMag(g, 0.18 * l, 0.034, 0.05, M.metal, 0.02));
    k.pistolGrip(0.1, -0.035, M.poly);
    // Wire stock.
    k.box(0.01, 0.01, 0.28, M.metal, 0.025, 0.0, 0.31);
    k.box(0.01, 0.01, 0.28, M.metal, -0.025, -0.02, 0.31);
    k.box(0.06, 0.09, 0.012, M.metal, 0, -0.02, 0.45);
    const r = longGunAttachments(k, atts, { mountZ: 0, mountY: 0.04, tip, boreY: 0, guardZ: -0.2, guardY: -0.04, sightY: 0.078, adsZ: -0.42 });
    return { muzzle: V(0, 0, r.tip), sightY: r.sightY, adsZ: r.adsZ, grip: V(0.005, -0.09, 0.11), fore: V(-0.012, -0.075, -0.07), parts: { mag }, pistol: false };
  },

  rpk(k, atts) {
    const { M } = k;
    k.box(0.072, 0.095, 0.42, M.body, 0, 0, 0);
    k.box(0.06, 0.022, 0.32, M.metal, 0, 0.058, -0.02);
    k.box(0.08, 0.08, 0.28, M.furn, 0, -0.005, -0.35);
    const tip = k.barrel(-0.49, 0.42, 0.016, 0.012);
    k.frontPost(-0.86, 0.09, 0.055);
    k.rearSight(-0.1, 0.088);
    // Bipod legs folded along the barrel.
    k.box(0.01, 0.01, 0.26, M.metal, 0.018, -0.01, -0.72);
    k.box(0.01, 0.01, 0.26, M.metal, -0.018, -0.01, -0.72);
    const mag = k.magazine(-0.09, -0.048, atts, (g, l) => k.curvedMag(g, 0.3 * l, 0.054, 0.09, M.metal));
    k.pistolGrip(0.12, -0.048);
    // Club-foot stock.
    k.box(0.055, 0.08, 0.16, M.furn, 0, -0.03, 0.3);
    k.box(0.06, 0.14, 0.14, M.furn, 0, -0.05, 0.43);
    const r = longGunAttachments(k, atts, { mountZ: -0.06, mountY: 0.07, tip, boreY: 0.012, guardZ: -0.38, guardY: -0.045, sightY: 0.09, adsZ: -0.48 });
    return { muzzle: V(0, 0.012, r.tip), sightY: r.sightY, adsZ: r.adsZ, grip: V(0.005, -0.1, 0.12), fore: V(-0.012, -0.05, -0.35), parts: { mag }, pistol: false };
  },

  l96a1(k, atts) {
    const { M } = k;
    // Green thumbhole chassis, heavy barrel, bolt on the right, built-in scope.
    k.box(0.07, 0.08, 0.36, M.body, 0, 0.0, 0);
    k.box(0.085, 0.08, 0.42, M.furn, 0, -0.035, -0.32);
    k.box(0.08, 0.07, 0.3, M.furn, 0, -0.04, 0.28);
    k.box(0.08, 0.16, 0.08, M.furn, 0, -0.07, 0.45); // butt
    k.box(0.07, 0.04, 0.16, M.furn, 0, 0.04, 0.33); // cheek rest
    k.box(0.05, 0.12, 0.06, M.furn, 0, -0.1, 0.12, -0.3); // thumbhole grip
    k.box(0.08, 0.02, 0.18, M.furn, 0, -0.14, 0.22); // lower bar of the thumbhole
    const tip = k.barrel(-0.53, 0.46, 0.017, 0.01);
    k.cyl(0.022, 0.05, M.metal, 0, 0.01, tip + 0.02);
    const mag = k.magazine(-0.04, -0.07, atts, (g, l) => k.straightMag(g, 0.07 * l, 0.04, 0.07, M.metal, 0));
    const bolt = k.group(0.04, 0.02, 0.08);
    k.box(0.06, 0.012, 0.012, M.metal, 0.03, 0, 0, 0, 0, 0, bolt);
    k.box(0.022, 0.022, 0.022, M.metal, 0.06, 0, 0, 0, 0, 0, bolt);
    let sightY = 0.12;
    let adsZ = -0.4;
    const opt = k.optic(atts, -0.05, 0.04);
    if (opt) ({ sightY, adsZ } = opt);
    else sightY = k.scope(-0.06, 0.04, 0.34, 0.032, atts.includes('varzoom'));
    let t = tip;
    if (atts.includes('suppressor')) t = k.suppressor(tip, 0.01, 0.028, 0.24);
    return { muzzle: V(0, 0.01, t), sightY, adsZ, grip: V(0.005, -0.11, 0.13), fore: V(-0.012, -0.08, -0.32), parts: { mag, bolt }, pistol: false };
  },

  dragunov(k, atts) {
    const { M } = k;
    k.box(0.066, 0.085, 0.36, M.body, 0, 0, 0);
    k.box(0.078, 0.07, 0.26, M.furn, 0, -0.005, -0.31);
    for (let i = 0; i < 4; i++) k.box(0.08, 0.008, 0.02, M.poly, 0, -0.005, -0.22 - i * 0.05);
    const tip = k.barrel(-0.44, 0.5, 0.012, 0.012);
    k.cyl(0.017, 0.07, M.metal, 0, 0.012, tip + 0.035, 6);
    // Skeleton (thumbhole) wood stock.
    k.box(0.05, 0.03, 0.34, M.furn, 0, 0.0, 0.33);
    k.box(0.05, 0.03, 0.26, M.furn, 0, -0.12, 0.36, 0.25);
    k.box(0.06, 0.16, 0.04, M.furn, 0, -0.06, 0.5);
    k.box(0.045, 0.12, 0.05, M.furn, 0, -0.08, 0.17, -0.3);
    const mag = k.magazine(-0.08, -0.044, atts, (g, l) => k.straightMag(g, 0.11 * l, 0.045, 0.08, M.metal, 0.12));
    let sightY = 0.12;
    let adsZ = -0.4;
    const opt = k.optic(atts, -0.04, 0.05);
    if (opt) ({ sightY, adsZ } = opt);
    else sightY = k.scope(-0.04, 0.05, 0.3, 0.028, atts.includes('varzoom'));
    let t = tip;
    if (atts.includes('suppressor')) t = k.suppressor(tip, 0.012, 0.026, 0.22);
    return { muzzle: V(0, 0.012, t), sightY, adsZ, grip: V(0.005, -0.12, 0.17), fore: V(-0.012, -0.05, -0.31), parts: { mag }, pistol: false };
  },

  olympia(k) {
    const { M } = k;
    k.box(0.07, 0.07, 0.16, M.metal, 0, -0.01, 0.0); // action
    // Barrels + fore-end hinge at the front of the action (break action on reload).
    const barrels = k.group(0, -0.02, -0.08);
    k.cyl(0.017, 0.6, M.metal, 0.018, 0.02, -0.3, 6, barrels);
    k.cyl(0.017, 0.6, M.metal, -0.018, 0.02, -0.3, 6, barrels);
    k.box(0.01, 0.006, 0.6, M.metal, 0, 0.042, -0.3, 0, 0, 0, barrels); // rib
    k.box(0.006, 0.008, 0.006, M.brass, 0, 0.05, -0.59, 0, 0, 0, barrels); // bead
    k.box(0.06, 0.04, 0.2, M.furn, 0, -0.015, -0.14, 0, 0, 0, barrels); // fore-end
    // Shells visible when the action is open.
    k.cyl(0.014, 0.05, M.shell, 0.018, 0.02, 0.02, 6, barrels);
    k.cyl(0.014, 0.05, M.shell, -0.018, 0.02, 0.02, 6, barrels);
    // Wood stock with a straight wrist.
    k.box(0.05, 0.06, 0.16, M.furn, 0, -0.06, 0.15, 0.25);
    k.box(0.06, 0.12, 0.24, M.furn, 0, -0.13, 0.33, 0.12);
    k.box(0.012, 0.02, 0.06, M.metal, 0, -0.055, 0.04);
    return { muzzle: V(0, 0.0, -0.69), sightY: 0.056, adsZ: -0.44, grip: V(0.005, -0.08, 0.14), fore: V(-0.012, -0.06, -0.22), parts: { barrels }, pistol: false };
  },

  stakeout(k, atts) {
    const { M } = k;
    k.box(0.068, 0.085, 0.26, M.body, 0, 0, 0);
    const tip = k.barrel(-0.13, 0.42, 0.017, 0.02);
    k.cyl(0.014, 0.34, M.metal, 0, -0.022, -0.3, 6); // magazine tube
    k.box(0.006, 0.008, 0.006, M.brass, 0, 0.042, tip + 0.01);
    const pump = k.group(0, -0.022, -0.3);
    k.cyl(0.028, 0.16, M.furn, 0, 0, 0, 8, pump);
    for (let i = 0; i < 4; i++) k.cyl(0.03, 0.008, M.poly, 0, 0, -0.06 + i * 0.04, 8, pump);
    // Pistol grip only (no stock).
    k.box(0.05, 0.14, 0.06, M.furn, 0, -0.1, 0.13, -0.4);
    k.box(0.012, 0.02, 0.07, M.metal, 0, -0.05, 0.05);
    if (atts.includes('grip')) k.foregrip(-0.3, -0.05);
    return { muzzle: V(0, 0.02, tip), sightY: 0.046, adsZ: -0.42, grip: V(0.005, -0.11, 0.12), fore: V(-0.012, -0.045, -0.3), parts: { pump }, pistol: false };
  },

  spas12(k, atts) {
    const { M } = k;
    k.box(0.07, 0.095, 0.3, M.body, 0, 0, 0);
    const tip = k.barrel(-0.15, 0.42, 0.017, 0.022);
    // Ventilated barrel jacket.
    k.cyl(0.024, 0.2, M.poly, 0, 0.022, -0.26, 6);
    k.cyl(0.016, 0.38, M.metal, 0, -0.024, -0.33, 6);
    const pump = k.group(0, -0.024, -0.26);
    k.box(0.07, 0.05, 0.18, M.poly, 0, -0.005, 0, 0, 0, 0, pump);
    for (let i = 0; i < 5; i++) k.box(0.072, 0.006, 0.01, M.metal, 0, 0.0, -0.07 + i * 0.035, 0, 0, 0, pump);
    k.box(0.012, 0.03, 0.012, M.metal, 0, 0.06, -0.12);
    k.box(0.03, 0.02, 0.02, M.metal, 0, 0.06, 0.12);
    k.pistolGrip(0.12, -0.047, M.poly);
    // Folding metal stock with the hook.
    k.box(0.012, 0.012, 0.3, M.metal, 0.03, 0.0, 0.3);
    k.box(0.012, 0.012, 0.3, M.metal, -0.03, 0.0, 0.3);
    k.box(0.07, 0.012, 0.012, M.metal, 0, 0.0, 0.45);
    k.box(0.012, 0.06, 0.012, M.metal, 0, 0.03, 0.45);
    let t = tip;
    if (atts.includes('suppressor')) t = k.suppressor(tip, 0.022, 0.03, 0.2);
    return { muzzle: V(0, 0.022, t), sightY: 0.07, adsZ: -0.44, grip: V(0.005, -0.1, 0.13), fore: V(-0.012, -0.05, -0.26), parts: { pump }, pistol: false };
  },

  m1911(k, atts) {
    return pistolGun(k, atts, { slideLen: 0.22, slideH: 0.045, gripH: 0.11, barrelExtra: 0, rev: false });
  },
  asp(k, atts) {
    return pistolGun(k, atts, { slideLen: 0.16, slideH: 0.04, gripH: 0.085, barrelExtra: 0, rev: false });
  },
  python(k, atts) {
    return pistolGun(k, atts, { slideLen: 0.28, slideH: 0.04, gripH: 0.11, barrelExtra: 0.08, rev: true });
  },

  gl(k) {
    const { M } = k;
    // The M203 raised: launcher tube under a stub of the host rifle.
    k.box(0.065, 0.085, 0.3, M.metal, 0, 0.08, 0.05);
    k.cyl(0.035, 0.36, M.metal, 0, -0.01, -0.2, 8);
    k.cyl(0.028, 0.005, M.poly, 0, -0.01, -0.382, 8);
    k.cyl(0.04, 0.24, M.poly, 0, 0.08, -0.22, 6); // host handguard
    k.box(0.04, 0.05, 0.08, M.metal, 0, -0.05, 0.0);
    k.box(0.045, 0.12, 0.05, M.poly, 0, -0.1, 0.08, -0.3);
    // Ladder sight flipped up.
    k.box(0.004, 0.07, 0.03, M.metal, 0.045, 0.16, -0.1);
    k.box(0.02, 0.004, 0.004, M.metal, 0.035, 0.18, -0.1);
    return { muzzle: V(0, -0.01, -0.39), sightY: 0.18, adsZ: -0.44, grip: V(0.005, -0.12, 0.09), fore: V(-0.012, -0.06, -0.2), parts: {}, pistol: false };
  },

  knife(k) {
    knifeMesh(k, k.root);
    return { muzzle: V(0, 0, -0.2), sightY: 0, adsZ: -0.4, grip: V(0, -0.05, 0.05), fore: V(0, -0.05, 0.05), parts: {}, pistol: true };
  },
};

/** Pistol / revolver body. */
function pistolGun(k: Kit, atts: readonly string[], o: { slideLen: number; slideH: number; gripH: number; barrelExtra: number; rev: boolean }): GunBuild {
  const { M } = k;
  const dual = atts.includes('dual');
  const one = (parent: THREE.Object3D) => {
    const slide = k.group(0, 0.02, -0.05, parent);
    if (o.rev) {
      k.box(0.036, 0.035, o.slideLen, M.body, 0, 0, -0.02, 0, 0, 0, slide);
      k.box(0.012, 0.014, o.slideLen * 0.9, M.body, 0, 0.024, -0.03, 0, 0, 0, slide); // vent rib
      k.box(0.026, 0.02, o.slideLen * 0.85, M.metal, 0, -0.026, -0.04, 0, 0, 0, slide); // ejector shroud
    } else {
      k.box(0.038, o.slideH, o.slideLen, M.body, 0, 0, 0, 0, 0, 0, slide);
      for (let i = 0; i < 4; i++) k.box(0.04, o.slideH * 0.7, 0.004, M.poly, 0, 0, o.slideLen / 2 - 0.02 - i * 0.012, 0, 0, 0, slide);
    }
    k.box(0.034, 0.028, o.slideLen * 0.72, M.metal, 0, -0.012, -0.03, 0, 0, 0, parent); // frame
    k.box(0.034, o.gripH, 0.055, M.furn, 0, -0.025 - o.gripH / 2, 0.04, 0.22, 0, 0, parent);
    k.box(0.01, 0.02, 0.05, M.metal, 0, -0.04, -0.03, 0, 0, 0, parent);
    const front = -0.05 - o.slideLen / 2;
    k.box(0.008, 0.012, 0.01, M.metal, 0, 0.05, front + 0.01, 0, 0, 0, parent);
    k.box(0.025, 0.012, 0.01, M.metal, 0, 0.05, -0.05 + o.slideLen / 2 - 0.01, 0, 0, 0, parent);
    let cylinder: THREE.Object3D | undefined;
    if (o.rev) {
      cylinder = k.group(0, 0.0, 0.0, parent);
      k.cyl(0.03, 0.06, M.metal, 0, 0, 0, 6, cylinder);
      k.box(0.03, 0.03, 0.05, M.metal, 0, 0.02, 0.06, 0, 0, 0, parent); // hammer area
    }
    if (atts.includes('extmag') && !o.rev) k.box(0.028, 0.05, 0.045, M.metal, 0, -0.03 - o.gripH, 0.06, 0.22, 0, 0, parent);
    return { slide, cylinder, front };
  };
  const a = one(k.root);
  let offhand: THREE.Object3D | undefined;
  if (dual) {
    offhand = k.group(-0.3, 0, 0);
    one(offhand);
  }
  let sightY = 0.056;
  let adsZ = -0.36;
  let tip = a.front;
  if (atts.includes('acog')) {
    const opt = k.optic(atts, -0.04, 0.045);
    if (opt) ({ sightY, adsZ } = opt);
  }
  if (atts.includes('suppressor')) tip = k.suppressor(tip, 0.02, 0.018, 0.14);
  return { muzzle: V(0, 0.02, tip), sightY, adsZ, grip: V(0, -0.085, 0.06), fore: V(-0.03, -0.075, 0.02), parts: { slide: a.slide, cylinder: a.cylinder, offhand }, pistol: true, noAds: dual };
}

/** A combat knife (blade along -z) into `parent`. */
export function knifeMesh(k: Kit, parent: THREE.Object3D): void {
  const { M } = k;
  k.box(0.008, 0.035, 0.17, M.steel, 0, 0.0, -0.1, 0, 0, 0, parent);
  k.box(0.004, 0.012, 0.04, M.steel, 0, 0.012, -0.2, 0.5, 0, 0, parent);
  k.box(0.04, 0.05, 0.012, M.metal, 0, 0.0, -0.01, 0, 0, 0, parent);
  k.box(0.026, 0.032, 0.1, M.poly, 0, -0.002, 0.05, 0, 0, 0, parent);
}

/** A grenade in the hand (frag body). */
export function grenadeMesh(k: Kit, parent: THREE.Object3D, mat: THREE.Material): void {
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.04, 0), mat);
  m.scale.set(1, 1.25, 1);
  parent.add(m);
  k.box(0.02, 0.02, 0.02, k.M.metal, 0, 0.05, 0, 0, 0, 0, parent);
  k.box(0.008, 0.05, 0.012, k.M.metal, 0.018, 0.03, 0, 0, 0, 0.3, parent);
}
