/**
 * Pack-a-Punch signature effects, client side (kinds in shared/defs/pap-effects.ts, the server in
 * streaks/packapunch-effects.ts). The server decides everything; this draws `killstreaks.papFx`:
 *
 * - Burning (incendiary rounds, dragon's breath): a hot flush and flames rising off the body; on
 *   my own screen a flickering orange edge; the napalm crackle where it starts.
 * - Poisoned (Scorpion Venom): green bubbles rising off the body (more with more doses); on my own
 *   screen a pulsing green edge; a hiss on each new dose.
 * - Shattered armour: pale shards flaking off the body; on my screen a cracked-glass overlay.
 * - Marked (Predator, for the shooter only): a red box outline around the target, drawn through
 *   walls, blinking in its last second.
 * - Stagger: my aim kicks (`Match.kick`, recovering at the held gun's rate).
 * - Piercing / collateral: a spark and blood where the round went on through, and a zing.
 * - Ricochet: the bounce's tracer, sparks off the wall and a pwing.
 * - Shockwave: a purple ring on the floor, dust and a whoomp. Knockback: dust and a thud.
 * - Frost round: an ice burst and crackle (the frost itself is the wonder weapons' ice entity).
 * - Exploding headshot: a small red-orange burst (blast jolt nearby).
 * - In hand: a red laser dot at the crosshair (AK74fu2), a second gun in the left hand (MPL-LF, and
 *   any gun with the Akimbo attachment: the same mirrored copy).
 */
import * as THREE from 'three';
import { PAP_CAMO, papEffectOf } from '../../../shared/defs/pack-a-punch';
import type { PapFx } from '../../../shared/defs/pap-effects';
import type { Vec3 } from '../../../shared/math';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { rect, unit } from '../../hud/draw';
import { onFeature, registerHudWidget, registerMatchHook } from '../../registry';
import { currentMatch } from '../../state';
import { blastJolt } from '../weapons/equipment';
import { bodyLook } from '../weapons/wonder/bodies';
import { fxKit } from '../weapons/wonder/fx';

const DEG = Math.PI / 180;
const FIRE = [0xffd060, 0xff8a20, 0xff5a10];
const MARK = 0xff3030;
const VENOM = [0x8cff5a, 0x4cd03a, 0xc8ff9a];
const rnd = (k: number) => (Math.random() * 2 - 1) * k;
const t3 = (v: readonly number[], i = 0): Vec3 => ({ x: v[i]!, y: v[i + 1]!, z: v[i + 2]! });

/** Statuses by player id (room time each ends), and the marks I placed. */
export const papFxState = {
  burn: new Map<string, number>(),
  /** Poisoned players: until (room time) and doses. */
  venom: new Map<string, { until: number; n: number }>(),
  shatter: new Map<string, number>(),
  marks: new Map<string, number>(),
  /** When my own burn / shatter started (local time), for the overlays' fade in. */
  burnAt: -9,
  shatterAt: -9,
};

const live = (m: Match, until: number | undefined) => until !== undefined && until > m.serverTime;

/** Doses of venom in player `id` right now (0 when not poisoned). */
export const venomDoses = (m: Match, id: string): number => {
  const v = papFxState.venom.get(id);
  return v && live(m, v.until) ? v.n : 0;
};
/** Is player `id` burning right now (tests, the HUD)? */
export const isBurning = (m: Match, id: string): boolean => live(m, papFxState.burn.get(id));
/** Is player `id` marked for me right now? */
export const isMarked = (m: Match, id: string): boolean => live(m, papFxState.marks.get(id)) && (m.remotes.views.get(id)?.alive ?? false);

function bodyPos(m: Match, id: string): Vec3 | null {
  if (id === m.myId) {
    const s = m.net.predictor.shown();
    return { x: s.x, y: s.y, z: s.z };
  }
  const v = m.remotes.views.get(id);
  return v && v.alive ? { x: v.x, y: v.y, z: v.z } : null;
}

