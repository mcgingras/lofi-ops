/**
 * Wonder weapon effects on the client:
 *
 * - `weapons.wonderFx` pushes (everyone): the Ray Gun splash (green burst, ring, fizz), the
 *   Thundergun blast (rolling shockwave rings, dust kicked up along the tube, a shake), lightning
 *   arcs (jagged flickering bolts with glow at the joints, a crackle), the Winter's Howl frost cone
 *   (shards and mist), a shatter (ice shards, the body gone) and a fling (a Thundergun kill's body
 *   thrown back). Remote shooters' gunshots play from here (wonder shots are not hitscan snapshots).
 * - The local player's own pull (`registerShotFx(...).local`): a predicted Ray Gun bolt, the blast
 *   or frost from the muzzle at once, and the first Wunderwaffe arc to whatever the crosshair is on,
 *   so the shooter never waits a round trip; the server's copies of those are skipped for them.
 * - Killcam replays (`replay`): the same effects from the recorded shots (the bolt flies, arcs chain).
 * - Entities: the Ray Gun bolt (`weapons.raybolt`: a glowing core with a trail) and frost on a body
 *   (`weapons.frost`: ice crystals growing over a remote soldier, a block when frozen solid).
 */
import * as THREE from 'three';
import { rayHitboxes, playerHitboxes } from '../../../../shared/collision';
import { RAYGUN, THUNDERGUN, WINTERS_HOWL, WONDER_ENTITY, WUNDERWAFFE, type WonderFx } from '../../../../shared/defs/wonder';
import type { Vec3 } from '../../../../shared/math';
import { sfx } from '../../../game/audio';
import { rumble } from '../../../game/gamepad';
import type { Match } from '../../../game/match';
import { onFeature, registerEntityRenderer, registerMatchHook, registerShotFx } from '../../../registry';
import { getTexture } from '../../../render/textures';
import { currentMatch } from '../../../state';
import { equipState } from '../equipment';

const GREEN = 0x5cff4a;
const CYAN = 0x9ae8ff;
const ICE = 0xbfeeff;
const AIR = 0xe8f0ff;
const DUST = 0x8a7a60;

// ---------------------------------------------------------------------------------------------
// Sprites and particles
// ---------------------------------------------------------------------------------------------

const mats = new Map<string, THREE.SpriteMaterial>();
/** A cached sprite material: additive glows, or alpha-tested chunky sprites. */
function spriteMat(tex: string, color: number, additive: boolean): THREE.SpriteMaterial {
  const key = `${tex}|${color}|${additive}`;
  let m = mats.get(key);
  if (!m) {
    m = additive
      ? new THREE.SpriteMaterial({ map: getTexture(tex), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })
      : new THREE.SpriteMaterial({ map: getTexture(tex), color, alphaTest: 0.5, depthWrite: false });
    mats.set(key, m);
  }
  return m;
}

interface Particle {
  s: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size0: number;
  size1: number;
  grav: number;
  drag: number;
}

const particles: Particle[] = [];
const transients: { obj: THREE.Object3D; age: number; life: number; step(k: number, dt: number): void; dispose?(): void }[] = [];
let scene: THREE.Scene | null = null;

function emit(at: Vec3, o: { tex?: string; color: number; additive?: boolean; vel?: Vec3; life: number; size: number; size1?: number; grav?: number; drag?: number }): void {
  if (!scene) return;
  const s = new THREE.Sprite(spriteMat(o.tex ?? 'wonder.glow', o.color, o.additive ?? true));
  s.position.set(at.x, at.y, at.z);
  s.scale.setScalar(o.size);
  scene.add(s);
  const v = o.vel ?? { x: 0, y: 0, z: 0 };
  particles.push({ s, vx: v.x, vy: v.y, vz: v.z, age: 0, life: o.life, size0: o.size, size1: o.size1 ?? o.size, grav: o.grav ?? 0, drag: o.drag ?? 0 });
}

function stepParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.age += dt;
    if (p.age >= p.life) {
      p.s.removeFromParent();
      particles.splice(i, 1);
      continue;
    }
    const k = p.age / p.life;
    const d = Math.max(0, 1 - p.drag * dt);
    p.vx *= d;
    p.vz *= d;
    p.vy = p.vy * d - p.grav * dt;
    p.s.position.x += p.vx * dt;
    p.s.position.y += p.vy * dt;
    p.s.position.z += p.vz * dt;
    // Alpha-tested sprites can't fade: they shrink away over the last stretch.
    const size = p.size0 + (p.size1 - p.size0) * k;
    p.s.scale.setScalar(k > 0.75 ? size * (1 - (k - 0.75) * 4) : size);
  }
  for (let i = transients.length - 1; i >= 0; i--) {
    const t = transients[i]!;
    t.age += dt;
    if (t.age >= t.life) {
      t.obj.removeFromParent();
      t.dispose?.();
      transients.splice(i, 1);
      continue;
    }
    t.step(t.age / t.life, dt);
  }
}

