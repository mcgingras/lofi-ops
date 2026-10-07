/**
 * Economy models: viewmodels for the wager-only weapons (crossbow, ballistic knife), entity views
 * for crossbow bolts and tomahawks, and the camo skin on third-person rifles (remote soldiers),
 * read from each player's snapshot camo (`PlayerSnap.c`).
 */
import * as THREE from 'three';
import type { EntitySnap } from '../../../shared/protocol';
import type { Match } from '../../game/match';
import { registerEntityRenderer, registerMatchHook } from '../../registry';
import { registerViewmodel, worldUV } from '../../render/models/viewmodels';
import type { Soldier } from '../../render/models/soldier';
import { makeLookMaterial, setDynLight, type LookMaterial } from '../../render/shader';
import { hasTexture } from '../../render/textures';
import { camoTextureId } from './camos';

// ---------------------------------------------------------------------------------------------
// Viewmodels (registered under the WeaponDef.model ids of the wager weapons)
// ---------------------------------------------------------------------------------------------

registerViewmodel('crossbow', (c) => {
  const gm = c.mat('gunmetal', { rep: 0.25 });
  const body = c.camo ? c.mat(c.camo, { rep: 0.3 }) : c.mat('gunwood', { rep: 0.3 });
  const gl = c.mat('glove');
  const sl = c.mat('camo', { rep: 0.4 });
  c.box(0.06, 0.07, 0.62, body, 0, 0, -0.18);
  c.box(0.5, 0.025, 0.04, gm, 0, 0.02, -0.44); // limbs
  c.box(0.02, 0.01, 0.01, gm, 0, 0.05, -0.2);
  const string = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.004, 0.004), c.mat('paint', { tint: 0x202020 }));
  string.position.set(0, 0.03, -0.32);
  c.group.add(string);
  c.box(0.012, 0.012, 0.36, c.mat('lamp', { emissive: 0.4, tint: 0xd04020 }), 0, 0.045, -0.3); // bolt
  c.box(0.05, 0.05, 0.12, gm, 0, 0.075, -0.06); // scope
  c.box(0.045, 0.14, 0.05, body, 0, -0.1, 0.02, 0.25);
  c.box(0.055, 0.09, 0.2, body, 0, -0.03, 0.22);
  c.box(0.09, 0.095, 0.13, gl, 0.005, -0.1, 0.03);
  c.box(0.095, 0.075, 0.13, gl, -0.01, -0.04, -0.36);
  c.box(0.12, 0.12, 0.44, sl, 0.05, -0.18, 0.3, 0.2, -0.1);
  return { muzzle: new THREE.Vector3(0, 0.045, -0.5), hip: new THREE.Vector3(0.16, -0.2, -0.38), ads: new THREE.Vector3(0, -0.1, -0.36), reload: 'drop' };
});

registerViewmodel('ballistic_knife', (c) => {
  const gm = c.mat('gunmetal', { rep: 0.2 });
  const grip = c.camo ? c.mat(c.camo, { rep: 0.2 }) : c.mat('rubber', { rep: 0.2 });
  const blade = c.mat('steel', { rep: 0.2, tint: 0xd8d8d8 });
  const gl = c.mat('glove');
  const sl = c.mat('camo', { rep: 0.4 });
  c.box(0.035, 0.04, 0.16, grip, 0, 0, 0);
  c.box(0.04, 0.012, 0.02, gm, 0, 0, -0.085);
  c.box(0.008, 0.03, 0.15, blade, 0, 0.005, -0.17);
  c.box(0.075, 0.08, 0.1, gl, 0, -0.03, 0.02);
  c.box(0.1, 0.1, 0.4, sl, 0.04, -0.12, 0.28, 0.25, -0.05);
  return { muzzle: new THREE.Vector3(0, 0.005, -0.25), hip: new THREE.Vector3(0.15, -0.16, -0.32), ads: new THREE.Vector3(0.06, -0.12, -0.34), reload: 'drop' };
});

// ---------------------------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------------------------

