/**
 * Bullet penetration (src/shared/penetration.ts, combat `traceShot`): per-type depth limits, the
 * materials, damage kept, max walls, range, Hardened, shotguns and launchers, human vs bot shots,
 * the feedback flags and the replay's wall points.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { botBrain } from '../src/server/features/bots/api';
import { registerPerkModifiers } from '../src/server/features/perks/index';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { CollisionWorld, type Solid } from '../src/shared/collision';
import { packClip, unpackClip } from '../src/shared/defs/deathcam';
import { PERK_TUNING } from '../src/shared/defs/perks';
import { WEAPON_BY_ID, WEAPONS } from '../src/shared/defs/weapons';
import { getMapData } from '../src/shared/defs/maps';
import { box, type MapData } from '../src/shared/maps/types';
import { normalize, type Vec3 } from '../src/shared/math';
import { effectiveDistance, keepAt, materialByName, PENETRATION, penetrationMaterial, penetrationType, traceBullet, wallKeep, type PenetrationType } from '../src/shared/penetration';
import { addScripted, addShooter, place, steps, testRoom, type TestRoom } from './bots-walls';
import { solid } from './helpers';

const MATS = { wood: { texture: 'bo_planks' }, siding: { texture: 'nt_siding' }, concrete: { texture: 'bo_concrete' }, rock: { texture: 'bo_rock' }, corr: { texture: 'fr_corr' }, plaster: { texture: 'nt_plaster' }, glass: { texture: 'bo_glass' }, steel: { texture: 'steel' } };
const MAP = { materials: MATS } as unknown as MapData;
const matOf = (s: Solid) => penetrationMaterial(MAP, s.mat);

/** A wall `th` thick across the x axis starting at z, 10 m wide, 3 m tall. */
const wall = (mat: string, z: number, th: number) => solid({ x: -5, y: 0, z }, { x: 5, y: 3, z: z + th }, { mat });
const world = (...walls: Solid[]) => new CollisionWorld(walls);
const O: Vec3 = { x: 0, y: 1.5, z: -5 };
const D: Vec3 = { x: 0, y: 0, z: 1 };
const shoot = (w: CollisionWorld, type: PenetrationType, depthMultiplier = 1, range = 200) => traceBullet(w, matOf, O, D, { range, type, depthMultiplier });
const through = (mat: string, th: number, type: PenetrationType, depthMultiplier = 1) => shoot(world(wall(mat, 0, th)), type, depthMultiplier).walls.length === 1;

describe('penetration: types and materials', () => {
  it('every weapon has BO1\'s type for its class: pistols/SMGs small, ARs/LMGs medium, snipers large, shotguns pellet, launchers and the knife none', () => {
    const want: Record<string, PenetrationType> = { pistol: 'small', smg: 'small', ar: 'medium', lmg: 'medium', sniper: 'large', shotgun: 'pellet', launcher: 'none', special: 'none' };
    for (const w of WEAPONS) expect({ id: w.id, type: penetrationType(w) }).toEqual({ id: w.id, type: want[w.class] });
    expect(PENETRATION.depth.none).toBe(0);
    expect(PENETRATION.depth.pellet).toBeLessThan(PENETRATION.depth.small);
    expect(PENETRATION.depth.small).toBeLessThan(PENETRATION.depth.medium);
    expect(PENETRATION.depth.medium).toBeLessThan(PENETRATION.depth.large);
  });

  it('materials by texture, then material id: drywall/sheet metal easy, wood the reference, concrete hard, rock/steel/glass/clips solid, unknown masonry', () => {
    const cases: Record<string, string> = {
      bo_planks: 'wood', fr_ply: 'wood', nt_siding: 'wood', nt_woodfence: 'wood', crate: 'wood', jg_bamboo: 'wood',
      nt_plaster: 'soft', term_wall: 'soft', hn_plaster: 'soft', bo_fabric: 'soft', term_carpet: 'soft',
      fr_corr: 'sheet', fr_tin: 'sheet', container2: 'sheet', rust_trailer: 'sheet', bo_carpaint: 'sheet',
      bo_concrete: 'masonry', nt_brick: 'masonry', fr_block: 'masonry', term_facade: 'masonry', term_floor: 'masonry',
      bo_rock: 'solid', hn_stone: 'solid', afg_ground: 'solid', bo_sandbag: 'solid', steel: 'solid', rust_beam: 'solid', bo_glass: 'solid', none: 'solid', gltf: 'solid',
    };
    for (const [name, cls] of Object.entries(cases)) expect({ name, cls: materialByName(name) ?? 'masonry' }).toEqual({ name, cls });
    const map = { materials: { a: { texture: 'mystery' }, wood: { texture: 'mystery' } } } as unknown as MapData;
    expect(penetrationMaterial(map, 'a')).toBe('masonry');
    expect(penetrationMaterial(map, 'wood')).toBe('wood');
  });
});

