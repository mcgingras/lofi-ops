/**
 * Headless bot simulations for tuning and the metric tests (tests/bots.sim.test.ts) and the
 * report script (scripts/bots-metrics.ts):
 *
 *   duel()      one bot against a scripted target (still or strafing) at a set distance: time to
 *               first shot, time to kill and hit rate in the first 0.5 s, from first sighting.
 *   simMatch()  a bot-only match on a map/mode: spawn deaths, distance to the nearest enemy at
 *               spawn, clustering (teammates within 8 m), lane spread, KC confirms/denies, S&D
 *               plants, tick time.
 *
 * Math.random is replaced by a seeded generator for the duration of each run so numbers repeat.
 */
import { botBrain, configureRoomBots } from '../src/server/features/bots/api';
import { FEATURES } from '../src/server/features/index';
import { controllerOf } from '../src/server/features/modes/common';
import { registerModeRules } from '../src/server/features/modes/index';
import { spawnStats } from '../src/server/features/modes/spawns';
import { Lobby } from '../src/server/lobby';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import type { BotDifficultyId, BotSkill } from '../src/shared/defs/bots';
import { Buttons } from '../src/shared/input';
import { buildCollisionWorld, box, type MapData } from '../src/shared/maps/types';
import { createMoveState } from '../src/shared/movement';

/** A flat 100 x 24 m walled range for duels (nothing in the way, no hazards). */
export function rangeMap(): MapData {
  const sp = (x: number, z: number, yaw = 0) => ({ x, y: 0, z, yaw });
  return {
    id: 'test_range',
    name: 'Test Range',
    bounds: { min: { x: -50, y: -2, z: -12 }, max: { x: 50, y: 12, z: 12 } },
    materials: { ground: { texture: 'ground' }, wall: { texture: 'steel' } },
    brushes: [
      { min: { x: -51, y: -1, z: -13 }, max: { x: 51, y: 0, z: 13 }, mat: 'ground' },
      box(102, 4, 0.5, 'wall', 0, 0, -12.25),
      box(102, 4, 0.5, 'wall', 0, 0, 12.25),
      box(0.5, 4, 26, 'wall', -50.25, 0, 0),
      box(0.5, 4, 26, 'wall', 50.25, 0, 0),
    ],
    decals: [],
    props: [],
    lights: [],
    spawns: { teams: [[sp(-45, 0)], [sp(45, 0, Math.PI)]], ffa: [sp(-45, 0), sp(45, 0, Math.PI)] },
    objectives: {},
    times: [{ id: 'day', name: 'Day', clock: '12:00', sky: 'skyGrey', skyRot: 0, sunDir: { x: 0, y: 1, z: 0 }, sun: [1, 1, 1], amb: [0.5, 0.5, 0.5], fog: [0.5, 0.5, 0.5], fogNear: 10, fogFar: 100, unlit: [1, 1, 1], lights: {}, glow: 0 }],
    defaultTime: 'day',
  };
}
const RANGE = rangeMap();

/** Run `fn` with Math.random seeded (Park-Miller). */
export function withSeed<T>(seed: number, fn: () => T): T {
  const orig = Math.random;
  let s = (seed % 2147483646) + 1;
  Math.random = () => (s = (s * 48271) % 2147483647) / 2147483647;
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

let rulesRegistered = false;

function makeLobby(): { lobby: Lobby; store: Store } {
  if (!rulesRegistered) {
    registerModeRules();
    rulesRegistered = true;
  }
  const store = new Store(':memory:');
  const lobby = new Lobby({ store, features: FEATURES, log: () => {}, autoTick: false });
  return { lobby, store };
}

const steps = (r: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) r.step();
};

// ---------------------------------------------------------------------------------------------
// Duels
// ---------------------------------------------------------------------------------------------

export interface DuelOpts {
  difficulty: BotDifficultyId | 'custom';
  custom?: BotSkill;
  distance: number;
  strafe: boolean;
  trials?: number;
  seed?: number;
  weapon?: string;
  /** Called once the room and both bots exist (e.g. start a Glitch against the shooter's side). */
  setup?: (room: Room, shooter: PlayerState, target: PlayerState) => void;
}

