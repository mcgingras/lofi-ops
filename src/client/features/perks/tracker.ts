/**
 * Tracker, client side (rules in the server's perks/tracker.ts, numbers and the wire format in
 * shared/defs/tracker.ts): the `perks.tracks` push (sent to Tracker players only) becomes glowing
 * boot prints on the ground, left and right feet in turn, fading out over `TRACKER.fadeSec`.
 */
import * as THREE from 'three';
import { printAlpha, unpackTracks } from '../../../shared/defs/tracker';
import { onFeature, registerMatchHook } from '../../registry';
import { currentMatch } from '../../state';

/** Enough for a full stream (24 prints, 2.5 times a second, 3.5 s). */
const POOL = 224;
/** The quad (the boot plus its glow). */
const SIZE = { w: 0.34, l: 0.56 };
/** Feet are this far either side of the walking line (m). */
const STANCE = 0.11;

let tex: THREE.CanvasTexture | null = null;
/** A boot sole and heel with a soft glow round it, drawn once (white; the material tints it). */
function bootTexture(): THREE.CanvasTexture {
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 52;
  const g = c.getContext('2d')!;
  const boot = (alpha: number) => {
    g.fillStyle = `rgba(255,255,255,${alpha})`;
    g.beginPath();
    g.ellipse(16, 17, 6.5, 8.5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillRect(12, 25, 8, 4);
    g.beginPath();
    g.ellipse(16, 34, 5.5, 5.5, 0, 0, Math.PI * 2);
    g.fill();
  };
  // Glow: the boot blurred out, faint; then the boot itself, solid, with tread gaps.
  g.filter = 'blur(4px)';
  boot(0.55);
  g.filter = 'none';
  boot(1);
  g.clearRect(9, 14, 14, 1);
  g.clearRect(9, 19, 14, 1);
  g.clearRect(10, 34, 12, 1);
  tex = new THREE.CanvasTexture(c);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

interface Print {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  born: number;
}

const state = { group: null as THREE.Group | null, pool: [] as Print[], next: 0, foot: 0 };

function ensurePool(scene: THREE.Scene): void {
  if (state.group) {
    if (state.group.parent !== scene) scene.add(state.group);
    return;
  }
  const group = new THREE.Group();
  group.name = 'perks.tracker';
  const geo = new THREE.PlaneGeometry(SIZE.w, SIZE.l);
  geo.rotateX(-Math.PI / 2);
  for (let i = 0; i < POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({ map: bootTexture(), color: 0xff7a1a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, alphaTest: 0.01 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.renderOrder = 2;
    group.add(mesh);
    state.pool.push({ mesh, mat, born: -99 });
  }
  state.group = group;
  scene.add(group);
}

onFeature('perks.tracks', (d) => {
  const m = currentMatch();
  if (!m) return;
  ensurePool(m.renderer.scene);
  for (const f of unpackTracks(d)) {
    const p = state.pool[state.next]!;
    state.next = (state.next + 1) % POOL;
    state.foot ^= 1;
    const side = state.foot ? 1 : -1;
    // Right of the walking direction (yaw 0 looks down -z): (cos yaw, 0, -sin yaw).
    const rx = Math.cos(f.yaw) * STANCE * side;
    const rz = -Math.sin(f.yaw) * STANCE * side;
    p.mesh.position.set(f.x + rx, f.y + 0.03, f.z + rz);
    p.mesh.rotation.set(0, f.yaw, 0);
    p.born = m.time;
    p.mesh.visible = true;
    p.mat.opacity = 1;
  }
});

registerMatchHook('perks.tracker', {
  start(m) {
    for (const p of state.pool) {
      p.mesh.visible = false;
      p.born = -99;
    }
    if (state.group) m.renderer.scene.add(state.group);
    return () => state.group?.removeFromParent();
  },
  frame(m) {
    if (!state.group) return;
    for (const p of state.pool) {
      if (!p.mesh.visible) continue;
      const a = printAlpha(m.time - p.born);
      if (a <= 0) p.mesh.visible = false;
      // A slow pulse so they read as glowing.
      else p.mat.opacity = a * (0.8 + 0.2 * Math.sin((m.time - p.born) * 7));
    }
  },
});

export const trackerPrintsShown = (): number => state.pool.filter((p) => p.mesh.visible).length;