onFeature('killstreaks.papFx', (fx: PapFx) => {
  const m = currentMatch();
  if (!m) return;
  switch (fx.k) {
    case 'burn': {
      const was = live(m, papFxState.burn.get(fx.v));
      papFxState.burn.set(fx.v, fx.until);
      if (fx.v === m.myId && !was) papFxState.burnAt = m.time;
      const at = bodyPos(m, fx.v);
      if (!was && at) sfx.play('ks_fire', { at: { x: at.x, y: at.y + 1, z: at.z }, volume: 0.9 });
      break;
    }
    case 'venom': {
      papFxState.venom.set(fx.v, { until: fx.until, n: fx.n });
      const at = bodyPos(m, fx.v);
      if (at) {
        sfx.play('weapons.wonder.chill', { at: { x: at.x, y: at.y + 1.1, z: at.z }, volume: 0.5 + 0.08 * fx.n, rate: 1.25 });
        for (let i = 0; i < 4 + fx.n * 2; i++) fxKit.emit({ x: at.x + rnd(0.2), y: at.y + 1.1, z: at.z + rnd(0.2) }, { color: VENOM[i % 3]!, life: 0.4, size: 0.07, size1: 0.02, vel: { x: rnd(1.5), y: Math.random() * 1.5, z: rnd(1.5) }, grav: 4 });
      }
      break;
    }
    case 'shatter': {
      papFxState.shatter.set(fx.v, fx.until);
      if (fx.v === m.myId) papFxState.shatterAt = m.time;
      const at = bodyPos(m, fx.v);
      if (at) {
        sfx.play('ks_pap_shatter', { at: { x: at.x, y: at.y + 1.2, z: at.z }, volume: 1 });
        for (let i = 0; i < 14; i++) fxKit.emit({ x: at.x, y: at.y + 1.2, z: at.z }, { color: 0xdfe8ff, life: 0.5, size: 0.08, size1: 0.02, vel: { x: rnd(3), y: Math.random() * 3, z: rnd(3) }, grav: 9 });
      }
      break;
    }
    case 'mark':
      papFxState.marks.set(fx.v, fx.until);
      sfx.play('ks_pap_mark', { volume: 0.6 });
      break;
    case 'stagger':
      if (fx.v === m.myId) m.kick(fx.p * DEG, fx.y * DEG);
      break;
    case 'pierce':
      for (let i = 0; i + 2 < fx.pts.length; i += 3) {
        const at = t3(fx.pts, i);
        m.effects.puff('blood', at, { x: 0, y: 1, z: 0 }, 8);
        m.effects.puff('spark', at, { x: 0, y: 1, z: 0 }, 4);
        if (i === 0) sfx.play('ks_pap_zing', { at, volume: 0.8 });
      }
      break;
    case 'rico': {
      const a = t3(fx.a);
      const b = t3(fx.b);
      m.effects.tracer(a, b);
      m.effects.puff('spark', a, { x: 0, y: 1, z: 0 }, 8);
      fxKit.lightning(a, b, 0xffe0a0, 0.22, 0.02);
      // A spark trail along the bounce so it reads at a glance.
      for (let i = 1; i <= 8; i++) {
        const k = i / 8;
        fxKit.emit({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k }, { color: 0xffd070, life: 0.25 + k * 0.15, size: 0.12, size1: 0.02 });
      }
      if (fx.hit) m.effects.puff('blood', b, { x: 0, y: 1, z: 0 }, 6);
      sfx.play('ks_pap_rico', { at: a, volume: 0.9 });
      break;
    }
    case 'pulse': {
      const at = { x: fx.x, y: fx.y, z: fx.z };
      fxKit.ring(at, { x: 0, y: 1, z: 0 }, 0xb46cff, 0.3, fx.r * 1.15, 0.45);
      fxKit.ring({ x: at.x, y: at.y + 0.9, z: at.z }, { x: 0, y: 1, z: 0 }, 0x6ab8ff, 0.2, fx.r * 0.9, 0.35);
      for (let i = 0; i < 12; i++) m.effects.puff('dust', { x: at.x + rnd(fx.r * 0.7), y: at.y + 0.1, z: at.z + rnd(fx.r * 0.7) }, { x: 0, y: 1, z: 0 }, 2);
      sfx.play('ks_pap_pulse', { at, volume: 1.4 });
      const me = m.net.predictor.shown();
      if (Math.hypot(me.x - at.x, me.z - at.z) < fx.r + 2) blastJolt(m, 0.35, 0);
      break;
    }
    case 'knock':
      m.effects.puff('dust', { x: fx.x, y: fx.y + 0.1, z: fx.z }, { x: 0, y: 1, z: 0 }, 6);
      sfx.play('thud', { at: { x: fx.x, y: fx.y + 1, z: fx.z }, volume: 1.2 });
      break;
    case 'freeze': {
      const at = { x: fx.x, y: fx.y + 1.1, z: fx.z };
      for (let i = 0; i < 18; i++) fxKit.emit(at, { color: i % 2 ? 0xcdeeff : 0x8fd0ff, life: 0.5 + Math.random() * 0.3, size: 0.12, size1: 0.03, vel: { x: rnd(3.5), y: Math.random() * 3, z: rnd(3.5) }, grav: 6 });
      sfx.play('ks_pap_freeze', { at, volume: 1.1 });
      break;
    }
    case 'headblast': {
      const at = { x: fx.x, y: fx.y, z: fx.z };
      fxKit.emit(at, { color: 0xffffff, life: 0.1, size: 1.2, size1: 2 });
      fxKit.emit(at, { color: 0xff6a20, life: 0.35, size: 0.8, size1: fx.r * 0.9 });
      for (let i = 0; i < 16; i++) fxKit.emit(at, { color: i % 2 ? 0xb01818 : FIRE[i % 3]!, life: 0.4 + Math.random() * 0.3, size: 0.18, size1: 0.04, vel: { x: rnd(7), y: 1 + Math.random() * 6, z: rnd(7) }, grav: 12, drag: 1 });
      m.effects.puff('blood', at, { x: 0, y: 1, z: 0 }, 12);
      sfx.play('ks_boom', { at, volume: 1.4, rate: 1.15 });
      const me = m.net.predictor.shown();
      const d = Math.hypot(me.x - at.x, me.y - at.y, me.z - at.z);
      if (d < 18) blastJolt(m, Math.min(0.7, (18 - d) / 20), Math.max(0, Math.min(1, 1.2 - d / fx.r)));
      break;
    }
  }
});

