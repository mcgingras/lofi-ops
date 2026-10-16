/**
 * Zombies (BO1-style round survival), rules level: the BO1 formulas, the spawn cap and queue,
 * zombie health per round, points, wall-buys, the Mystery Box (cost, roll, teddy bear), Perk-a-Colas
 * (Juggernog, Speed Cola, Double Tap, Quick Revive), power-ups, downs / revives / game over,
 * hellhound rounds, the zombie AI on Nuketown, the AI's cost at 24 zombies and the frontend listing.
 * Rooms are stepped tick by tick (Lobby + room.step(), no sockets).
 */
import { withSeed } from './bots-sim';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import botsFeature from '../src/server/features/bots/index';
import perksFeature from '../src/server/features/perks/index';
import progressionFeature from '../src/server/features/progression/index';
import weaponsFeature from '../src/server/features/weapons/index';
import { PATH_SEARCHES_PER_TICK } from '../src/server/features/zombies/brain';
import type { ZombiesGame } from '../src/server/features/zombies/game';
import { zombiesGameOf, ZombiesRules } from '../src/server/features/zombies/index';
import { survivorOf, undeadOf } from '../src/server/features/zombies/state';
import { Lobby } from '../src/server/lobby';
import { registerMode } from '../src/server/modes/index';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { moveParamsFor } from '../src/server/sim';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import { CHALLENGES } from '../src/shared/defs/challenges';
import { mapsForMode } from '../src/shared/defs/maps';
import { MODE_BY_ID } from '../src/shared/defs/modes';
import { BOX_CYCLE_SEC, MYSTERY_BOX } from '../src/shared/defs/mystery-box';
import { WEAPON_BY_ID } from '../src/shared/defs/weapons';
import {
  BOX,
  boxPool,
  DOGS,
  dogHealth,
  dogsForRound,
  downedLoss,
  firstDogRound,
  gaitOdds,
  killPoints,
  newDropTracker,
  nextDogRound,
  PERK_EFFECTS,
  PowerupCycle,
  rollBoxWeapon,
  rollDrop,
  rollGait,
  scaledPoints,
  spawnDelay,
  teddyRoll,
  updateDropTracker,
  ZM_ENTITY,
  zombieHealth,
  ZOMBIES,
  zombiesForRound,
} from '../src/shared/defs/zombies';
import { PLAYLIST_BY_ID, playlistMode } from '../src/shared/frontend/playlists';
import { Buttons } from '../src/shared/input';
import { zombiesLayer } from '../src/shared/maps/zombies/index';
import { createMoveState } from '../src/shared/movement';
import { newProfile } from '../src/shared/profile';

let store: Store | undefined;
let lobby: Lobby | undefined;
let seq = 0;

beforeAll(() => registerMode('zombies', () => new ZombiesRules()));

afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

function setup(map = 'nuketown'): { room: Room; g: ZombiesGame } {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [weaponsFeature, perksFeature, progressionFeature, botsFeature], log: () => {}, autoTick: false });
  const room = lobby.createRoom({ mode: 'zombies', map, closeWhenEmpty: false });
  return { room, g: zombiesGameOf(room)! };
}
const steps = (room: Room, seconds: number, each?: () => void) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) {
    each?.();
    room.step();
  }
};
function human(room: Room, name = `H${++seq}`): PlayerState {
  const s = new Session(`s${++seq}-${name}`, null, newProfile(`p-${name}-${seq}`, name), 'tok');
  return room.addHuman(s);
}
const place = (room: Room, p: PlayerState, x: number, z: number, yaw = p.yaw) => {
  const y = room.world.groundBelow(x, z, 3, 6) ?? 0;
  p.move = { ...createMoveState(x, y, z), onGround: true };
  p.yaw = yaw;
};
/** Keep a human's input flowing (core idles a human with no commands), holding `buttons`. */
const cmdSeq = new WeakMap<PlayerState, number>();
function hold(room: Room, p: PlayerState, buttons: number): void {
  const n = (cmdSeq.get(p) ?? p.lastSeq) + 1;
  cmdSeq.set(p, n);
  room.queueInputs(p, [{ seq: n, dt: TICK_DT, buttons, yaw: p.yaw, pitch: 0, weaponSlot: p.slot }]);
}
/** Start a game with one survivor standing (round 1 under way unless `pre`). */
function game(map = 'nuketown', opts: { round?: boolean } = {}) {
  const { room, g } = setup(map);
  const h = human(room);
  steps(room, 0.2);
  expect(h.alive).toBe(true);
  if (opts.round !== false) {
    g.phaseEndsAt = room.time;
    steps(room, 0.1);
    expect(g.phase).toBe('active');
  }
  return { room, g, h };
}
const zombie = (g: ZombiesGame): PlayerState => {
  expect(g.spawnOne('zombie')).toBe(true);
  return g.aliveUndead().at(-1)!;
};
const pts = (p: PlayerState) => survivorOf(p)!.points;

