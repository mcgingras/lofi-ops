/**
 * The iconic SMG models: a builder (and so a viewmodel, third-person and dropped gun) for each,
 * building with every attachment and a camo, the registry covering every loadout weapon, synth
 * voices, and the signature silhouettes (the P90's magazine on top that lifts on a reload, the
 * Uzi's magazine in the grip, the Spectre's fat casket mag).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FURNITURE, GUNS, Kit } from '../src/client/features/weapons/gunkit';
import { VOICES } from '../src/client/features/weapons/sounds';
import { LOADOUT_WEAPONS, WEAPON_BY_ID } from '../src/shared/defs/weapons';

const NEW = ['mp5', 'ump45', 'vector', 'p90', 'spectre', 'uzi'];
const mat = () => new THREE.MeshBasicMaterial();

function build(model: string, atts: string[], camo: string | null = null) {
  const root = new THREE.Group();
  const kit = new Kit(root, mat, camo, FURNITURE[model] ?? 'poly');
  const b = GUNS[model]!(kit, atts);
  const box = new THREE.Box3().setFromObject(root);
  let meshes = 0;
  root.traverse((o) => (meshes += (o as THREE.Mesh).isMesh ? 1 : 0));
  return { root, b, box, meshes };
}
const magBox = (id: string, atts: string[] = []) => new THREE.Box3().setFromObject(build(id, atts).b.parts.mag!);
const size = (b: THREE.Box3) => b.getSize(new THREE.Vector3());

describe('model registry', () => {
  it('every loadout weapon (the new SMGs included) has a builder and a synth voice', () => {
    for (const w of LOADOUT_WEAPONS) {
      expect(GUNS[w.model], w.id).toBeTypeOf('function');
      expect(VOICES[w.id], w.id).toBeDefined();
    }
    for (const id of NEW) expect(WEAPON_BY_ID.get(id)!.model).toBe(id);
  });
});

describe('SMG models', () => {
  it('build with no attachment, each attachment alone and with a camo', () => {
    for (const id of NEW) {
      const def = WEAPON_BY_ID.get(id)!;
      for (const atts of [[], ...def.attachments.map((a) => [a])]) {
        for (const camo of [null, 'camo.tiger']) {
          const { b, box, meshes } = build(def.model, atts, camo);
          const tag = `${id} [${atts.join(',')}] ${camo}`;
          expect(meshes, tag).toBeGreaterThan(15);
          expect(Number.isFinite(box.min.z) && Number.isFinite(box.max.z), tag).toBe(true);
          expect(b.muzzle.z, tag).toBeLessThan(-0.2);
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

  it('optics raise the sight line (except the P90, whose ring sight already sits high), suppressors lengthen, extended mags grow', () => {
    for (const id of NEW) {
      const bare = build(id, []);
      for (const o of ['reddot', 'reflex', 'acog']) {
        const s = build(id, [o]).b.sightY;
        if (id === 'p90') expect(s, `${id}/${o}`).toBeGreaterThan(0.12);
        else expect(s, `${id}/${o}`).toBeGreaterThan(bare.b.sightY);
      }
      expect(build(id, ['suppressor']).b.muzzle.z, id).toBeLessThan(bare.b.muzzle.z);
      const a = size(magBox(id));
      const e = size(magBox(id, ['extmag']));
      expect(Math.max(e.y, e.z), id).toBeGreaterThan(Math.max(a.y, a.z));
    }
  });

  it('silhouettes: the P90 mag rides on top and lifts on a reload, the Uzi mag sits in the grip, the Spectre mag is the widest', () => {
    const p90 = build('p90', []);
    expect(p90.b.magUp).toBe(true);
    expect(magBox('p90').min.y).toBeGreaterThan(p90.b.muzzle.y);
    for (const id of NEW.filter((x) => x !== 'p90')) {
      expect(build(id, []).b.magUp, id).toBeFalsy();
      expect(magBox(id).max.y, id).toBeLessThan(0.05);
    }
    // Uzi: the magazine well is the grip, behind the trigger guard rather than ahead of it.
    const uzi = build('uzi', []);
    expect(Math.abs(magBox('uzi').getCenter(new THREE.Vector3()).z - uzi.b.grip.z)).toBeLessThan(0.06);
    expect(magBox('mp5').getCenter(new THREE.Vector3()).z).toBeLessThan(build('mp5', []).b.grip.z - 0.1);
    const widths = Object.fromEntries(NEW.filter((x) => x !== 'p90').map((id) => [id, size(magBox(id)).x]));
    expect(Math.max(...Object.values(widths))).toBe(widths.spectre);
  });
});