// --------------------------------------------------------------------------- world: bodies and outlines

let flameClock = 0;
const outlines = new Map<string, THREE.LineSegments>();
const outlineGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.75, 1.85, 0.75));
const outlineMat = new THREE.LineBasicMaterial({ color: MARK, depthTest: false, depthWrite: false, transparent: true, fog: false });

function updateBodies(m: Match, dt: number): void {
  flameClock += dt;
  const puff = flameClock >= 1 / 30;
  if (puff) flameClock = 0;
  for (const [id, until] of papFxState.burn) {
    if (!live(m, until)) {
      papFxState.burn.delete(id);
      continue;
    }
    if (id === m.myId) continue;
    const v = m.remotes.views.get(id);
    if (!v || !v.alive) continue;
    bodyLook(id, { heat: 0.55 + 0.15 * Math.sin(m.time * 23) });
    if (!puff) continue;
    const h = 1.7 - 0.6 * v.crouch;
    for (let i = 0; i < 3; i++) {
      fxKit.emit({ x: v.x + rnd(0.28), y: v.y + 0.15 + Math.random() * h, z: v.z + rnd(0.28) }, { color: FIRE[(Math.random() * 3) | 0]!, life: 0.35 + Math.random() * 0.3, size: 0.38, size1: 0.08, vel: { x: rnd(0.3), y: 1.8 + Math.random(), z: rnd(0.3) } });
    }
    if (Math.random() < 0.3) fxKit.emit({ x: v.x + rnd(0.2), y: v.y + h, z: v.z + rnd(0.2) }, { tex: 'puff', color: 0x2a2624, additive: false, life: 0.9, size: 0.2, size1: 0.6, vel: { x: rnd(0.3), y: 1.2, z: rnd(0.3) } });
  }
  for (const [id, v] of papFxState.venom) {
    if (!live(m, v.until)) {
      papFxState.venom.delete(id);
      continue;
    }
    const r = id === m.myId ? null : m.remotes.views.get(id);
    if (!r || !r.alive || !puff || Math.random() > 0.2 + 0.1 * v.n) continue;
    fxKit.emit({ x: r.x + rnd(0.25), y: r.y + 0.4 + Math.random() * 1.2, z: r.z + rnd(0.25) }, { color: VENOM[(Math.random() * 3) | 0]!, life: 0.6, size: 0.09, size1: 0.03, vel: { x: rnd(0.2), y: 0.9, z: rnd(0.2) } });
  }
  for (const [id, until] of papFxState.shatter) {
    if (!live(m, until)) {
      papFxState.shatter.delete(id);
      continue;
    }
    const v = id === m.myId ? null : m.remotes.views.get(id);
    if (!v || !v.alive || !puff || Math.random() > 0.25) continue;
    fxKit.emit({ x: v.x + rnd(0.3), y: v.y + 0.5 + Math.random() * 1.1, z: v.z + rnd(0.3) }, { color: 0xdfe8ff, life: 0.4, size: 0.06, size1: 0.02, vel: { x: rnd(0.8), y: 0.5, z: rnd(0.8) }, grav: 6 });
  }
  // Marks: a red outline box through walls around each target I marked.
  for (const [id, line] of outlines) {
    if (!isMarked(m, id)) {
      line.removeFromParent();
      outlines.delete(id);
    }
  }
  for (const [id, until] of papFxState.marks) {
    if (!isMarked(m, id)) {
      if (!live(m, until)) papFxState.marks.delete(id);
      continue;
    }
    const v = m.remotes.views.get(id)!;
    let line = outlines.get(id);
    if (!line) {
      line = new THREE.LineSegments(outlineGeo, outlineMat);
      line.renderOrder = 999;
      line.frustumCulled = false;
      m.renderer.scene.add(line);
      outlines.set(id, line);
    }
    const crouch = 1 - 0.35 * v.crouch - 0.55 * v.prone;
    line.position.set(v.x, v.y + 0.925 * crouch, v.z);
    line.scale.set(1, crouch, 1);
    line.rotation.y = v.yaw;
    line.visible = until - m.serverTime > 1 || Math.floor(m.time * 8) % 2 === 0;
  }
}

