/**
 * First-person weapon models. `registerViewmodel(modelId, build)` (WeaponDef.model) lets the
 * weapons feature add guns; core ships the prototype's rifle ('ak47', also the fallback) and a
 * pistol ('m1911'). A builder adds meshes to `ctx.group` using `ctx.mat(texture, opts)` (lit by
 * the per-object light) and returns where the muzzle is and the hip/ADS offsets.
 *
 * Camos: `ctx.camo` is a texture id (`camo.<camoId>` when the economy feature registered that
 * recipe, else null); use it for the parts a skin should cover.
 */
import * as THREE from 'three';
import { makeLookMaterial, type LookMaterial, type LookMaterialOpts } from '../shader';
import { hasTexture } from '../textures';

export interface ViewmodelCtx {
  group: THREE.Group;
  mat(texture: string, o?: Omit<LookMaterialOpts, 'texture' | 'dyn'>): LookMaterial;
  /** Box with world-scaled UVs added to the group. */
  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx?: number, ry?: number): THREE.Mesh;
  attachments: readonly string[];
  /** Camo texture id or null. */
  camo: string | null;
}

export interface ViewmodelSpec {
  /** Muzzle position in group space (flash, tracer start). */
  muzzle: THREE.Vector3;
  /** Group offset from the camera at the hip and fully aimed. */
  hip: THREE.Vector3;
  ads: THREE.Vector3;
  /** Reload animation style (default 'tilt'). */
  reload?: 'tilt' | 'drop';
  /**
   * Optional per-frame animation of the model's own parts (bolt, pump, hands, knife...), after the
   * rig has placed the group. Return true to skip the rig's generic reload dip.
   */
  animate?(s: ViewmodelAnimState): boolean | void;
}

/** What `ViewmodelSpec.animate` gets every frame. */
export interface ViewmodelAnimState {
  dt: number;
  time: number;
  ads: number;
  /** 0..1 reload progress or -1. */
  reload: number;
  /** 0..1 raise progress or -1. */
  raise: number;
  /** Seconds since the last shot (large when none). */
  sinceShot: number;
  sprint: boolean;
  /** A one-off action started with `ViewmodelRig.action` (e.g. 'melee', 'throw'), or null. */
  action: string | null;
  /** 0..1 progress of the action. */
  actionT: number;
}

export type ViewmodelBuilder = (ctx: ViewmodelCtx) => ViewmodelSpec;

const builders = new Map<string, ViewmodelBuilder>();
export function registerViewmodel(modelId: string, build: ViewmodelBuilder): void {
  builders.set(modelId, build);
}

export interface BuiltViewmodel {
  group: THREE.Group;
  spec: ViewmodelSpec;
  mats: LookMaterial[];
}

export function buildViewmodel(modelId: string, attachments: readonly string[] = [], camoId = 'none'): BuiltViewmodel {
  const group = new THREE.Group();
  const mats: LookMaterial[] = [];
  const camoTex = camoId !== 'none' && hasTexture(`camo.${camoId}`) ? `camo.${camoId}` : null;
  const ctx: ViewmodelCtx = {
    group,
    attachments,
    camo: camoTex,
    mat(texture, o = {}) {
      const m = makeLookMaterial({ ...o, texture, dyn: true, fog: false });
      mats.push(m);
      return m;
    },
    box(w, h, d, mat, x, y, z, rx = 0, ry = 0) {
      const m = new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, h, d), w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, 0);
      group.add(m);
      return m;
    },
  };
  const build = builders.get(modelId) ?? builders.get('ak47')!;
  const spec = build(ctx);
  return { group, spec, mats };
}

