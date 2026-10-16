/**
 * Lethal grenades at BO1 strength: the numbers (kill radius, falloff), the blast's reach rules
 * (distance to the body's box; walls stop it, thin props and fences don't), Flak Jacket, a stuck
 * semtex always killing, self damage and teammates, and the bots' throwing (rate, distance,
 * scatter, aim).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BOT_GRENADE, grenadeAimPoint, grenadeChance, grenadeCooldown, grenadePitch, grenadeScatter, minThrowDistance } from '../src/server/features/bots/grenades';
import perksFeature from '../src/server/features/perks/index';
import weaponsFeature, { explode, startThrow } from '../src/server/features/weapons/index';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { BLAST, blastDistance, blastReaches, type BlastBody } from '../src/shared/blast';
import { PLAYER, TICK_DT } from '../src/shared/constants';
import { BOT_DIFFICULTIES } from '../src/shared/defs/bots';
import { blastDamage, EQUIPMENT_BY_ID, killRadius, NADE_ENTITY, NADE_PHYSICS } from '../src/shared/defs/equipment';
import { PERK_TUNING } from '../src/shared/defs/perks';
import { throwVelocity } from '../src/shared/projectile';
import { createMoveState } from '../src/shared/movement';
import { viewDir } from '../src/shared/math';
import { flatWorld, solid } from './helpers';

const FRAG = EQUIPMENT_BY_ID.get('frag')!;
const SEMTEX = EQUIPMENT_BY_ID.get('semtex')!;

/** The chosen BO1-derived numbers (docs/features/weapons.md, "Lethal grenades"). */
const CHOSEN = {
  frag: { radius: 6.5, max: 200, min: 50, fuse: 3.5, killRadius: 4.33 },
  semtex: { radius: 6.5, max: 200, min: 50, fuse: 2.5, killRadius: 4.33 },
};

let store: Store | undefined;
let lobby: Lobby | undefined;
afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = store = undefined;
});
function setup(): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [weaponsFeature, perksFeature], log: () => {}, autoTick: false });
  const room = lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
  room.world = flatWorld();
  return room;
}
const steps = (room: Room, s: number) => {
  for (let i = 0; i < Math.round(s / TICK_DT); i++) room.step();
};
function body(room: Room, team: 0 | 1, x: number, z: number, perks: string[] = []): PlayerState {
  const p = room.addBot({ team });
  if (perks.length && p.loadout) p.loadout = { ...p.loadout, perks };
  if (!p.alive) room.spawn(p);
  p.move = { ...createMoveState(x, 0, z), onGround: true };
  p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: 0 }) };
  return p;
}
const boxOf = (p: PlayerState): BlastBody => ({ x: p.move.x, y: p.move.y, z: p.move.z, radius: PLAYER.radius, height: PLAYER.height });
/** A blast `d` metres from the side of a standing body's box, at the floor (a grenade lying there). */
const beside = (p: PlayerState, d: number) => ({ x: p.move.x + PLAYER.radius + d, y: 0.1, z: p.move.z });

describe('BO1 numbers', () => {
  it('frag and semtex use the chosen profile, fuse and kill radius', () => {
    for (const [id, c] of Object.entries(CHOSEN)) {
      const def = EQUIPMENT_BY_ID.get(id)!;
      expect({ radius: def.radius, max: def.max, min: def.min, fuse: def.fuse }, id).toEqual({ radius: c.radius, max: c.max, min: c.min, fuse: c.fuse });
      expect(killRadius(def), id).toBeCloseTo(c.killRadius, 2);
    }
    expect(FRAG.cookable).toBe(true);
    expect(SEMTEX.cookable).toBe(false);
    expect(SEMTEX.sticky).toBe(true);
  });

  it('falloff is linear from the inner damage at the centre to the outer at the edge, nothing beyond', () => {
    expect(blastDamage(FRAG, 0)).toBe(FRAG.max);
    expect(blastDamage(FRAG, FRAG.radius)).toBeCloseTo(FRAG.min, 9);
    expect(blastDamage(FRAG, FRAG.radius / 2)).toBeCloseTo((FRAG.max + FRAG.min) / 2, 9);
    expect(blastDamage(FRAG, FRAG.radius + 0.01)).toBe(0);
    const a = blastDamage(FRAG, 1) - blastDamage(FRAG, 2);
    const b = blastDamage(FRAG, 4) - blastDamage(FRAG, 5);
    expect(a).toBeCloseTo(b, 9);
    expect(killRadius({ radius: 5, max: 90, min: 10 })).toBe(0);
    expect(killRadius({ radius: 5, max: 300, min: 150 })).toBe(5);
  });
});

