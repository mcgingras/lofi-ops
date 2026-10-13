/**
 * "Killed through a wall by a bot": the reproduction harness for tests/bots.walls.test.ts and
 * scripts/bots-walls.ts.
 *
 *   coverMap()     a synthetic walled box: a concrete wall, a render-only wall (no collision), a
 *                  bullet-proof window (sight passes, bullets don't), thin plank boards (sight
 *                  stops, bullets pass), a couch (bullets stop, sight passes) and a turned crate
 *                  drawn bigger than its collision.
 *   coverSpots()   on a real map: a bot cell B and a player cell C where every part of a standing
 *                  player at C is behind bullet-stopping, sight-blocking collision from B's eye,
 *                  and a peek cell P a step or two from C where the player's chest is in plain view.
 *   renderSpots()  the same, but the player at C is hidden only by drawn geometry (no collision
 *                  for sight), i.e. a bot that trusts collision alone sees straight through it.
 *   peekSim()      bots against a scripted player who hides at C and peeks out to P, over and over.
 *                  For every death by a bot's bullet: did the killing ray cross bullet-stopping
 *                  collision (must never happen), was the victim fully hidden on the server when
 *                  hit, did the ray cross drawn bullet-stopping geometry, and was the victim
 *                  already behind cover on their own screen (latency estimate). Also how long
 *                  after each peek the first shot came, by how long the player had been hidden.
 *
 * Math.random is seeded (withSeed) so the numbers repeat.
 */
import { botBrain, configureRoomBots, navFor } from '../src/server/features/bots/api';
import { botCanHit, botCanSee, chestOf, eyePointOf, headOf, occludersFor } from '../src/server/features/bots/sight';
import { FEATURES } from '../src/server/features/index';
import { registerModeRules } from '../src/server/features/modes/index';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { playerHitboxes } from '../src/shared/collision';
import { PLAYER, TICK_DT } from '../src/shared/constants';
import type { BotDifficultyId } from '../src/shared/defs/bots';
import { Buttons } from '../src/shared/input';
import { box, buildCollisionWorld, type MapData } from '../src/shared/maps/types';
import { yawTo, type Vec3 } from '../src/shared/math';
import { createMoveState } from '../src/shared/movement';
import { withSeed } from './bots-sim';

export { withSeed };

// ---------------------------------------------------------------------------------------------
// Synthetic map
// ---------------------------------------------------------------------------------------------

/**
 * 40 x 40 m walled box. Bots stand on the south side (z = 12) and the player on the north
 * (z = -6) behind one of six covers, all 2 m wide and centred on x = -15, -9, -3, 3, 9, 15:
 *   x = -15  concrete wall (collides in every channel)
 *   x = -9   render-only wall (`collide: false`): drawn opaque, no collision at all
 *   x = -3   bullet-proof window (`sight: false`): see-through, bullets stop
 *   x = 3    thin plank boards (`bullets: false`): hides you, bullets pass (penetrable)
 *   x = 9    couch-like block (`sight: false`, bullets stop), drawn opaque, 1.9 m tall
 *   x = 15   crate drawn turned 30 degrees over a smaller unturned collision box (sight passes the
 *            drawn corners)
 */
