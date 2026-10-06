import { describe, expect, it } from 'vitest';
import { HitboxHistory } from '../src/server/lagcomp';

describe('lag compensation history', () => {
  const h = new HitboxHistory(1, 60);
  // A target walking +x at 6 m/s, recorded every tick for 2 s (buffer keeps ~1 s).
  for (let i = 0; i <= 120; i++) h.record(i / 60, [['t', { x: (i / 60) * 6, y: 0, z: 0, crouched: false, alive: true }]]);
  const now = 2;

  it('rewinds to an exact tick', () => {
    expect(h.poseAt('t', 1.9)!.x).toBeCloseTo(11.4, 6);
  });

  it('interpolates between ticks', () => {
    expect(h.poseAt('t', 1.905)!.x).toBeCloseTo(11.43, 6);
  });

  it('clamps rewinds to 250 ms', () => {
    expect(HitboxHistory.clampTime(now - 1, now)).toBeCloseTo(now - 0.25, 9);
    expect(HitboxHistory.clampTime(now + 1, now)).toBe(now);
    expect(HitboxHistory.clampTime(Number.NaN, now)).toBe(now);
    const p = h.rewind(HitboxHistory.clampTime(now - 0.6, now)).get('t')!;
    expect(p.x).toBeCloseTo((now - 0.25) * 6, 6);
  });

  it('drops frames older than its window', () => {
    expect(h.poseAt('t', 0.2)!.x).toBeGreaterThan(5);
  });
});
