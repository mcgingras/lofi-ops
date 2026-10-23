/**
 * Effects for the Scavenger, the 31-79 JGb215 (Baby Gun) and the Wave Gun (the other wonder
 * weapons' are in fx.ts, whose particle kit this uses):
 *
 * - Scavenger: the bolt (`weapons.scavbolt`: a dark dart with a red light that blinks faster as
 *   the fuse runs down, beeping), its big blast (`boom`: fireball, smoke column, shockwave ring,
 *   a shake and ringing ears close in), and the shot's muzzle flash.
 * - Baby Gun: the pink shrink beam (`shrink`), shrunk players drawn tiny with sparkles and a
 *   squeak now and then (`weapons.shrunk`), and a kick (`kick`: a squish, the body gone).
 * - Wave Gun: zap bolts from alternate pistols (`zap`), the Wave Gun's rippling microwave beam
 *   (`wave`), a swelling body growing and flushing red (`weapons.swell`), and the pop (`pop`).
 *
 * The shooter's own shots draw on the pull (`registerShotFx(...).local`), so their server copies are
 * skipped for them; killcam replays draw from the recorded shots.
 */
import * as THREE from 'three';
import { BABY_GUN, SCAVENGER, WAVE_GUN, WONDER_ENTITY, type WonderFx } from '../../../../shared/defs/wonder';
import type { Vec3 } from '../../../../shared/math';
import { sfx } from '../../../game/audio';
import type { Match } from '../../../game/match';
import { onFeature, registerEntityRenderer, registerShotFx } from '../../../registry';
import { currentMatch } from '../../../state';
import { blastJolt } from '../equipment';
import { bodyLook } from './bodies';
import { fxKit } from './fx';

const RED = 0xff3a2a;
const FIRE = 0xffa040;
const PINK = 0xff6ae0;
const ZAP = 0x4ab4ff;
const WAVE = 0xff7a3a;

const rnd = (a: number) => (Math.random() * 2 - 1) * a;
const t3 = (v: [number, number, number]): Vec3 => ({ x: v[0], y: v[1], z: v[2] });
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const add = (a: Vec3, d: Vec3, k: number): Vec3 => ({ x: a.x + d.x * k, y: a.y + d.y * k, z: a.z + d.z * k });

// ---------------------------------------------------------------------------------------------
// Scavenger
// ---------------------------------------------------------------------------------------------

/** The Scavenger's blast: a fireball, a smoke column, a ground ring, a shake and ringing close in. */
function scavBoom(m: Match, at: Vec3): void {
  const E = fxKit.emit;
  const R = SCAVENGER.blast.r;
  E(at, { color: 0xffffff, life: 0.12, size: 2.5, size1: 3.5 });
  E(at, { color: FIRE, life: 0.45, size: 1.5, size1: R * 1.1 });
  for (let i = 0; i < 26; i++) E(at, { color: i % 2 ? FIRE : 0xffd060, life: 0.5 + Math.random() * 0.4, size: 0.3, size1: 0.05, vel: { x: rnd(12), y: 2 + Math.random() * 10, z: rnd(12) }, grav: 12, drag: 1 });
  for (let i = 0; i < 14; i++) E({ x: at.x + rnd(1), y: at.y + Math.random(), z: at.z + rnd(1) }, { tex: 'puff', color: 0x3a3632, additive: false, life: 1.6 + Math.random(), size: 0.8, size1: 2.6, vel: { x: rnd(1.5), y: 2 + Math.random() * 2.5, z: rnd(1.5) }, drag: 1.2 });
  fxKit.ring(at, { x: 0, y: 1, z: 0 }, FIRE, 0.5, R * 1.3, 0.5);
  m.effects.puff('spark', at, { x: 0, y: 1, z: 0 }, 18);
  m.effects.puff('dust', at, { x: 0, y: 1, z: 0 }, 22);
  sfx.play('weapons.wonder.scavboom', { at, volume: 2.2, range: 'far' });
  const cam = m.renderer.cam.position;
  const d = Math.hypot(cam.x - at.x, cam.y - at.y, cam.z - at.z);
  const shake = d <= R ? 1 : Math.max(0, 1 - (d - R) / 28);
  blastJolt(m, shake, Math.max(0, Math.min(1, 1.6 - d / R)));
}