export function coverMap(): MapData {
  const sp = (x: number, z: number, yaw = 0) => ({ x, y: 0, z, yaw });
  const W = 2;
  const H = 2.2;
  return {
    id: 'test_cover',
    name: 'Test Cover',
    bounds: { min: { x: -20, y: -2, z: -20 }, max: { x: 20, y: 12, z: 20 } },
    materials: { ground: { texture: 'ground' }, wall: { texture: 'steel' }, concrete: { texture: 'bo_concrete' }, glass: { texture: 'bo_glass' }, planks: { texture: 'bo_planks' }, fabric: { texture: 'bo_fabric' }, crate: { texture: 'crate' } },
    brushes: [
      { min: { x: -21, y: -1, z: -21 }, max: { x: 21, y: 0, z: 21 }, mat: 'ground' },
      box(42, 4, 0.5, 'wall', 0, 0, -20.25),
      box(42, 4, 0.5, 'wall', 0, 0, 20.25),
      box(0.5, 4, 42, 'wall', -20.25, 0, 0),
      box(0.5, 4, 42, 'wall', 20.25, 0, 0),
      box(W, H, 0.4, 'concrete', -15, 0, -5),
      box(W, H, 0.4, 'concrete', -9, 0, -5, { collide: false }),
      box(W, H, 0.06, 'glass', -3, 0, -5, { sight: false }),
      box(W, H, 0.1, 'planks', 3, 0, -5, { bullets: false }),
      box(W, 1.9, 0.9, 'fabric', 9, 0, -5, { sight: false }),
      // Drawn 2.6 x 2.6 turned 30 degrees; collision only the inner 1.6 x 1.6.
      box(2.6, H, 2.6, 'crate', 15, 0, -5, { collide: false, ry: Math.PI / 6 }),
      box(1.6, H, 1.6, 'crate', 15, 0, -5, { noRender: true }),
    ],
    decals: [],
    props: [],
    lights: [],
    spawns: { teams: [[sp(0, 15)], [sp(0, -15, Math.PI)]], ffa: [sp(0, 15), sp(0, -15, Math.PI)] },
    objectives: {},
    times: [{ id: 'day', name: 'Day', clock: '12:00', sky: 'skyGrey', skyRot: 0, sunDir: { x: 0, y: 1, z: 0 }, sun: [1, 1, 1], amb: [0.5, 0.5, 0.5], fog: [0.5, 0.5, 0.5], fogNear: 10, fogFar: 100, unlit: [1, 1, 1], lights: {}, glow: 0 }],
    defaultTime: 'day',
  };
}

/**
 * The six covers of coverMap: where the bot stands, where the player hides and peeks (feet), and
 * whether bullets may pass by design (penetrable) or the cover can be seen through.
 */
export const COVERS = [
  { kind: 'concrete', bot: { x: -15, y: 0, z: 10 }, hide: { x: -15, y: 0, z: -6.2 }, peek: { x: -12.8, y: 0, z: -6.2 }, penetrable: false, seeThrough: false },
  { kind: 'render-only', bot: { x: -9, y: 0, z: 10 }, hide: { x: -9, y: 0, z: -6.2 }, peek: { x: -6.8, y: 0, z: -6.2 }, penetrable: false, seeThrough: false },
  { kind: 'bulletproof-glass', bot: { x: -3, y: 0, z: 10 }, hide: { x: -3, y: 0, z: -6.2 }, peek: { x: -0.8, y: 0, z: -6.2 }, penetrable: false, seeThrough: true },
  { kind: 'thin-planks', bot: { x: 3, y: 0, z: 10 }, hide: { x: 3, y: 0, z: -6.2 }, peek: { x: 5.2, y: 0, z: -6.2 }, penetrable: true, seeThrough: false },
  { kind: 'couch', bot: { x: 9, y: 0, z: 10 }, hide: { x: 9, y: 0, z: -6.3 }, peek: { x: 11.2, y: 0, z: -6.3 }, penetrable: false, seeThrough: false },
  { kind: 'turned-crate', bot: { x: 16.2, y: 0, z: 10 }, hide: { x: 16.2, y: 0, z: -7.4 }, peek: { x: 18.6, y: 0, z: -7.4 }, penetrable: false, seeThrough: false },
] as const;

/** coverMap's covers as CoverSpots for peekSim. */
export const coverMapSpots = (): CoverSpot[] => COVERS.map((c) => ({ bot: { ...c.bot }, cover: { ...c.hide }, peek: { ...c.peek }, blocker: c.kind }));

// ---------------------------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------------------------

let rulesRegistered = false;

export interface TestRoom {
  room: Room;
  close(): void;
}

/** A TDM room on `map` (a map id, or MapData swapped in), bots managed by us, playing. */
export function testRoom(map: string | MapData, difficulty: BotDifficultyId = 'regular'): TestRoom {
  if (!rulesRegistered) {
    registerModeRules();
    rulesRegistered = true;
  }
  const store = new Store(':memory:');
  const lobby = new Lobby({ store, features: FEATURES, log: () => {}, autoTick: false });
  const room = lobby.createRoom({ mode: 'tdm', map: typeof map === 'string' ? map : 'yard', closeWhenEmpty: false, private: true });
  if (typeof map !== 'string') {
    room.map = map;
    room.world = buildCollisionWorld(map);
  }
  configureRoomBots(room, { fill: false, difficulty, variance: 0 }, { waitSec: 0 });
  return {
    room,
    close() {
      lobby.shutdown();
      store.close();
    },
  };
}

