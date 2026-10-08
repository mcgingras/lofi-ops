/**
 * The MW2 guns' low-poly models (Intervention, ACR, M16A4) build with every attachment and camo
 * through the shared kit (the same builders feed the viewmodel, third-person and dropped guns),
 * with the muzzle out front, sights above the bore and the moving parts the animations need.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FURNITURE, GUNS, Kit } from '../src/client/features/weapons/gunkit';
import { WEAPON_BY_ID } from '../src/shared/defs/weapons';

const mat = () => new THREE.MeshBasicMaterial();

function build(model: string, atts: string[], camo: string | null = null) {
  const root = new THREE.Group();
  const kit = new Kit(root, mat, camo, FURNITURE[model] ?? 'poly');
  const b = GUNS[model]!(kit, atts);
  const box = new THREE.Box3().setFromObject(root);
  return { root, b, box, meshes: root.children.length };
}

describe('MW2 gun models', () => {
  it('has a builder for each model id', () => {
    for (const id of ['intervention', 'acr', 'm16a4']) expect(GUNS[WEAPON_BY_ID.get(id)!.model], id).toBeTypeOf('function');
  });

  it('build with no attachment, each attachment alone and with a camo', () => {
    for (const id of ['intervention', 'acr', 'm16a4']) {
      const def = WEAPON_BY_ID.get(id)!;
      for (const atts of [[], ...def.attachments.map((a) => [a])]) {
        for (const camo of [null, 'camo.tiger']) {
          const { b, box, meshes } = build(def.model, atts, camo);
          const tag = `${id} [${atts.join(',')}] ${camo}`;
          expect(meshes, tag).toBeGreaterThan(20);
          expect(Number.isFinite(box.min.z) && Number.isFinite(box.max.z), tag).toBe(true);
          // Muzzle at the front of the model, sight line above the bore, hands on the gun.
          expect(b.muzzle.z, tag).toBeLessThan(-0.5);
          expect(b.muzzle.z, tag).toBeGreaterThanOrEqual(box.min.z - 1e-6);
          expect(b.sightY, tag).toBeGreaterThan(b.muzzle.y);
          expect(b.adsZ, tag).toBeLessThan(-0.3);
          expect(b.grip.z, tag).toBeGreaterThan(b.fore.z);
          expect(b.pistol, tag).toBe(false);
          expect(b.parts.mag, tag).toBeDefined();
        }
      }
    }
  });

  it('suppressors lengthen the gun; optics raise the sight line on the rifles', () => {
    for (const id of ['intervention', 'acr', 'm16a4']) {
      const bare = build(id, []).b;
      expect(build(id, ['suppressor']).b.muzzle.z, id).toBeLessThan(bare.muzzle.z);
    }
    for (const id of ['acr', 'm16a4']) {
      const irons = build(id, []).b.sightY;
      for (const o of ['reddot', 'reflex', 'acog']) expect(build(id, [o]).b.sightY, `${id}/${o}`).toBeGreaterThan(irons);
    }
  });

  it('the Intervention is long, has a bolt to cycle and a big built-in scope', () => {
    const iv = build('intervention', []);
    const l96 = build('l96a1', []);
    expect(iv.b.parts.bolt).toBeDefined();
    expect(iv.box.max.z - iv.box.min.z).toBeGreaterThan(l96.box.max.z - l96.box.min.z);
    expect(iv.b.sightY).toBeGreaterThan(0.1);
  });

  it('the M16A4 is a flat-top: lower sight line than the carry-handle M16, longer handguard rail', () => {
    const a4 = build('m16a4', []);
    const m16 = build('m16', []);
    expect(a4.b.sightY).toBeLessThan(m16.b.sightY);
    // With the same red dot both sit on a rail, but the M16's sits on top of the carry handle.
    expect(build('m16a4', ['reddot']).b.sightY).toBeLessThan(build('m16', ['reddot']).b.sightY);
  });
});
