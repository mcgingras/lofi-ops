/**
 * Tactical Nuke presentation maths (client): the countdown number, phases, white-out, slow
 * motion, cloud growth, shockwave timing by distance, the caller's laptop pose and the HUD lines.
 */
import { describe, expect, it } from 'vitest';
import { findNuke, laptopPose, nukeFrame, nukeLines, nukeSide, readNuke, sirenTick, type NukeInfo } from '../src/client/features/killstreaks/nuke-logic';
import { KS_ENTITY } from '../src/shared/defs/killstreaks';
import { NUKE, blastPoint, cloudGrowth, countdownNumber, nukeEndAt, nukePhase, nukeTimeScale, nukeWhite, shockAt } from '../src/shared/defs/nuke';
import type { EntitySnap } from '../src/shared/protocol';

const times = { a: 100, d: 110, n: 100, f: 220 };
const ent: EntitySnap = { id: 7, kind: KS_ENTITY.nuke, x: 0, y: 0, z: -150, yaw: 0, team: 1, s: { ...times, o: 'p1' } };
const info: NukeInfo = readNuke(ent)!;

describe('countdown and phases', () => {
  it('counts 10 down to 1 over the ten seconds, then 0', () => {
    expect(countdownNumber(100, times)).toBe(10);
    expect(countdownNumber(100.5, times)).toBe(10);
    expect(countdownNumber(101, times)).toBe(9);
    expect(countdownNumber(108.2, times)).toBe(2);
    expect(countdownNumber(109.99, times)).toBe(1);
    expect(countdownNumber(110, times)).toBe(0);
    // Before the countdown starts (laptop) it shows the full ten.
    expect(countdownNumber(99, times)).toBe(10);
  });

  it('arming, countdown, detonated', () => {
    expect(nukePhase(98.6, times)).toBe('arming');
    expect(nukePhase(100, times)).toBe('countdown');
    expect(nukePhase(109.9, times)).toBe('countdown');
    expect(nukePhase(110, times)).toBe('detonated');
  });

  it('the shockwave reaches near things first and everyone within the spread', () => {
    expect(shockAt(100, times)).toBeCloseTo(110 + NUKE.shockDelaySec);
    expect(shockAt(220, times)).toBeCloseTo(110 + NUKE.shockDelaySec + NUKE.shockSpreadSec);
    expect(shockAt(160, times)).toBeCloseTo(110 + NUKE.shockDelaySec + NUKE.shockSpreadSec / 2);
    expect(shockAt(10, times)).toBeCloseTo(shockAt(100, times));
    expect(nukeEndAt(times)).toBeGreaterThan(shockAt(1e6, times));
  });

  it('puts the blast past the map edge in the given direction', () => {
    const b = blastPoint({ x: 10, y: 0, z: 0 }, 40, 0);
    expect(b).toEqual({ x: 10, y: 0, z: -(40 + NUKE.blastOut) });
    const e = blastPoint({ x: 0, y: 0, z: 0 }, 40, Math.PI / 2);
    expect(e.x).toBeCloseTo(-(40 + NUKE.blastOut));
  });
});