export const steps = (r: Room, seconds: number, each?: () => void) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) {
    r.step();
    each?.();
  }
};

/** Put a player on the ground at `at`, facing `yaw`, alive and topped up. */
export function place(r: Room, p: PlayerState, at: Vec3, yaw = 0): void {
  if (!p.alive) r.spawn(p);
  const g = r.world.groundBelow(at.x, at.z, at.y + 0.6, 2);
  p.move = { ...createMoveState(at.x, g ?? at.y, at.z), onGround: true };
  p.yaw = yaw;
  p.pitch = 0;
  p.health = p.maxHealth;
}

/** A bot with no killstreaks and no grenades (bullets only), standing at `at`. */
export function addShooter(r: Room, team: 0 | 1, at: Vec3, face: Vec3, name = 'Shooter'): PlayerState {
  const bot = r.addBot({ name, team });
  if (bot.nextLoadout) bot.nextLoadout = { ...bot.nextLoadout, killstreaks: [], lethal: null, tactical: null };
  r.spawn(bot);
  place(r, bot, at, yawTo(at, face));
  const brain = botBrain(r, bot)!;
  brain.onSpawn(bot, r.time, r);
  brain.forced = { at: { ...bot.move }, radius: 0.6, hold: true };
  return bot;
}

/** A player driven by `think` (the bots feature's brain replaced), standing at `at`. */
export function addScripted(r: Room, team: 0 | 1, at: Vec3, think: (room: Room, self: PlayerState) => { buttons: number; yaw: number; pitch?: number } | null, name = 'Player'): PlayerState {
  const p = r.addBot({ name, team });
  // No perks either: Second Chance's bleed-out kill would be credited to a bot without a shot.
  if (p.nextLoadout) p.nextLoadout = { ...p.nextLoadout, perks: [], killstreaks: [], lethal: null, tactical: null };
  r.spawn(p);
  place(r, p, at);
  p.brain = {
    think: (room, self) => {
      const o = think(room, self);
      return o ? { buttons: o.buttons, yaw: o.yaw, pitch: o.pitch ?? 0, weaponSlot: 0 } : { buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: 0 };
    },
  };
  return p;
}

/** Buttons that walk `self` toward `to` while looking along `yaw` (strafing as needed). */
export function walkKeys(self: PlayerState, yaw: number, to: Vec3, stopAt = 0.12): number {
  const mx = to.x - self.move.x;
  const mz = to.z - self.move.z;
  const l = Math.hypot(mx, mz);
  if (l < stopAt) return 0;
  const f = (-Math.sin(yaw) * mx - Math.cos(yaw) * mz) / l;
  const r = (Math.cos(yaw) * mx - Math.sin(yaw) * mz) / l;
  let b = 0;
  if (f > 0.38) b |= Buttons.FORWARD;
  if (f < -0.38) b |= Buttons.BACK;
  if (r > 0.38) b |= Buttons.RIGHT;
  if (r < -0.38) b |= Buttons.LEFT;
  return b;
}

// ---------------------------------------------------------------------------------------------
// Visibility helpers
// ---------------------------------------------------------------------------------------------

export interface Pose {
  x: number;
  y: number;
  z: number;
  crouched: boolean;
}

/** Points spread over a player's hitboxes (centres, side edges, top of the head). */
export function hitboxPoints(p: Pose): Vec3[] {
  const hb = playerHitboxes(p, p.crouched);
  const out: Vec3[] = [];
  for (const b of [hb.head, hb.torso, hb.legs]) {
    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    const hx = ((b.max.x - b.min.x) / 2) * 0.9;
    const hz = ((b.max.z - b.min.z) / 2) * 0.9;
    out.push({ x: cx, y: cy, z: cz }, { x: cx - hx, y: cy, z: cz }, { x: cx + hx, y: cy, z: cz }, { x: cx, y: cy, z: cz - hz }, { x: cx, y: cy, z: cz + hz });
  }
  out.push({ x: p.x, y: hb.head.max.y - 0.03, z: p.z });
  return out;
}

