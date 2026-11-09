/**
 * Timers that outlive a match: the match clock never goes back (game/clock.ts), a marker thrown
 * late in one match doesn't hide the gun in the next, and the Spy Plane's radar rules
 * (radar-logic.ts): a sweep every second, blips that hold between sweeps, enemies beyond the
 * minimap pulled on to its edge.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/client/render/textures', async (orig) => {
  const T = await import('three');
  const real = await orig<typeof import('../src/client/render/textures')>();
  const tex = new T.Texture();
  return { ...real, getTexture: () => tex, hasTexture: () => true, registerTexture: () => {}, bindTexture: () => {}, unbindTexture: () => {} };
});

import { markerClient } from '../src/client/features/killstreaks/marker';
import { clampToRadar, PING_SEC, sweepPings, SWEEP_SEC, type Ping } from '../src/client/features/killstreaks/radar-logic';
import { matchClockStart, matchClockTick } from '../src/client/game/clock';
import type { Match } from '../src/client/game/match';
import { matchHooks } from '../src/client/registry';
import { KILLSTREAK_BY_ID } from '../src/shared/defs/killstreaks';

describe('match clock', () => {
  it('a new match starts past the last one, never back at 0', () => {
    const first = matchClockStart();
    matchClockTick(first + 480);
    expect(matchClockStart()).toBeGreaterThan(first + 480);
    // An older match still ticking (teardown order) can't pull it back.
    const next = matchClockStart();
    matchClockTick(first + 5);
    expect(matchClockStart()).toBe(next);
  });
});

describe('Care Package / Mystery Box marker', () => {
  it('a throw late in one match does not hide the gun in the next', () => {
    const hook = matchHooks.get('killstreaks.marker')!;
    // What a throw 500 s into the last match left behind.
    markerClient.thrownAt = 500;
    const m = {
      time: 1,
      alive: true,
      phase: 'playing',
      slot: 0,
      yaw: 0,
      pitch: 0,
      netRtt: 0.05,
      controls: { locked: true, triggerHeld: false, isHeld: () => false },
      viewmodel: { visible: true },
    } as unknown as Match;
    const stop = hook.start!(m);
    hook.frame!(m, 1 / 60);
    expect(m.viewmodel.visible).toBe(true);
    if (typeof stop === 'function') stop();
  });
});

describe('Spy Plane radar', () => {
  const foes = [{ x: 10, z: -4 }, { x: -30, z: 60 }];

  it('sweeps as soon as it is up, then every second, replacing the last blips', () => {
    let s = sweepPings([], -Infinity, 100, true, foes);
    expect(s.pings).toEqual([{ x: 10, z: -4, t: 100 }, { x: -30, z: 60, t: 100 }]);
    // Between sweeps the blips hold where they were, whatever the enemies do.
    s = sweepPings(s.pings, s.lastSweep, 100 + SWEEP_SEC * 0.9, true, [{ x: 0, z: 0 }]);
    expect(s.pings.map((p) => p.t)).toEqual([100, 100]);
    s = sweepPings(s.pings, s.lastSweep, 100 + SWEEP_SEC, true, [{ x: 12, z: -4 }]);
    expect(s.pings).toEqual([{ x: 12, z: -4, t: 100 + SWEEP_SEC }]);
  });

  it('there is always a blip between sweeps, and they run out once the plane is gone', () => {
    expect(PING_SEC).toBeGreaterThan(SWEEP_SEC);
    const up: Ping[] = [{ x: 1, z: 2, t: 100 }];
    expect(sweepPings(up, 100, 100 + SWEEP_SEC * 0.99, false, foes).pings).toHaveLength(1);
    expect(sweepPings(up, 100, 100 + PING_SEC + 0.01, false, foes).pings).toEqual([]);
  });

  it('an enemy beyond the minimap shows on its edge, in their direction', () => {
    expect(clampToRadar(10, -20, 28)).toEqual({ x: 10, y: -20, out: false });
    const p = clampToRadar(56, -112, 28);
    expect(p.out).toBe(true);
    expect(p.x).toBeCloseTo(14);
    expect(p.y).toBeCloseTo(-28);
  });

  it('the Spy Plane flies for 45 s, the Blackbird no shorter', () => {
    expect(KILLSTREAK_BY_ID.get('uav')!.durationSec).toBe(45);
    expect(KILLSTREAK_BY_ID.get('blackbird')!.durationSec).toBeGreaterThanOrEqual(45);
  });
});