function projectileView(e: EntitySnap, build: (mats: LookMaterial[]) => THREE.Object3D) {
  const mats: LookMaterial[] = [];
  const object = build(mats);
  let spin = 0;
  return {
    object,
    update(s: EntitySnap, dt: number, m: Match) {
      if (m.map) setDynLight(mats, m.map.lightAt(s.x, s.y, s.z));
      if (e.kind === 'tomahawk') {
        spin += dt * 18;
        object.children[0]!.rotation.x = -spin;
      }
    },
    dispose() {
      object.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const m of mats) m.dispose();
    },
  };
}

registerEntityRenderer('bolt', (e) =>
  projectileView(e, (mats) => {
    const g = new THREE.Group();
    const shaft = makeLookMaterial({ texture: 'gunmetal', dyn: true, rep: 0.2 });
    const tip = makeLookMaterial({ texture: 'lamp', dyn: true, emissive: 0.8, tint: 0xff5020 });
    mats.push(shaft, tip);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.4), shaft);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.06), tip);
    t.position.z = -0.22;
    g.add(m, t);
    return g;
  }),
);

registerEntityRenderer('tomahawk', (e) =>
  projectileView(e, (mats) => {
    const g = new THREE.Group();
    const spinner = new THREE.Group();
    const wood = makeLookMaterial({ texture: 'gunwood', dyn: true, rep: 0.2 });
    const steel = makeLookMaterial({ texture: 'gunmetal', dyn: true, rep: 0.2 });
    mats.push(wood, steel);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.36, 0.03), wood);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.14), steel);
    head.position.set(0, 0.15, -0.06);
    spinner.add(handle, head);
    g.add(spinner);
    return g;
  }),
);

// ---------------------------------------------------------------------------------------------
// Third-person camo: a skinned sleeve over each remote soldier's rifle receiver
// ---------------------------------------------------------------------------------------------

// Soldier rifle bar (see render/models/soldier.ts): from A to B, relative to the aim pivot.
const PIVOT = new THREE.Vector3(0, 1.45, 0);
const A = new THREE.Vector3(0.13, 1.4, 0.08).sub(PIVOT);
const B = new THREE.Vector3(-0.02, 1.3, 0.78).sub(PIVOT);

interface Skin {
  camo: string;
  mesh: THREE.Mesh | null;
  mat: LookMaterial | null;
}
const skins = new WeakMap<Soldier, Skin>();

function skinSoldier(soldier: Soldier, camo: string) {
  let s = skins.get(soldier);
  if (s && s.camo === camo) return;
  if (s?.mesh) {
    s.mesh.removeFromParent();
    s.mesh.geometry.dispose();
    const i = s.mat ? soldier.mats.indexOf(s.mat) : -1;
    if (i >= 0) soldier.mats.splice(i, 1);
    s.mat?.dispose();
  }
  s = { camo, mesh: null, mat: null };
  skins.set(soldier, s);
  const tex = camoTextureId(camo);
  if (camo === 'none' || !hasTexture(tex)) return;
  const dir = B.clone().sub(A);
  const len = dir.length() * 0.62;
  dir.normalize();
  const mat = makeLookMaterial({ texture: tex, dyn: true, rep: 0.25 });
  const mesh = new THREE.Mesh(worldUV(new THREE.BoxGeometry(0.068, 0.094, len), 0.068, 0.094, len), mat);
  mesh.position.copy(A).addScaledVector(B.clone().sub(A), 0.4);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  soldier.aim.add(mesh);
  soldier.mats.push(mat);
  s.mesh = mesh;
  s.mat = mat;
}

registerMatchHook('economy.camo3p', {
  frame(match) {
    const snap = match.net.lastSnap;
    if (!snap) return;
    const camoOf = new Map<string, string>();
    for (const p of snap.players) camoOf.set(p.id, p.c ?? 'none');
    for (const v of match.remotes.views.values()) skinSoldier(v.soldier, camoOf.get(v.id) ?? 'none');
  },
});