describe('penetration: depth limits', () => {
  it('a pistol (small) goes through 10 cm of wood, not 30 cm; a sniper (large) through 30 cm; an AR (medium) through a 25 cm house wall, not 35 cm', () => {
    expect(through('wood', 0.1, 'small')).toBe(true);
    expect(through('wood', 0.3, 'small')).toBe(false);
    expect(through('wood', 0.3, 'large')).toBe(true);
    expect(through('siding', 0.25, 'medium')).toBe(true);
    expect(through('wood', 0.35, 'medium')).toBe(false);
  });

  it('drywall and sheet metal are easy (an SMG through a 25 cm drywall wall and 20 cm of corrugated sheet)', () => {
    expect(through('plaster', 0.25, 'small')).toBe(true);
    expect(through('corr', 0.2, 'small')).toBe(true);
  });

  it('nothing goes through a concrete wall, rock, steel or bullet-stopping glass, not even a Hardened sniper', () => {
    for (const [mat, th] of [['concrete', 0.15], ['concrete', 0.3], ['rock', 0.1], ['steel', 0.05], ['glass', 0.03]] as const)
      for (const type of ['small', 'medium', 'large'] as const) {
        const path = shoot(world(wall(mat, 0, th)), type, PERK_TUNING.hardenedPenetration);
        expect({ mat, th, type, walls: path.walls.length, t: path.t }).toEqual({ mat, th, type, walls: 0, t: 5 });
      }
  });

  it('a wall is measured entry to exit along the ray: a pistol passes 10 cm of wood square on, not at a steep angle', () => {
    const w = world(wall('wood', 0, 0.12));
    expect(traceBullet(w, matOf, O, D, { range: 200, type: 'small' }).walls[0]!.thickness).toBeCloseTo(0.12, 6);
    const slant = normalize({ x: 0.8, y: 0, z: 0.6 });
    const o = { x: -3, y: 1.5, z: -4 };
    const p = traceBullet(w, matOf, o, slant, { range: 200, type: 'small' });
    expect(p.walls).toEqual([]);
    expect(p.hit?.solid.mat).toBe('wood');
  });

  it('brushes that touch or overlap are one wall: two 10 cm boards back to back stop a pistol, an AR passes them as one', () => {
    const w = world(wall('wood', 0, 0.1), wall('wood', 0.1, 0.1));
    expect(shoot(w, 'small').walls).toEqual([]);
    const ar = shoot(w, 'medium');
    expect(ar.walls.length).toBe(1);
    expect(ar.walls[0]!.thickness).toBeCloseTo(0.2, 6);
    // Wood in front of concrete: the concrete stops it.
    expect(shoot(world(wall('wood', 0, 0.05), wall('concrete', 0.05, 0.2)), 'large', 2).walls).toEqual([]);
  });
});

