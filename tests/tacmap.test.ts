/**
 * Tactical map (BO1 radio targeting for Napalm, Mortar Team, Rolling Thunder, Attack Helicopter):
 * target validation, run-direction maths and footprints (shared), and the server's map mode rules
 * (radio up, body still, weapon down, cancel/death keep the streak, validated RPC, bots unaffected).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { callKillstreak, readyKillstreaks, suggestTarget } from '../src/server/features/killstreaks/api';
import { onStreakPressed } from '../src/server/features/killstreaks/index';
import { submitMapTarget } from '../src/server/features/killstreaks/mapmode';
import { ksOf, stateMsg } from '../src/server/features/killstreaks/state';
import { AIRSPACE } from '../src/server/features/killstreaks/streaks/heli';
import { KILLSTREAKS, KILLSTREAK_BY_ID, KS_ENTITY } from '../src/shared/defs/killstreaks';
import { MAP_MODE, STRIKE, clampInside, dirOfYaw, mapPointsNeeded, strikeFootprint, takeToken, validateMapTarget, wrapAngle, yawFromDrag } from '../src/shared/defs/tactical-map';
import { viewDir } from '../src/shared/math';
import type { Room } from '../src/server/room';
import { bot, give, gunKill, place, rig, steps, until, type Rig } from './perks-streaks.helpers';

const B = { min: { x: -20, y: -5, z: -30 }, max: { x: 20, y: 20, z: 30 } };
const def = (id: string) => KILLSTREAK_BY_ID.get(id)!;

describe('tactical map maths (shared)', () => {
  it('map-targeted streaks are Napalm, Mortar Team, Rolling Thunder and the Attack Helicopter', () => {
    const map = KILLSTREAKS.filter((k) => k.targeting === 'map').map((k) => [k.id, k.mapPick, mapPointsNeeded(k)]);
    expect(map).toEqual([
      ['napalm', 'line', 1],
      ['mortar', 'points', 3],
      ['attack_helicopter', 'area', 1],
      ['rolling_thunder', 'line', 1],
    ]);
    // Care Package, Sentry and SAM keep their in-world placement.
    expect([def('care_package').targeting, def('sentry_gun').targeting, def('sam_turret').targeting]).toEqual(['point', 'place', 'place']);
  });

  it('run direction from a drag matches viewDir (yaw 0 = north = -z, +yaw towards -x)', () => {
    const a = { x: 0, z: 0 };
    expect(yawFromDrag(a, { x: 0, z: -10 })).toBeCloseTo(0);
    expect(yawFromDrag(a, { x: -10, z: 0 })).toBeCloseTo(Math.PI / 2);
    expect(yawFromDrag(a, { x: 10, z: 0 })).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(yawFromDrag(a, { x: 0, z: 10 }))).toBeCloseTo(Math.PI);
    for (const yaw of [0, 0.7, -2, 3]) {
      const d = dirOfYaw(yaw);
      const v = viewDir(yaw, 0);
      expect(d.x).toBeCloseTo(v.x);
      expect(d.z).toBeCloseTo(v.z);
      expect(yawFromDrag(a, { x: d.x * 5, z: d.z * 5 })).toBeCloseTo(wrapAngle(yaw));
    }
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI / 2);
  });

  it('footprints follow the run and match the strike geometry', () => {
    const n = strikeFootprint('napalm', [{ x: 1, z: 2 }], Math.PI / 2); // runs towards -x
    expect(n.map((c) => [Math.round(c.x), Math.round(c.z), c.r])).toEqual([
      [7, 2, STRIKE.napalm.blastR],
      [1, 2, STRIKE.napalm.blastR],
      [-5, 2, STRIKE.napalm.blastR],
    ]);
    const t = strikeFootprint('rolling_thunder', [{ x: 0, z: 0 }], 0);
    expect(t).toHaveLength(STRIKE.rolling_thunder.bombs);
    expect(t[0]!.z).toBeCloseTo(((STRIKE.rolling_thunder.bombs - 1) / 2) * STRIKE.rolling_thunder.spacing); // first bomb south of the spot
    expect(strikeFootprint('mortar', [{ x: 1, z: 1 }, { x: 2, z: 2 }, { x: 3, z: 3 }]).map((c) => c.r)).toEqual([3.5, 3.5, 3.5]); // ~7 m across (BO1)
    expect(strikeFootprint('attack_helicopter', [{ x: 0, z: 0 }])[0]!.r).toBe(STRIKE.attack_helicopter.patrolR);
  });

  it('validates count, bounds, types and yaw', () => {
    expect(validateMapTarget(def('napalm'), B, { points: [[1, 2]], yaw: 0.5 })).toEqual({ ok: true, points: [{ x: 1, z: 2 }], yaw: 0.5 });
    expect(validateMapTarget(def('napalm'), B, { points: [[1, 2]], yaw: 7 })).toMatchObject({ ok: true, yaw: expect.closeTo(7 - Math.PI * 2, 6) });
    expect(validateMapTarget(def('napalm'), B, { points: [[1, 2]] })).toEqual({ ok: false, reason: 'bad_yaw' });
    expect(validateMapTarget(def('napalm'), B, { points: [[1, 2]], yaw: Infinity })).toEqual({ ok: false, reason: 'bad_yaw' });
    expect(validateMapTarget(def('napalm'), B, { points: [[1, 2], [3, 4]], yaw: 0 })).toEqual({ ok: false, reason: 'count' });
    expect(validateMapTarget(def('mortar'), B, { points: [[1, 2], [3, 4]] })).toEqual({ ok: false, reason: 'count' });
    expect(validateMapTarget(def('mortar'), B, { points: [[1, 2], [3, 4], [-5, 6]] })).toEqual({ ok: true, points: [{ x: 1, z: 2 }, { x: 3, z: 4 }, { x: -5, z: 6 }], yaw: null });
    expect(validateMapTarget(def('mortar'), B, { points: [[1, 2], [3, 4], [-50, 6]] })).toEqual({ ok: false, reason: 'out_of_bounds' });
    expect(validateMapTarget(def('attack_helicopter'), B, { points: [[0, 31]] })).toEqual({ ok: false, reason: 'out_of_bounds' });
    expect(validateMapTarget(def('attack_helicopter'), B, { points: [['0', 1]] })).toEqual({ ok: false, reason: 'bad_request' });
    expect(validateMapTarget(def('attack_helicopter'), B, { points: [[NaN, 1]] })).toEqual({ ok: false, reason: 'bad_request' });
    expect(validateMapTarget(def('attack_helicopter'), B, null)).toEqual({ ok: false, reason: 'bad_request' });
    expect(validateMapTarget(def('uav'), B, { points: [[0, 0]] })).toEqual({ ok: false, reason: 'not_map_streak' });
    expect(validateMapTarget(def('care_package'), B, { points: [[0, 0]] })).toEqual({ ok: false, reason: 'not_map_streak' });
    // On the edge (cursor rounding) is fine and gets clamped inside.
    expect(validateMapTarget(def('attack_helicopter'), B, { points: [[20.3, -30.2]] })).toEqual({ ok: true, points: [{ x: 19, z: -29 }], yaw: null });
    expect(clampInside(B, { x: -100, z: 100 })).toEqual({ x: -19, z: 29 });
  });

  it('rate limits with a token bucket', () => {
    const b = { tokens: MAP_MODE.rpcBurst, at: 0 };
    for (let i = 0; i < MAP_MODE.rpcBurst; i++) expect(takeToken(b, 0)).toBe(true);
    expect(takeToken(b, 0)).toBe(false);
    expect(takeToken(b, 0.6)).toBe(true); // refills at rpcPerSec
    expect(takeToken(b, 0.6)).toBe(false);
  });
});

let r: Rig | undefined;
afterEach(() => {
  r?.close();
  r = undefined;
});
const setup = (map = 'yard') => (r = rig({ map })).room;

/** A "human" caller: map mode is for players who see it (bots never open it). */
const human = (room: Room) => {
  const a = bot(room, 0);
  a.isBot = false;
  place(a, -10, 20);
  return a;
};