// ---------------------------------------------------------------------------------------------
// BO1 formulas
// ---------------------------------------------------------------------------------------------

describe('BO1 round formulas', () => {
  it('zombie health per round (ai_calculate_health)', () => {
    expect([1, 2, 3, 5, 9].map(zombieHealth)).toEqual([150, 250, 350, 550, 950]);
    // From round 10: +10% (truncated) a round.
    expect(zombieHealth(10)).toBe(1045);
    expect(zombieHealth(11)).toBe(1149);
    expect(zombieHealth(12)).toBe(1263);
    let h = 950;
    for (let r = 10; r <= 30; r++) h += Math.trunc(h * 0.1);
    expect(zombieHealth(30)).toBe(h);
  });

  it('zombies per round (round_spawning + default_max_zombie_func), solo and co-op', () => {
    expect([1, 2, 3, 4, 5, 6].map((r) => zombiesForRound(r, 1))).toEqual([6, 8, 13, 18, 24, 27]);
    expect(zombiesForRound(10, 1)).toBe(33);
    expect(zombiesForRound(20, 1)).toBe(60);
    expect(zombiesForRound(1, 4)).toBe(10);
    expect(zombiesForRound(6, 4)).toBe(45);
    expect(zombiesForRound(10, 4)).toBe(78);
    expect(zombiesForRound(1, 2)).toBe(7);
  });

  it('spawn delay: 2 s, x0.95 a round, floored near 0.08', () => {
    expect(spawnDelay(1)).toBe(2);
    expect(spawnDelay(2)).toBeCloseTo(1.9, 6);
    expect(spawnDelay(3)).toBeCloseTo(1.805, 6);
    expect(spawnDelay(100)).toBeGreaterThanOrEqual(0.075);
    expect(spawnDelay(100)).toBeLessThanOrEqual(0.081);
  });

  it('run speeds by round (set_run_speed): walkers early, sprinters from round 10', () => {
    expect(gaitOdds(1).walk).toBeCloseTo(1, 9);
    const r2 = gaitOdds(2);
    expect(r2.walk).toBeCloseTo(28 / 35, 6);
    expect(r2.run).toBeCloseTo(7 / 35, 6);
    expect(gaitOdds(5).run).toBeCloseTo(31 / 35, 6);
    expect(gaitOdds(10).sprint).toBeCloseTo(1, 9);
    expect(rollGait(1, 0.999)).toBe('walk');
    expect(rollGait(30, 0)).toBe('sprint');
  });

  it('points: +10 a hit, 60 torso / 100 head / 50 limb / 130 knife, rounded to 5 and doubled', () => {
    expect(killPoints('torso', 'bullet')).toBe(60);
    expect(killPoints('head', 'bullet')).toBe(100);
    expect(killPoints('legs', 'bullet')).toBe(50);
    expect(killPoints('torso', 'melee')).toBe(130);
    expect(killPoints(null, 'explosive')).toBe(50);
    expect(scaledPoints(10, false)).toBe(10);
    expect(scaledPoints(60, true)).toBe(120);
    expect(scaledPoints(12, false)).toBe(15);
    expect(downedLoss(1000)).toBe(50);
    expect(downedLoss(1234)).toBe(70);
  });

  it('power-up drops: the score threshold flag, 3% at random, at most 4 a round', () => {
    const t = newDropTracker(1);
    expect(t.threshold).toBe(2500);
    expect(rollDrop(t, 0.5)).toBe(false);
    expect(rollDrop(t, 0.02)).toBe(true); // randomint(100) <= 2
    expect(rollDrop(t, 0.03)).toBe(false);
    updateDropTracker(t, 2400);
    expect(t.flag).toBe(false);
    updateDropTracker(t, 2600);
    expect(t.flag).toBe(true);
    expect(t.threshold).toBeCloseTo(2600 + 2000 * 1.14, 6);
    expect(rollDrop(t, 0.9)).toBe(true);
    expect(t.flag).toBe(false);
    t.dropsThisRound = 4;
    expect(rollDrop(t, 0)).toBe(false);
    // The cycle: each power-up once per shuffle; Carpenter only with 5 broken windows.
    const c = new PowerupCycle(['full_ammo', 'insta_kill', 'double_points', 'nuke', 'carpenter']);
    const seen = new Set(Array.from({ length: 4 }, () => c.pick({ brokenWindows: 0 })));
    expect(seen.has('carpenter')).toBe(false);
    expect(seen.size).toBe(4);
  });

  it('teddy bear chances (treasure_chest_weapon_spawn) and the box pool', () => {
    for (let a = 0; a < 4; a++) expect(teddyRoll(a, 0, 0)).toBe(false);
    expect(teddyRoll(5, 0, 0.1)).toBe(true); // 15% band
    expect(teddyRoll(5, 0, 0.2)).toBe(false);
    expect(teddyRoll(8, 0, 0.99)).toBe(true); // never moved: always by the 8th pull
    expect(teddyRoll(10, 1, 0.25)).toBe(true); // 30% band after a move
    expect(teddyRoll(10, 1, 0.35)).toBe(false);
    expect(teddyRoll(15, 1, 0.45)).toBe(true); // 50%
    const pool = boxPool();
    expect(pool.some((p) => p.id === 'raygun')).toBe(true);
    expect(pool.some((p) => p.id === 'm1911')).toBe(false);
    const ray = pool.find((p) => p.id === 'raygun')!;
    const gun = pool.find((p) => p.id === 'ak47')!;
    expect(ray.weight).toBeLessThan(gun.weight);
    for (let i = 0; i < 50; i++) expect(rollBoxWeapon(['ak47', 'raygun'], i / 50)).not.toMatch(/^(ak47|raygun)$/);
  });

  it('hellhound rounds: every 4-5 rounds from 5-7, 6 (then 8) per player, health 400/900/1300/1600', () => {
    for (let i = 0; i < 10; i++) {
      const f = firstDogRound(i / 10);
      expect(f).toBeGreaterThanOrEqual(5);
      expect(f).toBeLessThanOrEqual(7);
      const n = nextDogRound(f, i / 10) - f;
      expect(n === 4 || n === 5).toBe(true);
    }
    expect(dogsForRound(1, 1)).toBe(6);
    expect(dogsForRound(3, 2)).toBe(16);
    expect([1, 2, 3, 4, 5].map(dogHealth)).toEqual([400, 900, 1300, 1600, 1600]);
  });
});

