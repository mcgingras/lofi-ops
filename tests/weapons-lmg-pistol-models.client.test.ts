/**
 * The early-CoD LMG and pistol models: a builder (and so a viewmodel, third-person and dropped
 * gun) for each, building with every attachment and a camo, plus the synth voices and the
 * signature silhouettes (the M60 longest, the RPD's round drum, the HK21's tall 125-round box).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FURNITURE, GUNS, Kit } from '../src/client/features/weapons/gunkit';
import { VOICES } from '../src/client/features/weapons/sounds';
// The secondary launchers add their builders to GUNS from their own module.
import '../src/client/features/weapons/launchers/models';
import { LOADOUT_WEAPONS, WEAPON_BY_ID } from '../src/shared/defs/weapons';

const LMGS = ['m60', 'stoner63', 'hk21', 'rpd', 'm249', 'mg4'];
const PISTOLS = ['deagle', 'makarov', 'usp'];
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
const length = (m: string) => {
  const { box } = build(m, []);
  return box.max.z - box.min.z;
};

describe('model registry', () => {
  it('every loadout weapon (the new ones included) has a builder and a synth voice', () => {
    for (const w of LOADOUT_WEAPONS) {
      expect(GUNS[w.model], w.id).toBeTypeOf('function');
      expect(VOICES[w.id], w.id).toBeDefined();
    }
    for (const id of [...LMGS, ...PISTOLS]) expect(WEAPON_BY_ID.get(id)!.model).toBe(id);
  });
});

describe('LMG models', () => {
  it('build with no attachment, each attachment alone and with a camo', () => {
    for (const id of LMGS) {
      const def = WEAPON_BY_ID.get(id)!;
      for (const atts of [[], ...def.attachments.map((a) => [a])]) {
        for (const camo of [null, 'camo.tiger']) {
          const { b, box, meshes } = build(def.model, atts, camo);
          const tag = `${id} [${atts.join(',')}] ${camo}`;
          expect(meshes, tag).toBeGreaterThan(20);
          expect(Number.isFinite(box.min.z) && Number.isFinite(box.max.z), tag).toBe(true);
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

  it('optics raise the sight line, suppressors lengthen the gun, extended mags grow the box', () => {
    for (const id of LMGS) {
      const bare = build(id, []);
      for (const o of ['reddot', 'reflex', 'acog']) expect(build(id, [o]).b.sightY, `${id}/${o}`).toBeGreaterThan(bare.b.sightY);
      if (WEAPON_BY_ID.get(id)!.attachments.includes('suppressor')) expect(build(id, ['suppressor']).b.muzzle.z, id).toBeLessThan(bare.b.muzzle.z);
      const magBox = (atts: string[]) => new THREE.Box3().setFromObject(build(id, atts).b.parts.mag!);
      expect(magBox(['extmag']).min.y, id).toBeLessThan(magBox([]).min.y);
    }
  });

  it('silhouettes: the M60 is the longest LMG, the Stoner63 the shortest; the HK21 box hangs lowest', () => {
    const lens = Object.fromEntries([...LMGS, 'rpk'].map((id) => [id, length(id)]));
    expect(Math.max(...Object.values(lens))).toBe(lens.m60);
    expect(Math.min(...Object.values(lens))).toBe(lens.stoner63);
    const low = (id: string) => new THREE.Box3().setFromObject(build(id, []).b.parts.mag!).min.y;
    for (const id of LMGS.filter((x) => x !== 'hk21')) expect(low('hk21'), id).toBeLessThan(low(id));
    expect(FURNITURE.rpd).toBe('wood');
  });
});

describe('pistol models', () => {
  it('build one-handed with a slide, with each attachment (dual wield adds the off-hand gun)', () => {
    for (const id of PISTOLS) {
      const def = WEAPON_BY_ID.get(id)!;
      for (const atts of [[], ...def.attachments.map((a) => [a])]) {
        const { b, meshes } = build(id, atts, 'camo.tiger');
        const tag = `${id} [${atts.join(',')}]`;
        expect(b.pistol, tag).toBe(true);
        expect(b.parts.slide, tag).toBeDefined();
        expect(b.muzzle.z, tag).toBeLessThan(-0.1);
        expect(meshes, tag).toBeGreaterThan(10);
        expect(!!b.parts.offhand, tag).toBe(atts.includes('dual'));
        expect(!!b.noAds, tag).toBe(atts.includes('dual'));
      }
    }
  });

  it('the Desert Eagle is the biggest automatic pistol, the Makarov the smallest', () => {
    expect(length('deagle')).toBeGreaterThan(length('usp'));
    expect(length('deagle')).toBeGreaterThan(length('m1911'));
    expect(length('makarov')).toBeLessThan(length('usp'));
    expect(length('makarov')).toBeLessThan(length('m1911'));
  });
});