describe('blast reach (shared/blast.ts)', () => {
  const b: BlastBody = { x: 0, y: 0, z: 0, radius: 0.3, height: 1.8 };
  it('distance is to the nearest point of the box', () => {
    expect(blastDistance({ x: 0, y: 0.1, z: 0 }, b)).toBe(0);
    expect(blastDistance({ x: 2.3, y: 0.1, z: 0 }, b)).toBeCloseTo(2, 9);
    expect(blastDistance({ x: 0, y: 3.8, z: 0 }, b)).toBeCloseTo(2, 9);
    expect(blastDistance({ x: 3.3, y: 0.1, z: 4.3 }, b)).toBeCloseTo(5, 9);
  });

  it('a wall stops it; a post, a thin pillar or a fence does not', () => {
    const c = { x: 3, y: 0.1, z: 0 };
    expect(blastReaches(flatWorld(), c, b)).toBe(true);
    const wall = solid({ x: 1.4, y: 0, z: -3 }, { x: 1.6, y: 3, z: 3 });
    expect(blastReaches(flatWorld([wall]), c, b)).toBe(false);
    // A 15 cm post right on the line to the middle of the body.
    const post = solid({ x: 1.42, y: 0, z: -0.075 }, { x: 1.58, y: 3, z: 0.075 });
    expect(blastReaches(flatWorld([post]), c, b)).toBe(true);
    // A chain-link fence (bullets pass through it).
    const fence = solid({ x: 1.45, y: 0, z: -3 }, { x: 1.5, y: 2.5, z: 3 }, { bullets: false, sight: false });
    expect(blastReaches(flatWorld([fence]), c, b)).toBe(true);
    // Waist-high cover: the head still shows, so the blast reaches it (BO1 crouch behind it instead).
    const low = solid({ x: 1.4, y: 0, z: -3 }, { x: 1.6, y: 1.0, z: 3 });
    expect(blastReaches(flatWorld([low]), { x: 3, y: 0.1, z: 0 }, b)).toBe(true);
    expect(blastReaches(flatWorld([low]), { x: 3, y: 0.1, z: 0 }, { ...b, height: PLAYER.crouchHeight * 0.75 })).toBe(false);
  });

  it('a thin wall you stand against never lets a blast round it', () => {
    // A 5 cm plywood wall 0.32 m from the body's middle: the side points poke past it.
    const ply = solid({ x: 0.32, y: 0, z: -3 }, { x: 0.37, y: 3, z: 3 });
    expect(BLAST.spread).toBeGreaterThan(0.37);
    expect(blastReaches(flatWorld([ply]), { x: 2, y: 0.1, z: 0 }, b)).toBe(false);
  });
});

