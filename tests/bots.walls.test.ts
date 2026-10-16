/**
 * "I keep dying through walls from the bots": every way it could happen, each with a test.
 *
 *   perception  a bot never notices (or keeps) a player it can't see: collision walls, drawn
 *               geometry with no collision for sight (render-only props, couches, turned crates),
 *               on the synthetic cover box and at real cover spots on Nuketown, Rust, Terminal,
 *               Firing Range and Estate. Gunfire behind cover turns it but never lets it engage.
 *   line of fire  it never fires unless a bullet would reach the point it aims at (bullet-proof
 *               glass: it sees you, it doesn't shoot); no damage ever goes through.
 *   penetration  bots' bullets never penetrate: they stop on anything with `bullets` collision,
 *               whatever the weapon; only brushes marked `bullets: false` (thin boards, fences) let
 *               them through. Human shots go through thin walls (tests/penetration.test.ts), never
 *               concrete or bullet-proof glass.
 *   memory      the moment the target is out of view it stops firing and aims at the last point it
 *               saw, then lets go after LOST_GRACE.
 *   timing      bot shots hit where players are now (no rewind); humans' shots still rewind.
 *   reacquire   a player hidden for over a second gets a full reaction when they peek again.
 *   radar       a UAV contact steers it, never makes it fire.
 *   sim         bots vs a peeking player: 0 deaths through collision or drawn cover.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { botBrain } from '../src/server/features/bots/api';
import { angleDiff } from '../src/server/features/bots/aim';
import { LOST_GRACE } from '../src/server/features/bots/brain';
import { botCanSee, chestOf, occludersFor } from '../src/server/features/bots/sight';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { BOT_DIFFICULTY_BY_ID } from '../src/shared/defs/bots';
import { getMapData } from '../src/shared/defs/maps';
import { WEAPONS } from '../src/shared/defs/weapons';
import { Buttons } from '../src/shared/input';
import { buildCollisionWorld, type MapData } from '../src/shared/maps/types';
import { normalize, yawTo, type Vec3 } from '../src/shared/math';
import { addScripted, addShooter, COVERS, coverMap, coverMapSpots, coverSpots, hiddenFromBullets, hiddenFromSight, peekSim, place, steps, testRoom, withSeed, type CoverSpot, type TestRoom } from './bots-walls';

const open: TestRoom[] = [];
const room = (map: string | MapData, difficulty: 'regular' | 'veteran' | 'recruit' = 'regular'): Room => {
  const t = testRoom(map, difficulty);
  open.push(t);
  steps(t.room, 0.1);
  return t.room;
};
afterEach(() => {
  for (const t of open.splice(0)) t.close();
});

const eyeOf = (p: PlayerState): Vec3 => ({ x: p.move.x, y: p.move.y + (p.move.crouched ? 1.0 : 1.6), z: p.move.z });
const still = (crouch = false) => (_r: Room, self: PlayerState) => ({ buttons: crouch ? Buttons.CROUCH : 0, yaw: self.yaw });

interface TrapResult {
  engaged: boolean;
  fired: number;
  damage: number;
  heard: boolean;
}

/**
 * A bot holding still at `spot.bot`, facing the cover, and a player behind it for `seconds`
 * (crouched, or firing into the air every half second so the bot hears it).
 */
function trap(map: string | MapData, spot: CoverSpot, o: { crouch?: boolean; noisy?: boolean; seconds?: number; difficulty?: 'regular' | 'veteran'; seed?: number } = {}): TrapResult {
  const seed = o.seed ?? Math.round(Math.abs(spot.cover.x * 131 + spot.cover.z * 17 + spot.bot.x * 7) + (o.crouch ? 1 : 0) + (o.noisy ? 2 : 0));
  return withSeed(seed, () => trapRun(map, spot, o));
}

