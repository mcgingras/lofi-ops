/**
 * The first-person gun never goes missing: for every weapon (with every pair of its attachments,
 * plain and Pack-a-Punched), the real ViewmodelRig is put through every pose (aim, sprint, prone,
 * mantle, reload, raise, shots, knife, grenade and tomahawk holds and throws) and must come back to
 * the pose it started in, on screen, with finite numbers.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/client/render/textures', async (orig) => {
  const T = await import('three');
  const real = await orig<typeof import('../src/client/render/textures')>();
  const tex = new T.Texture();
  return { ...real, getTexture: () => tex, hasTexture: () => true, registerTexture: () => {}, bindTexture: () => {}, unbindTexture: () => {} };
});

import { ViewmodelRig, type ViewmodelPose } from '../src/client/game/viewmodel';
import '../src/client/features/weapons/viewmodels';
import '../src/client/features/weapons/launchers/models';
import '../src/client/features/weapons/wonder/models';
import { WEAPONS } from '../src/shared/defs/weapons';

const DT = 1 / 60;
const rest = (time: number): ViewmodelPose => ({ dt: DT, time, ads: 0, move: 0, sprint: false, yaw: 0, pitch: 0, reload: -1, raise: -1, light: [1, 1, 1], prone: 0, crawl: 0, mantle: -1 });

/** What is on screen: the box of every visible mesh under the rig (the muzzle flash aside), and how many. */
function shown(rig: ViewmodelRig): { box: THREE.Box3; meshes: number; finite: boolean } {
  rig.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let meshes = 0;
  let finite = true;
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    for (const e of o.matrixWorld.elements) if (!Number.isFinite(e)) finite = false;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !(mesh.geometry instanceof THREE.PlaneGeometry)) {
      meshes++;
      mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
    }
    o.children.forEach(walk);
  };
  walk(rig.root);
  return { box, meshes, finite };
}

class Bench {
  time = 0;
  readonly rig = new ViewmodelRig(new THREE.Scene());
  step(over: Partial<ViewmodelPose> = {}, sec = DT): void {
    for (let t = 0; t < sec - 1e-9; t += DT) {
      this.time += DT;
      this.rig.update({ ...rest(this.time), ...over });
    }
  }
  /** Sweep a 0..1 progress field over `sec`. */
  sweep(key: 'reload' | 'raise' | 'mantle', sec: number, over: Partial<ViewmodelPose> = {}): void {
    const n = Math.round(sec / DT);
    for (let i = 0; i <= n; i++) this.step({ ...over, [key]: i / n });
  }
  settle(): ReturnType<typeof shown> {
    this.step({}, 2.5);
    return shown(this.rig);
  }
}

const SCENES: Record<string, (b: Bench) => void> = {
  aim: (b) => {
    for (let i = 0; i <= 20; i++) b.step({ ads: i / 20 });
    b.step({ ads: 1 }, 0.5);
  },
  sprint: (b) => b.step({ sprint: true, move: 1 }, 1),
  prone: (b) => {
    for (let i = 0; i <= 30; i++) b.step({ prone: i / 30 });
    b.step({ prone: 1, crawl: 1, move: 0.3 }, 1);
    for (let i = 30; i >= 0; i--) b.step({ prone: i / 30 });
  },
  mantle: (b) => b.sweep('mantle', 0.6),
  reload: (b) => b.sweep('reload', 2.4),
  raise: (b) => b.sweep('raise', 0.5),
  shots: (b) => {
    for (let i = 0; i < 30; i++) {
      b.rig.shoot(b.time, 1.2);
      b.step({}, 0.07);
    }
  },
  knife: (b) => {
    b.rig.action('melee', 0.45);
    b.sweep('raise', 0.7);
  },
  'knife cut short by a throw': (b) => {
    b.rig.action('melee', 0.45);
    b.step({}, 0.1);
    b.rig.action('ready:frag', 0.25, true);
    b.step({}, 0.6);
    b.rig.action('release:frag', 0.4);
    b.sweep('raise', 0.7);
  },
  'grenade held then thrown': (b) => {
    b.rig.action('ready:frag', 0.25, true);
    b.step({}, 2);
    b.rig.action('release:frag', 0.4);
    b.sweep('raise', 0.7);
  },
  'grenade hold dropped': (b) => {
    b.rig.action('ready:frag', 0.25, true);
    b.step({ ads: 1 }, 1);
    b.rig.endAction();
  },
  tomahawk: (b) => {
    b.rig.action('ready:tomahawk', 0.25, true);
    b.step({}, 0.5);
    b.rig.action('release:tomahawk', 0.4);
    b.step({}, 0.7);
  },
  'reload cut short by a switch': (b) => {
    for (let i = 0; i <= 40; i++) b.step({ reload: i / 100 });
    b.sweep('raise', 0.5);
  },
};

/** Every pair of a weapon's attachments (and each alone, and none). */
function loadouts(atts: readonly string[]): string[][] {
  const out: string[][] = [[]];
  for (let i = 0; i < atts.length; i++) {
    out.push([atts[i]!]);
    for (let j = i + 1; j < atts.length; j++) out.push([atts[i]!, atts[j]!]);
  }
  return out;
}

describe('the first-person gun stays on screen', () => {
  for (const w of WEAPONS) {
    it(`${w.id}: every attachment pair, plain and packed, through every pose`, () => {
      const b = new Bench();
      for (const camo of ['none', 'pap']) {
        for (const atts of loadouts(w.attachments ?? [])) {
          const tag = `${w.id} [${atts.join('+')}] ${camo}`;
          b.rig.setWeapon(w.model, atts, camo);
          const base = b.settle();
          expect(base.finite, tag).toBe(true);
          expect(base.meshes, tag).toBeGreaterThan(3);
          // In front of the camera (it looks down -z from the origin), in the lower right.
          const c = base.box.getCenter(new THREE.Vector3());
          expect(c.z, tag).toBeLessThan(0.4);
          expect(c.z, tag).toBeGreaterThan(-1.5);
          expect(Math.abs(c.x), tag).toBeLessThan(0.5);
          expect(c.y, tag).toBeGreaterThan(-0.6);
          expect(c.y, tag).toBeLessThan(0.3);
          // Only the scenes that matter for attachment pairs are the cheap ones; all of them plain.
          const scenes = atts.length > 1 ? ['aim', 'reload', 'knife'] : Object.keys(SCENES);
          for (const name of scenes) {
            SCENES[name]!(b);
            const after = b.settle();
            expect(after.finite, `${tag} after ${name}`).toBe(true);
            expect(after.meshes, `${tag} after ${name}`).toBe(base.meshes);
            const d = after.box.getCenter(new THREE.Vector3()).distanceTo(c);
            expect(d, `${tag} after ${name}`).toBeLessThan(0.02);
            expect(b.rig.currentAction, `${tag} after ${name}`).toBeNull();
          }
        }
      }
      b.rig.dispose();
    });
  }
});