describe('grenades in a room', () => {
  it('a frag kills inside the kill radius and wounds outside it', () => {
    const room = setup();
    const a = body(room, 0, -10, 0);
    const kr = killRadius(FRAG);
    for (const [d, dies] of [[0, true], [kr - 0.2, true], [kr + 0.25, false], [FRAG.radius - 0.1, false]] as const) {
      const v = body(room, 1, 0, 0);
      explode(room, beside(v, d), FRAG, a.id);
      expect(v.alive, `d=${d}`).toBe(dies);
      if (!dies) expect(v.health).toBeCloseTo(100 - blastDamage(FRAG, blastDistance({ ...beside(v, d), y: 0.2 }, boxOf(v))), 0);
      room.removePlayer(v.id);
    }
    const far = body(room, 1, 0, 0);
    explode(room, beside(far, FRAG.radius + 0.2), FRAG, a.id);
    expect(far.health).toBe(100);
  });

  it('a wall between saves you; a pillar does not', () => {
    const room = setup();
    const a = body(room, 0, -10, 0);
    const v = body(room, 1, 0, 0);
    room.world = flatWorld([solid({ x: 0.9, y: 0, z: -3 }, { x: 1.1, y: 3, z: 3 })]);
    explode(room, beside(v, 1.2), FRAG, a.id);
    expect(v.health).toBe(100);
    room.world = flatWorld([solid({ x: 0.92, y: 0, z: -0.08 }, { x: 1.08, y: 3, z: 0.08 })]);
    explode(room, beside(v, 1.2), FRAG, a.id);
    expect(v.alive).toBe(false);
  });

  it('Flak Jacket (x0.65) survives a frag a few metres off that kills without it', () => {
    const room = setup();
    const a = body(room, 0, -10, 0);
    expect(PERK_TUNING.flakExplosive).toBe(0.65);
    // Between the plain and the Flak Jacket kill radius.
    const flakKr = killRadius({ ...FRAG, max: FRAG.max * PERK_TUNING.flakExplosive, min: FRAG.min * PERK_TUNING.flakExplosive });
    const d = (killRadius(FRAG) + flakKr) / 2;
    const plain = body(room, 1, 0, 0);
    explode(room, beside(plain, d), FRAG, a.id);
    expect(plain.alive).toBe(false);
    const flak = body(room, 1, 0, 0, ['flak_jacket']);
    explode(room, beside(flak, d), FRAG, a.id);
    expect(flak.alive).toBe(true);
    // Point blank still kills through Flak Jacket.
    explode(room, beside(flak, 0), FRAG, a.id);
    expect(flak.alive).toBe(false);
  });

  it('a semtex stuck to a player kills them, Flak Jacket or not, even at extra health', () => {
    const room = setup();
    const a = body(room, 0, -6, 0);
    const v = body(room, 1, 0, 0, ['flak_jacket']);
    v.maxHealth = v.health = 250;
    // Stuck on the back of their shoulder, the far side from the thrower.
    explode(room, { x: v.move.x + 0.3, y: 1.5, z: v.move.z }, SEMTEX, a.id, v.id);
    expect(v.alive).toBe(false);
    // The same blast unstuck at 250 health with Flak Jacket: hurt, alive.
    const w = body(room, 1, 0, 3, ['flak_jacket']);
    w.maxHealth = w.health = 250;
    explode(room, { x: w.move.x + 0.3, y: 1.5, z: w.move.z }, SEMTEX, a.id);
    expect(w.alive).toBe(true);
  });

  it('a thrown semtex sticks to the enemy it hits and kills them', () => {
    const room = setup();
    const a = body(room, 0, 0, 4);
    const v = body(room, 1, 0, 0, ['flak_jacket']);
    a.loadout = { ...a.loadout!, lethal: 'semtex' };
    room.spawn(a);
    a.move = { ...createMoveState(0, 0, 4), onGround: true };
    a.brain = { think: () => ({ buttons: 0, yaw: 0, pitch: Math.atan2(-0.5, 4), weaponSlot: 0 }) };
    room.step();
    expect(startThrow(room, a, 'lethal')).toBe(true);
    steps(room, 0.6);
    const e = room.entities.byKind(NADE_ENTITY)[0]!;
    expect(e.s?.p).toBe(v.id);
    steps(room, SEMTEX.fuse);
    expect(v.alive).toBe(false);
  });

  it('the thrower is hurt by their own frag; a teammate is not; an enemy is', () => {
    const room = setup();
    const a = body(room, 0, 0, 0);
    const mate = body(room, 0, 0, 2);
    const foe = body(room, 1, 0, -2);
    explode(room, { x: 0.6, y: 0.1, z: 0 }, FRAG, a.id);
    expect(a.alive).toBe(false);
    expect(mate.health).toBe(100);
    expect(foe.alive).toBe(false);
  });
});

