/**
 * Blackout in the world: the plane, loot items on the floor (with a rarity glow under guns), the
 * circle's wall, parachutes over gliding players (and yourself), the cameras (behind the plane
 * while aboard, behind the player you spectate after death), and soldier culling (bodies beyond
 * `SOLDIER_FAR` are drawn as a cheap shared box, beyond `SOLDIER_CULL` not at all).
 */
import * as THREE from 'three';
import { LOOT_ENTITY, PLANE_ENTITY, RARITY_COLOR, planeAt, rarityOf, type LootItem } from '../../../shared/defs/blackout';
import { PICKUP_ENTITY, dropAttachments, type DropSnapState } from '../../../shared/defs/pickups';
import { PlayerFlags } from '../../../shared/protocol';
import type { Match } from '../../game/match';
import { registerEntityRenderer, registerMatchHook } from '../../registry';
import { G, makeLookMaterial, setDynLight, type LookMaterial } from '../../render/shader';
import { getTexture } from '../../render/textures';
import { bo, circleNow, isBlackout, resetBlackout } from './store';

/** Soldiers further than this are a plain box (m); further than SOLDIER_CULL, hidden. */
export const SOLDIER_FAR = 70;
export const SOLDIER_CULL = 160;

function mat(texture: string, tint: number, mats: LookMaterial[], o: { emissive?: number; side?: 'double' } = {}): LookMaterial {
  const m = makeLookMaterial({ texture, tint, dyn: true, emissive: o.emissive, side: o.side });
  mats.push(m);
  return m;
}

const boxMesh = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
};

// ---------------------------------------------------------------------------------------------
// The plane
// ---------------------------------------------------------------------------------------------

function buildPlane(mats: LookMaterial[]): THREE.Group {
  const g = new THREE.Group();
  const hull = mat('steel', 0x8a9086, mats);
  const dark = mat('steel', 0x4a5048, mats);
  const glass = mat('steel', 0x202830, mats, { emissive: 0.2 });
  g.add(boxMesh(4.2, 4.2, 30, hull, 0, 0, 0)); // fuselage, nose toward -z
  g.add(boxMesh(3.2, 2.4, 3, hull, 0, -0.4, -16.3)); // nose
  g.add(boxMesh(2.6, 0.8, 1.2, glass, 0, 0.9, -15.6)); // cockpit glass
  g.add(boxMesh(38, 0.5, 5.5, hull, 0, 1.9, -2)); // wing
  for (const x of [-11, -6, 6, 11]) g.add(boxMesh(1.4, 1.4, 3.4, dark, x, 1.0, -3.4)); // engines
  g.add(boxMesh(13, 0.4, 3.4, hull, 0, 1.6, 13.5)); // tailplane
  g.add(boxMesh(0.5, 6, 4, hull, 0, 4.6, 13.2)); // fin
  g.add(boxMesh(3.6, 0.3, 6, dark, 0, -1.9, 12)); // open ramp
  return g;
}

registerEntityRenderer(PLANE_ENTITY, (_e, match) => {
  const mats: LookMaterial[] = [];
  const object = buildPlane(mats);
  setDynLight(mats, [1, 1, 1]);
  return {
    object,
    update(e) {
      // Follow the line exactly (the snapshots are 20 Hz; the plane is big and close).
      const s = bo.state;
      if (s && s.t0 >= 0) {
        const at = planeAt(s.plane, match.serverTime - s.t0);
        object.position.set(at.x, at.y + 2.6, at.z);
        object.rotation.y = at.yaw;
        return false;
      }
      object.position.set(e.x, e.y + 2.6, e.z);
      object.rotation.y = e.yaw;
      return false;
    },
    dispose() {
      object.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      for (const m of mats) m.dispose();
    },
  };
});

// ---------------------------------------------------------------------------------------------
// Loot items
// ---------------------------------------------------------------------------------------------

const ITEM_LOOK: Record<LootItem['k'], { tex: string; tint: number; size: [number, number, number] }> = {
  ammo: { tex: 'crate', tint: 0x8a8a4a, size: [0.42, 0.24, 0.28] },
  armor: { tex: 'vest', tint: 0x4a6a9a, size: [0.5, 0.12, 0.6] },
  bandage: { tex: 'crate', tint: 0xf0ece0, size: [0.22, 0.12, 0.16] },
  medkit: { tex: 'crate', tint: 0xd03a2a, size: [0.4, 0.22, 0.3] },
  frag: { tex: 'steel', tint: 0x3a4a30, size: [0.14, 0.18, 0.14] },
};