// ---------------------------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------------------------

describe('Zombies game', () => {
  it('starts with the M1911 (8 + 32), 500 points, two frags; round 1 has 6 walkers at 150 health', () => {
    const { room, g, h } = game();
    expect(h.weapons.map((w) => [w.def.base.id, w.mag, w.reserve])).toEqual([['m1911', 8, 32]]);
    expect(pts(h)).toBe(500);
    expect(h.ext.weapons?.lethalN).toBe(2);
    expect(g.round).toBe(1);
    steps(room, 15);
    const all = g.aliveUndead();
    expect(all.length + g.queue).toBe(6);
    for (const z of all) {
      expect(z.health).toBe(150);
      expect(undeadOf(z)!.gait).toBe('walk');
      expect(z.team).toBe(1);
      expect(z.weapons).toHaveLength(0);
    }
  });

  it('caps the horde at 24 alive and queues the rest', () => {
    const { room, g, h } = game();
    h.maxHealth = h.health = 1e9;
    g.round = 19;
    g.phase = 'break';
    g.phaseEndsAt = room.time;
    steps(room, 0.1);
    expect(g.round).toBe(20);
    expect(g.queue).toBe(60);
    let maxAlive = 0;
    let queuedAtCap = -1;
    steps(room, 25, () => {
      h.health = h.maxHealth;
      const a = g.aliveUndead().length;
      maxAlive = Math.max(maxAlive, a);
      if (a === ZOMBIES.maxAlive && queuedAtCap < 0) queuedAtCap = g.queue;
    });
    expect(maxAlive).toBe(24);
    expect(queuedAtCap).toBeGreaterThan(0);
    // Round 20 zombies have round 20 health.
    for (const z of g.aliveUndead()) expect(z.maxHealth).toBe(zombieHealth(20));
  });

  it('points for hits, kills, headshots and knife kills; Double Points and Insta-Kill', () => {
    const { room, g, h } = game();
    const hit = (z: PlayerState, amount: number, part: 'head' | 'torso' | 'legs', means = 'bullet', weapon = 'ak47') => room.damage({ victim: z, attacker: h, amount, weapon, part, means, from: null, distance: 5 });
    let z = zombie(g);
    hit(z, 1, 'torso');
    expect(pts(h)).toBe(510);
    hit(z, 9999, 'torso');
    expect(z.alive).toBe(false);
    expect(pts(h)).toBe(570);
    z = zombie(g);
    hit(z, 9999, 'head');
    expect(pts(h)).toBe(670);
    expect(survivorOf(h)!.headshots).toBe(1);
    z = zombie(g);
    hit(z, 9999, 'torso', 'melee', 'knife');
    expect(pts(h)).toBe(800);
    g.doubleUntil = room.time + 30;
    z = zombie(g);
    hit(z, 1, 'torso');
    expect(pts(h)).toBe(820);
    g.doubleUntil = 0;
    g.instaUntil = room.time + 30;
    g.round = 30;
    z = zombie(g);
    expect(z.health).toBe(zombieHealth(30));
    hit(z, 1, 'legs');
    expect(z.alive).toBe(false);
    expect(survivorOf(h)!.kills).toBe(4);
  });

  it('wall-buys: hold USE at the chalk for the gun, again for ammo at half price; the third gun replaces the one in hand', () => {
    const { room, g, h } = game();
    const wall = g.buy.walls.find((w) => w.spot.weapon === 'olympia')!;
    expect(wall.price).toBe(500);
    survivorOf(h)!.points = 2000;
    const f = { x: -Math.sin(wall.spot.yaw), z: -Math.cos(wall.spot.yaw) };
    place(room, h, wall.spot.x + f.x * 1, wall.spot.z + f.z * 1, wall.spot.yaw + Math.PI);
    steps(room, 0.5, () => hold(room, h, Buttons.USE));
    expect(h.weapons.map((w) => w.def.base.id)).toEqual(['m1911', 'olympia']);
    expect(pts(h)).toBe(1500);
    expect(h.slot).toBe(1);
    // Held the whole time: one purchase per press.
    steps(room, 0.3, () => hold(room, h, 0));
    h.weapons[1]!.reserve = 0;
    steps(room, 0.5, () => hold(room, h, Buttons.USE));
    expect(pts(h)).toBe(1250);
    expect(h.weapons[1]!.reserve).toBe(WEAPON_BY_ID.get('olympia')!.reserve);
    // Full: no charge.
    steps(room, 0.3, () => hold(room, h, 0));
    steps(room, 0.5, () => hold(room, h, Buttons.USE));
    expect(pts(h)).toBe(1250);
    // A third gun takes the place of the one in hand.
    const mp = g.buy.walls.find((w) => w.spot.weapon === 'mp5k')!;
    survivorOf(h)!.points = 1000;
    g.buy.buyWall(h, mp);
    expect(h.weapons.map((w) => w.def.base.id)).toEqual(['m1911', 'mp5k']);
    expect(pts(h)).toBe(0);
    expect(g.buy.buyWall(h, wall)).toBe(false);
  });

  // Seeded: the box roll and teddy chance are random.
  it('the Mystery Box: 950, a weapon you do not carry, taken with a fresh press; the teddy bear refunds and moves it', () => withSeed(1, () => {
    const { room, g, h } = game();
    survivorOf(h)!.points = 5000;
    expect(g.buy.box.ent).not.toBeNull();
    expect(BOX.cost).toBe(950);
    expect(g.buy.useBox(h)).toBe(true);
    expect(pts(h)).toBe(4050);
    const w = g.buy.box.weapon!;
    expect(w).not.toBe('m1911');
    expect(WEAPON_BY_ID.has(w) || w === 'teddy').toBe(true);
    steps(room, BOX_CYCLE_SEC + 0.2);
    expect(g.buy.box.ent!.s!.ph).toBe(3);
    // Still holding from the opening: no take until USE was let go.
    g.buy.box.released = false;
    expect(g.buy.useBox(h)).toBe(false);
    g.buy.box.released = true;
    expect(g.buy.useBox(h)).toBe(true);
    expect(h.weapons.some((x) => x.def.base.id === w)).toBe(true);
    steps(room, MYSTERY_BOX.closeSec + 0.2);
    expect(g.buy.box.ent!.s!.ph).toBe(1);
    // Force the teddy: 8 uses at the first spot always brings it.
    g.buy.box.accessed = 7;
    const before = pts(h);
    const spot = g.buy.box.spot;
    expect(g.buy.useBox(h)).toBe(true);
    expect(g.buy.box.weapon).toBe('teddy');
    steps(room, BOX_CYCLE_SEC + 2);
    expect(pts(h)).toBe(before);
    steps(room, MYSTERY_BOX.closeSec + MYSTERY_BOX.leaveSec + 0.2);
    expect(g.buy.box.ent).toBeNull();
    steps(room, BOX.moveSec + 0.2);
    expect(g.buy.box.ent).not.toBeNull();
    expect(g.buy.box.spot).not.toBe(spot);
    expect(g.buy.box.moves).toBe(1);
    expect(room.entities.byKind(ZM_ENTITY.box)).toHaveLength(1);
  }));

  it('Perk-a-Colas: Juggernog 250 health, Speed Cola x0.5 reloads, Double Tap x1.33 fire rate; lost when downed', () => {
    const { room, g, h } = game();
    survivorOf(h)!.points = 20000;
    const machine = (id: string) => g.buy.perks.find((m) => m.id === id)!;
    expect(g.buy.buyPerk(h, machine('jugg'))).toBe(true);
    expect(pts(h)).toBe(17500);
    expect(h.maxHealth).toBe(100);
    steps(room, PERK_EFFECTS.drinkSec + 0.1);
    expect(h.maxHealth).toBe(250);
    expect(g.buy.buyPerk(h, machine('jugg'))).toBe(false);
    g.buy.buyPerk(h, machine('speed'));
    // One drink at a time.
    expect(g.buy.buyPerk(h, machine('doubletap'))).toBe(false);
    steps(room, PERK_EFFECTS.drinkSec + 0.1);
    g.buy.buyPerk(h, machine('doubletap'));
    steps(room, PERK_EFFECTS.drinkSec + 0.1);
    expect(survivorOf(h)!.perks).toEqual(['jugg', 'speed', 'doubletap']);
    expect(pts(h)).toBe(12500);
    expect(room.modifiers.mul('reloadMultiplier', h)).toBe(0.5);
    expect(moveParamsFor(room, h).fireRate).toBeCloseTo(4 / 3, 6);
    // Double Tap: shots 0.08 s apart from an MP5K (rpm 750 = 0.08 s) all go through faster than the plain rate.
    g.buy.giveWeapon(h, 'mpl');
    steps(room, 1);
    const w = h.weapons[h.slot]!;
    const fireAll = () => {
      let ok = 0;
      w.mag = 999;
      const gap = (60 / w.def.rpm) * 0.85;
      for (let i = 0; i < 30; i++) {
        if (room.fire(h, { dir: { x: 0, y: 0, z: -1 } }).ok) ok++;
        steps(room, gap);
      }
      return ok;
    };
    const fast = fireAll();
    survivorOf(h)!.perks = survivorOf(h)!.perks.filter((p) => p !== 'doubletap');
    const slow = fireAll();
    expect(fast).toBeGreaterThan(slow);
    // Five swipes down a Juggernog survivor (BO1: down on the 5th hit), and the perks go.
    survivorOf(h)!.perks.push('revive');
    h.health = h.maxHealth;
    const z = zombie(g);
    for (let i = 0; i < 4; i++) room.damage({ victim: h, attacker: z, amount: ZOMBIES.swipeDamage, weapon: 'zombie', part: 'torso', means: 'melee', from: null, distance: 1 });
    expect(g.isDown(h)).toBe(false);
    room.damage({ victim: h, attacker: z, amount: ZOMBIES.swipeDamage, weapon: 'zombie', part: 'torso', means: 'melee', from: null, distance: 1 });
    expect(g.isDown(h)).toBe(true);
    expect(survivorOf(h)!.perks).toEqual([]);
    expect(h.maxHealth).toBe(100);
  });

  it('Quick Revive solo: 500, revives you after 10 s, at most three times; without it going down ends the game', () => {
    const { room, g, h } = game();
    survivorOf(h)!.points = 5000;
    const qr = g.buy.perks.find((m) => m.id === 'revive')!;
    g.buy.buyPerk(h, qr);
    expect(pts(h)).toBe(4500);
    steps(room, PERK_EFFECTS.drinkSec + 0.1);
    expect(g.soloLives).toBe(2);
    const z = zombie(g);
    const swipe = () => room.damage({ victim: h, attacker: z, amount: ZOMBIES.swipeDamage, weapon: 'zombie', part: 'torso', means: 'melee', from: null, distance: 1 });
    swipe();
    swipe();
    expect(g.isDown(h)).toBe(true);
    expect(survivorOf(h)!.selfReviveAt).not.toBeNull();
    // While down zombies leave you alone.
    expect(g.horde.targets).toHaveLength(1);
    steps(room, 0.1);
    expect(g.horde.targets).toHaveLength(0);
    steps(room, ZOMBIES.soloReviveSec);
    expect(g.isDown(h)).toBe(false);
    expect(h.alive).toBe(true);
    expect(g.phase).not.toBe('over');
    // Twice more, then sold out.
    for (let i = 0; i < 2; i++) {
      survivorOf(h)!.perks = [];
      expect(g.buy.buyPerk(h, qr)).toBe(true);
      steps(room, PERK_EFFECTS.drinkSec + 0.1);
    }
    expect(g.soloLives).toBe(0);
    expect(qr.ent.s?.off).toBe(1);
    survivorOf(h)!.perks = [];
    expect(g.buy.buyPerk(h, qr)).toBe(false);
    // No Quick Revive: down = game over.
    swipe();
    swipe();
    steps(room, 0.1);
    expect(g.phase).toBe('over');
    expect(g.survived).toBe(1);
    steps(room, ZOMBIES.gameOverSec + 0.2);
    expect(room.phase).toBe('ended');
    const ext = room.results!.ext.zombies as { round: number; players: { id: string; downs: number }[] };
    expect(ext.round).toBe(1);
    expect(ext.players.find((p) => p.id === h.id)!.downs).toBe(2);
    expect(room.results!.players.every((p) => !p.bot)).toBe(true);
  });

  it('co-op: a teammate holds USE to revive (and earns the 5%), a bleed-out comes back next round, everyone down ends it', () => {
    const { room, g, h } = game();
    const b = human(room);
    steps(room, 0.1);
    expect(g.solo).toBe(false);
    // Joined mid-round: back in at the next round.
    expect(b.alive).toBe(false);
    g.queue = 0;
    for (const z of g.aliveUndead()) room.kill(z, h, { weapon: 'ak47', means: 'bullet', part: 'torso' });
    steps(room, 0.2);
    expect(g.phase).toBe('break');
    steps(room, 0.2);
    expect(b.alive).toBe(true);
    survivorOf(b)!.points = 1000;
    const z = zombie(g);
    const down = (p: PlayerState) => {
      for (let i = 0; i < 2; i++) room.damage({ victim: p, attacker: z, amount: ZOMBIES.swipeDamage, weapon: 'zombie', part: 'torso', means: 'melee', from: null, distance: 1 });
    };
    down(b);
    expect(g.isDown(b)).toBe(true);
    expect(pts(b)).toBe(950);
    expect(b.weapons.map((w) => w.def.base.id)).toEqual(['m1911']);
    place(room, b, 0, -12);
    place(room, h, 0.8, -12);
    const before = pts(h);
    steps(room, ZOMBIES.reviveSec + 0.2, () => hold(room, h, Buttons.USE));
    expect(g.isDown(b)).toBe(false);
    expect(pts(h)).toBe(before + 50);
    expect(survivorOf(h)!.revives).toBe(1);
    // Quick Revive halves it.
    survivorOf(h)!.perks.push('revive');
    down(b);
    steps(room, ZOMBIES.reviveSec * 0.5 + 0.2, () => hold(room, h, Buttons.USE));
    expect(g.isDown(b)).toBe(false);
    // Left alone: bleeds out, everyone else up loses 10%.
    down(b);
    survivorOf(h)!.points = 1000;
    steps(room, ZOMBIES.bleedOutSec + 0.2, () => hold(room, h, 0));
    expect(b.alive).toBe(false);
    expect(survivorOf(b)!.dead).toBe(true);
    expect(pts(h)).toBe(900);
    g.queue = 0;
    for (const x of g.aliveUndead()) room.kill(x, h, { weapon: 'ak47', means: 'bullet', part: 'torso' });
    steps(room, 0.5);
    expect(b.alive).toBe(true);
    // Both down: game over.
    survivorOf(h)!.perks = [];
    const z2 = zombie(g);
    for (const p of [h, b]) for (let i = 0; i < 2; i++) room.damage({ victim: p, attacker: z2, amount: ZOMBIES.swipeDamage, weapon: 'zombie', part: 'torso', means: 'melee', from: null, distance: 1 });
    steps(room, 0.1);
    expect(g.phase).toBe('over');
    steps(room, ZOMBIES.gameOverSec + 0.2);
    expect(room.phase).toBe('ended');
  });

  it('power-ups: Max Ammo refills, Nuke kills every zombie for +400, drops stop after 4 a round', () => {
    const { room, g, h } = game();
    room.modifiers.add('damageTaken', (v) => (v === h ? 0 : undefined), 'test.god');
    h.weapons[0]!.reserve = 0;
    const e = g.powerups.drop('full_ammo', { x: h.move.x, y: h.move.y, z: h.move.z });
    expect(room.entities.get(e.id)).toBeDefined();
    steps(room, 0.2);
    expect(room.entities.get(e.id)).toBeUndefined();
    expect(h.weapons[0]!.reserve).toBe(32);
    g.queue = 0;
    for (let i = 0; i < 5; i++) zombie(g);
    const before = pts(h);
    const kills = survivorOf(h)!.kills;
    g.powerups.grab('nuke', h, h.move);
    steps(room, 1.5);
    expect(g.aliveUndead()).toHaveLength(0);
    expect(pts(h)).toBe(before + 400);
    expect(survivorOf(h)!.kills).toBe(kills);
    expect(room.entities.byKind(ZM_ENTITY.powerup)).toHaveLength(0);
    // Insta-Kill and Double Points last 30 s.
    g.powerups.grab('insta_kill', h, h.move);
    g.powerups.grab('double_points', h, h.move);
    expect(g.instaUntil - room.time).toBeCloseTo(30, 3);
    expect(g.doubleUntil - room.time).toBeCloseTo(30, 3);
    // Dropping power-ups lie there 26 s.
    const d = g.powerups.drop('insta_kill', { x: h.move.x + 10, y: h.move.y, z: h.move.z });
    steps(room, 25);
    expect(room.entities.get(d.id)).toBeDefined();
    steps(room, 1.2);
    expect(room.entities.get(d.id)).toBeUndefined();
    // Kills with the flag up drop, at most 4 a round.
    g.drops.dropsThisRound = 0;
    let dropped = 0;
    for (let i = 0; i < 8; i++) {
      g.drops.flag = true;
      const z = zombie(g);
      const n0 = room.entities.byKind(ZM_ENTITY.powerup).length;
      room.kill(z, h, { weapon: 'ak47', means: 'bullet', part: 'torso' });
      dropped += room.entities.byKind(ZM_ENTITY.powerup).length - n0;
    }
    expect(dropped).toBe(4);
  });

  it('hellhound rounds: dogs at dog health, two per survivor at a time, the last one drops a Max Ammo', () => {
    const { room, g, h } = game('nuketown', { round: false });
    h.maxHealth = h.health = 1e9;
    g.nextDog = 1;
    g.phaseEndsAt = room.time;
    steps(room, 0.1);
    expect(g.dogRound).toBe(true);
    expect(g.queue).toBe(6);
    steps(room, DOGS.introSec - 0.5);
    expect(g.aliveUndead()).toHaveLength(0);
    const drops: string[] = [];
    const drop = g.powerups.drop.bind(g.powerups);
    g.powerups.drop = (id, at) => {
      drops.push(id);
      return drop(id, at);
    };
    let killed = 0;
    let maxAlive = 0;
    steps(room, 60, () => {
      h.health = h.maxHealth;
      if (!g.dogRound) return;
      const dogs = g.aliveUndead();
      maxAlive = Math.max(maxAlive, dogs.length);
      for (const d of dogs) {
        expect(undeadOf(d)!.kind).toBe('dog');
        expect(d.maxHealth).toBe(400);
        if (room.time - d.spawnTime > 1) {
          room.kill(d, h, { weapon: 'ak47', means: 'bullet', part: 'torso' });
          killed++;
        }
      }
    });
    expect(killed).toBe(6);
    expect(maxAlive).toBeLessThanOrEqual(2);
    expect(drops).toContain('full_ammo');
    expect(g.round).toBe(2);
    expect(g.dogRound).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// AI and its cost
// ---------------------------------------------------------------------------------------------

describe('zombie AI', () => {
  it('reaches a survivor on Nuketown and swipes when in reach', () => {
    const { room, g, h } = game();
    g.queue = 0;
    for (const z of g.aliveUndead()) room.kill(z, null, { weapon: 'nuke', means: 'explosive' });
    let swipes = 0;
    room.bus.on('beforeDamage', (ev) => {
      if (ev.victim === h && ev.attacker && undeadOf(ev.attacker) && ev.means === 'melee') {
        swipes++;
        ev.cancel = true;
      }
    }, { priority: 500 });
    g.round = 6; // runners
    for (let i = 0; i < 6; i++) zombie(g);
    const start = Math.min(...g.aliveUndead().map((z) => Math.hypot(z.move.x - h.move.x, z.move.z - h.move.z)));
    expect(start).toBeGreaterThan(9);
    let reached = -1;
    steps(room, 30, () => {
      hold(room, h, 0);
      if (reached < 0 && g.aliveUndead().some((z) => Math.hypot(z.move.x - h.move.x, z.move.z - h.move.z) <= ZOMBIES.swipeReach)) reached = room.time;
    });
    const br = g.brains.get(g.aliveUndead()[0]!.id) as unknown as Record<string, unknown>;
    expect(reached).toBeGreaterThan(0);
    expect(swipes).toBeGreaterThan(0);
  });

  it('24 zombies cost a bounded tick, and path searches stay within the per-tick budget', () => {
    const { room, g, h } = game();
    h.maxHealth = h.health = 1e9;
    g.round = 12;
    g.queue = 0;
    while (g.aliveUndead().length < 24) zombie(g);
    steps(room, 1);
    const searches0 = g.horde.stats.searches;
    const ticks = 600;
    let total = 0;
    let worst = 0;
    for (let i = 0; i < ticks; i++) {
      h.health = h.maxHealth;
      hold(room, h, 0);
      const t0 = performance.now();
      room.step();
      const dt = performance.now() - t0;
      total += dt;
      worst = Math.max(worst, dt);
    }
    expect(g.aliveUndead().length).toBeGreaterThanOrEqual(20);
    expect((g.horde.stats.searches - searches0) / ticks).toBeLessThanOrEqual(PATH_SEARCHES_PER_TICK);
    // Generous for a loaded 4-worker run: the budget is the 16.7 ms tick.
    expect(total / ticks).toBeLessThan(8);
    expect(worst).toBeLessThan(60);
  });
});

// ---------------------------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------------------------

describe('Zombies listing', () => {
  it('a party playlist, the mode def, three maps with layers, challenges', () => {
    const mode = MODE_BY_ID.get('zombies')!;
    expect(mode).toMatchObject({ teams: true, teamsByRules: true, respawn: false, maxPlayers: 4, timeLimitSec: 0 });
    expect(mode.killXp).toBeDefined();
    const pl = PLAYLIST_BY_ID.get('zombies')!;
    expect(pl.category).toBe('party');
    expect(playlistMode(pl)).toBe('zombies');
    const maps = mapsForMode('zombies').map((m) => m.id).sort();
    expect(maps).toEqual(['firingrange', 'nuketown', 'yard']);
    for (const id of maps) expect(zombiesLayer(id)).not.toBeNull();
    const ids = CHALLENGES.map((c) => c.id);
    for (const id of ['zombies_round', 'zombies_horde', 'zombies_headshots']) expect(ids).toContain(id);
    const round = CHALLENGES.find((c) => c.id === 'zombies_round')!;
    expect(round.aggregate).toBe('max');
  });
});