const rnd = (a: number) => (Math.random() * 2 - 1) * a;
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const add = (a: Vec3, d: Vec3, k: number): Vec3 => ({ x: a.x + d.x * k, y: a.y + d.y * k, z: a.z + d.z * k });
const t3 = (v: [number, number, number]): Vec3 => ({ x: v[0], y: v[1], z: v[2] });

/** A unit vector perpendicular to `d` (and a second one), for cone spreads and rings. */
function basis(d: Vec3): [Vec3, Vec3] {
  const up = Math.abs(d.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const a = unit({ x: up.y * d.z - up.z * d.y, y: up.z * d.x - up.x * d.z, z: up.x * d.y - up.y * d.x });
  const b = { x: d.y * a.z - d.z * a.y, y: d.z * a.x - d.x * a.z, z: d.x * a.y - d.y * a.x };
  return [a, b];
}

// ---------------------------------------------------------------------------------------------
// The effects
// ---------------------------------------------------------------------------------------------

/** Ray Gun impact: a green flash, a ring on the ground, a spray of sparks. */
function splash(at: Vec3): void {
  emit(at, { color: GREEN, life: 0.35, size: 0.6, size1: 2.6 });
  emit(at, { color: 0xffffff, life: 0.12, size: 0.8, size1: 1.2 });
  for (let i = 0; i < 16; i++) emit(at, { color: GREEN, life: 0.4 + Math.random() * 0.3, size: 0.12, size1: 0.04, vel: { x: rnd(5), y: 1 + Math.random() * 4, z: rnd(5) }, grav: 9, drag: 1 });
  ring(at, { x: 0, y: 1, z: 0 }, GREEN, 0.3, 3.2, 0.4);
  currentMatch()?.effects.puff('dust', at, undefined, 4);
}

/** A flat expanding ring facing `normal`. */
function ring(at: Vec3, normal: Vec3, color: number, r0: number, r1: number, life: number, travel?: { dir: Vec3; dist: number }): void {
  if (!scene) return;
  const mat = new THREE.MeshBasicMaterial({ map: getTexture('wonder.ring'), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.position.set(at.x, at.y + 0.05, at.z);
  mesh.lookAt(at.x + normal.x, at.y + 0.05 + normal.y, at.z + normal.z);
  scene.add(mesh);
  transients.push({
    obj: mesh,
    age: 0,
    life,
    step(k) {
      const r = r0 + (r1 - r0) * Math.sqrt(k);
      mesh.scale.setScalar(r);
      mat.color.setHex(color).multiplyScalar(1 - k);
      if (travel) mesh.position.set(at.x + travel.dir.x * travel.dist * k, at.y + travel.dir.y * travel.dist * k, at.z + travel.dir.z * travel.dist * k);
    },
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
    },
  });
}

/** Thundergun: rolling rings of compressed air down the tube, dust off the ground, a shake. */
function blast(m: Match, o: Vec3, dir: Vec3, local: boolean): void {
  const d = unit(dir);
  for (let i = 0; i < 4; i++) ring(add(o, d, 0.6 + i * 0.4), d, AIR, 0.25 + i * 0.1, THUNDERGUN.r1 * 1.3, 0.32 + i * 0.07, { dir: d, dist: THUNDERGUN.range * (0.6 + i * 0.1) });
  const [a, b] = basis(d);
  for (let i = 0; i < 26; i++) {
    const along = 0.5 + Math.random() * 2;
    const spread = 0.35;
    const v = unit({ x: d.x + a.x * rnd(spread) + b.x * rnd(spread), y: d.y + a.y * rnd(spread) + b.y * rnd(spread), z: d.z + a.z * rnd(spread) + b.z * rnd(spread) });
    emit(add(o, d, along), { color: AIR, life: 0.3 + Math.random() * 0.2, size: 0.25, size1: 1.2, vel: { x: v.x * 22, y: v.y * 22, z: v.z * 22 }, drag: 3 });
  }
  // Dust kicked up along the floor under the blast.
  const world = m.net.world;
  for (let i = 0; i < 10; i++) {
    const p = add(o, d, 1 + (i / 10) * THUNDERGUN.range);
    const g = world.groundBelow(p.x, p.z, p.y, 3);
    if (g === null) continue;
    for (let j = 0; j < 2; j++) emit({ x: p.x + rnd(1), y: g + 0.2, z: p.z + rnd(1) }, { tex: 'puff', color: DUST, additive: false, life: 0.9 + Math.random() * 0.5, size: 0.4, size1: 1.8, vel: { x: d.x * 6 + rnd(1.5), y: 1 + Math.random() * 1.5, z: d.z * 6 + rnd(1.5) }, drag: 2 });
  }
  const me = m.net.predictor.state;
  const dist = Math.hypot(me.x - o.x, me.z - o.z);
  if (local || dist < THUNDERGUN.range) {
    equipState.shake = { at: m.time, amount: local ? 0.5 : 0.8 };
    rumble('explosion', local ? 0.6 : 0.8);
  }
}

/** One jagged lightning bolt from a to b that flickers (re-jitters) while it lives. */
function lightning(a: Vec3, b: Vec3, color: number, life = 0.22, width = 0.045): void {
  if (!scene) return;
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const core = new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const n = Math.max(4, Math.min(18, Math.round(len / 0.7)));
  const box = new THREE.BoxGeometry(1, 1, 1);
  const segs: THREE.Mesh[] = [];
  const cores: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(box, mat);
    const c = new THREE.Mesh(box, core);
    group.add(s, c);
    segs.push(s);
    cores.push(c);
  }
  // A fork off the middle.
  const fork = new THREE.Mesh(box, mat);
  group.add(fork);
  scene.add(group);
  const d = unit({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
  const [u, v] = basis(d);
  const place = (mesh: THREE.Mesh, p: Vec3, q: Vec3, w: number) => {
    const l = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
    mesh.position.set((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2);
    mesh.lookAt(q.x, q.y, q.z);
    mesh.scale.set(w, w, l);
  };
  let next = 0;
  const jitter = () => {
    const pts: Vec3[] = [a];
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const amp = Math.min(0.6, len * 0.08) * Math.sin(k * Math.PI);
      pts.push({ x: a.x + (b.x - a.x) * k + u.x * rnd(amp) + v.x * rnd(amp), y: a.y + (b.y - a.y) * k + u.y * rnd(amp) + v.y * rnd(amp), z: a.z + (b.z - a.z) * k + u.z * rnd(amp) + v.z * rnd(amp) });
    }
    pts.push(b);
    for (let i = 0; i < n; i++) {
      place(segs[i]!, pts[i]!, pts[i + 1]!, width);
      place(cores[i]!, pts[i]!, pts[i + 1]!, width * 0.4);
    }
    const mid = pts[Math.floor(n / 2)]!;
    place(fork, mid, { x: mid.x + u.x * rnd(1) + d.x * 0.5, y: mid.y + rnd(0.8), z: mid.z + v.z * rnd(1) + d.z * 0.5 }, width * 0.7);
  };
  jitter();
  transients.push({
    obj: group,
    age: 0,
    life,
    step(k, dt) {
      next -= dt;
      if (next <= 0) {
        next = 0.035;
        jitter();
      }
      group.visible = k < 0.6 || Math.random() < 0.6;
    },
    dispose() {
      box.dispose();
      mat.dispose();
      core.dispose();
    },
  });
  emit(b, { color, life: 0.25, size: 0.9, size1: 0.3 });
  emit(a, { color, life: 0.12, size: 0.5 });
}

/** An arc to a body: the bolt, sparks at the end, a crackle. */
function arc(o: Vec3, e: Vec3, hit: boolean, sound: boolean): void {
  lightning(o, e, CYAN, 0.24);
  lightning(o, e, 0x6aa0ff, 0.16, 0.025);
  for (let i = 0; i < (hit ? 12 : 6); i++) emit(e, { color: CYAN, life: 0.3 + Math.random() * 0.2, size: 0.08, size1: 0.02, vel: { x: rnd(4), y: Math.random() * 4, z: rnd(4) }, grav: 10 });
  if (sound) sfx.play('weapons.wonder.zap', { at: e, volume: 1.1 });
}

/** Winter's Howl: a cone of shards and mist from the nozzle. */
function frostCone(o: Vec3, dir: Vec3): void {
  const d = unit(dir);
  const [a, b] = basis(d);
  for (let i = 0; i < 34; i++) {
    const spread = 0.12;
    const v = unit({ x: d.x + a.x * rnd(spread) + b.x * rnd(spread), y: d.y + a.y * rnd(spread) + b.y * rnd(spread), z: d.z + a.z * rnd(spread) + b.z * rnd(spread) });
    const speed = 14 + Math.random() * 10;
    emit(add(o, d, 0.3), { tex: 'wonder.shard', color: ICE, additive: false, life: (WINTERS_HOWL.range / speed) * (0.7 + Math.random() * 0.4), size: 0.08, size1: 0.2, vel: { x: v.x * speed, y: v.y * speed, z: v.z * speed }, drag: 0.6 });
  }
  for (let i = 0; i < 14; i++) {
    const v = unit({ x: d.x + a.x * rnd(0.18) + b.x * rnd(0.18), y: d.y + a.y * rnd(0.18) + b.y * rnd(0.18), z: d.z + a.z * rnd(0.18) + b.z * rnd(0.18) });
    emit(add(o, d, 0.5), { color: 0x6ab8e8, life: 0.6 + Math.random() * 0.3, size: 0.3, size1: 2.2, vel: { x: v.x * 12, y: v.y * 12 + 0.5, z: v.z * 12 }, drag: 2.5 });
  }
}

/** A frozen body bursting into shards. */
function shatter(at: Vec3): void {
  emit(at, { color: 0xffffff, life: 0.15, size: 1.4, size1: 2 });
  for (let i = 0; i < 40; i++) emit({ x: at.x + rnd(0.3), y: at.y + rnd(0.8), z: at.z + rnd(0.3) }, { tex: 'wonder.shard', color: i % 3 ? ICE : 0xffffff, additive: false, life: 0.9 + Math.random() * 0.6, size: 0.1 + Math.random() * 0.12, vel: { x: rnd(5), y: 1 + Math.random() * 5, z: rnd(5) }, grav: 14, drag: 0.4 });
  for (let i = 0; i < 6; i++) emit(at, { color: 0x6ab8e8, life: 0.8, size: 0.4, size1: 1.8, vel: { x: rnd(1.5), y: Math.random(), z: rnd(1.5) }, drag: 2 });
  sfx.play('weapons.wonder.shatter', { at, volume: 1.4 });
}

/** The viewmodel muzzle in the world (a little ahead of the eye, low right). */
function localMuzzle(m: Match, dir: Vec3): Vec3 {
  const cam = m.renderer.cam;
  const yaw = Math.atan2(-dir.x, -dir.z);
  return { x: cam.position.x + dir.x * 0.7 + Math.cos(yaw) * 0.12, y: cam.position.y + dir.y * 0.7 - 0.12, z: cam.position.z + dir.z * 0.7 - Math.sin(yaw) * 0.12 };
}

// ---------------------------------------------------------------------------------------------
// Corpses: shattered bodies vanish, launched ones fly back
// ---------------------------------------------------------------------------------------------

const shattered = new Map<string, number>();
const flung = new Map<string, { dir: Vec3; at: number }>();

function bodies(m: Match): void {
  for (const [id, at] of shattered) {
    const v = m.remotes.views.get(id);
    if (!v || (v.alive && m.time - at > 0.5)) {
      shattered.delete(id);
      continue;
    }
    if (!v.alive) v.soldier.root.visible = false;
  }
  for (const [id, f] of flung) {
    const v = m.remotes.views.get(id);
    if (!v || (v.alive && m.time - f.at > 0.5)) {
      flung.delete(id);
      continue;
    }
    if (v.alive) continue;
    const t = Math.min(0.9, m.time - f.at);
    const r = v.soldier.root.position;
    r.x += f.dir.x * 9 * t;
    r.z += f.dir.z * 9 * t;
    r.y += Math.max(0, 5 * t - 7 * t * t);
  }
}

// ---------------------------------------------------------------------------------------------
// Pushes, local pulls, killcam replays
// ---------------------------------------------------------------------------------------------

onFeature('weapons.wonderFx', (fx: WonderFx) => {
  const m = currentMatch();
  if (!m || !scene) return;
  const mine = 'p' in fx && fx.p === m.myId;
  switch (fx.k) {
    case 'splash':
      splash(fx);
      sfx.play('weapons.wonder.splash', { at: fx, volume: 1.3 });
      break;
    case 'blast':
      if (!mine) {
        blast(m, t3(fx.o), t3(fx.d), false);
        sfx.gunshot('thundergun', t3(fx.o));
      }
      break;
    case 'arc':
      // My own first arc was drawn on the pull; the hops are the server's.
      if (mine && fx.hop === 0) break;
      arc(t3(fx.o), t3(fx.e), fx.hit, fx.hop > 0 || !mine);
      if (!mine && fx.hop === 0) sfx.gunshot('wunderwaffe', t3(fx.o));
      break;
    case 'frost':
      if (!mine) {
        frostCone(t3(fx.o), t3(fx.d));
        sfx.gunshot('wintershowl', t3(fx.o));
      }
      break;
    case 'shatter':
      shatter(fx);
      shattered.set(fx.v, m.time);
      break;
    case 'fling':
      flung.set(fx.v, { dir: unit({ x: fx.x, y: 0, z: fx.z }), at: m.time });
      break;
  }
});

/** Own Ray Gun bolts: drawn locally at once; the server's copy shows after this long. */
const localBoltSec = (m: Match) => Math.min(0.4, Math.max(0.12, m.netRtt * 0.5 + 0.1));

registerShotFx('raygun', {
  local(m, origin, dir) {
    if (!scene) return;
    const from = localMuzzle(m, dir);
    emit(from, { color: GREEN, life: 0.08, size: 0.35 });
    const life = localBoltSec(m);
    const core = new THREE.Sprite(spriteMat('wonder.glow', GREEN, true));
    core.scale.setScalar(0.45);
    scene.add(core);
    // Converge from the muzzle onto the aim line within a few metres.
    transients.push({
      obj: core,
      age: 0,
      life,
      step(k) {
        const t = k * life;
        const p = add(origin, dir, RAYGUN.speed * t + 0.6);
        const blend = Math.min(1, t / 0.08);
        core.position.set(from.x + (p.x - from.x) * blend, from.y + (p.y - from.y) * blend, from.z + (p.z - from.z) * blend);
        if (Math.random() < 0.7) emit({ x: core.position.x, y: core.position.y, z: core.position.z }, { color: GREEN, life: 0.18, size: 0.22, size1: 0.05 });
      },
    });
  },
  replay(m, _shooter, from, to) {
    if (!scene) return;
    const d = unit({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });
    const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const life = Math.max(0.05, len / RAYGUN.speed);
    const core = new THREE.Sprite(spriteMat('wonder.glow', GREEN, true));
    core.scale.setScalar(0.45);
    scene.add(core);
    let burst = false;
    transients.push({
      obj: core,
      age: 0,
      life: life + 0.05,
      step(k) {
        const p = add(from, d, len * Math.min(1, k * ((life + 0.05) / life)));
        core.position.set(p.x, p.y, p.z);
        emit(p, { color: GREEN, life: 0.18, size: 0.22, size1: 0.05 });
        if (!burst && k * (life + 0.05) >= life) {
          burst = true;
          core.visible = false;
          splash(to);
          sfx.play('weapons.wonder.splash', { at: to, volume: 1.3 });
        }
      },
    });
    void m;
  },
});

registerShotFx('thundergun', {
  local(m, _origin, dir) {
    blast(m, localMuzzle(m, dir), dir, true);
  },
  replay(m, _shooter, from, to) {
    blast(m, from, unit({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }), true);
  },
});

registerShotFx('wunderwaffe', {
  local(m, origin, dir) {
    // Predict the first arc: the world, then the first body on the line.
    const range = WUNDERWAFFE.range;
    const wall = m.net.world.raycast(origin, dir, range, 'bullets');
    let t = wall ? wall.t : range;
    let hit = false;
    for (const v of m.remotes.views.values()) {
      if (!v.alive || !m.isEnemy(v.id)) continue;
      const h = rayHitboxes(origin, dir, playerHitboxes(v, v.prone > 0.5 ? 'prone' : v.crouch > 0.5, v.yaw), t);
      if (h) {
        t = h.t;
        hit = true;
      }
    }
    arc(localMuzzle(m, dir), add(origin, dir, t), hit, false);
  },
  replay(m, shooter, from, to, hit, t) {
    // Hops of one shot come a beat apart, each from the last victim.
    const prev = lastArc.get(shooter);
    const start = prev && t - prev.t < 0.6 && t > prev.t && Math.hypot(prev.end.x - to.x, prev.end.y - to.y, prev.end.z - to.z) <= WUNDERWAFFE.hopRange + 1.5 ? prev.end : from;
    lastArc.set(shooter, { t, end: { ...to } });
    arc(start, to, hit, start !== from);
    void m;
  },
});
const lastArc = new Map<string, { t: number; end: Vec3 }>();

registerShotFx('wintershowl', {
  local(m, _origin, dir) {
    frostCone(localMuzzle(m, dir), dir);
  },
  replay(_m, _shooter, from, to) {
    frostCone(from, unit({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }));
  },
});

// ---------------------------------------------------------------------------------------------
// Entities: the bolt, frost on a body
// ---------------------------------------------------------------------------------------------

registerEntityRenderer(WONDER_ENTITY.bolt, (e, m) => {
  const root = new THREE.Group();
  const core = new THREE.Sprite(spriteMat('wonder.glow', GREEN, true));
  core.scale.setScalar(0.5);
  const hot = new THREE.Sprite(spriteMat('wonder.glow', 0xeaffd8, true));
  hot.scale.setScalar(0.18);
  root.add(core, hot);
  const own = e.owner === m.myId;
  const born = typeof e.s?.b === 'number' ? e.s.b : m.serverTime;
  return {
    object: root,
    update() {
      // My own bolt: the predicted one is showing for the first moment.
      root.visible = !own || m.serverTime - born >= localBoltSec(m);
      if (!root.visible) return;
      core.scale.setScalar(0.45 + Math.sin(m.time * 40) * 0.06);
      emit({ x: root.position.x, y: root.position.y, z: root.position.z }, { color: GREEN, life: 0.22, size: 0.26, size1: 0.04 });
    },
  };
});

registerEntityRenderer(WONDER_ENTITY.frost, (e, m) => {
  const root = new THREE.Group();
  const iceMat = new THREE.MeshBasicMaterial({ color: ICE, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const blockMat = new THREE.MeshBasicMaterial({ color: 0x5aa8d8, transparent: true, opacity: 0.35, depthWrite: false });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const shards: THREE.Mesh[] = [];
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Mesh(geo, iceMat);
    const a = (i / 14) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.32, 0.2 + (i % 7) * 0.24, Math.sin(a) * 0.32);
    s.rotation.set(rnd(0.6), a, rnd(0.6));
    s.scale.set(0.06, 0.28, 0.06);
    root.add(s);
    shards.push(s);
  }
  const block = new THREE.Mesh(geo, blockMat);
  block.scale.set(0.8, 1.95, 0.8);
  block.position.y = 0.97;
  root.add(block);
  const victim = String(e.s?.p ?? '');
  let mist = 0;
  return {
    object: root,
    update(s, dt) {
      const f = typeof s.s?.f === 'number' ? s.s.f : 0;
      // Ride the soldier as drawn (remotes are interpolated), never in my own face.
      const v = m.remotes.views.get(victim);
      root.visible = victim !== m.myId && (!v || v.alive);
      if (v) root.position.set(v.x, v.y, v.z);
      const crouch = v ? 1 - 0.35 * v.crouch : 1;
      shards.forEach((sh, i) => {
        sh.visible = i / shards.length < f + 0.15;
        sh.scale.y = 0.18 + 0.2 * f;
      });
      block.visible = f >= 1;
      block.scale.y = 1.95 * crouch;
      block.position.y = 0.97 * crouch;
      mist -= dt;
      if (root.visible && mist <= 0) {
        mist = 0.25 - 0.15 * f;
        emit({ x: root.position.x + rnd(0.3), y: root.position.y + 0.3 + Math.random() * 1.4 * crouch, z: root.position.z + rnd(0.3) }, { color: 0x6ab8e8, life: 0.8, size: 0.2, size1: 0.6, vel: { x: rnd(0.3), y: 0.4, z: rnd(0.3) } });
      }
      return !v;
    },
    dispose() {
      geo.dispose();
      iceMat.dispose();
      blockMat.dispose();
    },
  };
});

registerMatchHook('weapons.wonder', {
  start(m) {
    scene = m.renderer.scene;
    return () => {
      for (const p of particles) p.s.removeFromParent();
      particles.length = 0;
      for (const t of transients) {
        t.obj.removeFromParent();
        t.dispose?.();
      }
      transients.length = 0;
      for (const mat of mats.values()) mat.dispose();
      mats.clear();
      shattered.clear();
      flung.clear();
      lastArc.clear();
      scene = null;
    };
  },
  frame(m, dt) {
    if (scene !== m.renderer.scene) scene = m.renderer.scene;
    stepParticles(dt);
    bodies(m);
  },
});
