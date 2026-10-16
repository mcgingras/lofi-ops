/**
 * The grenade indicator (pure, client `weapons/danger.ts`): which live lethals get a marker on the
 * ring around the crosshair, and where it points. A frag or semtex that can hurt you (an enemy's,
 * or your own) inside its kill radius plus the margin; never a teammate's, a tactical or a launcher
 * round; within the height band; a semtex stuck to you always.
 */
import { describe, expect, it } from 'vitest';
import { dangerRingPos, grenadeDangers, indicatorRange, type DangerNade, type DangerViewer } from '../src/client/features/weapons/danger';
import { EQUIPMENT_BY_ID, GRENADE_INDICATOR, killRadius } from '../src/shared/defs/equipment';

const FRAG = EQUIPMENT_BY_ID.get('frag')!;
const SEMTEX = EQUIPMENT_BY_ID.get('semtex')!;
const me = (o: Partial<DangerViewer> = {}): DangerViewer => ({ x: 0, y: 1.6, z: 0, yaw: 0, id: 'me', canHurt: (owner) => owner === 'me' || owner === 'enemy', ...o });
const nade = (o: Partial<DangerNade>): DangerNade => ({ x: 0, y: 0.1, z: -3, equip: 'frag', owner: 'enemy', ...o });

describe('grenade indicator', () => {
  it('range is the kill radius plus the margin, for lethal explosives only', () => {
    // BO1's cg_hudGrenadeIconMaxRangeFrag 250 units, or the kill radius plus the margin if further.
    expect(GRENADE_INDICATOR.range).toBeCloseTo(6.35, 9);
    expect(indicatorRange('frag')).toBeCloseTo(Math.max(6.35, killRadius(FRAG) + GRENADE_INDICATOR.margin), 9);
    expect(indicatorRange('semtex')).toBeCloseTo(Math.max(6.35, killRadius(SEMTEX) + GRENADE_INDICATOR.margin), 9);
    expect(indicatorRange('frag')).toBeGreaterThan(killRadius(FRAG));
    for (const id of ['flashbang', 'concussion', 'tomahawk', 'gl', 'bogus']) expect(indicatorRange(id), id).toBe(0);
    expect(killRadius(FRAG)).toBeGreaterThan(3);
  });

  it('shows an enemy or your own frag in range, never a teammate one', () => {
    const near = killRadius(FRAG) * 0.8;
    expect(grenadeDangers([nade({ z: -near })], me())).toHaveLength(1);
    expect(grenadeDangers([nade({ z: -near, owner: 'me' })], me())).toHaveLength(1);
    expect(grenadeDangers([nade({ z: -near, owner: 'mate' })], me())).toHaveLength(0);
    // A grenade from someone who left still hurts (no owner known): canHurt decides.
    expect(grenadeDangers([nade({ z: -near, owner: null })], me({ canHurt: () => true }))).toHaveLength(1);
  });

  it('stops at the range and at the height band', () => {
    const range = indicatorRange('frag');
    const flat = (d: number) => nade({ y: 1.6, z: -d });
    expect(grenadeDangers([flat(range - 0.05)], me())).toHaveLength(1);
    expect(grenadeDangers([flat(range + 0.05)], me())).toHaveLength(0);
    expect(grenadeDangers([nade({ y: 1.6 + GRENADE_INDICATOR.maxHeight + 0.2, z: -1 })], me())).toHaveLength(0);
    expect(grenadeDangers([nade({ y: 1.6 - GRENADE_INDICATOR.maxHeight - 0.2, z: -1 })], me())).toHaveLength(0);
  });

  it('red inside the kill radius, yellow in the margin; nearest first', () => {
    const kr = killRadius(FRAG);
    const marks = grenadeDangers([nade({ y: 1.6, z: -(kr + (indicatorRange('frag') - kr) * 0.5) }), nade({ y: 1.6, x: kr * 0.5, z: 0 })], me());
    expect(marks.map((m) => m.lethal)).toEqual([true, false]);
    expect(marks[1]!.dist).toBeGreaterThan(kr);
    expect(marks[0]!.dist).toBeLessThan(marks[1]!.dist);
  });

  it('points at the grenade: ahead is up, right is right, behind is down, turning with the view', () => {
    const at = (x: number, z: number, yaw = 0) => grenadeDangers([nade({ x, z, y: 1.6 })], me({ yaw }))[0]!.angle;
    expect(at(0, -2)).toBeCloseTo(0, 6); // yaw 0 looks down -z
    expect(at(2, 0)).toBeCloseTo(Math.PI / 2, 6);
    expect(at(-2, 0)).toBeCloseTo(-Math.PI / 2, 6);
    expect(Math.abs(at(0, 2))).toBeCloseTo(Math.PI, 6);
    // Turn to face +x (yaw -PI/2): the grenade at +x is now dead ahead.
    expect(at(2, 0, -Math.PI / 2)).toBeCloseTo(0, 6);
    const up = dangerRingPos(0, 100, 100, 30, 9);
    expect(up).toMatchObject({ x: 100, y: 70, tipX: 100, tipY: 61 });
    const right = dangerRingPos(Math.PI / 2, 100, 100, 30, 9);
    expect(right.x).toBeCloseTo(130, 6);
    expect(right.y).toBeCloseTo(100, 6);
  });

  it('a semtex stuck to you always shows, red, whoever threw it', () => {
    const marks = grenadeDangers([nade({ equip: 'semtex', owner: 'mate', stuckTo: 'me', y: 1.2, z: 0.2 })], me());
    expect(marks).toHaveLength(1);
    expect(marks[0]!.lethal).toBe(true);
  });
});