/** The geometry the checks need (a Room, or a map and its collision). */
export type Geo = Pick<Room, 'world' | 'map'>;

const poseOf = (p: PlayerState): Pose => ({ x: p.move.x, y: p.move.y, z: p.move.z, crouched: p.move.crouched });

/** No bullet from `eye` could reach any part of a player at `pose` (collision bullets mask). */
export function hiddenFromBullets(r: Geo, eye: Vec3, pose: Pose, drawnToo = false): boolean {
  for (const q of hitboxPoints(pose)) {
    if (!r.world.lineOfSight(eye, q, 'bullets')) continue;
    if (drawnToo && occludersFor(r.map).first(eye, q, true)) continue;
    return false;
  }
  return true;
}

/** Nothing of a player at `pose` can be seen from `eye` (collision sight mask, optionally drawn geometry too). */
export function hiddenFromSight(r: Geo, eye: Vec3, pose: Pose, drawnToo: boolean): boolean {
  for (const q of hitboxPoints(pose)) {
    if (drawnToo ? botCanSee(r.world, r.map, eye, q) : r.world.lineOfSight(eye, q, 'sight')) return false;
  }
  return true;
}

/** Any of the points a bot looks for (chest, eyes, head centre) is in view from `eye`, drawn geometry included. */
export function exposed(r: Geo, eye: Vec3, p: PlayerState): boolean {
  return [chestOf(p), eyePointOf(p), headOf(p)].some((q) => botCanSee(r.world, r.map, eye, q));
}

const eyeAt = (c: Vec3, crouched = false): Vec3 => ({ x: c.x, y: c.y + (crouched ? PLAYER.crouchEye : PLAYER.eye), z: c.z });

// ---------------------------------------------------------------------------------------------
// Spots on real maps
// ---------------------------------------------------------------------------------------------

export interface CoverSpot {
  /** Bot position, the player's hiding cell and the peek cell (feet). */
  bot: Vec3;
  cover: Vec3;
  peek: Vec3;
  /** What blocks bot -> cover (material and brush index of the first solid on the chest line). */
  blocker: string;
}

/**
 * Bot / cover / peek triples on a real map, deterministic for a seed. `kind`:
 *   'wall'   the player at the cover cell is behind collision that stops both bullets and sight;
 *   'render' it is hidden only by drawn geometry (collision lets sight through to its chest).
 */
export function coverSpots(map: MapData, n: number, seed: number, kind: 'wall' | 'render' = 'wall', tries = 6000): CoverSpot[] {
  return withSeed(seed, () => {
    const world = buildCollisionWorld(map);
    const nav = navFor(map);
    const occ = occludersFor(map);
    const out: CoverSpot[] = [];
    const used: Vec3[] = [];
    for (let t = 0; t < tries && out.length < n; t++) {
      const c = nav.random();
      if (!c || !c.core) continue;
      if (used.some((u) => Math.hypot(u.x - c.x, u.z - c.z) < 6)) continue;
      const b = nav.random();
      if (!b || !b.core) continue;
      const d = Math.hypot(b.x - c.x, b.z - c.z);
      if (d < 8 || d > 30 || Math.abs(b.y - c.y) > 3) continue;
      const eye = eyeAt(b);
      const pose: Pose = { x: c.x, y: c.y, z: c.z, crouched: false };
      const chest = { x: c.x, y: c.y + 1.15, z: c.z };
      // Hidden from the bot's eye standing and crouched (bots crouch while holding a spot).
      const eyes = [eye, eyeAt(b, true)];
      if (kind === 'wall') {
        if (!eyes.every((e) => hiddenFromBullets({ world, map }, e, pose) && hiddenFromSight({ world, map }, e, pose, false))) continue;
      } else {
        // Collision lets sight through to the chest; the drawn geometry hides everything.
        if (!world.lineOfSight(eye, chest, 'sight')) continue;
        if (!eyes.every((e) => hiddenFromSight({ world, map }, e, pose, true))) continue;
      }
      // A peek cell 1-2.5 m away, walkable in a straight line, with the chest in plain view.
      let peek: Vec3 | null = null;
      for (let k = 0; k < 16 && !peek; k++) {
        const a = (k / 16) * Math.PI * 2;
        const r = 1 + (k % 4) * 0.5;
        const pc = nav.cellAt({ x: c.x + Math.cos(a) * r, y: c.y, z: c.z + Math.sin(a) * r }, true);
        if (!pc || !pc.core || Math.abs(pc.y - c.y) > 0.3 || !nav.straight(c, pc)) continue;
        const pch = { x: pc.x, y: pc.y + 1.15, z: pc.z };
        if (botCanSee(world, map, eye, pch) && botCanHit(world, map, eye, pch)) peek = { x: pc.x, y: pc.y, z: pc.z };
      }
      if (!peek) continue;
      const dir = { x: chest.x - eye.x, y: chest.y - eye.y, z: chest.z - eye.z };
      const l = Math.hypot(dir.x, dir.y, dir.z);
      const hit = world.raycast(eye, { x: dir.x / l, y: dir.y / l, z: dir.z / l }, l, 'sight');
      const o = kind === 'render' ? occ.first(eye, chest) : null;
      const blocker = o ? `${o.mat}#${o.source}` : hit ? `${hit.solid.mat}#${hit.solid.source}` : '?';
      used.push({ x: c.x, y: c.y, z: c.z });
      out.push({ bot: { x: b.x, y: b.y, z: b.z }, cover: { x: c.x, y: c.y, z: c.z }, peek, blocker });
    }
    return out;
  });
}