function trapRun(map: string | MapData, spot: CoverSpot, o: { crouch?: boolean; noisy?: boolean; seconds?: number; difficulty?: 'regular' | 'veteran' }): TrapResult {
  const r = room(map, o.difficulty ?? 'veteran');
  let nextNoise = 0;
  const player = addScripted(r, 1, spot.cover, (rm, self) => {
    if (o.noisy && rm.time >= nextNoise) {
      nextNoise = rm.time + 0.5;
      self.weapons[0]!.mag = self.weapons[0]!.def.magazine;
      rm.fire(self, { dir: { x: 0, y: 1, z: 0 } });
    }
    return { buttons: o.crouch ? Buttons.CROUCH : 0, yaw: self.yaw };
  });
  // A plain, loud rifle (a suppressed one would make no noise).
  if (o.noisy) player.weapons[0] = makeWeapon({ weapon: 'ak47', attachments: [], camo: 'none' }, 'ak47');
  const bot = addShooter(r, 0, spot.bot, spot.cover);
  const brain = botBrain(r, bot)!;
  brain.forced = { at: { ...bot.move }, radius: 0.05, hold: true };
  const res: TrapResult = { engaged: false, fired: 0, damage: 0, heard: false };
  r.bus.on('fire', (e) => {
    if (e.player === bot) res.fired++;
  });
  r.bus.on('damage', (e) => {
    if (e.victim === player && e.attacker === bot) res.damage += e.amount;
  });
  steps(r, o.seconds ?? 3, () => {
    if (brain.target === player) res.engaged = true;
    if (brain.heard) res.heard = true;
  });
  return res;
}

// ---------------------------------------------------------------------------------------------

describe('bots and walls: the synthetic cover box', () => {
  it('the covers are what they claim (collision vs drawn geometry)', () => {
    const map = coverMap();
    const world = buildCollisionWorld(map);
    const g = { world, map };
    for (const c of COVERS) {
      const eye = { x: c.bot.x, y: 1.6, z: c.bot.z };
      const pose = { ...c.hide, crouched: false };
      const sightByCollision = !hiddenFromSight(g, eye, pose, false);
      const sightByDrawn = !hiddenFromSight(g, eye, pose, true);
      const bulletsPass = !hiddenFromBullets(g, eye, pose);
      expect({ kind: c.kind, sightByDrawn }).toEqual({ kind: c.kind, sightByDrawn: c.seeThrough });
      expect({ kind: c.kind, bulletsPass }).toEqual({ kind: c.kind, bulletsPass: c.kind === 'render-only' || c.penetrable || c.kind === 'turned-crate' });
      // The covers a collision-only bot would see straight through.
      if (['render-only', 'couch', 'turned-crate', 'bulletproof-glass'].includes(c.kind)) expect(sightByCollision).toBe(true);
      // And the peek spot is in plain view.
      expect(botCanSee(world, map, eye, { x: c.peek.x, y: 1.15, z: c.peek.z })).toBe(true);
    }
  });

  for (const c of COVERS) {
    it(`behind ${c.kind}: never noticed (unless see-through), never fired at, never hurt`, () => {
      const spot = coverMapSpots().find((s) => s.blocker === c.kind)!;
      for (const crouch of [false, true]) {
        const res = trap(coverMap(), spot, { crouch });
        expect({ crouch, ...res, heard: undefined }).toEqual({ crouch, engaged: c.seeThrough, fired: 0, damage: 0, heard: undefined });
      }
    });
  }

  it('bullet-proof glass: it sees you through it, and holds fire (it used to empty magazines into it)', () => {
    const spot = coverMapSpots().find((s) => s.blocker === 'bulletproof-glass')!;
    const res = trap(coverMap(), spot, { seconds: 4 });
    expect(res.engaged).toBe(true);
    expect(res.fired).toBe(0);
  });

  it('gunfire behind cover turns it toward the sound, but it never engages or fires', () => {
    for (const kind of ['concrete', 'render-only', 'couch'] as const) {
      const spot = coverMapSpots().find((s) => s.blocker === kind)!;
      const res = trap(coverMap(), spot, { noisy: true, seconds: 4 });
      expect({ kind, ...res }).toEqual({ kind, engaged: false, fired: 0, damage: 0, heard: true });
    }
  });
});

// ---------------------------------------------------------------------------------------------

const MAPS = ['nuketown', 'rust', 'terminal', 'firingrange', 'estate'] as const;

