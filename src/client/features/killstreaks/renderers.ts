/** Entity renderers for every killstreak entity kind (models.ts builds them), with their sounds. */
import * as THREE from 'three';
import { KS_ENTITY } from '../../../shared/defs/killstreaks';
import type { EntitySnap } from '../../../shared/protocol';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { registerEntityRenderer, type EntityView } from '../../registry';
import { iHave } from '../perks/state';
import { buildCrate, buildDog, buildHeli, buildMissile, buildPlane, buildRcxd, buildSam, buildSentry, Kit } from './models';
import { friendly, ksClient } from './store';

const lightOf = (m: Match) => (m.map ? (x: number, y: number, z: number) => m.map!.lightAt(x, y, z) : null);

/** Red marker over enemy hardware for Hacker users. */
function hackerMark(kit: Kit, y: number): THREE.Sprite {
  const s = kit.sprite('glow', 0.9, 0xff3a2a);
  s.position.y = y;
  s.visible = false;
  kit.root.add(s);
  return s;
}

const isFriendly = (e: EntitySnap) => friendly(e.owner ?? '', e.team ?? null);

/** Plays a looping sound by re-triggering it every `every` seconds (positional). */
function looper(id: string, every: number, volume: number) {
  let t = Math.random() * every;
  return (dt: number, at: THREE.Vector3, rate = 1) => {
    t -= dt;
    if (t > 0) return;
    t += every;
    sfx.play(id, { at: { x: at.x, y: at.y, z: at.z }, volume, rate });
  };
}

function plane(kind: 'uav' | 'cuav' | 'blackbird' | 'jet' | 'bomber') {
  return (_e: EntitySnap, m: Match): EntityView => {
    const kit = new Kit();
    buildPlane(kit, kind);
    const snd = kind === 'jet' ? null : looper('ks_prop', 0.45, kind === 'bomber' ? 1.6 : 0.8);
    let jetPlayed = false;
    return {
      object: kit.root,
      update(e, dt) {
        kit.light(dt, lightOf(m), kit.root.position);
        // Bank into the turn for orbiting planes.
        kit.root.rotation.z = kind === 'uav' || kind === 'cuav' || kind === 'blackbird' ? -0.25 : 0;
        if (snd) snd(dt, kit.root.position);
        if (kind === 'jet' && !jetPlayed) {
          const cam = m.renderer.cam.position;
          if (Math.hypot(e.x - cam.x, e.z - cam.z) < 120) {
            jetPlayed = true;
            sfx.play('ks_jet', { at: { x: e.x, y: e.y, z: e.z }, volume: 2.2 });
          }
        }
      },
      dispose: () => kit.dispose(),
    };
  };
}

function heli(kind: 'heli' | 'gunner' | 'drop') {
  return (_e: EntitySnap, m: Match): EntityView => {
    const kit = new Kit();
    const rot = buildHeli(kit, kind);
    const flash = kind === 'drop' ? null : kit.sprite('flash', 0.9);
    if (flash) {
      flash.position.set(0, kind === 'gunner' ? -1.4 : -0.9, kind === 'gunner' ? -0.6 : -3.3);
      kit.root.add(flash);
    }
    const thump = looper('ks_rotor', 0.11, kind === 'drop' ? 1.6 : 1.2);
    const gun = looper(kind === 'gunner' ? 'ks_gunner' : 'ks_sentry', 0.16, 1.4);
    let spin = 0;
    return {
      object: kit.root,
      update(e, dt) {
        kit.light(dt, lightOf(m), kit.root.position);
        spin += dt * 28;
        for (const r of rot.main) r.rotation.y = spin;
        for (const r of rot.tail) r.rotation.x = spin * 1.5;
        thump(dt, kit.root.position);
        const firing = e.s?.f === 1;
        if (flash) flash.visible = firing && Math.random() < 0.6;
        if (firing) gun(dt, kit.root.position);
        kit.root.rotation.x = 0.08; // nose down a touch
        // Hide the Chopper Gunner you're riding (the camera is inside it).
        if (kind === 'gunner') kit.root.visible = !(e.owner === m.myId);
      },
      dispose: () => kit.dispose(),
    };
  };
}

registerEntityRenderer(KS_ENTITY.uav, plane('uav'));
registerEntityRenderer(KS_ENTITY.counterUav, plane('cuav'));
registerEntityRenderer(KS_ENTITY.blackbird, plane('blackbird'));
registerEntityRenderer(KS_ENTITY.jet, plane('jet'));
registerEntityRenderer(KS_ENTITY.bomber, plane('bomber'));
registerEntityRenderer(KS_ENTITY.heli, heli('heli'));
registerEntityRenderer(KS_ENTITY.gunner, heli('gunner'));
registerEntityRenderer(KS_ENTITY.dropHeli, heli('drop'));