// ---------------------------------------------------------------------------------------------
// The peek simulation
// ---------------------------------------------------------------------------------------------

export interface PeekSimOpts {
  map: string | MapData;
  spots: CoverSpot[];
  /** Seconds per spot. */
  seconds: number;
  difficulty?: BotDifficultyId;
  seed?: number;
  /** Round trip for the on-screen estimate (ms); input batching and tick wait are added. */
  rttMs?: number;
  /** The player ducks back into cover the moment it's hit (as a person would). */
  retreatOnHit?: boolean;
  /** Cover counts as penetrable (bullets may pass by design) for these spot indices. */
  penetrable?: (spot: number) => boolean;
  /** Called once per spot with the room and its two players (debugging). */
  onRoom?: (r: Room, bot: PlayerState, player: PlayerState, spot: number) => void;
  /** Called for every death by a bot bullet (debugging). */
  onKill?: (k: { spot: number; time: number; origin: Vec3; end: Vec3; pose: Pose; botAt: Vec3; throughSolid: boolean; hiddenOnServer: boolean; throughDrawn: boolean; hiddenOnScreen: boolean; weapon: string; deathAt: number; hits: string }) => void;
}

export interface PeekSimResult {
  seconds: number;
  peeks: number;
  /** Player deaths to bot bullets, and the share in each category. */
  deaths: number;
  /** The killing ray crossed bullet-stopping collision (impossible unless penetrable). */
  throughSolid: number;
  /** Every part of the victim's current hitbox was behind bullet-stopping collision when hit. */
  hiddenOnServer: number;
  /** The killing ray crossed drawn, bullet-stopping geometry without collision. */
  throughDrawn: number;
  /** Already fully behind cover (collision or drawn) on the victim's screen when the kill arrived. */
  hiddenOnScreen: number;
  /** Deaths while walking back into cover. */
  whileRetreating: number;
  /** Bot shots fired while the target was fully hidden from them (bullets), and all bot shots. */
  shotsAtHidden: number;
  shots: number;
  /** Seconds from the start of each exposure to the first shot at it, by the time hidden before. */
  reacquire: { hiddenSec: number; firstShotSec: number }[];
  /** Total delay used for the screen estimate (ms). */
  screenLagMs: number;
}

/** Input batching (60 Hz flush: half a slot on average) and the server's tick wait (half a tick). */
export const INPUT_DELAY_MS = 1000 / 60 / 2 + 1000 / 60 / 2;