function clearOutlines(): void {
  for (const line of outlines.values()) line.removeFromParent();
  outlines.clear();
}

// --------------------------------------------------------------------------- in hand: dual wield

const akimbo = { src: null as THREE.Object3D | null, copy: null as THREE.Object3D | null };
const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);
const tmpM = new THREE.Matrix4();
const LOWER = new THREE.Matrix4().makeTranslation(0, -0.015, 0.02);

/** The held weapon's packed effect (the client treats camo `pap` as packed). */
function heldPacked(m: Match): string | null {
  const w = m.me?.weapons[m.slot];
  return w && w.camo === PAP_CAMO ? w.id : null;
}

function dropAkimbo(): void {
  akimbo.copy?.removeFromParent();
  akimbo.copy = null;
  akimbo.src = null;
}

/** Does the gun in hand get a second one in the left hand: packed dual wield (MPL-LF) or the Akimbo attachment? */
export function heldAkimbo(m: Match): boolean {
  const id = heldPacked(m);
  if (id && papEffectOf(id, 'akimbo')) return true;
  return m.slot < 2 && !!m.weapon()?.attachmentIds.includes('akimbo');
}

/** Dual wield in hand: a mirrored copy of the viewmodel in the left hand, following its pose. */
function updateAkimbo(m: Match): void {
  const root = m.viewmodel.root;
  const src = root.children.find((c) => c !== akimbo.copy) ?? null;
  if (!heldAkimbo(m) || !src || !root.visible || !root.parent) {
    dropAkimbo();
    return;
  }
  let copy = akimbo.copy;
  if (akimbo.src !== src || !copy) {
    dropAkimbo();
    akimbo.src = src;
    copy = akimbo.copy = src.clone();
    copy.matrixAutoUpdate = false;
    root.parent.add(copy);
  }
  // Mirror x the pose x mirror (the view camera sits at the origin looking down -z): the left-hand
  // image of the right-hand gun, with the same face winding. A touch lower so the pair doesn't
  // read as one mirrored image.
  root.updateMatrixWorld(true);
  tmpM.copy(MIRROR).multiply(root.matrixWorld).multiply(src.matrix).multiply(MIRROR);
  copy.matrix.copy(LOWER).multiply(tmpM);
  copy.matrixWorldNeedsUpdate = true;
  copy.visible = src.visible;
  // The muzzle flash and other toggled parts follow the right-hand gun.
  const a = src.children;
  const b = copy.children;
  for (let i = 0; i < a.length && i < b.length; i++) b[i]!.visible = a[i]!.visible;
}

registerMatchHook('killstreaks.papFx', {
  start() {
    papFxState.burn.clear();
    papFxState.venom.clear();
    papFxState.shatter.clear();
    papFxState.marks.clear();
    papFxState.burnAt = papFxState.shatterAt = -9;
    return () => {
      clearOutlines();
      dropAkimbo();
      papFxState.burn.clear();
      papFxState.venom.clear();
      papFxState.shatter.clear();
      papFxState.marks.clear();
    };
  },
  frame(m, dt) {
    updateBodies(m, dt);
    updateAkimbo(m);
  },
});

// --------------------------------------------------------------------------- HUD: overlays and the laser dot

