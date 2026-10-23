/**
 * How the undead look and sound (remote soldiers on team 1 in a Zombies match):
 * - zombies: the soldier re-dressed as a lo-fi zombie soldier: desaturated green-grey, torn dark
 *   strips hanging off the uniform, glowing amber eyes, no rifle; a shambling walk with the arms
 *   out, a swipe when they attack (their FIRING flag), climbing out of the ground when they spawn,
 *   and a headshot kill pops the head off;
 * - hellhounds: the soldier is hidden and a big charred dog with burning eyes runs in its place.
 * Groans and growls come from the horde now and then, louder up close.
 */
import * as THREE from 'three';
import { ZOMBIE_POSE, zombiePose } from '../../../shared/defs/zombies';
import { PlayerFlags } from '../../../shared/protocol';
import { sfx } from '../../game/audio';
import type { RemoteView } from '../../game/remotes';
import { net } from '../../net';
import { registerMatchHook } from '../../registry';
import { makeLookMaterial, setDynLight, type LookMaterial } from '../../render/shader';
import { unbindTexture } from '../../render/textures';
import type { Soldier } from '../../render/models/soldier';
import { currentMatch } from '../../state';
import { buildDog, Kit } from '../killstreaks/models';
import { fxEmit } from '../weapons/wonder/index';
import { isZombiesMatch, zm } from './store';

/** Skin and cloth multiplier: desaturated green-grey. */
const ZOMBIE_TINT = new THREE.Color(0.74, 0.86, 0.64);
const EYE = 0xffb030;
const hip = new THREE.Vector3();

interface Dressed {
  soldier: Soldier;
  extras: THREE.Object3D[];
  mats: LookMaterial[];
  eyes: THREE.Object3D[];
  dog: { kit: Kit; legs: THREE.Object3D[]; head: THREE.Object3D; group: THREE.Group } | null;
  /** Zombie arms (the soldier's rifle arms are hidden): a pivot at the shoulders, arms reaching forward. */
  arms: THREE.Group | null;
  wasAlive: boolean;
  riseAt: number;
  firingWas: boolean;
  swipeAt: number;
  phase: number;
  groanIn: number;
  headless: boolean;
  lastX: number;
  lastZ: number;
}

const dressed = new Map<string, Dressed>();

function dress(v: RemoteView, dog: boolean, now: number): Dressed {
  const s = v.soldier;
  const d: Dressed = { soldier: s, extras: [], mats: [], eyes: [], dog: null, arms: null, wasAlive: v.alive, riseAt: v.alive ? now : -99, firingWas: false, swipeAt: -99, phase: Math.random() * 6, groanIn: 2 + Math.random() * 6, headless: false, lastX: v.x, lastZ: v.z };
  if (dog) {
    s.lie.visible = false;
    const kit = new Kit();
    const rig = buildDog(kit);
    for (const m of kit.mats) m.uniforms.uTint.value.multiply(new THREE.Color(0.75, 0.52, 0.42));
    // A burning halo (BO1 hellhounds come wreathed in fire).
    const halo = kit.sprite('wonder.glow', 1.3, 0xff6a20);
    const hm = halo.material as THREE.SpriteMaterial;
    hm.blending = THREE.AdditiveBlending;
    hm.transparent = true;
    hm.alphaTest = 0;
    hm.depthWrite = false;
    hm.color.setHex(0xff6a20).multiplyScalar(0.35);
    halo.position.set(0, 0.65, 0);
    kit.root.add(halo);
    const eye = kit.mat('ks_dark', { emissive: 1, tint: 0xff6020 });
    for (const sx of [-1, 1]) {
      const e = kit.box(rig.head, 0.05, 0.04, 0.02, eye, 0.07 * sx, 0.04, -0.135);
      d.eyes.push(e);
    }
    kit.root.scale.setScalar(1.4);
    kit.root.rotation.y = Math.PI;
    const group = new THREE.Group();
    group.add(kit.root);
    s.root.add(group);
    d.dog = { kit, legs: rig.legs, head: rig.head, group };
  } else {
    for (const m of s.mats) m.uniforms.uTint.value.multiply(ZOMBIE_TINT);
    s.gun.visible = false;
    // Arms out: hide the soldier's rifle arms, add straight arms reaching forward from the shoulders.
    s.aim.visible = false;
    const sleeve = makeLookMaterial({ texture: 'camo', dyn: true, rep: 0.45, tint: 0x8a9a74 });
    const skin = makeLookMaterial({ texture: 'glove', dyn: true, rep: 0.25, tint: 0x9ab088 });
    d.mats.push(sleeve, skin);
    const arms = new THREE.Group();
    arms.position.set(0, 1.45, 0);
    for (const sx of [-1, 1]) {
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.34), sleeve);
      upper.position.set(0.22 * sx, 0, 0.15);
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.32), sleeve);
      fore.position.set(0.2 * sx, -0.02, 0.45);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.12), skin);
      hand.position.set(0.19 * sx, -0.03, 0.66);
      arms.add(upper, fore, hand);
    }
    s.body.add(arms);
    d.arms = arms;
    d.extras.push(arms);
    // Glowing eyes on the mask.
    const eyeMat = makeLookMaterial({ texture: 'ks_dark', dyn: true, emissive: 1, tint: EYE });
    d.mats.push(eyeMat);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02), eyeMat);
      e.position.set(0.048 * sx, 0.2, 0.135);
      s.head.add(e);
      d.eyes.push(e);
      d.extras.push(e);
    }
    // Tattered strips hanging off the uniform.
    const rag = makeLookMaterial({ texture: 'camo', dyn: true, rep: 0.4, tint: 0x4a4436 });
    d.mats.push(rag);
    const strips: [number, number, number, number][] = [[-0.16, 1.1, 0.13, 0.28], [0.12, 1.05, 0.13, 0.22], [0.2, 1.35, -0.12, 0.3], [-0.05, 0.95, -0.12, 0.2]];
    for (const [x, y, z, h] of strips) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, h, 0.015), rag);
      m.position.set(x, y - h / 2, z);
      m.rotation.z = (Math.random() - 0.5) * 0.4;
      s.body.add(m);
      d.extras.push(m);
    }
    // A blood-dark stain across the chest.
    const stain = makeLookMaterial({ texture: 'ks_dark', dyn: true, tint: 0x5a1a14 });
    d.mats.push(stain);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.01), stain);
    st.position.set(0.04, 1.3, 0.165);
    st.rotation.z = 0.3;
    s.body.add(st);
    d.extras.push(st);
  }
  return d;
}