export function peekSim(o: PeekSimOpts): PeekSimResult {
  const rtt = o.rttMs ?? 35;
  const lag = (rtt + INPUT_DELAY_MS) / 1000;
  const res: PeekSimResult = { seconds: 0, peeks: 0, deaths: 0, throughSolid: 0, hiddenOnServer: 0, throughDrawn: 0, hiddenOnScreen: 0, whileRetreating: 0, shotsAtHidden: 0, shots: 0, reacquire: [], screenLagMs: lag * 1000 };
  o.spots.forEach((spot, si) => {
    withSeed((o.seed ?? 11) * 1000 + si, () => {
      const tr = testRoom(o.map, o.difficulty ?? 'regular');
      const r = tr.room;
      try {
        steps(r, 0.1);
        let phase: 'hide' | 'out' | 'hold' | 'back' = 'hide';
        let until = r.time + 1 + Math.random() * 1.5;
        let crouchPeek = false;
        let hiddenSince = r.time;
        let exposedAt = -1;
        let exposureHidden = 0;
        let shotThisExposure = false;
        const player = addScripted(r, 1, spot.cover, (room, self) => {
          const yaw = yawTo(self.move, spot.bot);
          const now = room.time;
          if (phase === 'hide' && now >= until) {
            phase = 'out';
            crouchPeek = Math.random() < 0.25;
            res.peeks++;
          }
          if (phase === 'out' && Math.hypot(self.move.x - spot.peek.x, self.move.z - spot.peek.z) < 0.15) {
            phase = 'hold';
            until = now + 0.3 + Math.random() * 1.2;
          }
          if (phase === 'hold' && now >= until) phase = 'back';
          if (phase === 'back' && Math.hypot(self.move.x - spot.cover.x, self.move.z - spot.cover.z) < 0.15) {
            phase = 'hide';
            until = now + 0.5 + Math.random() * 2.5;
          }
          const to = phase === 'out' || phase === 'hold' ? spot.peek : spot.cover;
          let b = walkKeys(self, yaw, to);
          if (crouchPeek && phase === 'hold') b |= Buttons.CROUCH;
          return { buttons: b, yaw };
        });
        const bot = addShooter(r, 0, spot.bot, spot.peek);
        r.bus.on('spawn', ({ player: p }) => {
          if (p === player) {
            place(r, player, spot.cover);
            phase = 'hide';
            until = r.time + 1 + Math.random() * 1.5;
          }
        });
        o.onRoom?.(r, bot, player, si);
        if (o.retreatOnHit)
          r.bus.on('damage', (e) => {
            if (e.victim === player && (phase === 'out' || phase === 'hold')) phase = 'back';
          });
        const eyeOfBot = () => ({ x: bot.move.x, y: bot.move.y + (bot.move.crouched ? PLAYER.crouchEye : PLAYER.eye), z: bot.move.z });
        let pendingKill: { attacker: PlayerState; pose: Pose; vx: number; vz: number; retreating: boolean; t: number } | null = null;
        r.bus.on('death', (e) => {
          if (e.victim !== player || e.means !== 'bullet' || !e.attacker) return;
          pendingKill = { attacker: e.attacker, pose: poseOf(player), vx: player.move.vx, vz: player.move.vz, retreating: phase === 'back', t: r.time };
        });
        r.bus.on('fire', (e) => {
          if (e.player !== bot) return;
          res.shots++;
          const hiddenNow = player.alive && hiddenFromBullets(r, e.origin, poseOf(player));
          if (hiddenNow) res.shotsAtHidden++;
          if (exposedAt >= 0 && !shotThisExposure) {
            shotThisExposure = true;
            res.reacquire.push({ hiddenSec: exposureHidden, firstShotSec: r.time - exposedAt });
          }
          const k = pendingKill;
          if (!k || k.attacker !== bot) return;
          pendingKill = null;
          // The killing shot's 'fire' follows its 'death' in the same tick.
          if (k.t !== r.time) return;
          res.deaths++;
          if (k.retreating) res.whileRetreating++;
          const hit = e.hits.find((h) => h.victim === player);
          // The ray's end on the victim (pellet 0 for single-bullet guns), else the hit part's centre.
          const hb = playerHitboxes(k.pose, k.pose.crouched);
          const part = hb[hit?.part ?? 'torso'];
          const centre = { x: (part.min.x + part.max.x) / 2, y: (part.min.y + part.max.y) / 2, z: (part.min.z + part.max.z) / 2 };
          const endOnBody = Math.hypot(e.end.x - k.pose.x, e.end.z - k.pose.z) < 0.6 ? e.end : centre;
          const len = Math.hypot(endOnBody.x - e.origin.x, endOnBody.y - e.origin.y, endOnBody.z - e.origin.z);
          const back = (len - 0.02) / Math.max(len, 1e-6);
          const justShort = { x: e.origin.x + (endOnBody.x - e.origin.x) * back, y: e.origin.y + (endOnBody.y - e.origin.y) * back, z: e.origin.z + (endOnBody.z - e.origin.z) * back };
          const throughSolid = !r.world.lineOfSight(e.origin, justShort, 'bullets') && !(o.penetrable?.(si) ?? false);
          const hiddenOnServer = hiddenFromBullets(r, e.origin, k.pose);
          const throughDrawn = !!occludersFor(r.map).first(e.origin, justShort, true);
          const screen: Pose = { ...k.pose, x: k.pose.x + k.vx * lag, z: k.pose.z + k.vz * lag };
          const hiddenOnScreen = hiddenFromBullets(r, e.origin, screen, true) && hiddenFromSight(r, e.origin, screen, true);
          if (throughSolid) res.throughSolid++;
          if (hiddenOnServer) res.hiddenOnServer++;
          if (throughDrawn) res.throughDrawn++;
          if (hiddenOnScreen) res.hiddenOnScreen++;
          o.onKill?.({ spot: si, time: r.time, origin: e.origin, end: e.end, pose: k.pose, botAt: { ...bot.move }, throughSolid, hiddenOnServer, throughDrawn, hiddenOnScreen, weapon: e.weapon, deathAt: k.t, hits: e.hits.map((h) => `${h.victim.name}:${h.part}:${h.damage.toFixed(0)}`).join(',') });
        });
        const total = Math.round(o.seconds / TICK_DT);
        for (let i = 0; i < total; i++) {
          r.step();
          if (r.phase !== 'playing') break;
          // Exposure: the bot could see the player's chest, eyes or head (drawn geometry counts).
          const visible = player.alive && bot.alive && exposed(r, eyeOfBot(), player);
          if (visible && exposedAt < 0) {
            exposedAt = r.time;
            exposureHidden = r.time - hiddenSince;
            shotThisExposure = false;
          } else if (!visible && exposedAt >= 0) {
            exposedAt = -1;
            hiddenSince = r.time;
          } else if (!visible && !player.alive) hiddenSince = r.time;
        }
        res.seconds += o.seconds;
      } finally {
        tr.close();
      }
    });
  });
  return res;
}