/** Deterministic crack lines (from screen corners and edges inward), in 0..1 screen units. */
const CRACKS: [number, number][][] = (() => {
  let s = 1234567;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out: [number, number][][] = [];
  const starts: [number, number][] = [[0, 0.1], [0.08, 0], [1, 0.85], [0.93, 1], [0, 0.78], [1, 0.2], [0.35, 1], [0.7, 0]];
  for (const [x0, y0] of starts) {
    const pts: [number, number][] = [[x0, y0]];
    let x = x0;
    let y = y0;
    const dx = (0.5 - x0) * 0.11;
    const dy = (0.5 - y0) * 0.11;
    for (let i = 0; i < 3; i++) {
      x += dx * (0.6 + r() * 0.8) + (r() - 0.5) * 0.06;
      y += dy * (0.6 + r() * 0.8) + (r() - 0.5) * 0.06;
      pts.push([x, y]);
    }
    out.push(pts);
  }
  return out;
})();

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, u: number, c: string): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / u));
  for (let i = 0; i <= n; i++) rect(g, Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), u, u, c);
}

registerHudWidget(
  'killstreaks.papStatus',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.alive) return;
    const u = unit(H);
    // On fire: a flickering orange edge: a solid rim, then dithered flame pixels thinning inward
    // (opaque pixels only: the HUD composites where alpha > 0.5).
    if (isBurning(m, m.myId)) {
      const k = Math.min(1, (m.time - papFxState.burnAt) / 0.15);
      const frame = Math.floor(m.time * 14);
      const rim = 2 * u;
      const cols = ['#ff8a20', '#ffb040', '#ff5a10'];
      const c0 = cols[frame % 3]!;
      rect(g, 0, 0, W, rim, c0);
      rect(g, 0, H - rim, W, rim, c0);
      rect(g, 0, 0, rim, H, c0);
      rect(g, W - rim, 0, rim, H, c0);
      const step = 2 * u;
      const depth = Math.round((12 + 4 * Math.sin(m.time * 17)) * u * k);
      for (let d = rim; d < depth; d += step) {
        const density = 1 - d / depth;
        const lay = d / step;
        for (let i = 0; i * step < W; i++) {
          const h1 = ((i * 73856093) ^ (lay * 19349663) ^ (frame * 83492791)) >>> 0;
          if ((h1 % 1000) / 1000 < density * 0.7) rect(g, i * step, d, step, step, cols[h1 % 3]!);
          const h2 = (h1 * 2654435761) >>> 0;
          if ((h2 % 1000) / 1000 < density * 0.7) rect(g, i * step, H - d - step, step, step, cols[h2 % 3]!);
        }
        for (let j = 0; j * step < H; j++) {
          const h1 = ((j * 2971215073) ^ (lay * 433494437) ^ (frame * 1597334677)) >>> 0;
          if ((h1 % 1000) / 1000 < density * 0.7) rect(g, d, j * step, step, step, cols[h1 % 3]!);
          const h2 = (h1 * 2246822519) >>> 0;
          if ((h2 % 1000) / 1000 < density * 0.7) rect(g, W - d - step, j * step, step, step, cols[h2 % 3]!);
        }
      }
    }
    // Poisoned: a green rim that pulses, thicker with more doses.
    const doses = venomDoses(m, m.myId);
    if (doses > 0) {
      const rim = Math.round((1 + doses * 0.6) * u * (0.6 + 0.4 * Math.abs(Math.sin(m.time * 5))));
      const c = Math.floor(m.time * 6) % 2 ? '#5ad040' : '#8cff5a';
      rect(g, 0, 0, W, rim, c);
      rect(g, 0, H - rim, W, rim, c);
      rect(g, 0, 0, rim, H, c);
      rect(g, W - rim, 0, rim, H, c);
    }
    // Armour shattered: cracked glass over the screen while it lasts.
    if (live(m, papFxState.shatter.get(m.myId))) {
      const c = Math.floor(m.time * 2) % 2 ? '#e8f0ff' : '#c8d4e8';
      for (const pts of CRACKS) {
        for (let i = 1; i < pts.length; i++) line(g, pts[i - 1]![0] * W, pts[i - 1]![1] * H, pts[i]![0] * W, pts[i]![1] * H, u, c);
      }
    }
    // Laser (AK74fu2): a red dot at the crosshair, where every round goes.
    const id = heldPacked(m);
    if (id && papEffectOf(id, 'laser') && m.slot < 2) {
      const cx = Math.round(W / 2);
      const cy = Math.round(H / 2);
      rect(g, cx - u, cy - u, 2 * u, 2 * u, Math.floor(m.time * 6) % 3 ? '#ff2020' : '#ff6060');
    }
  },
  22,
);