registerShotFx('scavenger', {
  local(m, _origin, dir) {
    const from = fxKit.localMuzzle(m, dir);
    fxKit.emit(from, { color: FIRE, life: 0.08, size: 0.45 });
    fxKit.emit(add(from, dir, 0.3), { tex: 'puff', color: 0x6a6660, additive: false, life: 0.5, size: 0.15, size1: 0.6, vel: { x: dir.x * 3, y: 0.6, z: dir.z * 3 }, drag: 3 });
  },
  replay(m, _shooter, from, to) {
    fxKit.emit(from, { color: FIRE, life: 0.08, size: 0.45 });
    void m;
    void to;
  },
});

registerEntityRenderer(WONDER_ENTITY.scav, (e, m) => {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0x2e3328 });
  const tipMat = new THREE.MeshBasicMaterial({ color: RED });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const shaft = new THREE.Mesh(geo, bodyMat);
  shaft.scale.set(0.03, 0.03, 0.38);
  const fins = new THREE.Mesh(geo, bodyMat);
  fins.scale.set(0.09, 0.09, 0.05);
  fins.position.z = 0.17;
  const tip = new THREE.Mesh(geo, tipMat);
  tip.scale.set(0.045, 0.045, 0.06);
  tip.position.z = -0.2;
  const pitch = new THREE.Group();
  pitch.add(shaft, fins, tip);
  root.add(pitch);
  const light = new THREE.Sprite(fxKit.spriteMat('wonder.glow', RED, true));
  light.scale.setScalar(0.3);
  root.add(light);
  let lastBlink = -1;
  // Someone else's shot (not a killcam stand-in): their gunshot, from where the bolt leaves.
  if (e.id >= 0 && e.owner !== m.myId && e.s?.k !== 1) sfx.gunshot('scavenger', { x: e.x, y: e.y, z: e.z });
  return {
    object: root,
    update(s, dt) {
      const pt = typeof s.s?.pt === 'number' ? s.s.pt : 0;
      pitch.rotation.x = pt;
      const stuck = s.s?.k === 1;
      const host = typeof s.s?.p === 'string' ? s.s.p : null;
      // Stuck in me: never in my face (the HUD warns instead).
      root.visible = host !== m.myId;
      if (!stuck) {
        light.visible = true;
        if (Math.random() < 0.8) fxKit.emit({ x: root.position.x, y: root.position.y, z: root.position.z }, { color: RED, life: 0.15, size: 0.12, size1: 0.02 });
        return;
      }
      // The fuse: blinks quicken toward the blast, each one a beep.
      const fuse = typeof s.s?.f === 'number' ? s.s.f : m.serverTime + SCAVENGER.fuseSec;
      const left = Math.max(0, fuse - m.serverTime);
      const rate = 4 + 18 * (1 - left / SCAVENGER.fuseSec);
      const phase = Math.floor(m.serverTime * rate);
      light.visible = phase % 2 === 0;
      if (light.visible && phase !== lastBlink) {
        lastBlink = phase;
        if (root.visible) sfx.play('weapons.beep', { at: root.position, volume: 0.6 });
      }
      void dt;
    },
    dispose() {
      geo.dispose();
      bodyMat.dispose();
      tipMat.dispose();
    },
  };
});

// ---------------------------------------------------------------------------------------------
// Baby Gun
// ---------------------------------------------------------------------------------------------

/** The shrink beam: a pink pulse with rings rolling down it and sparkles where it lands. */
function shrinkBeam(from: Vec3, to: Vec3, hit: boolean): void {
  fxKit.lightning(from, to, PINK, 0.22, 0.06);
  fxKit.lightning(from, to, 0xffffff, 0.12, 0.02);
  const d = unit({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });
  const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  for (let i = 0; i < 3; i++) fxKit.ring(add(from, d, 0.4 + i * 0.3), d, PINK, 0.08, 0.3, 0.3 + i * 0.05, { dir: d, dist: Math.max(0.5, len - 0.6) });
  for (let i = 0; i < (hit ? 22 : 10); i++) fxKit.emit(to, { color: i % 3 ? PINK : 0xffffff, life: 0.4 + Math.random() * 0.4, size: 0.1, size1: 0.02, vel: { x: rnd(3), y: Math.random() * 3, z: rnd(3) }, grav: 4 });
  fxKit.emit(to, { color: PINK, life: 0.3, size: 0.4, size1: hit ? BABY_GUN.splashR * 1.4 : 0.8 });
}