/** One line per result for logs and the docs. */
export function formatPeek(label: string, s: PeekSimResult): string {
  const pct = (n: number) => (s.deaths ? ((100 * n) / s.deaths).toFixed(1) : '0.0') + '%';
  const rq = (lo: number, hi: number) => {
    const xs = s.reacquire.filter((x) => x.hiddenSec >= lo && x.hiddenSec < hi).map((x) => x.firstShotSec);
    if (!xs.length) return 'n/a';
    xs.sort((a, b) => a - b);
    return `${xs.length}x min ${xs[0]!.toFixed(2)} med ${xs[Math.floor(xs.length / 2)]!.toFixed(2)}`;
  };
  return `${label}: ${s.seconds}s, ${s.peeks} peeks, ${s.deaths} deaths | through collision ${s.throughSolid} (${pct(s.throughSolid)}), hidden on server ${s.hiddenOnServer} (${pct(s.hiddenOnServer)}), through drawn cover ${s.throughDrawn} (${pct(s.throughDrawn)}), hidden on screen @${s.screenLagMs.toFixed(0)}ms ${s.hiddenOnScreen} (${pct(s.hiddenOnScreen)}), retreating ${s.whileRetreating} | shots ${s.shots}, at fully hidden ${s.shotsAtHidden} | first shot after peek: hidden<0.3s ${rq(0, 0.3)}; 0.3-1s ${rq(0.3, 1)}; >=1s ${rq(1, 99)}`;
}