function undress(d: Dressed): void {
  d.soldier.body.position.set(0, 0, 0);
  d.soldier.body.rotation.set(0, 0, 0);
  d.soldier.head.rotation.set(0, 0, 0);
  for (const e of d.extras) {
    e.removeFromParent();
    if (e instanceof THREE.Mesh) e.geometry.dispose();
  }
  for (const m of d.mats) {
    unbindTexture(m);
    m.dispose();
  }
  if (d.dog) {
    d.dog.group.removeFromParent();
    d.dog.kit.dispose();
  }
}

// A headshot kill on a zombie: the head goes (BO1 head gib).
const headshots = new Map<string, number>();

registerMatchHook('zombies.look', {
  start() {
    for (const d of dressed.values()) undress(d);
    dressed.clear();
    headshots.clear();
    const off = net.on('killfeed', (k) => {
      if (k.headshot && k.victimTeam === 1) headshots.set(k.victim, performance.now() / 1000);
    });
    return () => {
      off();
      for (const d of dressed.values()) undress(d);
      dressed.clear();
    };
  },
  frame(m, dt) {
    if (!isZombiesMatch(m)) return;
    const now = performance.now() / 1000;
    const dogs = new Set(zm.state?.dogs ?? []);
    const cam = m.renderer.cam.position;
    const seen = new Set<string>();
    for (const v of m.remotes.views.values()) {
      if (v.team !== 1) continue;
      seen.add(v.id);
      let d = dressed.get(v.id);
      if (d && d.soldier !== v.soldier) {
        undress(d);
        d = undefined;
      }
      if (!d) {
        d = dress(v, dogs.has(v.id), now);
        dressed.set(v.id, d);
      }
      const s = v.soldier;
      const speed = Math.hypot(v.x - d.lastX, v.z - d.lastZ) / Math.max(dt, 1e-3);
      d.lastX = v.x;
      d.lastZ = v.z;
      // Spawned (or a pooled body reused): climb out of the ground.
      if (v.alive && !d.wasAlive) {
        d.riseAt = now;
        d.headless = false;
        s.head.visible = true;
        for (let i = 0; i < 10; i++) fxEmit({ x: v.x + (Math.random() - 0.5) * 0.8, y: v.y + 0.1, z: v.z + (Math.random() - 0.5) * 0.8 }, { color: 0x5a4a38, life: 0.6 + Math.random() * 0.4, size: 0.12, size1: 0.04, vel: { x: (Math.random() - 0.5) * 2, y: 1.5 + Math.random() * 2, z: (Math.random() - 0.5) * 2 }, grav: 9 });
        if (Math.hypot(cam.x - v.x, cam.z - v.z) < 30) sfx.play('zombies.spawn', { at: { x: v.x, y: v.y, z: v.z }, volume: 0.9 });
      }
      if (!v.alive && d.wasAlive) {
        const hs = headshots.get(v.id);
        if (hs !== undefined && now - hs < 1 && !d.dog) {
          d.headless = true;
          s.head.visible = false;
          for (let i = 0; i < 14; i++) fxEmit({ x: v.x, y: v.y + 1.7, z: v.z }, { color: i % 3 ? 0x7a1010 : 0x3a5030, life: 0.5 + Math.random() * 0.4, size: 0.08, size1: 0.03, vel: { x: (Math.random() - 0.5) * 3, y: 1 + Math.random() * 3, z: (Math.random() - 0.5) * 3 }, grav: 12 });
          headshots.delete(v.id);
        }
      }
      d.wasAlive = v.alive;
      const firing = (v.flags & PlayerFlags.FIRING) !== 0;
      if (firing && !d.firingWas && v.alive) {
        d.swipeAt = now;
        if (Math.hypot(cam.x - v.x, cam.z - v.z) < 12) sfx.play(d.dog ? 'zombies.growl' : 'zombies.swipe', { at: { x: v.x, y: v.y + 1.2, z: v.z }, volume: 0.9 });
      }
      d.firingWas = firing;
      const rise = Math.max(0, Math.min(1, (now - d.riseAt) / ZOMBIE_POSE.riseSec));
      if (d.dog) {
        const g = d.dog;
        g.kit.light(dt, m.map ? (x, y, z) => m.map!.lightAt(x, y, z) : null, s.root.position);
        d.phase += dt * Math.min(20, speed * 2.4);
        const sw = Math.min(0.9, speed * 0.14);
        g.legs.forEach((leg, i) => (leg.rotation.x = Math.sin(d!.phase + (i === 0 || i === 3 ? 0 : Math.PI)) * sw));
        const bite = now - d.swipeAt < 0.35;
        g.head.rotation.x = bite ? -0.5 + Math.sin(now * 40) * 0.2 : Math.sin(now * 3) * 0.05;
        g.group.rotation.z = v.alive ? 0 : Math.min(1.5, g.group.rotation.z + dt * 4);
        g.group.position.y = v.alive ? -0.9 * (1 - rise) : 0;
        g.group.visible = v.alive || v.deadFor < 3;
      } else {
        if (m.map) setDynLight(d.mats, m.map.lightAt(v.x, v.y + 1.2, v.z), 0.25);
        if (v.alive) {
          // Shamble: a lurching limp about the hips, the head nodding and lolling, arms reaching
          // out. Kept small so the drawn head stays inside the head hitbox (ZOMBIE_POSE).
          d.phase += dt * (1.5 + speed * 1.6);
          const pose = zombiePose(speed, d.phase);
          s.body.rotation.set(pose.lean, 0, pose.roll);
          // Pivot at the hips: move the body so the hip point stays put.
          hip.set(0, ZOMBIE_POSE.hip, 0).applyEuler(s.body.rotation);
          s.body.position.set(0, s.body.position.y + ZOMBIE_POSE.hip - hip.y, -hip.z);
          s.body.position.x = -hip.x;
          s.head.rotation.set(pose.nod, 0, pose.headRoll);
          const swipe = now - d.swipeAt;
          let ax: number;
          if (swipe < 0.55) {
            // Up, then a slash down.
            const k = swipe / 0.55;
            ax = k < 0.5 ? -0.1 - 1.1 * (k / 0.5) : -1.2 + 1.8 * ((k - 0.5) / 0.5);
          } else ax = -0.12 + Math.sin(d.phase * 0.7) * 0.07;
          // Climbing out: up from below the ground, arms raised. The server crouches the body for
          // the first part of it (riseCrouchSec), so the drawn head follows the hitbox up.
          if (rise < 1) {
            const k = Math.min(1, (now - d.riseAt) / ZOMBIE_POSE.riseCrouchSec);
            s.root.position.y -= ZOMBIE_POSE.riseDrop * (1 - k) * (1 - k);
            ax = -1.3 * (1 - rise) + ax * rise;
          }
          if (d.arms) {
            d.arms.rotation.x = ax - s.body.rotation.x;
            d.arms.rotation.z = Math.sin(d.phase) * 0.06;
          }
        } else s.body.position.set(0, s.body.position.y, 0);
        for (const e of d.eyes) e.visible = v.alive && !d.headless;
      }
      // Groans (zombies) and growls (dogs), now and then, from the ones near you.
      d.groanIn -= dt;
      if (d.groanIn <= 0 && v.alive) {
        d.groanIn = 3.5 + Math.random() * 6;
        const dist = Math.hypot(cam.x - v.x, cam.z - v.z);
        if (dist < 28) sfx.play(d.dog ? 'zombies.growl' : 'zombies.groan', { at: { x: v.x, y: v.y + 1.5, z: v.z }, volume: 0.9, rate: 0.85 + Math.random() * 0.35 });
      }
    }
    for (const [id, d] of dressed) {
      if (seen.has(id)) continue;
      undress(d);
      dressed.delete(id);
    }
  },
});

/** Is this remote one of the undead? */
export const isUndeadView = (v: RemoteView) => v.team === 1 && isZombiesMatch(currentMatch());