registerEntityRenderer(LOOT_ENTITY, (e, match) => {
  const it = e.s as unknown as LootItem | undefined;
  if (!it?.k || !ITEM_LOOK[it.k]) return null;
  const look = ITEM_LOOK[it.k];
  const mats: LookMaterial[] = [];
  const tint = it.k === 'armor' ? [0x6a8a6a, 0x4a6a9a, 0x9a6ab0][(it.l ?? 1) - 1]! : look.tint;
  const object = new THREE.Group();
  object.add(boxMesh(look.size[0], look.size[1], look.size[2], mat(look.tex, tint, mats), 0, look.size[1] / 2, 0));
  if (it.k === 'medkit') object.add(boxMesh(0.16, 0.01, 0.05, mat('crate', 0xffffff, mats, { emissive: 1 }), 0, look.size[1] + 0.006, 0), boxMesh(0.05, 0.01, 0.16, mat('crate', 0xffffff, mats, { emissive: 1 }), 0, look.size[1] + 0.006, 0));
  // A small glow so items read from a distance.
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getTexture('glow'), color: it.k === 'armor' ? 0x6aa0ff : 0xfff0b0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  glow.scale.setScalar(0.9);
  glow.position.y = 0.3;
  object.add(glow);
  if (match.map) setDynLight(mats, match.map.lightAt(e.x, e.y + 0.5, e.z));
  return {
    object,
    dispose() {
      object.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      glow.material.dispose();
      for (const m of mats) m.dispose();
    },
  };
});

// ---------------------------------------------------------------------------------------------
// Per-frame world: storm wall, chutes, rarity glows, soldier culling, cameras
// ---------------------------------------------------------------------------------------------

interface WorldViews {
  wall: THREE.Mesh;
  wallMat: THREE.MeshBasicMaterial;
  chutes: Map<string, THREE.Group>;
  myChute: THREE.Group;
  chuteMats: LookMaterial[];
  far: THREE.InstancedMesh;
  glows: THREE.Sprite[];
  glowMats: THREE.SpriteMaterial[];
}

let views: WorldViews | null = null;

function buildChute(mats: LookMaterial[]): THREE.Group {
  const g = new THREE.Group();
  const cloth = mats[0] ?? mat('vest', 0xb85a2a, mats, { side: 'double' });
  for (let i = -2; i <= 2; i++) {
    const seg = boxMesh(1.3, 0.25, 2.6, cloth, i * 1.25, 4.6 - Math.abs(i) * 0.35, 0);
    seg.rotation.z = -i * 0.18;
    g.add(seg);
  }
  const line = mats[1] ?? mat('steel', 0x202020, mats);
  for (const x of [-2.4, 2.4]) {
    const l = boxMesh(0.03, 2.8, 0.03, line, x * 0.5, 2.6, 0);
    l.rotation.z = x > 0 ? -0.35 : 0.35;
    g.add(l);
  }
  return g;
}