registerEntityRenderer(KS_ENTITY.crate, (_e, m) => {
  const kit = new Kit();
  buildCrate(kit);
  const smoke = kit.sprite('puff', 0.6, 0xd0a040);
  kit.root.add(smoke);
  const mark = hackerMark(kit, 1.6);
  let t = 0;
  return {
    object: kit.root,
    update(e, dt) {
      t += dt;
      kit.light(dt, lightOf(m), kit.root.position);
      smoke.visible = e.s?.l === true;
      smoke.position.set(Math.sin(t * 1.3) * 0.2, 1.2 + ((t * 0.8) % 2), Math.cos(t) * 0.2);
      smoke.scale.setScalar(0.4 + ((t * 0.8) % 2) * 0.5);
      mark.visible = iHave('hacker') && !isFriendly(e);
    },
    dispose: () => kit.dispose(),
  };
});

/**
 * A turret in someone's hands (`s.c`): green where it can go down, red where it can't (`s.v`).
 * Hidden when it is ours (turret.ts draws our preview). Returns the tint now applied.
 */
function carriedLook(kit: Kit, e: EntitySnap, m: Match, tint: number): number {
  const carried = e.s?.c === 1;
  kit.root.visible = !(carried && e.owner === m.myId);
  const want = carried ? (e.s?.v === 1 ? 0x70ff80 : 0xff5040) : 0xffffff;
  if (want !== tint) for (const mat of kit.mats) mat.uniforms.uTint.value.setHex(want);
  return want;
}

/**
 * Sentry Gun. The root turns with the head (entity yaw); the tripod is turned back to the way it was
 * placed (`s.b`). The red lamp lights while it tracks someone (`s.t`) and burns steady once it may
 * fire (`s.a`); a chirp plays when it picks up a target (BO1 plays `mpl_turret_alert`). Stunned
 * (`s.st`): sparks, no lamp. Carried (`s.c`): tinted green / red for others (BO1 swaps in its
 * good / bad placement models); your own carried turret is drawn by turret.ts as the preview.
 */
/** Sentry models by entity id (turret.ts aims the tracking laser from the smoothed one). */
export const sentryObjects = new Map<number, THREE.Object3D>();

registerEntityRenderer(KS_ENTITY.sentry, (e0, m) => {
  const kit = new Kit();
  const parts = buildSentry(kit);
  sentryObjects.set(e0.id, kit.root);
  const mark = hackerMark(kit, 1.5);
  const gun = looper('ks_sentry', 0.12, 1.2);
  const spark = kit.sprite('flash', 0.35, 0x9fd0ff);
  spark.position.set(0, 1.0, 0);
  kit.root.add(spark);
  let lastTarget = '';
  let tint = -1;
  return {
    object: kit.root,
    update(e, dt) {
      tint = carriedLook(kit, e, m, tint);
      kit.light(dt, lightOf(m), kit.root.position);
      const base = typeof e.s?.b === 'number' ? e.s.b : e.yaw;
      parts.legs.rotation.y = base - e.yaw;
      const firing = e.s?.f === 1;
      parts.flash.visible = firing && Math.random() < 0.7;
      if (firing) gun(dt, kit.root.position);
      const target = typeof e.s?.t === 'string' ? e.s.t : '';
      const stunned = e.s?.st === 1;
      if (target && target !== lastTarget) sfx.play('weapons.beep', { at: { x: e.x, y: e.y + 1, z: e.z }, volume: target === m.myId ? 1.1 : 0.6, rate: 0.8 });
      lastTarget = target;
      parts.lamp.visible = !!target && !stunned && (e.s?.a === 1 || Math.floor(m.time * 8) % 2 === 0);
      spark.visible = stunned && Math.random() < 0.35;
      mark.visible = iHave('hacker') && !isFriendly(e);
    },
    dispose: () => {
      sentryObjects.delete(e0.id);
      kit.dispose();
    },
  };
});

registerEntityRenderer(KS_ENTITY.sam, (_e, m) => {
  const kit = new Kit();
  buildSam(kit);
  const mark = hackerMark(kit, 2);
  let tint = -1;
  return {
    object: kit.root,
    update(e, dt) {
      tint = carriedLook(kit, e, m, tint);
      kit.light(dt, lightOf(m), kit.root.position);
      mark.visible = iHave('hacker') && !isFriendly(e);
    },
    dispose: () => kit.dispose(),
  };
});

