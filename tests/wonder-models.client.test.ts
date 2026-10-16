/**
 * The wonder weapons on the client: the four low-poly models build through the shared gun kit
 * (so first person, third person, dropped guns, the killcam and the Mystery Box cycle all get
 * them) with their recognisable parts glowing; every one has a synthesized voice and
 * effect sounds listed as synth-only, a shot effect for the local pull and killcam replays, and a
 * killfeed icon; the Mystery Box's sounds are registered too.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FURNITURE, GUNS, Kit } from '../src/client/features/weapons/gunkit';
import '../src/client/features/weapons/index';
import '../src/client/features/killstreaks/sounds';
import { sfx } from '../src/client/game/audio';
import { killfeedIcons, shotFxs } from '../src/client/registry';
import { SFX_SYNTH_ONLY } from '../src/shared/defs/sfx-recipes';
import { WEAPON_BY_ID } from '../src/shared/defs/weapons';
import { WONDER_WEAPON_IDS } from '../src/shared/defs/wonder';

function build(model: string) {
  const root = new THREE.Group();
  const made: { texture: string; emissive: number }[] = [];
  const kit = new Kit(
    root,
    (texture, o = {}) => {
      made.push({ texture, emissive: o.emissive ?? 0 });
      return new THREE.MeshBasicMaterial();
    },
    null,
    FURNITURE[model] ?? 'poly',
  );
  const b = GUNS[model]!(kit, []);
  const box = new THREE.Box3().setFromObject(root);
  let meshes = 0;
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes++;
  });
  return { b, box, meshes, made };
}

describe('wonder weapon models', () => {
  it('build through the kit with a muzzle out front, hands on the gun and glowing parts', () => {
    for (const id of WONDER_WEAPON_IDS) {
      const model = WEAPON_BY_ID.get(id)!.model;
      expect(GUNS[model], id).toBeTypeOf('function');
      const { b, box, meshes, made } = build(model);
      expect(meshes, id).toBeGreaterThan(14);
      expect(b.muzzle.z, id).toBeLessThan(-0.2);
      expect(b.muzzle.z, id).toBeGreaterThanOrEqual(box.min.z - 0.02);
      expect(b.adsZ, id).toBeLessThan(-0.3);
      expect(made.some((m) => m.emissive > 0), `${id} glows`).toBe(true);
    }
    // The tell-tale parts.
    expect(build('raygun').made.some((m) => m.texture === 'wonder.green')).toBe(true);
    expect(build('raygun').b.pistol).toBe(true);
    expect(build('thundergun').b.noAds).toBe(true);
    expect(build('thundergun').b.parts.cylinder).toBeDefined(); // the turbine turns each blast
    expect(build('wunderwaffe').made.filter((m) => m.texture === 'wonder.bulb').length).toBeGreaterThan(0);
    expect(build('wunderwaffe').b.parts.mag).toBeDefined(); // the bulbs drop out on a reload
    expect(build('wintershowl').made.some((m) => m.texture === 'wonder.frost')).toBe(true);
  });

  it('each has a synth voice listed as synth-only, a shot effect and a killfeed icon', () => {
    for (const id of WONDER_WEAPON_IDS) {
      expect(sfx.hasSynth(`shot.${id}`), id).toBe(true);
      expect(SFX_SYNTH_ONLY[`shot.${id}`], id).toBeDefined();
      expect(shotFxs.get(id)?.local, id).toBeTypeOf('function');
      expect(shotFxs.get(id)?.replay, id).toBeTypeOf('function');
      expect(killfeedIcons.has(id), id).toBe(true);
    }
    for (const id of ['weapons.wonder.splash', 'weapons.wonder.zap', 'weapons.wonder.shatter', 'weapons.wonder.chill', 'ks_mbox_jingle', 'ks_mbox_tick', 'ks_mbox_thunder', 'ks_mbox_land', 'ks_mbox_beam', 'ks_mbox_open', 'ks_mbox_whoosh']) {
      expect(sfx.hasSynth(id), id).toBe(true);
      expect(SFX_SYNTH_ONLY[id], id).toBeDefined();
    }
  });
});
