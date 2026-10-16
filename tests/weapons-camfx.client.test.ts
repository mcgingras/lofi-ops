/** Camera shake / concussion timing: effects stamped in a previous room never replay. */
import { describe, expect, it } from 'vitest';
import { blastFeel, SHAKE, shakeAmplitude, stunStrength } from '../src/client/features/weapons/camfx';
import { EQUIPMENT_BY_ID, killRadius } from '../src/shared/defs/equipment';

describe('weapons camera effects', () => {
  it('a shake lasts SHAKE.sec and fades', () => {
    const s = { at: 10, amount: 1 };
    expect(shakeAmplitude(10, s)).toBeCloseTo(SHAKE.amp);
    expect(shakeAmplitude(10 + SHAKE.sec / 2, s)).toBeCloseTo(SHAKE.amp / 2);
    expect(shakeAmplitude(10 + SHAKE.sec + 1e-6, s)).toBe(0);
  });

  it('a frag shakes fully inside its kill radius and fades out; ears ring only close in', () => {
    const kr = killRadius(EQUIPMENT_BY_ID.get('frag')!);
    expect(blastFeel('frag', kr * 0.5)).toEqual([1, expect.any(Number)]);
    expect(blastFeel('frag', kr * 0.5)[1]).toBe(1);
    expect(blastFeel('frag', kr)[0]).toBe(1);
    const [mid, ringMid] = blastFeel('frag', (kr + SHAKE.reach) / 2);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(ringMid).toBe(0);
    expect(blastFeel('frag', SHAKE.reach + 1)[0]).toBe(0);
    expect(blastFeel('semtex', 1)[0]).toBe(1);
    expect(blastFeel('gl', 1)[0]).toBe(1);
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