describe('map mode (server)', () => {
  it('STREAK raises the radio: weapon down, body still, radio entity; STREAK again puts it away and keeps the streak', () => {
    const room = setup();
    const a = human(room);
    give(a, 'napalm');
    onStreakPressed(room, a);
    expect(ksOf(a).map?.id).toBe('napalm');
    expect(stateMsg(room, a).map).toMatchObject({ id: 'napalm' });
    expect(ksOf(a).armed).toBeNull(); // no crosshair designator
    const radio = room.entities.byKind(KS_ENTITY.radio);
    expect(radio).toHaveLength(1);
    expect(radio[0]!.owner).toBe(a.id);
    steps(room, 0.1);
    expect(a.swapEnd).toBeGreaterThan(room.time);
    expect(room.modifiers.mul('speedMultiplier', a)).toBe(0);
    expect(room.modifiers.any('canSprint', a)).toBe(false);
    onStreakPressed(room, a);
    expect(ksOf(a).map).toBeNull();
    expect(room.entities.byKind(KS_ENTITY.radio)).toHaveLength(0);
    expect(readyKillstreaks(a)).toEqual(['napalm']);
  });

  it('dying, the timeout and changing selection put the radio away; the streak is kept', () => {
    const room = setup();
    const a = human(room);
    give(a, 'mortar');
    give(a, 'uav');
    ksOf(a).selected = 0;
    onStreakPressed(room, a);
    expect(ksOf(a).map?.id).toBe('mortar');
    gunKill(room, bot(room, 1), a);
    expect(ksOf(a).map).toBeNull();
    expect(room.entities.byKind(KS_ENTITY.radio)).toHaveLength(0);
    expect(readyKillstreaks(a)).toEqual(['mortar', 'uav']);
    room.spawn(a);
    place(a, -10, 20);
    ksOf(a).selected = 0;
    onStreakPressed(room, a);
    expect(ksOf(a).map?.id).toBe('mortar');
    steps(room, MAP_MODE.maxSec + 0.2);
    expect(ksOf(a).map).toBeNull();
    expect(readyKillstreaks(a)).toContain('mortar');
  });

  it('mapTarget calls the strike exactly where chosen, along the chosen direction', () => {
    const room = setup();
    const a = human(room);
    give(a, 'napalm');
    // Not open yet: refused.
    expect(submitMapTarget(room, a, { id: 'napalm', points: [[-1, 0]], yaw: 0 })).toEqual({ ok: false, reason: 'map_closed' });
    onStreakPressed(room, a);
    expect(submitMapTarget(room, a, { id: 'napalm', points: [[-1, 0]] })).toEqual({ ok: false, reason: 'bad_yaw' });
    expect(submitMapTarget(room, a, { id: 'napalm', points: [[-1, 999]], yaw: 0 })).toEqual({ ok: false, reason: 'out_of_bounds' });
    expect(submitMapTarget(room, a, { id: 'mortar', points: [[-1, 0]], yaw: 0 })).toEqual({ ok: false, reason: 'not_ready' });
    const booms: { x: number; z: number }[] = [];
    const rr = room as unknown as { sendFeature: (p: unknown, id: string, data: unknown) => void };
    const orig = rr.sendFeature.bind(room);
    rr.sendFeature = (p, id, data) => {
      if (id === 'killstreaks.fx' && (data as { kind: string }).kind === 'napalm') booms.push(data as { x: number; z: number });
      orig(p, id, data);
    };
    steps(room, 1); // refill the rate limit bucket
    const yaw = Math.PI / 2; // runs towards -x
    expect(submitMapTarget(room, a, { id: 'napalm', points: [[-1, 2]], yaw })).toEqual({ ok: true });
    expect(ksOf(a).map).toBeNull();
    expect(readyKillstreaks(a)).toEqual([]);
    const jet = room.entities.byKind(KS_ENTITY.jet)[0]!;
    expect(jet.yaw).toBeCloseTo(yaw);
    until(room, () => booms.length === 3, 8);
    const want = strikeFootprint('napalm', [{ x: -1, z: 2 }], yaw);
    expect(booms.map((b) => [Math.round(b.x), Math.round(b.z)])).toEqual(want.map((c) => [Math.round(c.x), Math.round(c.z)]));
  });

  it('napalm releases about 4 s after the call, Rolling Thunder about 7 s (BO1)', () => {
    const room = setup();
    const a = human(room);
    const firstBoom = (id: string) => {
      let at = -1;
      const off = room.bus.on('damage', () => {
        if (at < 0) at = room.time;
      });
      const v = bot(room, 1);
      place(v, -1, 0);
      give(a, id);
      const t0 = room.time;
      expect(callKillstreak(room, a, id, { target: { x: -1, y: 0, z: 0 }, yaw: 0 }).ok).toBe(true);
      until(room, () => at >= 0, 12);
      off();
      return at - t0;
    };
    const n = firstBoom('napalm');
    expect(n).toBeGreaterThan(3);
    expect(n).toBeLessThan(5);
    steps(room, 10);
    const t = firstBoom('rolling_thunder');
    expect(t).toBeGreaterThan(5.5);
    expect(t).toBeLessThan(8);
  });

  it('mortar needs three points; the Attack Helicopter patrols the chosen area', () => {
    const room = setup();
    const a = human(room);
    give(a, 'mortar');
    onStreakPressed(room, a);
    expect(submitMapTarget(room, a, { id: 'mortar', points: [[0, 0], [5, 5]] })).toEqual({ ok: false, reason: 'count' });
    expect(submitMapTarget(room, a, { id: 'mortar', points: [[0, 0], [5, 5], [-8, -6]] })).toEqual({ ok: true });
    expect(room.entities.byKind(KS_ENTITY.mortarMark).map((e) => [e.x, e.z])).toEqual([
      [0, 0],
      [5, 5],
      [-8, -6],
    ]);
    give(a, 'attack_helicopter');
    ksOf(a).selected = 0;
    onStreakPressed(room, a);
    expect(ksOf(a).map?.id).toBe('attack_helicopter');
    steps(room, 1);
    expect(submitMapTarget(room, a, { id: 'attack_helicopter', points: [[6, -8]] })).toEqual({ ok: true });
    const heli = room.entities.byKind(KS_ENTITY.heli)[0]!;
    expect(heli.s).toMatchObject({ px: 6, pz: -8 });
    steps(room, 12);
    expect(Math.hypot(heli.x - 6, heli.z + 8)).toBeLessThan((heli.s!.pr as number) + 3);
  });

  it('rate limits map RPCs', () => {
    const room = setup();
    const a = human(room);
    give(a, 'napalm');
    onStreakPressed(room, a);
    const bad = { id: 'napalm', points: [[0, 999]], yaw: 0 };
    const reasons = Array.from({ length: MAP_MODE.rpcBurst + 2 }, () => (submitMapTarget(room, a, bad) as { reason: string }).reason);
    expect(reasons.slice(0, MAP_MODE.rpcBurst)).toEqual(Array(MAP_MODE.rpcBurst).fill('out_of_bounds'));
    expect(reasons.slice(MAP_MODE.rpcBurst)).toEqual(['rate_limited', 'rate_limited']);
  });

  it('the radio does not open with a full airspace', () => {
    const room = setup();
    const a = human(room);
    for (let i = 0; i < AIRSPACE; i++) {
      give(a, 'attack_helicopter');
      expect(callKillstreak(room, a, 'attack_helicopter').ok).toBe(true);
    }
    give(a, 'attack_helicopter');
    onStreakPressed(room, a);
    expect(ksOf(a).map).toBeNull();
  });

  it('bots skip the map: they aim at clusters of enemies they know about', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, -10, 20);
    const e1 = bot(room, 1);
    place(e1, 5, -5);
    const e2 = bot(room, 1);
    place(e2, 7, -4);
    const s = suggestTarget(room, a, 'napalm', 1);
    expect(Math.hypot(s.target!.x - 6, s.target!.z + 4.5)).toBeLessThan(4);
    give(a, 'napalm');
    expect(callKillstreak(room, a, 'napalm', s).ok).toBe(true);
    expect(ksOf(a).map ?? null).toBeNull();
  });
});