export interface DuelResult {
  /** Mean seconds from first sighting to the first shot (trials that fired). */
  firstShot: number;
  /** Median seconds from first sighting to the kill (trials that killed within the window). */
  ttkMedian: number;
  ttkMean: number;
  /** Share of trials that killed within 0.6 s / within the 3 s window. */
  under06: number;
  killRate: number;
  /** Hits / shots in the first 0.5 s after the first shot. */
  hit05: number;
  /** Hits / shots over the whole engagement. */
  hitAll: number;
}

/**
 * On a flat walled range: the shooter faces 20-45 degrees off the target, which is placed in
 * view at t = 0 (first sighting). The target never shoots back.
 */
export function duel(o: DuelOpts): DuelResult {
  const trials = o.trials ?? 30;
  return withSeed(o.seed ?? 7, () => {
    const { lobby, store } = makeLobby();
    try {
      const r = lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, private: true });
      r.map = RANGE;
      r.world = buildCollisionWorld(RANGE);
      configureRoomBots(r, { fill: false, difficulty: o.difficulty, custom: o.custom, variance: 0 }, { waitSec: 0 });
      const shooter = r.addBot({ name: 'Shooter', team: 0 });
      const target = r.addBot({ name: 'Target', team: 1 });
      steps(r, 0.3);
      o.setup?.(r, shooter, target);
      let strafeDir = 1;
      let strafeUntil = 0;
      target.brain = {
        think: (room, self) => {
          if (!o.strafe) return { buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: 0 };
          if (room.time >= strafeUntil) {
            strafeDir = -strafeDir;
            strafeUntil = room.time + 0.35 + Math.random() * 0.5;
          }
          return { buttons: strafeDir > 0 ? Buttons.RIGHT : Buttons.LEFT, yaw: self.yaw, pitch: 0, weaponSlot: 0 };
        },
      };
      const brain = botBrain(r, shooter)!;
      let shots = 0;
      let hits = 0;
      let shots05 = 0;
      let hits05 = 0;
      let firstShotAt = -1;
      let t0 = 0;
      r.bus.on('fire', (e) => {
        if (e.player !== shooter) return;
        const hit = e.hits.some((h) => h.victim === target);
        if (firstShotAt < 0) firstShotAt = r.time;
        shots++;
        if (hit) hits++;
        if (r.time - firstShotAt <= 0.5) {
          shots05++;
          if (hit) hits05++;
        }
      });
      const firsts: number[] = [];
      const ttks: number[] = [];
      for (let k = 0; k < trials; k++) {
        // Fresh lives for both, placed for this trial.
        if (!shooter.alive) r.spawn(shooter);
        if (!target.alive) r.spawn(target);
        const sx = -30;
        const sz = 0;
        shooter.move = { ...createMoveState(sx, 0, sz), onGround: true };
        shooter.weapons = [makeWeapon({ weapon: o.weapon ?? 'ak47', attachments: [], camo: '' }, 'ak47'), shooter.weapons[1]!];
        shooter.slot = 0;
        shooter.swapEnd = 0;
        shooter.reloadEnd = 0;
        shooter.health = shooter.maxHealth;
        // No killstreaks: only the gun counts.
        shooter.stats.streak = 0;
        if (shooter.loadout) shooter.loadout = { ...shooter.loadout, killstreaks: [] };
        const tx = sx + o.distance;
        target.move = { ...createMoveState(tx, 0, sz - 0.5 + (Math.random() - 0.5)), onGround: true };
        target.yaw = Math.PI / 2;
        target.health = target.maxHealth;
        target.lastDamageTime = -999;
        // Facing down the lane, 20-45 degrees off the target (it has to turn onto it).
        const off = (20 + Math.random() * 25) * (Math.PI / 180) * (Math.random() < 0.5 ? -1 : 1);
        const face = -Math.PI / 2 + off;
        brain.onSpawn(shooter, r.time);
        brain.aim.yaw = face;
        brain.aim.pitch = 0;
        shooter.yaw = face;
        firstShotAt = -1;
        t0 = r.time;
        let killedAt = -1;
        for (let i = 0; i < Math.round(3 / TICK_DT); i++) {
          r.step();
          if (!target.alive) {
            killedAt = r.time;
            break;
          }
          if (!shooter.alive) break;
        }
        if (process.env.DUEL_DEBUG) console.log(`trial ${k}: first ${(firstShotAt - t0).toFixed(2)} kill ${(killedAt - t0).toFixed(2)} hp ${target.health} alive ${target.alive}`);
        if (firstShotAt >= 0) firsts.push(firstShotAt - t0);
        if (killedAt >= 0) ttks.push(killedAt - t0);
        // Rest a moment so the next trial starts cold.
        brain.target = null;
        steps(r, 0.2);
      }
      ttks.sort((a, b) => a - b);
      const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
      return {
        firstShot: mean(firsts),
        ttkMedian: ttks.length ? ttks[Math.floor(ttks.length / 2)]! : NaN,
        ttkMean: mean(ttks),
        under06: ttks.filter((t) => t < 0.6).length / trials,
        killRate: ttks.length / trials,
        hit05: hits05 / Math.max(1, shots05),
        hitAll: hits / Math.max(1, shots),
      };
    } finally {
      lobby.shutdown();
      store.close();
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------------------------

export interface MatchOpts {
  map: string;
  mode: string;
  players?: number;
  seconds: number;
  difficulty?: BotDifficultyId;
  seed?: number;
}

export interface MatchResult {
  map: string;
  mode: string;
  kills: number;
  spawns: number;
  /** Deaths within 3 s of spawning / spawns (initial match-start spawns excluded). */
  spawnDeathRate: number;
  /** Share of dynamic spawn picks where no candidate was safe (enemy near or in view). */
  unsafeSpawns: number;
  /** Mean distance (m) from a spawn to the nearest living enemy. */
  spawnEnemyDist: number;
  /** Mean teammates within 8 m of a living bot (team modes). */
  mates8: number;
  /** Share of samples where a bot has 3+ teammates within 8 m. */
  pack3: number;
  /** Share of bot time in the busiest of three lanes across the spawn-to-spawn axis (1/3 = even). */
  topLane: number;
  confirms: number;
  denies: number;
  rounds: number;
  plants: number;
  /** Mean and max room.step() CPU time (ms, process.cpuUsage: steady under machine load), and the 99th percentile. */
  tickMean: number;
  tickP99: number;
  tickMax: number;
}

export function simMatch(o: MatchOpts): MatchResult {
  return withSeed(o.seed ?? 11, () => {
    const { lobby, store } = makeLobby();
    try {
      const r = lobby.createRoom({ mode: o.mode, map: o.map, closeWhenEmpty: false, private: true, autoStart: false, countdownSec: 0, onEnd: 'lobby', postMatchSec: 999 });
      configureRoomBots(r, { fill: true, targetPlayers: o.players ?? 12, difficulty: o.difficulty ?? 'regular', variance: 0.15 }, { waitSec: 0 });
      r.startMatch();
      const picks0 = spawnStats.picks;
      const unsafe0 = spawnStats.unsafe;
      const team = r.mode.teams;
      const sp = r.map.spawns;
      const c0 = centroid(sp.teams[0]);
      const c1 = centroid(sp.teams[1]);
      let ax = c1.x - c0.x;
      let az = c1.z - c0.z;
      const al = Math.hypot(ax, az) || 1;
      ax /= al;
      az /= al;
      // Lane coordinate: the perpendicular offset, banded into thirds of the map's extent.
      const perp = (p: { x: number; z: number }) => (p.x - (c0.x + c1.x) / 2) * -az + (p.z - (c0.z + c1.z) / 2) * ax;
      const b = r.map.bounds;
      const corners = [
        { x: b.min.x, z: b.min.z },
        { x: b.max.x, z: b.min.z },
        { x: b.min.x, z: b.max.z },
        { x: b.max.x, z: b.max.z },
      ].map(perp);
      const pmin = Math.min(...corners) * 0.7;
      const pmax = Math.max(...corners) * 0.7;
      const lanes = [0, 0, 0];

      const spawnAt = new Map<string, number>();
      let spawns = 0;
      let spawnDeaths = 0;
      let spawnDist = 0;
      let spawnDistN = 0;
      let kills = 0;
      let plants = 0;
      const startT = r.time;
      r.bus.on('spawn', ({ player }) => {
        spawnAt.set(player.id, r.time);
        if (r.time - startT < 1) return;
        spawns++;
        let nd = Infinity;
        for (const q of r.players.values()) if (q !== player && q.alive && r.isEnemy(player, q)) nd = Math.min(nd, Math.hypot(q.move.x - player.move.x, q.move.z - player.move.z));
        if (nd < Infinity) {
          spawnDist += nd;
          spawnDistN++;
        }
      });
      const spawnPos = new Map<string, { x: number; y: number; z: number }>();
      r.bus.on('spawn', ({ player }) => spawnPos.set(player.id, { ...player.move }));
      r.bus.on('death', ({ victim, attacker }) => {
        kills++;
        const at = spawnAt.get(victim.id);
        if (at !== undefined && r.time - startT >= 1 && r.time - at < 3 && at - startT >= 1) {
          spawnDeaths++;
          if (process.env.SPAWN_DEBUG && attacker) {
            const sp = spawnPos.get(victim.id)!;
            const as = spawnPos.get(attacker.id);
            console.log(`spawn death ${victim.name} after ${(r.time - at).toFixed(2)}s: killer ${attacker.name} now ${Math.hypot(attacker.move.x - sp.x, attacker.move.z - sp.z).toFixed(1)} m from the spawn, killer spawned ${as ? (r.time - (spawnAt.get(attacker.id) ?? 0)).toFixed(1) : '?'}s ago, victim moved ${Math.hypot(victim.move.x - sp.x, victim.move.z - sp.z).toFixed(1)} m`);
          }
        }
      });
      let mates = 0;
      let pack = 0;
      let samples = 0;
      const ticks: number[] = [];
      const n = Math.round(o.seconds / TICK_DT);
      let lastPlanted = false;
      for (let i = 0; i < n; i++) {
        const t = process.cpuUsage();
        r.step();
        const u = process.cpuUsage(t);
        ticks.push((u.user + u.system) / 1000);
        if (r.phase !== 'playing') {
          if (r.phase === 'ended' || r.phase === 'lobby') break;
          continue;
        }
        if (o.mode === 'sd') {
          const c = controllerOf(r) as unknown as { bomb?: { state: string } } | null;
          const planted = c?.bomb?.state === 'planted';
          if (planted && !lastPlanted) plants++;
          lastPlanted = planted;
        }
        if (i % 30 === 0) {
          const alive = [...r.players.values()].filter((p) => p.alive);
          for (const p of alive) {
            if (team) {
              let m = 0;
              for (const q of alive) if (q !== p && q.team === p.team && Math.hypot(q.move.x - p.move.x, q.move.z - p.move.z) < 8) m++;
              mates += m;
              if (m >= 3) pack++;
              samples++;
            }
            const v = (perp(p.move) - pmin) / (pmax - pmin || 1);
            lanes[Math.max(0, Math.min(2, Math.floor(v * 3)))]!++;
          }
        }
      }
      ticks.sort((a, c) => a - c);
      const ctrl = controllerOf(r) as unknown as { confirmed?: [number, number]; denied?: [number, number]; round?: number } | null;
      const laneTotal = lanes[0]! + lanes[1]! + lanes[2]! || 1;
      return {
        map: o.map,
        mode: o.mode,
        kills,
        spawns,
        spawnDeathRate: spawnDeaths / Math.max(1, spawns),
        spawnEnemyDist: spawnDist / Math.max(1, spawnDistN),
        unsafeSpawns: (spawnStats.unsafe - unsafe0) / Math.max(1, spawnStats.picks - picks0),
        mates8: mates / Math.max(1, samples),
        pack3: pack / Math.max(1, samples),
        topLane: Math.max(...lanes) / laneTotal,
        confirms: ctrl?.confirmed ? ctrl.confirmed[0] + ctrl.confirmed[1] : 0,
        denies: ctrl?.denied ? ctrl.denied[0] + ctrl.denied[1] : 0,
        rounds: o.mode === 'sd' ? (ctrl?.round ?? 0) : 0,
        plants,
        tickMean: ticks.reduce((a, c) => a + c, 0) / Math.max(1, ticks.length),
        tickP99: ticks[Math.floor(ticks.length * 0.99)] ?? 0,
        tickMax: ticks.at(-1) ?? 0,
      };
    } finally {
      lobby.shutdown();
      store.close();
    }
  });
}

function centroid(pts: readonly { x: number; z: number }[]): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p.x;
    z += p.z;
  }
  return { x: x / Math.max(1, pts.length), z: z / Math.max(1, pts.length) };
}

export type { PlayerState };