describe('bots and grenades', () => {
  it('never throw where they would stand in their own blast', () => {
    expect(minThrowDistance('frag')).toBeGreaterThanOrEqual(killRadius(FRAG) + BOT_GRENADE.safety - 1e-9);
    expect(minThrowDistance('semtex')).toBeGreaterThanOrEqual(killRadius(SEMTEX) + BOT_GRENADE.safety - 1e-9);
    expect(minThrowDistance(null)).toBe(7);
  });

  it('throw rarely: at most one lethal per 16 s at the most aggressive, about one every 25-30 s regular', () => {
    for (const d of BOT_DIFFICULTIES) {
      const s = d.skill;
      expect(grenadeChance(s), d.id).toBeGreaterThan(0);
      expect(grenadeChance(s), d.id).toBeLessThanOrEqual(0.5);
      expect(grenadeCooldown(s, 0), d.id).toBeGreaterThanOrEqual(16);
      expect(grenadeCooldown(s, 0.999), d.id).toBeLessThanOrEqual(30);
    }
    // Even a custom bot at full aggression waits 16 s between throws.
    expect(grenadeCooldown({ aggression: 1 }, 0)).toBe(BOT_GRENADE.cooldownBase - BOT_GRENADE.cooldownAggression);
    expect(BOT_GRENADE.cooldownBase - BOT_GRENADE.cooldownAggression).toBeGreaterThanOrEqual(16);
    expect(BOT_GRENADE.spawnDelay).toBeGreaterThanOrEqual(5);
  });

  it('miss by more the worse they are: 2-6 m of scatter, never a sure kill from range', () => {
    const by = Object.fromEntries(BOT_DIFFICULTIES.map((d) => [d.id, grenadeScatter(d.skill)]));
    expect(by.recruit!).toBeGreaterThan(by.regular!);
    expect(by.regular!).toBeGreaterThan(by.hardened!);
    expect(by.hardened!).toBeGreaterThan(by.veteran!);
    expect(by.veteran!).toBeGreaterThanOrEqual(2);
    expect(by.recruit!).toBeLessThanOrEqual(6.5);
    // The aim point stays inside the scatter disc.
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const at = { x: 10, y: 0, z: -4 };
    let far = 0;
    for (let i = 0; i < 400; i++) {
      const p = grenadeAimPoint(at, BOT_DIFFICULTIES[1]!.skill, rnd);
      const off = Math.hypot(p.x - at.x, p.z - at.z);
      expect(off).toBeLessThanOrEqual(by.regular! + 1e-9);
      if (off > killRadius(FRAG)) far++;
    }
    // A regular bot's frag lands outside the kill radius of the spot it aimed at a fair share of the time.
    expect(far / 400).toBeGreaterThan(0.05);
  });

  it('the throw pitch lands the first bounce short of the spot', () => {
    for (const flat of [8, 12, 18, 22]) {
      const pitch = grenadePitch('frag', flat, -1.5);
      const v = throwVelocity(viewDir(0, pitch), FRAG.speed, FRAG.loft);
      const g = NADE_PHYSICS.gravity;
      const t = (v.y + Math.sqrt(v.y * v.y + 2 * g * 1.5)) / g;
      const reach = Math.hypot(v.x, v.z) * t;
      expect(reach, `flat ${flat}`).toBeGreaterThan(flat * 0.7);
      expect(reach, `flat ${flat}`).toBeLessThan(flat * 1.0);
    }
  });
});