describe('flash, slow motion and cloud', () => {
  it('flash: full white at once, eases to a washed-out view, white again when the shockwave hits', () => {
    expect(nukeWhite(-1)).toBe(0);
    expect(nukeWhite(0.2)).toBe(1);
    expect(nukeWhite(1)).toBeGreaterThan(0.3);
    expect(nukeWhite(1)).toBeLessThan(1);
    expect(nukeWhite(2.5)).toBeLessThan(0.25);
    expect(nukeWhite(2.5, -0.5)).toBe(nukeWhite(2.5));
    expect(nukeWhite(2.5, 0.25)).toBeCloseTo(0.5);
    expect(nukeWhite(3.5, 1)).toBe(1);
  });

  it('slow motion eases in and out over the beat', () => {
    expect(nukeTimeScale(-1)).toBe(1);
    expect(nukeTimeScale(0)).toBe(1);
    expect(nukeTimeScale(1.5)).toBeCloseTo(NUKE.slowmoSpeed);
    expect(nukeTimeScale(0.2)).toBeGreaterThan(NUKE.slowmoSpeed);
    expect(nukeTimeScale(NUKE.slowmoSec + 0.1)).toBe(1);
  });

  it('cloud grows from nothing, monotonic, to full', () => {
    expect(cloudGrowth(0)).toBe(0);
    let prev = 0;
    for (let s = 0.25; s <= 8; s += 0.25) {
      const g = cloudGrowth(s);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
    expect(cloudGrowth(1)).toBeGreaterThan(0.25);
    expect(cloudGrowth(10)).toBe(1);
  });
});

describe('per-frame view', () => {
  it('reads the entity and finds it among others', () => {
    expect(info).toMatchObject({ entity: 7, owner: 'p1', team: 1, times, blast: { x: 0, y: 0, z: -150 } });
    expect(readNuke({ ...ent, s: { a: 1 } })).toBeNull();
    expect(readNuke({ ...ent, kind: KS_ENTITY.uav })).toBeNull();
    expect(findNuke([{ ...ent, id: 1, kind: KS_ENTITY.uav }, ent])!.entity).toBe(7);
    expect(findNuke([])).toBeNull();
  });

  it('sides: mine, friendly, enemy (FFA: everyone else is an enemy)', () => {
    expect(nukeSide(info, 'p1', 1)).toBe('mine');
    expect(nukeSide(info, 'p2', 1)).toBe('friendly');
    expect(nukeSide(info, 'p3', 0)).toBe('enemy');
    expect(nukeSide({ ...info, team: null }, 'p3', null)).toBe('enemy');
  });

  it('a near viewer is hit before a far one; white holds to the end, then eases behind the results', () => {
    const near = nukeFrame(112.5, info, 100);
    const far = nukeFrame(112.5, info, 220);
    expect(near.hitSince).toBeGreaterThan(0);
    expect(far.hitSince).toBeLessThan(0);
    expect(near.white).toBe(1);
    expect(far.white).toBeLessThan(0.5);
    expect(nukeFrame(nukeEndAt(times), info, 220).white).toBe(1);
    expect(nukeFrame(nukeEndAt(times) + 5, info, 220).white).toBeCloseTo(0.3);
    expect(nukeFrame(105, info, 150)).toMatchObject({ phase: 'countdown', number: 5, white: 0, timeScale: 1, cloud: 0, shake: 0, laptop: -1 });
  });

  it('the laptop runs from the call to just after the countdown starts: raise, lid, key press, put away', () => {
    expect(nukeFrame(times.a - NUKE.laptopSec - 0.1, info, 150).laptop).toBe(-1);
    const k0 = nukeFrame(times.a - NUKE.laptopSec, info, 150).laptop;
    expect(k0).toBe(0);
    expect(nukeFrame(times.a, info, 150).laptop).toBeGreaterThan(0.5);
    expect(nukeFrame(times.a + 0.5, info, 150).laptop).toBe(-1);
    expect(laptopPose(-1)).toEqual({ raise: 0, lid: 0, press: 0 });
    expect(laptopPose(0.5).raise).toBe(1);
    expect(laptopPose(0.5).lid).toBeGreaterThan(0.9);
    expect(laptopPose(0.625).press).toBeCloseTo(1);
    expect(laptopPose(1).raise).toBeCloseTo(0);
  });

  it('the siren sounds once per countdown second', () => {
    let prev = 99.9;
    const fired: number[] = [];
    for (let t = 99.9; t < 111; t += 1 / 60) {
      const s = sirenTick(prev, t, times);
      if (s !== null) fired.push(s);
      prev = t;
    }
    expect(fired).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('announcer lines per side, then the final count', () => {
    expect(nukeLines('mine', 10)).toEqual({ head: 'TACTICAL NUKE INCOMING', line: 'YOU CALLED IN A TACTICAL NUKE' });
    expect(nukeLines('friendly', 9, 'Viper').line).toBe('FRIENDLY TACTICAL NUKE INBOUND (VIPER)');
    expect(nukeLines('enemy', 9).line).toBe('ENEMY TACTICAL NUKE INBOUND');
    expect(nukeLines('enemy', 5).line).toBe('NOWHERE TO HIDE');
    expect(nukeLines('enemy', 2).line).toBe('IMPACT IN 2');
    expect(nukeLines('mine', 0).line).toBe('');
  });
});