describe('bots and walls: real cover spots', () => {
  for (const id of MAPS) {
    it(`${id}: a player behind walls is never noticed, fired at or hurt (standing, crouched, firing)`, () => {
      const map = getMapData(id);
      const spots = coverSpots(map, 4, 21);
      expect(spots.length).toBeGreaterThanOrEqual(3);
      const world = buildCollisionWorld(map);
      for (const [i, s] of spots.entries()) {
        const res = trap(id, s);
        expect({ spot: i, blocker: s.blocker, ...res, heard: undefined }).toEqual({ spot: i, blocker: s.blocker, engaged: false, fired: 0, damage: 0, heard: undefined });
        if (hiddenFromSight({ world, map }, { x: s.bot.x, y: s.bot.y + 1.6, z: s.bot.z }, { ...s.cover, crouched: true }, true)) {
          const rc = trap(id, s, { crouch: true });
          expect({ spot: i, crouch: true, engaged: rc.engaged, fired: rc.fired, damage: rc.damage }).toEqual({ spot: i, crouch: true, engaged: false, fired: 0, damage: 0 });
        }
      }
      const noisy = trap(id, spots[0]!, { noisy: true, seconds: 4 });
      expect({ ...noisy, heard: undefined }).toEqual({ engaged: false, fired: 0, damage: 0, heard: undefined });
    });

    it(`${id}: a player hidden only by drawn geometry is not seen through it`, () => {
      const map = getMapData(id);
      const spots = coverSpots(map, 3, 5, 'render');
      for (const [i, s] of spots.entries()) {
        const res = trap(id, s);
        expect({ spot: i, blocker: s.blocker, engaged: res.engaged, fired: res.fired, damage: res.damage }).toEqual({ spot: i, blocker: s.blocker, engaged: false, fired: 0, damage: 0 });
      }
    });
  }

  it('drawn occluders exist where collision lets sight through (evidence on the five maps)', () => {
    const counts = Object.fromEntries(MAPS.map((id) => [id, coverSpots(getMapData(id), 3, 5, 'render').length]));
    // Rust's tanker and truck, Terminal's counter panel, Firing Range's sheds and truck, Estate's trim.
    expect(counts.rust).toBeGreaterThan(0);
    expect(counts.terminal).toBeGreaterThan(0);
    expect(counts.firingrange).toBeGreaterThan(0);
    for (const id of MAPS) expect(occludersFor(getMapData(id)).list.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------

describe('bots and walls: penetration', () => {
  it('no bot weapon gets a bullet through bullet-stopping cover, even thin glass; human shots not through the glass or concrete either; thin planks (bullets: false) let them through', () => {
    const r = room(coverMap());
    const target = addScripted(r, 1, { x: 0, y: 0, z: 0 }, still());
    const shooter = addScripted(r, 0, { x: 0, y: 0, z: 6 }, still());
    // Every shot straight at the chest: only the cover decides.
    r.modifiers.add('spreadMultiplier', (p) => (p === shooter ? 0 : undefined), 'test.nospread');
    r.bus.on('beforeDamage', (e) => {
      if (e.victim === target) e.amount = 1; // keep it alive
    });
    let dealt = 0;
    r.bus.on('damage', (e) => {
      if (e.victim === target) dealt += 1;
    });
    const tryShots = (cover: 'glass' | 'planks' | 'concrete' | 'none', weapon: string): number => {
      const c = COVERS.find((x) => x.kind === (cover === 'glass' ? 'bulletproof-glass' : cover === 'concrete' ? 'concrete' : 'thin-planks'))!;
      // Target right behind the cover, shooter 6 m in front of it, aiming at the chest.
      place(r, target, cover === 'none' ? { x: c.peek.x, y: 0, z: c.hide.z } : c.hide);
      place(r, shooter, { x: cover === 'none' ? c.peek.x : c.hide.x, y: 0, z: -5 + 6 });
      shooter.weapons[0] = makeWeapon({ weapon, attachments: [], camo: 'none' }, 'ak47');
      shooter.slot = 0;
      shooter.swapEnd = 0;
      shooter.reloadEnd = 0;
      // Nothing left over from the last weapon (a bolt stuck in the target kills its host).
      for (const e of [...r.entities.all()]) r.entities.remove(e.id);
      dealt = 0;
      for (let i = 0; i < 6; i++) {
        shooter.weapons[0]!.mag = shooter.weapons[0]!.def.magazine;
        shooter.weapons[0]!.credit = 2;
        shooter.reloadEnd = 0;
        const eye = eyeOf(shooter);
        r.fire(shooter, { dir: normalize({ x: target.move.x - eye.x, y: target.move.y + 1.15 - eye.y, z: target.move.z - eye.z }) });
        steps(r, 0.5);
      }
      steps(r, 2); // projectiles land, fuses run out
      return dealt;
    };
    let tested = 0;
    for (const w of WEAPONS) {
      if (tryShots('none', w.id) === 0) continue; // not hitscan (launchers, bolts, blades)
      tested++;
      expect({ weapon: w.id, throughGlass: tryShots('glass', w.id) }).toEqual({ weapon: w.id, throughGlass: 0 });
      expect({ weapon: w.id, throughPlanks: tryShots('planks', w.id) > 0 }).toEqual({ weapon: w.id, throughPlanks: true });
      // The same shots as a human's (penetration on): still nothing through the glass or the concrete.
      shooter.isBot = false;
      expect({ weapon: w.id, human: true, throughGlass: tryShots('glass', w.id), throughConcrete: tryShots('concrete', w.id) }).toEqual({ weapon: w.id, human: true, throughGlass: 0, throughConcrete: 0 });
      shooter.isBot = true;
    }
    expect(tested).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------------------------------------

/** On the cover box (concrete): the bot engaged and firing at a player standing at the peek spot. */
function engagedAtConcrete(difficulty: 'regular' | 'veteran' = 'veteran') {
  const r = room(coverMap(), difficulty);
  const c = COVERS[0];
  const player = addScripted(r, 1, c.peek, still());
  r.bus.on('beforeDamage', (e) => {
    if (e.victim === player) e.cancel = true;
  });
  const bot = addShooter(r, 0, c.bot, c.peek);
  const brain = botBrain(r, bot)!;
  brain.forced = { at: { ...bot.move }, radius: 0.05, hold: true };
  let shots = 0;
  let lastShot = -1;
  r.bus.on('fire', (e) => {
    if (e.player !== bot) return;
    shots++;
    lastShot = r.time;
  });
  for (let i = 0; i < 400 && shots < 3; i++) steps(r, 1 / 60);
  expect(brain.target).toBe(player);
  return { r, c, player, bot, brain, shots: () => shots, lastShot: () => lastShot };
}

describe('bots and walls: target memory', () => {
  it('stops firing the tick the target is out of view, aims at the last point it saw, then lets go', () => {
    const { r, c, player, bot, brain, shots } = engagedAtConcrete();
    const seenAt = { ...player.move };
    // Duck behind the concrete, then slide along behind it.
    place(r, player, c.hide);
    const before = shots();
    let firedAfter = 0;
    for (let i = 0; i < 12; i++) {
      steps(r, 1 / 60);
      if (i === 3) place(r, player, { x: c.hide.x + 0.7, y: 0, z: c.hide.z - 0.6 });
      firedAfter = shots() - before;
    }
    expect(firedAfter).toBe(0);
    const eye = eyeOf(bot);
    const toLast = Math.abs(angleDiff(yawTo(eye, seenAt), brain.aim.yaw));
    const toLive = Math.abs(angleDiff(yawTo(eye, player.move), brain.aim.yaw));
    expect(toLast).toBeLessThan(toLive);
    expect(brain.lastSeen!.at.x).toBeCloseTo(seenAt.x, 1);
    steps(r, LOST_GRACE);
    expect(brain.target).toBe(null);
    expect(shots() - before).toBe(0);
  });

  it('a target lost for less than LOST_GRACE is followed again without a new reaction', () => {
    const { r, c, player, brain } = engagedAtConcrete();
    place(r, player, c.hide);
    steps(r, 0.1);
    expect(brain.target).toBe(player);
    place(r, player, c.peek);
    steps(r, 0.05);
    expect(brain.target).toBe(player);
    expect(brain.aim.react).toBeLessThanOrEqual(0);
  });
});

describe('bots and walls: re-acquiring after hiding', () => {
  it('hidden for over a second: the first shot after peeking again takes a full reaction', () => {
    for (const difficulty of ['regular', 'veteran'] as const) {
      const reaction = BOT_DIFFICULTY_BY_ID.get(difficulty)!.skill.reactionMs / 1000;
      const times: number[] = [];
      for (let trial = 0; trial < 5; trial++) {
        withSeed(100 + trial, () => {
          const { r, c, player, shots } = engagedAtConcrete(difficulty);
          place(r, player, c.hide);
          steps(r, 1.2 + trial * 0.2);
          const before = shots();
          place(r, player, c.peek);
          const t0 = r.time;
          for (let i = 0; i < 300 && shots() === before; i++) steps(r, 1 / 60);
          times.push(r.time - t0);
          for (const t of open.splice(0)) t.close();
        });
      }
      // Reaction is drawn at x0.7..1.3, plus the noticing time.
      expect({ difficulty, min: Math.min(...times) >= reaction * 0.7 }).toEqual({ difficulty, min: true });
    }
  });
});

describe('bots and walls: server timing', () => {
  it("bot shots hit where players are now, not where the rewind's newest frame (a tick old) had them", () => {
    const r = room(coverMap());
    const c = COVERS[0];
    const player = addScripted(r, 1, c.peek, still());
    const shooter = addScripted(r, 0, c.bot, still());
    r.modifiers.add('spreadMultiplier', (p) => (p === shooter ? 0 : undefined), 'test.nospread');
    steps(r, 0.5); // history: the player at the peek spot (and the shooter's weapon is up)
    const eye = eyeOf(shooter);
    const dir = normalize({ x: player.move.x - eye.x, y: player.move.y + 1.15 - eye.y, z: player.move.z - eye.z });
    // This tick the player has ducked behind the concrete; the history still shows them out.
    place(r, player, c.hide);
    const hits: number[] = [];
    r.bus.on('fire', (e) => {
      if (e.player === shooter) hits.push(e.hits.length);
    });
    shooter.weapons[0]!.credit = 2;
    expect(r.fire(shooter, { dir }).ok).toBe(true); // a bot's shot (time = now)
    expect(hits).toEqual([0]);
    expect(player.health).toBe(player.maxHealth);
    // A human's shot from 100 ms ago is still rewound (lag compensation unchanged).
    steps(r, 0.25);
    place(r, player, c.peek);
    steps(r, 0.2);
    place(r, player, c.hide);
    shooter.weapons[0]!.credit = 2;
    expect(r.fire(shooter, { dir, time: r.time - 0.1 })).toEqual({ ok: true });
    expect(hits[1]).toBe(1);
  });
});

describe('bots and walls: radar', () => {
  it('a UAV contact behind a wall steers it, but it never fires while the player is hidden', () => {
    const r = room(coverMap(), 'veteran');
    const c = COVERS[0];
    const player = addScripted(r, 1, c.hide, still());
    r.bus.on('beforeDamage', (e) => {
      if (e.victim === player) e.cancel = true;
    });
    r.modifiers.add('radarVisible', (q) => (q === player ? true : undefined), 'test.uav');
    const bot = addShooter(r, 0, c.bot, c.hide);
    const brain = botBrain(r, bot)!;
    brain.forced = null;
    let sawRadar = false;
    let shotsAtHidden = 0;
    r.bus.on('fire', (e) => {
      if (e.player === bot && hiddenFromBullets(r, e.origin, { ...player.move, crouched: player.move.crouched })) shotsAtHidden++;
    });
    const start = { ...bot.move };
    steps(r, 6, () => {
      if (brain.radar) sawRadar = true;
    });
    expect(sawRadar).toBe(true);
    expect(Math.hypot(bot.move.x - start.x, bot.move.z - start.z)).toBeGreaterThan(2);
    expect(shotsAtHidden).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------

describe('bots and walls: peeking simulation', () => {
  it('bots vs a player peeking out of cover: no death through collision or drawn cover, no shots at a hidden player', () => {
    const results = [peekSim({ map: coverMap(), spots: coverMapSpots(), seconds: 20, difficulty: 'veteran', penetrable: (i) => COVERS[i]!.penetrable, retreatOnHit: true })];
    for (const id of ['nuketown', 'rust', 'terminal', 'firingrange', 'estate']) {
      const map = getMapData(id);
      results.push(peekSim({ map: id, spots: [...coverSpots(map, 3, 3), ...coverSpots(map, 2, 5, 'render')], seconds: 20, difficulty: 'veteran', retreatOnHit: true }));
    }
    const sum = (k: 'deaths' | 'throughSolid' | 'throughDrawn' | 'hiddenOnServer' | 'shotsAtHidden') => results.reduce((a, x) => a + x[k], 0);
    expect(sum('deaths')).toBeGreaterThan(20);
    expect(sum('throughSolid')).toBe(0);
    expect(sum('throughDrawn')).toBe(0);
    expect(sum('hiddenOnServer')).toBe(0);
    expect(sum('shotsAtHidden')).toBe(0);
    // No snap: after more than a second hidden, no shot within the fastest (veteran) reaction.
    const fast = BOT_DIFFICULTY_BY_ID.get('veteran')!.skill.reactionMs / 1000;
    const after1s = results.flatMap((x) => x.reacquire.filter((q) => q.hiddenSec >= 1).map((q) => q.firstShotSec));
    expect(after1s.length).toBeGreaterThan(20);
    expect(Math.min(...after1s)).toBeGreaterThanOrEqual(fast * 0.7);
  });

  it('chest exposure is what the sim calls a peek (sanity: the bot sees the peek spot)', () => {
    const spots = coverMapSpots();
    const map = coverMap();
    const world = buildCollisionWorld(map);
    for (const s of spots) {
      const p = { move: { x: s.peek.x, y: 0, z: s.peek.z, crouched: false } } as PlayerState;
      expect(botCanSee(world, map, { x: s.bot.x, y: 1.6, z: s.bot.z }, chestOf(p))).toBe(true);
    }
  });
});