registerShotFx('babygun', {
  local(m, origin, dir) {
    const wall = m.net.world.raycast(origin, dir, BABY_GUN.range, 'bullets');
    shrinkBeam(fxKit.localMuzzle(m, dir), add(origin, dir, wall ? wall.t : BABY_GUN.range), false);
  },
  replay(_m, _shooter, from, to, hit) {
    shrinkBeam(from, to, hit);
  },
});

registerEntityRenderer(WONDER_ENTITY.shrunk, (e, m) => {
  const root = new THREE.Group();
  const victim = String(e.s?.p ?? '');
  let squeakIn = 0.3 + Math.random();
  let size = 1;
  sfx.play('weapons.wonder.squeak', { at: { x: e.x, y: e.y + 0.4, z: e.z }, volume: 1 });
  return {
    object: root,
    update(_s, dt) {
      const v = m.remotes.views.get(victim);
      if (v) root.position.set(v.x, v.y, v.z);
      // Shrink fast (a quick pop down), stay tiny.
      size += (BABY_GUN.scale - size) * Math.min(1, dt * 12);
      if (v?.alive && victim !== m.myId) {
        bodyLook(victim, { scale: size });
        if (Math.random() < dt * 6) fxKit.emit({ x: v.x + rnd(0.25), y: v.y + Math.random() * 0.8, z: v.z + rnd(0.25) }, { color: PINK, life: 0.5, size: 0.06, size1: 0.01, vel: { x: 0, y: 0.6, z: 0 } });
      }
      // The squeaky little voice, now and then (more when they run about).
      squeakIn -= dt;
      if (squeakIn <= 0) {
        squeakIn = 0.9 + Math.random() * 1.6;
        if (victim !== m.myId && (!v || v.alive)) sfx.play('weapons.wonder.squeak', { at: { x: root.position.x, y: root.position.y + 0.4, z: root.position.z }, volume: 0.9 });
      }
      return !v;
    },
  };
});

// ---------------------------------------------------------------------------------------------
// Wave Gun
// ---------------------------------------------------------------------------------------------

/** A zap bolt: a short bright bolt with a spark where it ends. */
function zapBolt(from: Vec3, to: Vec3, hit: boolean): void {
  fxKit.lightning(from, to, ZAP, 0.1, 0.035);
  fxKit.emit(from, { color: ZAP, life: 0.06, size: 0.25 });
  for (let i = 0; i < (hit ? 8 : 4); i++) fxKit.emit(to, { color: ZAP, life: 0.25, size: 0.07, size1: 0.02, vel: { x: rnd(3), y: Math.random() * 3, z: rnd(3) }, grav: 9 });
}

/** The Wave Gun's beam: orange rings rippling out along it, a heat shimmer at the end. */
function waveBeam(from: Vec3, to: Vec3, hit: boolean): void {
  const d = unit({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });
  const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  for (let i = 0; i < 5; i++) fxKit.ring(add(from, d, 0.3 + i * 0.25), d, WAVE, 0.1, 0.45, 0.35 + i * 0.06, { dir: d, dist: Math.max(0.5, len - 0.5) });
  fxKit.lightning(from, to, WAVE, 0.18, 0.02);
  fxKit.emit(to, { color: WAVE, life: 0.35, size: 0.3, size1: hit ? 1.2 : 0.6 });
}

let localSide = 0;

/** My view of the Wave Gun aimed (pistols joined) right now. */
const aimedNow = (m: Match) => m.net.predictor.state.ads >= WAVE_GUN.adsAt;

registerShotFx('wavegun', {
  local(m, origin, dir) {
    const from = fxKit.localMuzzle(m, dir);
    if (aimedNow(m)) {
      const wall = m.net.world.raycast(origin, dir, WAVE_GUN.wave.range, 'bullets');
      waveBeam(from, add(origin, dir, wall ? wall.t : WAVE_GUN.wave.range), false);
      sfx.play('weapons.wonder.wave', { volume: 1.2 });
      return;
    }
    // Alternate pistols: the left one sits ~0.3 m to the left in the view.
    localSide = localSide ? 0 : 1;
    const yaw = Math.atan2(-dir.x, -dir.z);
    const muzzle = localSide ? { x: from.x - Math.cos(yaw) * 0.28, y: from.y, z: from.z + Math.sin(yaw) * 0.28 } : from;
    const wall = m.net.world.raycast(origin, dir, WAVE_GUN.zap.range, 'bullets');
    zapBolt(muzzle, add(origin, dir, wall ? wall.t : WAVE_GUN.zap.range), false);
  },
  replay(_m, _shooter, from, to, hit) {
    const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (len > WAVE_GUN.zap.range + 0.5) waveBeam(from, to, hit);
    else zapBolt(from, to, hit);
  },
});