function setup(m: Match): () => void {
  const scene = m.renderer.scene;
  const wallMat = new THREE.MeshBasicMaterial({ color: 0xff6a2a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true), wallMat);
  wall.frustumCulled = false;
  scene.add(wall);
  const chuteMats: LookMaterial[] = [];
  chuteMats.push(makeLookMaterial({ texture: 'vest', tint: 0xb85a2a, dyn: true, side: 'double' }), makeLookMaterial({ texture: 'steel', tint: 0x202020, dyn: true }));
  const myChute = buildChute(chuteMats);
  myChute.visible = false;
  scene.add(myChute);
  const farMat = makeLookMaterial({ texture: 'camo', tint: 0x9a9a88, dyn: true });
  const far = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 1.75, 0.4).translate(0, 0.875, 0), farMat, 64);
  far.count = 0;
  far.frustumCulled = false;
  scene.add(far);
  views = { wall, wallMat, chutes: new Map(), myChute, chuteMats, far, glows: [], glowMats: [] };
  return () => {
    if (!views) return;
    wall.removeFromParent();
    wall.geometry.dispose();
    wallMat.dispose();
    myChute.removeFromParent();
    for (const c of views.chutes.values()) c.removeFromParent();
    myChute.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
    for (const mm of chuteMats) mm.dispose();
    far.removeFromParent();
    far.geometry.dispose();
    farMat.dispose();
    for (const g of views.glows) g.removeFromParent();
    for (const gm of views.glowMats) gm.dispose();
    views = null;
  };
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3(1, 1, 1);
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function frame(m: Match): void {
  const v = views;
  if (!v) return;
  const cam = m.renderer.cam;
  const st = bo.state;
  // ---- The circle's wall.
  const c = circleNow(m);
  v.wall.visible = !!c && c.cur.r > 0.5;
  if (c) {
    v.wall.position.set(c.cur.x, 60, c.cur.z);
    v.wall.scale.set(c.cur.r, 200, c.cur.r);
  }

  // ---- Cameras: behind the plane while aboard; behind the watched player after death.
  const me = m.me;
  const stage = me?.alive ? (st?.stage ?? 'ground') : 'ground';
  if (stage === 'plane') {
    const s = m.net.predictor.shown();
    const back = 30;
    const dx = -Math.sin(m.yaw) * Math.cos(m.pitch);
    const dy = Math.sin(m.pitch);
    const dz = -Math.cos(m.yaw) * Math.cos(m.pitch);
    cam.position.set(s.x - dx * back, s.y + 9 - dy * back, s.z - dz * back);
    cam.rotation.set(m.pitch - 0.12, m.yaw, 0, 'YXZ');
  } else if (me && !me.alive && st?.watching && m.phase === 'playing') {
    const w = m.remotes.views.get(st.watching);
    if (w) {
      const back = 3.6;
      const yaw = w.yaw;
      cam.position.set(w.x + Math.sin(yaw) * back, w.y + 2.3, w.z + Math.cos(yaw) * back);
      cam.lookAt(tmpP.set(w.x, w.y + 1.5, w.z));
    }
  }
  m.viewmodel.visible = m.viewmodel.visible && stage === 'ground';
  // High up (plane, freefall) the fog thins out so the island shows below.
  const T = m.map?.time;
  if (T) {
    const h = Math.max(0, cam.position.y - 12);
    G.uFogNear.value = T.fogNear + h * 1.2;
    G.uFogFar.value = T.fogFar + h * 1.8;
    if (m.map) m.map.drawBoost = h * 1.8;
  }

  // ---- Parachutes: remote gliders falling slowly (the chute brakes them to ~6 m/s).
  const rt = m.net.renderTime();
  const seen = new Set<string>();
  for (const r of m.remotes.views.values()) {
    if (!r.alive) continue;
    const s = m.net.interp.sample(r.id, rt);
    const chute = !!s && !(s.f & PlayerFlags.GROUND) && s.vy < -2 && s.vy > -12 && s.y > 2;
    if (!chute) continue;
    seen.add(r.id);
    let g = v.chutes.get(r.id);
    if (!g) {
      g = buildChute(v.chuteMats);
      m.renderer.scene.add(g);
      v.chutes.set(r.id, g);
    }
    g.position.set(r.x, r.y, r.z);
    g.rotation.y = r.yaw;
  }
  for (const [id, g] of v.chutes) {
    if (seen.has(id)) continue;
    g.removeFromParent();
    v.chutes.delete(id);
  }
  const shown = m.net.predictor.shown();
  v.myChute.visible = stage === 'chute';
  if (v.myChute.visible) {
    v.myChute.position.set(shown.x, shown.y + 0.2, shown.z);
    v.myChute.rotation.y = m.yaw;
  }
  if (m.map) setDynLight(v.chuteMats, m.map.lightAt(shown.x, shown.y + 4, shown.z));

  // ---- Soldiers: far ones as boxes, very far ones not at all.
  let n = 0;
  for (const r of m.remotes.views.values()) {
    const d = Math.hypot(r.x - cam.position.x, r.z - cam.position.z);
    if (d <= SOLDIER_FAR || !r.soldier.root.visible) continue;
    r.soldier.root.visible = false;
    if (d > SOLDIER_CULL || !r.alive || n >= v.far.instanceMatrix.count) continue;
    tmpQ.setFromAxisAngle(UP, r.yaw);
    tmpM.compose(tmpP.set(r.x, r.y, r.z), tmpQ, tmpS);
    v.far.setMatrixAt(n++, tmpM);
  }
  v.far.count = n;
  v.far.instanceMatrix.needsUpdate = true;

  // ---- Rarity glows under rare and legendary guns within 40 m.
  let k = 0;
  for (const e of m.net.lastSnap?.ents ?? []) {
    if (e.kind !== PICKUP_ENTITY) continue;
    const s = e.s as unknown as DropSnapState;
    if (!s?.l) continue;
    const rarity = rarityOf(dropAttachments(s).length, s.w);
    if (rarity === 'common' || Math.hypot(e.x - cam.position.x, e.z - cam.position.z) > 40) continue;
    let g = v.glows[k];
    if (!g) {
      const gm = new THREE.SpriteMaterial({ map: getTexture('glow'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
      v.glowMats.push(gm);
      g = new THREE.Sprite(gm);
      g.scale.setScalar(1.4);
      m.renderer.scene.add(g);
      v.glows.push(g);
    }
    (g.material as THREE.SpriteMaterial).color.setHex(RARITY_COLOR[rarity]);
    g.position.set(e.x, e.y + 0.15, e.z);
    g.visible = true;
    k++;
  }
  for (let i = k; i < v.glows.length; i++) v.glows[i]!.visible = false;
}

registerMatchHook('blackout.world', {
  start(m) {
    if (!isBlackout(m)) return;
    resetBlackout(m.joined.roomId);
    return setup(m);
  },
  frame(m) {
    if (isBlackout(m)) frame(m);
  },
});
