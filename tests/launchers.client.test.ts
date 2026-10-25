/**
 * The launchers on the client: the five models build through the kit (plain and with a camo) with
 * the moving parts their animations need (China Lake pump, RPG warhead), the sounds are registered
 * (shots, lock tones, booms), killfeed icons and shot looks exist, the boom sizes follow the
 * blasts, and the lock tone quickens as the lock closes.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FURNITURE, GUNS, Kit } from '../src/client/features/weapons/gunkit';
import '../src/client/features/weapons/index';
import { launcherBlast, blastFeel } from '../src/client/features/weapons/camfx';
import { seekInterval } from '../src/client/features/weapons/launchers/index';
import { sfx } from '../src/client/game/audio';
import { killfeedIcons, shotFxs, entityRenderers } from '../src/client/registry';
import { LAUNCHER_ENTITY, LAUNCHER_IDS, LAUNCHERS } from '../src/shared/defs/launchers';
import { WEAPON_BY_ID } from '../src/shared/defs/weapons';

const mat = () => new THREE.MeshBasicMaterial();
function build(model: string, camo: string | null = null) {
  const root = new THREE.Group();
  const kit = new Kit(root, mat, camo, FURNITURE[model] ?? 'poly');
  const b = GUNS[model]!(kit, []);
  return { b, box: new THREE.Box3().setFromObject(root), meshes: root.children.length };
}

describe('launcher models', () => {
  it('each builds plain and with a camo: muzzle out front, sights above the bore, two hands', () => {
    for (const id of LAUNCHER_IDS) {
      const model = WEAPON_BY_ID.get(id)!.model;
      for (const camo of [null, 'camo.tiger']) {
        const { b, box, meshes } = build(model, camo);
        const tag = `${id} ${camo}`;
        expect(meshes, tag).toBeGreaterThan(8);
        expect(b.muzzle.z, tag).toBeLessThan(-0.4);
        expect(b.muzzle.z, tag).toBeGreaterThanOrEqual(box.min.z - 0.05);
        expect(b.sightY, tag).toBeGreaterThan(b.muzzle.y);
        expect(b.grip.z, tag).toBeGreaterThan(b.fore.z);
        expect(b.pistol, tag).toBe(false);
      }
    }
    expect(build('china_lake').b.parts.pump).toBeDefined();
    expect(build('rpg').b.parts.mag).toBeDefined();
    // The RPG is the long one, the LAW short.
    const len = (id: string) => {
      const { box } = build(id);
      return box.max.z - box.min.z;
    };
    expect(len('rpg')).toBeGreaterThan(len('m72law'));
  });
});

describe('launcher sounds, icons, looks', () => {
  it('shots, lock tones and booms are registered; icons and shot looks for each', () => {
    const ids = new Set(sfx.registeredIds());
    for (const id of LAUNCHER_IDS) {
      expect(ids.has(`shot.${id}`), id).toBe(true);
      expect(killfeedIcons.has(id), id).toBe(true);
      expect(shotFxs.has(id), id).toBe(true);
    }
    for (const id of ['weapons.lock.seek', 'weapons.lock.on', 'weapons.rocketboom', 'weapons.rocketboom.big', 'weapons.dud', 'weapons.rocket.whoosh']) expect(ids.has(id), id).toBe(true);
    expect(entityRenderers.has(LAUNCHER_ENTITY)).toBe(true);
  });

  it('booms are sized by the blast: an RPG rattles you from further than a frag; flak none', () => {
    expect(launcherBlast('rpg')).toEqual(LAUNCHERS.rpg!.blast);
    expect(launcherBlast('china_lake.bomblet')!.radius).toBeLessThan(LAUNCHERS.china_lake!.blast.radius);
    expect(launcherBlast('frag')).toBeNull();
    expect(blastFeel('rpg', 5)[0]).toBe(1);
    expect(blastFeel('frag', 5.5)[0]).toBeLessThan(1);
    expect(blastFeel('stinger.flak', 1)).toEqual([0, 0]);
  });

  it('the seeking tone quickens as the lock closes', () => {
    expect(seekInterval(0)).toBeGreaterThan(seekInterval(0.5));
    expect(seekInterval(0.5)).toBeGreaterThan(seekInterval(1));
    expect(seekInterval(1)).toBeCloseTo(0.1);
  });
});