registerEntityRenderer(WONDER_ENTITY.swell, (e, m) => {
  const root = new THREE.Group();
  const victim = String(e.s?.p ?? '');
  const popAt = typeof e.s?.t === 'number' ? e.s.t : m.serverTime + WAVE_GUN.wave.swellSec;
  const start = popAt - WAVE_GUN.wave.swellSec;
  return {
    object: root,
    update(_s, dt) {
      const v = m.remotes.views.get(victim);
      if (v) root.position.set(v.x, v.y, v.z);
      const k = Math.max(0, Math.min(1, (m.serverTime - start) / WAVE_GUN.wave.swellSec));
      if (v?.alive && victim !== m.myId) {
        // Swells (wobbling) and flushes red until it bursts.
        bodyLook(victim, { scale: 1 + 0.55 * k * k + Math.sin(m.time * 40) * 0.03 * k, heat: k });
        if (Math.random() < dt * 20) fxKit.emit({ x: v.x + rnd(0.35), y: v.y + 0.4 + Math.random() * 1.2, z: v.z + rnd(0.35) }, { color: WAVE, life: 0.3, size: 0.08, size1: 0.02, vel: { x: rnd(1), y: 1, z: rnd(1) } });
      }
      return !v;
    },
  };
});

/** A swollen body bursting: a red-orange burst and a pop; the body is gone. */
function pop(m: Match, at: Vec3, victim: string): void {
  fxKit.emit(at, { color: 0xffffff, life: 0.1, size: 1.2, size1: 1.8 });
  fxKit.emit(at, { color: WAVE, life: 0.4, size: 0.8, size1: 2.4 });
  for (let i = 0; i < 30; i++) fxKit.emit(at, { color: i % 2 ? 0xb02018 : WAVE, additive: i % 2 === 0, life: 0.6 + Math.random() * 0.5, size: 0.12, size1: 0.04, vel: { x: rnd(5), y: 1 + Math.random() * 5, z: rnd(5) }, grav: 12, drag: 0.6 });
  m.effects.puff('blood', at, { x: 0, y: 1, z: 0 }, 10);
  sfx.play('weapons.wonder.pop', { at, volume: 1.3 });
  fxKit.hideBody(victim, m.time);
}

/** A shrunk player kicked: a pink squish; the body is gone. */
function kick(m: Match, at: Vec3, victim: string): void {
  for (let i = 0; i < 16; i++) fxKit.emit({ x: at.x, y: at.y + 0.2, z: at.z }, { color: i % 2 ? PINK : 0xffffff, life: 0.5, size: 0.08, size1: 0.02, vel: { x: rnd(3), y: Math.random() * 3, z: rnd(3) }, grav: 9 });
  m.effects.puff('blood', { x: at.x, y: at.y + 0.2, z: at.z }, { x: 0, y: 1, z: 0 }, 5);
  sfx.play('weapons.wonder.kick', { at, volume: 1.2 });
  fxKit.hideBody(victim, m.time);
}

onFeature('weapons.wonderFx', (fx: WonderFx) => {
  const m = currentMatch();
  if (!m || !fxKit.hasScene()) return;
  switch (fx.k) {
    case 'boom':
      scavBoom(m, fx);
      break;
    case 'shrink':
      if (fx.p !== m.myId) {
        shrinkBeam(t3(fx.o), t3(fx.e), fx.hit);
        sfx.gunshot('babygun', t3(fx.o));
      }
      break;
    case 'kick':
      kick(m, fx, fx.v);
      break;
    case 'zap':
      if (fx.p !== m.myId) {
        zapBolt(t3(fx.o), t3(fx.e), fx.hit);
        sfx.gunshot('wavegun', t3(fx.o));
      }
      break;
    case 'wave':
      if (fx.p !== m.myId) {
        waveBeam(t3(fx.o), t3(fx.e), fx.hit);
        sfx.play('weapons.wonder.wave', { at: t3(fx.o), volume: 1.3 });
      }
      break;
    case 'pop':
      pop(m, fx, fx.v);
      break;
    default:
      break;
  }
});
