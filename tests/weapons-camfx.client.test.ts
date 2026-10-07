/** Camera shake / concussion timing: effects stamped in a previous room never replay. */
import { describe, expect, it } from 'vitest';
import { shakeAmplitude, stunStrength } from '../src/client/features/weapons/camfx';

describe('weapons camera effects', () => {
  it('a shake lasts half a second and fades', () => {
    const s = { at: 10, amount: 1 };
    expect(shakeAmplitude(10, s)).toBeCloseTo(0.03);
    expect(shakeAmplitude(10.25, s)).toBeCloseTo(0.015);
    expect(shakeAmplitude(10.5, s)).toBe(0);
  });

  it('a shake stamped in the future (previous room, later clock) is over, not huge', () => {
    // Regression: after a frag near you in one room, the next room (clock back near 0) shook the
    // camera by (1 - (now - at) / 0.5) * 0.03, i.e. several radians of roll every frame.
    expect(shakeAmplitude(5, { at: 400, amount: 0.8 })).toBe(0);
    expect(stunStrength(5, { at: 400, dur: 3, amount: 1 })).toBe(0);
  });

  it('a concussion holds, then fades over its last 1.2 s', () => {
    const s = { at: 0, dur: 3, amount: 1 };
    expect(stunStrength(0.5, s)).toBe(1);
    expect(stunStrength(2.4, s)).toBeCloseTo(0.5);
    expect(stunStrength(3, s)).toBe(0);
  });
});