const missile = (big: boolean) => (_e: EntitySnap, m: Match): EntityView => {
  const kit = new Kit();
  const { pitch, glow } = buildMissile(kit, big);
  const hiss = looper('ks_launch', 0.7, big ? 0.8 : 0.5);
  return {
    object: kit.root,
    update(e, dt) {
      kit.light(dt, lightOf(m), kit.root.position, true);
      const p = typeof e.s?.p === 'number' ? e.s.p : 0.3;
      pitch.rotation.x = p;
      hiss(dt, kit.root.position, big && e.s?.b === 1 ? 1.25 : 1);
      // A boosted Valkyrie burns brighter.
      glow.scale.setScalar((big ? 1.54 : 1.1) * (big && e.s?.b === 1 ? 1.6 + Math.random() * 0.4 : 1));
      // The rocket the local player rides carries the camera: hide the body so it doesn't block the view.
      kit.root.visible = !(big && m.alive && ksClient.state?.control?.entity === e.id);
    },
    dispose: () => kit.dispose(),
  };
};
registerEntityRenderer(KS_ENTITY.missile, missile(false));
registerEntityRenderer(KS_ENTITY.rocket, missile(true));

registerEntityRenderer(KS_ENTITY.dog, (_e, m) => {
  const kit = new Kit();
  const rig = buildDog(kit);
  let phase = Math.random() * 6;
  const last = new THREE.Vector3();
  let first = true;
  let barkIn = 2 + Math.random() * 4;
  return {
    object: kit.root,
    update(e, dt) {
      kit.light(dt, lightOf(m), kit.root.position);
      const p = kit.root.position;
      const speed = first ? 0 : p.distanceTo(last) / Math.max(dt, 1e-3);
      first = false;
      last.copy(p);
      phase += dt * Math.min(18, speed * 2.2);
      const sw = Math.min(0.8, speed * 0.12);
      rig.legs.forEach((leg, i) => (leg.rotation.x = Math.sin(phase + (i === 0 || i === 3 ? 0 : Math.PI)) * sw));
      const biting = e.s?.b === 1;
      rig.head.rotation.x = biting ? Math.sin(m.time * 30) * 0.3 - 0.2 : 0;
      barkIn -= dt;
      if (barkIn <= 0) {
        barkIn = 2.5 + Math.random() * 5;
        sfx.play('ks_bark', { at: { x: p.x, y: p.y + 0.6, z: p.z }, volume: 1.1 });
      }
    },
    dispose: () => kit.dispose(),
  };
});

registerEntityRenderer(KS_ENTITY.rcxd, (_e, m) => {
  const kit = new Kit();
  const wheels = buildRcxd(kit);
  const mark = hackerMark(kit, 0.8);
  const buzz = looper('ks_buzz', 0.1, 0.7);
  const last = new THREE.Vector3();
  let roll = 0;
  return {
    object: kit.root,
    update(e, dt) {
      kit.light(dt, lightOf(m), kit.root.position);
      const p = kit.root.position;
      const speed = p.distanceTo(last) / Math.max(dt, 1e-3);
      last.copy(p);
      roll += speed * dt * 10;
      for (const w of wheels) w.rotation.x = roll;
      buzz(dt, p, 0.8 + Math.min(1, speed / 8) * 0.6);
      mark.visible = iHave('hacker') && !isFriendly(e);
    },
    dispose: () => kit.dispose(),
  };
});

registerEntityRenderer(KS_ENTITY.fire, (e, m) => {
  const kit = new Kit();
  const r = typeof e.s?.r === 'number' ? e.s.r : 4;
  const flames: THREE.Sprite[] = [];
  for (let i = 0; i < 9; i++) {
    const s = kit.sprite('ks_fire', 1, 0xffffff);
    const a = (i / 9) * Math.PI * 2 + Math.random();
    const d = Math.random() * r * 0.8;
    s.position.set(Math.cos(a) * d, 0.5, Math.sin(a) * d);
    kit.root.add(s);
    flames.push(s);
  }
  const crackle = looper('ks_fire', 0.45, 0.8);
  return {
    object: kit.root,
    update(_s, dt) {
      for (const f of flames) {
        const k = 0.8 + Math.random() * 0.9;
        f.scale.set(k * 1.1, k * 1.6, 1);
        f.position.y = k * 0.75;
      }
      crackle(dt, kit.root.position);
      void m;
    },
    dispose: () => kit.dispose(),
  };
});

registerEntityRenderer(KS_ENTITY.mortarMark, (e, m) => {
  const kit = new Kit();
  const ring = kit.flat('ks_ring', 5);
  ring.position.y = 0.06;
  kit.root.add(ring);
  const lands = typeof e.s?.t === 'number' ? e.s.t : 0;
  let whistled = false;
  return {
    object: kit.root,
    update(_s, dt) {
      const left = lands - m.serverTime;
      ring.visible = Math.floor(m.time * (left < 1 ? 8 : 3)) % 2 === 0;
      ring.rotation.y += dt;
      if (!whistled && left <= 1.2) {
        whistled = true;
        const p = kit.root.position;
        sfx.play('ks_whistle', { at: { x: p.x, y: p.y + 10, z: p.z }, volume: 1.4 });
      }
    },
    dispose: () => kit.dispose(),
  };
});
