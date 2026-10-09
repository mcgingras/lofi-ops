/**
 * Economy models: viewmodels for the wager-only weapons (crossbow, ballistic knife; with the
 * weapons feature's knife / throwing hands, so the knife and the tomahawk show with them in hand),
 * entity views for crossbow bolts (a blinking, beeping red tip once stuck) and ballistic knife
 * blades (stuck in walls, lying at bodies), and the camo skin on third-person rifles (remote
 * soldiers), read from each player's snapshot camo (`PlayerSnap.c`).
 */
import * as THREE from 'three';
import { BLADE_ENTITY, BOLT_ENTITY } from '../../../shared/defs/economy';
import type { EntitySnap } from '../../../shared/protocol';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { registerEntityRenderer, registerMatchHook } from '../../registry';
import { registerViewmodel, worldUV, type ViewmodelCtx, type ViewmodelSpec } from '../../render/models/viewmodels';
import { actionHands } from '../weapons/viewmodels';
import type { Soldier } from '../../render/models/soldier';
import { makeLookMaterial, setDynLight, type LookMaterial } from '../../render/shader';
import { hasTexture } from '../../render/textures';
import { camoTextureId } from './camos';

// ---------------------------------------------------------------------------------------------
// Viewmodels (registered under the WeaponDef.model ids of the wager weapons)
// ---------------------------------------------------------------------------------------------

/** Move what a builder put in the group into a gun root, and add the knife / throwing hands. */
function withHands(c: ViewmodelCtx, spec: ViewmodelSpec): ViewmodelSpec {
  const gunRoot = new THREE.Group();
  for (const ch of [...c.group.children]) gunRoot.add(ch);
  c.group.add(gunRoot);
  const hands = actionHands(c, gunRoot, spec.hip);
  return { ...spec, animate: (st) => hands(st) };
}

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
  return withHands(c, { muzzle: new THREE.Vector3(0, 0.045, -0.5), hip: new THREE.Vector3(0.16, -0.2, -0.38), ads: new THREE.Vector3(0, -0.1, -0.36), reload: 'drop' });
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
  return withHands(c, { muzzle: new THREE.Vector3(0, 0.005, -0.25), hip: new THREE.Vector3(0.15, -0.16, -0.32), ads: new THREE.Vector3(0.06, -0.12, -0.34), reload: 'drop' });
});

// ---------------------------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------------------------

interface Built {
  object: THREE.Group;
  /** Pitched child (core sets the group's yaw). */
  body: THREE.Group;
  mats: LookMaterial[];
}

function build(fn: (body: THREE.Group, mk: (texture: string, o?: { tint?: number; emissive?: number }) => LookMaterial) => void): Built {
  const object = new THREE.Group();
  const body = new THREE.Group();
  body.rotation.order = 'YXZ';
  object.add(body);
  const mats: LookMaterial[] = [];
  fn(body, (texture, o = {}) => {
    const m = makeLookMaterial({ texture, dyn: true, rep: 0.2, ...o });
    mats.push(m);
    return m;
  });
  return { object, body, mats };
}

function disposeBuilt(b: Built) {
  b.object.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  for (const m of b.mats) m.dispose();
}

const box = (parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.z = z;
  parent.add(mesh);
  return mesh;
};

registerEntityRenderer(BOLT_ENTITY, () => {
  let tip: THREE.Mesh | null = null;
  let litMat: LookMaterial | null = null;
  let darkMat: LookMaterial | null = null;
  const b = build((body, mk) => {
    // Shaft trailing behind the point it flies (and sticks) along: the tip is just ahead of the
    // origin, so a stuck bolt's point sinks into the surface (the server stops 4 cm short).
    box(body, 0.02, 0.02, 0.36, mk('gunmetal'), 0.15);
    box(body, 0.06, 0.004, 0.07, mk('paint', { tint: 0x303030 }), 0.3); // fletching
    litMat = mk('lamp', { emissive: 1, tint: 0xff3020 });
    darkMat = mk('lamp', { emissive: 0.2, tint: 0x802018 });
    tip = box(body, 0.04, 0.04, 0.07, litMat, -0.02);
  });
  let nextBeep = 0;
  return {
    object: b.object,
    update(s: EntitySnap, _dt: number, m: Match) {
      if (m.map) setDynLight(b.mats, m.map.lightAt(s.x, s.y, s.z));
      b.body.rotation.x = Number(s.s?.pt ?? 0);
      // Stuck in you: don't draw it inside the camera.
      b.object.visible = s.s?.p !== m.myId;
      if (s.s?.k && tip && litMat && darkMat) {
        const on = Math.floor(m.time * 8) % 2 === 0;
        tip.material = on ? litMat : darkMat;
        if (m.time >= nextBeep) {
          nextBeep = m.time + 0.25;
          sfx.play('weapons.beep', { at: { x: s.x, y: s.y, z: s.z }, volume: 0.7 });
        }
      }
    },
    dispose: () => disposeBuilt(b),
  };
});

registerEntityRenderer(BLADE_ENTITY, () => {
  const b = build((body, mk) => {
    // Blade (point a little ahead of the origin, sunk into whatever it hit) and its dark tang.
    box(body, 0.008, 0.035, 0.2, mk('weapons.steel', { tint: 0xe8e8e8 }), 0.05);
    box(body, 0.026, 0.04, 0.016, mk('gunmetal'), 0.15);
    box(body, 0.016, 0.022, 0.06, mk('rubber'), 0.19);
  });
  return {
    object: b.object,
    update(s: EntitySnap, _dt: number, m: Match) {
      if (m.map) setDynLight(b.mats, m.map.lightAt(s.x, s.y + 0.1, s.z));
      const k = Number(s.s?.k ?? 0);
      b.body.rotation.x = k === 2 ? 0 : Number(s.s?.pt ?? 0);
      // On the floor: lying flat on its side.
      b.body.rotation.z = k === 2 ? Math.PI / 2 : 0;
      b.body.position.y = k === 2 ? 0.01 : 0;
    },
    dispose: () => disposeBuilt(b),
  };
});

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