export function worldUV(geo: THREE.BufferGeometry, w: number, h: number, d: number): THREE.BufferGeometry {
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

// The prototype's rifle (an AK-ish carbine with wooden furniture), gloves and sleeve.
registerViewmodel('ak47', (c) => {
  const gm = c.mat('gunmetal', { rep: 0.25 });
  const body = c.camo ? c.mat(c.camo, { rep: 0.3 }) : gm;
  const gw = c.camo ? body : c.mat('gunwood', { rep: 0.3 });
  const gl = c.mat('glove');
  const sl = c.mat('camo', { rep: 0.4 });
  c.box(0.07, 0.09, 0.38, body, 0, 0, 0);
  c.box(0.06, 0.02, 0.3, gm, 0, 0.055, -0.02);
  c.box(0.078, 0.078, 0.28, gw, 0, -0.005, -0.32);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.34, 6).rotateX(Math.PI / 2), gm);
  barrel.position.set(0, 0.012, -0.6);
  c.group.add(barrel);
  c.box(0.012, 0.05, 0.012, gm, 0, 0.06, -0.66);
  c.box(0.035, 0.03, 0.02, gm, 0, 0.075, -0.1);
  c.box(0.05, 0.18, 0.085, gm, 0, -0.13, -0.08, 0.28);
  c.box(0.045, 0.13, 0.06, gw, 0, -0.1, 0.11, -0.32);
  c.box(0.06, 0.11, 0.26, gw, 0, -0.025, 0.31);
  c.box(0.09, 0.095, 0.13, gl, 0.005, -0.1, 0.11);
  c.box(0.12, 0.12, 0.44, sl, 0.05, -0.18, 0.36, 0.2, -0.1);
  c.box(0.095, 0.075, 0.13, gl, -0.012, -0.05, -0.32);
  // ADS: rear and front sight tops (y ~0.088) on the eye line, held a little away from the face.
  let adsY = -0.088;
  if (c.attachments.includes('reddot')) {
    c.box(0.05, 0.05, 0.08, gm, 0, 0.09, -0.12);
    c.box(0.04, 0.035, 0.005, c.mat('lamp', { emissive: 1, tint: 0xff4030 }), 0, 0.1, -0.16);
    adsY = -0.1;
  }
  if (c.attachments.includes('extmag')) c.box(0.05, 0.12, 0.08, gm, 0, -0.27, -0.12, 0.35);
  return { muzzle: new THREE.Vector3(0, 0.012, -0.8), hip: new THREE.Vector3(0.17, -0.21, -0.4), ads: new THREE.Vector3(0, adsY, -0.46) };
});

registerViewmodel('m1911', (c) => {
  const gm = c.mat('gunmetal', { rep: 0.2 });
  const body = c.camo ? c.mat(c.camo, { rep: 0.2 }) : gm;
  const grip = c.mat('gunwood', { rep: 0.2 });
  const gl = c.mat('glove');
  const sl = c.mat('camo', { rep: 0.4 });
  c.box(0.04, 0.045, 0.22, body, 0, 0.02, -0.05);
  c.box(0.036, 0.03, 0.16, gm, 0, -0.012, -0.03);
  c.box(0.034, 0.11, 0.055, grip, 0, -0.07, 0.04, 0.22);
  c.box(0.008, 0.012, 0.01, gm, 0, 0.05, -0.15);
  c.box(0.025, 0.012, 0.01, gm, 0, 0.05, 0.05);
  c.box(0.075, 0.08, 0.1, gl, 0, -0.085, 0.06, 0.22);
  c.box(0.07, 0.06, 0.08, gl, -0.03, -0.075, 0.02, 0.1, 0.4);
  c.box(0.1, 0.1, 0.4, sl, 0.04, -0.15, 0.3, 0.25, -0.05);
  c.box(0.1, 0.1, 0.4, sl, -0.08, -0.16, 0.3, 0.25, 0.25);
  if (c.attachments.includes('extmag')) c.box(0.028, 0.05, 0.04, gm, 0, -0.14, 0.06, 0.22);
  return { muzzle: new THREE.Vector3(0, 0.025, -0.17), hip: new THREE.Vector3(0.14, -0.17, -0.34), ads: new THREE.Vector3(0, -0.056, -0.36), reload: 'drop' };
});