describe('penetration: damage, range, walls', () => {
  it('each wall keeps 0.75 of the damage (paper thin) down to 0.5 (at the limit); an AR through a 25 cm house wall or 10 cm of wood keeps about half to two thirds', () => {
    expect(wallKeep(0, 0.3)).toBe(PENETRATION.maxKeep);
    expect(wallKeep(0.3, 0.3)).toBe(PENETRATION.minKeep);
    expect(PENETRATION.maxKeep).toBe(0.75);
    expect(PENETRATION.minKeep).toBe(0.5);
    const house = shoot(world(wall('siding', 0, 0.25)), 'medium').walls[0]!;
    expect(house.keep).toBeGreaterThanOrEqual(0.5);
    expect(house.keep).toBeLessThan(0.6);
    const board = shoot(world(wall('wood', 0, 0.1)), 'medium').walls[0]!;
    expect(board.keep).toBeGreaterThan(0.6);
    expect(board.keep).toBeLessThan(0.7);
    const sheet = shoot(world(wall('corr', 0, 0.2)), 'medium').walls[0]!;
    expect(sheet.keep).toBeCloseTo(wallKeep(0.1, PENETRATION.depth.medium), 6);
  });

  it('at most two walls per bullet; the damage kept multiplies', () => {
    const w = world(wall('wood', 0, 0.05), wall('wood', 1, 0.05), wall('wood', 2, 0.05));
    const p = shoot(w, 'large');
    expect(PENETRATION.maxWalls).toBe(2);
    expect(p.walls.length).toBe(2);
    expect(p.t).toBeCloseTo(7, 6); // stopped by the third
    expect(keepAt(p.walls, 6.5)).toBeCloseTo(p.walls[0]!.keep * p.walls[1]!.keep, 9);
    expect(keepAt(p.walls, 5.5)).toBeCloseTo(p.walls[0]!.keep, 9);
    expect(keepAt(p.walls, 4)).toBe(1);
  });

  it('range drops after a wall: every metre past it counts double for falloff, and the bullet stops at the shortened range', () => {
    const p = shoot(world(wall('wood', 0, 0.05)), 'medium', 1, 25);
    const out = p.walls[0]!.tOut;
    expect(out).toBeCloseTo(5.05, 6);
    expect(p.t).toBeCloseTo(out + (25 - out) / PENETRATION.rangeStretch, 6);
    expect(effectiveDistance(p.walls, 10)).toBeCloseTo(10 + (10 - out) * (PENETRATION.rangeStretch - 1), 6);
    expect(effectiveDistance(p.walls, 4)).toBe(4);
    expect(effectiveDistance([], 30)).toBe(30);
  });

  it('Hardened doubles the depth (a pistol through 25 cm of wood) and loses less damage through the same wall', () => {
    expect(PERK_TUNING.hardenedPenetration).toBe(2);
    expect(through('wood', 0.25, 'small')).toBe(false);
    expect(through('wood', 0.25, 'small', 2)).toBe(true);
    expect(through('wood', 0.55, 'medium', 2)).toBe(true);
    const plain = shoot(world(wall('wood', 0, 0.12)), 'medium').walls[0]!.keep;
    const hard = shoot(world(wall('wood', 0, 0.12)), 'medium', 2).walls[0]!.keep;
    expect(hard).toBeGreaterThan(plain);
    expect(1 - hard).toBeLessThan((1 - plain) * 0.9);
  });

  it('shotgun pellets barely penetrate (a 3 cm board, not 10 cm); launchers and the knife never do', () => {
    expect(through('wood', 0.03, 'pellet')).toBe(true);
    expect(through('wood', 0.1, 'pellet')).toBe(false);
    expect(through('wood', 0.01, 'none')).toBe(false);
    expect(penetrationType(WEAPON_BY_ID.get('gl')!)).toBe('none');
    expect(penetrationType(WEAPON_BY_ID.get('knife')!)).toBe('none');
    expect(penetrationType(WEAPON_BY_ID.get('spas12')!)).toBe('pellet');
  });

  it('a wall beyond the range is not penetrated; no wall: the range', () => {
    expect(shoot(world(), 'medium', 1, 50).t).toBe(50);
    expect(shoot(world(wall('wood', 0, 0.05)), 'medium', 1, 4).walls).toEqual([]);
  });

  it('the replay keeps the wall points (deathcam clip round trip)', () => {
    const shots = [{ t: 1.5, id: 'a', end: [1, 2, 3] as [number, number, number], hit: true, pen: [[0, 1.5, 0] as [number, number, number], [0, 1.5, 0.1] as [number, number, number]] }, { t: 1.6, id: 'a', end: [4, 5, 6] as [number, number, number], hit: false }];
    const back = unpackClip(packClip([{ t: 1, p: [['a', 0, 0, 0, 0, 0, 0, 100]] }], shots)).shots;
    expect(back[0]!.pen).toEqual([[0, 1.5, 0], [0, 1.5, 0.1]]);
    expect(back[1]!.pen).toBeUndefined();
    expect(back[1]!.hit).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// In a room: human and bot shots, Hardened, the flags.

/** Walls across x at z = -5 (each 2 m wide), the shooter at z = +1, the target at z = -6.2. */
const LANES = [
  { mat: 'wood', th: 0.1, x: -12 },
  { mat: 'wood', th: 0.3, x: -8 },
  { mat: 'concrete', th: 0.2, x: -4 },
  { mat: 'rock', th: 0.5, x: 0 },
  { mat: 'corr', th: 0.15, x: 4 },
  { mat: 'siding', th: 0.25, x: 8 },
] as const;

function laneMap(): MapData {
  const sp = (x: number, z: number, yaw = 0) => ({ x, y: 0, z, yaw });
  const base = getMapData('yard');
  return {
    ...base,
    id: 'test_pen',
    name: 'Test Penetration',
    bounds: { min: { x: -20, y: -2, z: -20 }, max: { x: 20, y: 12, z: 20 } },
    materials: { ground: { texture: 'ground' }, ...MATS },
    brushes: [{ min: { x: -21, y: -1, z: -21 }, max: { x: 21, y: 0, z: 21 }, mat: 'ground' }, ...LANES.map((l) => box(2, 2.4, l.th, l.mat, l.x, 0, -5 + l.th / 2))],
    decals: [],
    props: [],
    lights: [],
    spawns: { teams: [[sp(0, 15)], [sp(0, -15, Math.PI)]], ffa: [sp(0, 15), sp(0, -15, Math.PI)] },
    objectives: {},
    hotspots: undefined,
  };
}

const open: TestRoom[] = [];
afterEach(() => {
  for (const t of open.splice(0)) t.close();
});
function laneRoom() {
  const t = testRoom(laneMap());
  open.push(t);
  steps(t.room, 0.1);
  const r = t.room;
  const still = (_r: Room, self: PlayerState) => ({ buttons: 0, yaw: self.yaw });
  const target = addScripted(r, 1, { x: 0, y: 0, z: -6.2 }, still, 'Target');
  const shooter = addScripted(r, 0, { x: 0, y: 0, z: 1 }, still, 'Shooter');
  r.modifiers.add('spreadMultiplier', (p) => (p === shooter ? 0 : undefined), 'test.nospread');
  return { r, target, shooter };
}

/** Shooter at z = +1 in `lane`, target behind its wall; one shot at the chest. Returns damage events. */
function shotAt(r: Room, shooter: PlayerState, target: PlayerState, x: number, weapon = 'ak47', o: { time?: number; health?: number } = {}) {
  place(r, target, { x, y: 0, z: -6.2 }, 0);
  if (o.health !== undefined) target.health = o.health;
  place(r, shooter, { x, y: 0, z: 1 }, 0);
  shooter.weapons[0] = makeWeapon({ weapon, attachments: [], camo: 'none' }, 'ak47');
  shooter.slot = 0;
  shooter.swapEnd = 0;
  shooter.reloadEnd = 0;
  shooter.weapons[0]!.credit = 2;
  const got: { amount: number; penetrated: boolean; health: number }[] = [];
  const off = r.bus.on('damage', (e) => {
    if (e.victim === target) got.push({ amount: e.amount, penetrated: !!e.penetrated, health: e.health });
  });
  const eye = { x, y: 1.6, z: 1 };
  r.fire(shooter, { dir: normalize({ x: 0, y: 1.15 - eye.y, z: -6.2 - eye.z }), ...(o.time !== undefined ? { time: o.time } : {}) });
  off();
  return got;
}

describe('penetration in a room', () => {
  it('a human\'s AK: through 10 cm of wood, a 25 cm house wall and sheet metal at reduced damage; not 30 cm of wood, concrete or rock', () => {
    const { r, target, shooter } = laneRoom();
    shooter.isBot = false;
    const ak = WEAPON_BY_ID.get('ak47')!;
    const res = Object.fromEntries(LANES.map((l) => [`${l.mat}${l.th}`, shotAt(r, shooter, target, l.x)]));
    for (const k of ['wood0.3', 'concrete0.2', 'rock0.5']) expect({ k, hits: res[k] }).toEqual({ k, hits: [] });
    for (const k of ['wood0.1', 'siding0.25', 'corr0.15']) {
      expect(res[k]!.length).toBe(1);
      expect(res[k]![0]!.penetrated).toBe(true);
      expect(res[k]![0]!.amount).toBeLessThanOrEqual(ak.damage.near * 0.75 + 1e-9);
      expect(res[k]![0]!.amount).toBeGreaterThanOrEqual(ak.damage.near * 0.5 - 1e-9);
    }
    // The house wall: about half.
    expect(res['siding0.25']![0]!.amount / ak.damage.near).toBeLessThan(0.6);
    // No wall: full damage, not flagged.
    place(r, target, { x: 14, y: 0, z: -6.2 });
    const clear = shotAt(r, shooter, target, 14);
    expect(clear).toEqual([{ amount: ak.damage.near, penetrated: false, health: 100 - ak.damage.near }]);
  });

  it('a pistol stops at 30 cm of wood where a sniper rifle goes through', () => {
    const { r, target, shooter } = laneRoom();
    shooter.isBot = false;
    expect(shotAt(r, shooter, target, -8, 'm1911')).toEqual([]);
    expect(shotAt(r, shooter, target, -12, 'm1911').length).toBe(1);
    expect(shotAt(r, shooter, target, -8, 'l96a1')[0]?.penetrated).toBe(true);
  });

  it('a bot\'s bullets stop on the first wall (bots fire only with a clear path)', () => {
    const { r, target, shooter } = laneRoom();
    expect(shooter.isBot).toBe(true);
    for (const l of LANES) expect({ lane: l.mat, hits: shotAt(r, shooter, target, l.x) }).toEqual({ lane: l.mat, hits: [] });
  });

  it('Hardened (the perk\'s penetrationMultiplier) gets an SMG through 25 cm and keeps more damage', () => {
    const { r, target, shooter } = laneRoom();
    shooter.isBot = false;
    registerPerkModifiers(r);
    expect(shotAt(r, shooter, target, 8, 'mp5k')).toEqual([]);
    const plain = shotAt(r, shooter, target, -12)[0]!.amount;
    shooter.loadout = { ...shooter.loadout, perks: ['hardened'] };
    expect(r.modifiers.mul('penetrationMultiplier', shooter)).toBe(2);
    expect(shotAt(r, shooter, target, 8, 'mp5k')[0]?.penetrated).toBe(true);
    expect(shotAt(r, shooter, target, -12)[0]!.amount).toBeGreaterThan(plain);
  });

  it('a kill through a wall: hit and killfeed flagged, the death event says penetrated, the shot carries the wall points', () => {
    const { r, target, shooter } = laneRoom();
    shooter.isBot = false;
    const sent: unknown[] = [];
    const broadcast = r.broadcast.bind(r);
    r.broadcast = ((m: { t: string }) => {
      if (m.t === 'killfeed') sent.push(m);
      broadcast(m as never);
    }) as typeof r.broadcast;
    const hits: unknown[] = [];
    shooter.session = { send: (m: { t: string }) => m.t === 'hit' && hits.push(m) } as never;
    let death: { penetrated?: boolean } | null = null;
    r.bus.on('death', (e) => {
      if (e.victim === target) death = e;
    });
    const fires: { walls?: Vec3[] }[] = [];
    r.bus.on('fire', (e) => fires.push(e));
    const recorded: { x?: number[] }[] = [];
    const rec = r.recordShot.bind(r);
    r.recordShot = (s) => (recorded.push(s), rec(s));
    const got = shotAt(r, shooter, target, -12, 'ak47', { health: 10 });
    shooter.session = null;
    expect(got[0]!.health).toBe(0);
    expect(death).toMatchObject({ penetrated: true });
    expect(hits).toEqual([expect.objectContaining({ kill: true, pen: true })]);
    expect(sent).toEqual([expect.objectContaining({ victim: target.id, pen: true })]);
    // Entry and exit of the 10 cm board, for the impact puffs and the killcam.
    expect(fires.at(-1)!.walls!.map((v) => Math.round(v.z * 100) / 100)).toEqual([-4.9, -5]);
    expect(recorded.at(-1)!.x!.length).toBe(6);
  });

  it('lag compensation: a human shot through a wall hits where the target was at the shooter\'s view time', () => {
    const { r, target, shooter } = laneRoom();
    shooter.isBot = false;
    place(r, target, { x: -12, y: 0, z: -6.2 });
    steps(r, 0.3);
    const before = r.time;
    // The target walks out of the lane (2 m to the side) before the shot arrives.
    place(r, target, { x: -15, y: 0, z: -6.2 });
    steps(r, 0.1);
    target.move = { ...target.move, x: -15 };
    const shooterAt = { x: -12, y: 0, z: 1 };
    place(r, shooter, shooterAt, 0);
    shooter.weapons[0] = makeWeapon({ weapon: 'ak47', attachments: [], camo: 'none' }, 'ak47');
    shooter.swapEnd = 0;
    shooter.weapons[0]!.credit = 2;
    const got: boolean[] = [];
    r.bus.on('damage', (e) => e.victim === target && got.push(!!e.penetrated));
    const eye = { x: -12, y: 1.6, z: 1 };
    r.fire(shooter, { dir: normalize({ x: 0, y: 1.15 - eye.y, z: -6.2 - eye.z }), time: before - 0.02 });
    expect(got).toEqual([true]);
  });
});

describe('penetration and bots', () => {
  it('a bot never fires at a player it cannot see behind a thin wooden wall, though that player\'s shots go through it', () => {
    const t = testRoom(laneMap(), 'veteran');
    open.push(t);
    const r = t.room;
    steps(r, 0.1);
    const player = addScripted(r, 1, { x: -12, y: 0, z: -6.2 }, (_r, self) => ({ buttons: 0, yaw: self.yaw }));
    player.isBot = false;
    const bot = addShooter(r, 0, { x: -12, y: 0, z: 2 }, { x: -12, y: 0, z: -6.2 });
    const brain = botBrain(r, bot)!;
    brain.forced = { at: { ...bot.move }, radius: 0.05, hold: true };
    let fired = 0;
    let hurt = 0;
    r.bus.on('fire', (e) => e.player === bot && fired++);
    r.bus.on('damage', (e) => e.victim === player && hurt++);
    steps(r, 3);
    expect(brain.target).not.toBe(player);
    expect({ fired, hurt }).toEqual({ fired: 0, hurt: 0 });
    // And the player's shot through the same wall lands.
    player.weapons[0] = makeWeapon({ weapon: 'ak47', attachments: [], camo: 'none' }, 'ak47');
    player.swapEnd = 0;
    player.reloadEnd = 0;
    player.weapons[0]!.credit = 2;
    r.modifiers.add('spreadMultiplier', (p) => (p === player ? 0 : undefined), 'test.nospread');
    let landed = false;
    r.bus.on('damage', (e) => e.victim === bot && e.penetrated && (landed = true));
    const eye = { x: player.move.x, y: player.move.y + 1.6, z: player.move.z };
    r.fire(player, { dir: normalize({ x: bot.move.x - eye.x, y: bot.move.y + 1.15 - eye.y, z: bot.move.z - eye.z }) });
    expect(landed).toBe(true);
  });
});
