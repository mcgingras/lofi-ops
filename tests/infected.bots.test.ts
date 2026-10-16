/**
 * Bots in Infected, simulated in real rooms with every feature (seeded): Infected bots hunt a
 * Survivor down (close the distance, knife or tomahawk them), Survivor bots group up at a rally
 * point and hold it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { botBrain, configureRoomBots } from '../src/server/features/bots/api';
import { FEATURES } from '../src/server/features/index';
import { controllerOf } from '../src/server/features/modes/common';
import { registerModeRules } from '../src/server/features/modes/index';
import type { InfectedRules } from '../src/server/features/modes/infected';
import { rallyPoint } from '../src/server/features/modes/infected-bots';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import { rangeMap, withSeed } from './bots-sim';
import { buildCollisionWorld } from '../src/shared/maps/types';

let store: Store | undefined;
let lobby: Lobby | undefined;

afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

function infectedRoom(map = 'yard'): { room: Room; rules: InfectedRules } {
  registerModeRules();
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: FEATURES, log: () => {}, autoTick: false });
  const room = lobby.createRoom({ mode: 'infected', map, private: true, closeWhenEmpty: false });
  configureRoomBots(room, { fill: false, difficulty: 'regular', variance: 0 }, { waitSec: 0 });
  return { room, rules: controllerOf(room) as unknown as InfectedRules };
}

const steps = (r: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) r.step();
};
const flat = (a: PlayerState, b: { x: number; z: number }) => Math.hypot(a.move.x - b.x, a.move.z - b.z);

describe('Infected bots', () => {
  it.each([
    ['yard', 7],
    ['nuketown', 3],
    ['firingrange', 5],
  ])('Infected bots close the distance on a Survivor and get them (%s)', (map, seed) => {
    withSeed(seed, () => {
      const { room, rules } = infectedRoom(map);
      const survivor = room.addBot({ name: 'Target' });
      const hunters = [0, 1, 2].map((i) => room.addBot({ name: `Hunter${i}` }));
      steps(room, 0.5);
      // The Survivor stands still in the middle of the Yard (no shooting back).
      survivor.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: 0 }) };
      const hot = room.map.hotspots?.[0] ?? room.map.spawns.ffa[0]!;
      survivor.move.x = hot.x;
      survivor.move.y = hot.y;
      survivor.move.z = hot.z;
      rules.makeFirst(hunters[0]!);
      // The other two die and come back Infected (the first one then drops to the knife).
      room.kill(hunters[1]!, null, { weapon: 'world', means: 'fall' });
      room.kill(hunters[2]!, null, { weapon: 'world', means: 'fall' });
      expect(hunters.every((h) => rules.roleOf(h) === 'infected')).toBe(true);
      steps(room, 3.3);
      expect(hunters.every((h) => h.alive && h.weapons.length === 1 && h.weapons[0]!.def.base.id === 'knife')).toBe(true);
      const start = Math.min(...hunters.map((h) => flat(h, survivor.move)));
      expect(start).toBeGreaterThan(8);
      let closest = start;
      let t = 0;
      while (t < 40 && rules.roleOf(survivor) === 'survivor') {
        steps(room, 0.25);
        t += 0.25;
        if (survivor.alive) closest = Math.min(closest, ...hunters.filter((h) => h.alive).map((h) => flat(h, survivor.move)));
      }
      // Infected (knifed or a tomahawk) well inside the time, or at least run down to arm's length.
      expect(rules.roleOf(survivor) === 'infected' || closest < 2.5).toBe(true);
      expect(t).toBeLessThan(40);
      expect(closest).toBeLessThan(start * 0.5);
    });
  });

  it('an Infected bot lobs its tomahawk at a Survivor in sight at mid range', () => {
    withSeed(2, () => {
      const { room, rules } = infectedRoom();
      const map = rangeMap();
      room.map = map;
      room.world = buildCollisionWorld(map);
      const survivor = room.addBot({ name: 'Target' });
      const hunter = room.addBot({ name: 'Hunter' });
      const extra = room.addBot({ name: 'Extra' });
      steps(room, 0.3);
      survivor.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: 0 }) };
      rules.makeFirst(extra);
      room.kill(hunter, null, { weapon: 'world', means: 'fall' });
      extra.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: 0 }) };
      steps(room, 3.3);
      Object.assign(extra.move, { x: -45, y: 0, z: 8, vx: 0, vz: 0 });
      expect(hunter.weapons[0]!.def.base.id).toBe('knife');
      // Face to face, 14 m apart on the open range.
      Object.assign(survivor.move, { x: 7, y: 0, z: 0, vx: 0, vz: 0 });
      Object.assign(hunter.move, { x: -7, y: 0, z: 0, vx: 0, vz: 0 });
      hunter.yaw = -Math.PI / 2;
      botBrain(room, hunter)!.aim.yaw = -Math.PI / 2;
      const thrown: string[] = [];
      room.bus.on('weapons.thrown', (e) => thrown.push(`${e.player.id}:${e.equipment}`));
      steps(room, 2.5);
      expect(thrown).toContain(`${hunter.id}:tomahawk`);
    });
  });

  it('Survivor bots group up at a rally point and hold it', () => {
    withSeed(11, () => {
      const { room, rules } = infectedRoom();
      const survivors = [0, 1, 2, 3].map((i) => room.addBot({ name: `Surv${i}` }));
      steps(room, 0.2);
      // No infection for this test: the Survivors only regroup.
      rules.pickAt = room.time + 1000;
      steps(room, 25);
      const rally = rallyPoint(room, rules)!;
      expect(rally).not.toBeNull();
      const before = survivors.map((s) => ({ x: s.move.x, z: s.move.z }));
      for (const s of survivors) expect(flat(s, rally)).toBeLessThan(6);
      let maxMove = 0;
      for (let i = 0; i < 40; i++) {
        steps(room, 0.25);
        survivors.forEach((s, k) => (maxMove = Math.max(maxMove, flat(s, before[k]!))));
      }
      // Holding: shuffling around the spot, not wandering off.
      expect(maxMove).toBeLessThan(6);
      for (const s of survivors) expect(flat(s, rally)).toBeLessThan(6);
      const goal = botBrain(room, survivors[0]!)?.goal;
      expect(goal?.kind).toBe('objective');
    });
  });
});
