/**
 * Machine pistols on the client: their one-handed low-poly models build with every attachment and
 * a camo through the shared kit (viewmodel, third person, dropped guns and the Create-a-Class
 * preview), Akimbo turns into the Pack-a-Punch dual-wield mirror (one hand on the gun, no ADS pose,
 * `heldAkimbo`), each has a synthesized voice and a killfeed icon, and the venom status reads back.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { heldAkimbo, papFxState, venomDoses } from '../src/client/features/killstreaks/packapunch-fx';
import { FURNITURE, GUNS, Kit } from '../src/client/features/weapons/gunkit';
import '../src/client/features/weapons/index';
import { MACHINE_PISTOL_ICONS } from '../src/client/features/weapons/killfeed';
import { buildWeaponViewmodel } from '../src/client/features/weapons/viewmodels';
import { sfx } from '../src/client/game/audio';
import type { Match } from '../src/client/game/match';
import { killfeedIcons } from '../src/client/registry';
import { effectiveWeapon } from '../src/shared/defs/attachments';
import { PAP_CAMO } from '../src/shared/defs/pack-a-punch';
import { LOADOUT_WEAPONS, WEAPON_BY_ID } from '../src/shared/defs/weapons';

const MPS = LOADOUT_WEAPONS.filter((w) => w.class === 'machinepistol').map((w) => w.id);
const mat = () => new THREE.MeshBasicMaterial();

function build(model: string, atts: string[], camo: string | null = null) {
  const root = new THREE.Group();
  const kit = new Kit(root, mat, camo, FURNITURE[model] ?? 'poly');
  const b = GUNS[model]!(kit, atts);
  const box = new THREE.Box3().setFromObject(root);
  let meshes = 0;
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes++;
  });
  return { b, box, meshes };
}

describe('machine pistol models', () => {
  it('there are five, and each builds with no attachment, each attachment alone, and a camo', () => {
    expect(MPS.sort()).toEqual(['cz75auto', 'g18', 'mp9', 'skorpion', 'tmp']);
    for (const id of MPS) {
      const def = WEAPON_BY_ID.get(id)!;
      expect(GUNS[def.model], id).toBeTypeOf('function');
      for (const atts of [[], ...def.attachments.map((a) => [a])]) {
        for (const camo of [null, 'camo.tiger']) {
          const { b, box, meshes } = build(def.model, atts, camo);
          const tag = `${id} [${atts.join(',')}] ${camo}`;
          expect(meshes, tag).toBeGreaterThanOrEqual(10);
          expect(b.pistol, tag).toBe(true);
          expect(b.muzzle.z, tag).toBeLessThan(-0.12);
          expect(b.muzzle.z, tag).toBeGreaterThanOrEqual(box.min.z - 1e-6);
          expect(b.sightY, tag).toBeGreaterThan(b.muzzle.y);
          expect(b.parts.slide, tag).toBeDefined();
          expect(b.parts.mag, tag).toBeDefined();
          // Smaller than an SMG.
          expect(box.max.z - box.min.z, tag).toBeLessThan(build('mp5k', []).box.max.z - build('mp5k', []).box.min.z + 0.15);
        }
      }
    }
  });

  it('suppressor lengthens, red dot raises the sight line, extended mag hangs lower', () => {
    for (const id of MPS) {
      const bare = build(id, []);
      expect(build(id, ['suppressor']).b.muzzle.z, id).toBeLessThan(bare.b.muzzle.z);
      expect(build(id, ['reddot']).b.sightY, id).toBeGreaterThan(bare.b.sightY);
      expect(build(id, ['extmag']).box.min.y, id).toBeLessThan(bare.box.min.y);
    }
  });

  it('Akimbo: one hand on the gun and no ADS pose (the left hand holds the mirrored copy)', () => {
    for (const id of MPS) {
      const plain = build(id, []).b;
      const pair = build(id, ['akimbo']).b;
      expect(plain.noAds || plain.oneHand, id).toBeFalsy();
      expect(pair.noAds, id).toBe(true);
      expect(pair.oneHand, id).toBe(true);
      expect(pair.parts.offhand, id).toBeUndefined(); // no second model: the mirror draws it
    }
    // The viewmodel: aimed pose = hip pose, and only the right arm (the left comes from the mirror).
    const vm = (atts: string[]) => {
      const group = new THREE.Group();
      const spec = buildWeaponViewmodel({ group, mat: () => new THREE.MeshBasicMaterial(), camo: null, attachments: atts } as unknown as Parameters<typeof buildWeaponViewmodel>[0], 'g18');
      let meshes = 0;
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes++;
      });
      return { spec, meshes };
    };
    const pair = vm(['akimbo']);
    const one = vm([]);
    expect(pair.spec.ads.equals(pair.spec.hip)).toBe(true);
    expect(one.spec.ads.equals(one.spec.hip)).toBe(false);
    expect(pair.meshes).toBeLessThan(one.meshes);
  });

  it('heldAkimbo: the Akimbo attachment and a packed MPL-LF both get the mirrored second gun', () => {
    const fake = (id: string, atts: string[], camo = 'none', slot = 1) =>
      ({ slot, me: { weapons: [{ id: 'ak47', attachments: [], camo: 'none' }, { id, attachments: atts, camo }] }, weapon: (s = slot) => (s === 1 ? effectiveWeapon(WEAPON_BY_ID.get(id)!, atts) : effectiveWeapon(WEAPON_BY_ID.get('ak47')!)) }) as unknown as Match;
    expect(heldAkimbo(fake('g18', ['akimbo']))).toBe(true);
    expect(heldAkimbo(fake('g18', ['extmag']))).toBe(false);
    expect(heldAkimbo(fake('g18', ['akimbo'], 'none', 0))).toBe(false);
    expect(heldAkimbo(fake('mpl', [], PAP_CAMO))).toBe(true);
    expect(heldAkimbo(fake('mpl', []))).toBe(false);
  });

  it('a synthesized voice (and a suppressed one) and a killfeed icon for each', () => {
    for (const id of MPS) {
      expect(sfx.hasSynth(`shot.${id}`), id).toBe(true);
      expect(sfx.hasSynth(`shot.${id}.sup`), id).toBe(true);
      expect(killfeedIcons.has(id), id).toBe(true);
      expect(MACHINE_PISTOL_ICONS[id], id).toBeDefined();
      const rects: number[][] = [];
      const g = { fillStyle: '', fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]) } as unknown as CanvasRenderingContext2D;
      const w = killfeedIcons.get(id)!(g, 200, 10, 2);
      expect(w, id).toBe(24);
      expect(rects.length, id).toBeGreaterThanOrEqual(4);
      for (const [x] of rects) expect(x!, id).toBeLessThanOrEqual(200);
    }
  });

  it('venom status: doses while it lasts, none after', () => {
    const m = { serverTime: 10 } as unknown as Match;
    papFxState.venom.set('v', { until: 12, n: 3 });
    expect(venomDoses(m, 'v')).toBe(3);
    expect(venomDoses({ serverTime: 12.5 } as unknown as Match, 'v')).toBe(0);
    expect(venomDoses(m, 'nobody')).toBe(0);
    papFxState.venom.clear();
  });
});
