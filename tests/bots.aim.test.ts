/** The bot aim controller and perception gating (pure functions in src/server/features/bots/aim.ts). */
import { describe, expect, it } from 'vitest';
import { addRecoil, aimParams, engage, flinch, lookToward, newAimState, noticeTime, offDeg, stepAim, sway, type AimContext } from '../src/server/features/bots/aim';
import { BOT_DIFFICULTY_BY_ID, type BotSkill } from '../src/shared/defs/bots';
import { rng } from '../src/shared/math';

const DEG = Math.PI / 180;
const DT = 1 / 60;
const preset = (id: string): BotSkill => ({ ...BOT_DIFFICULTY_BY_ID.get(id as 'regular')!.skill });
const ctx: AimContext = { dist: 15, latSpeed: 0, moving: false, ads: 1 };

/** Run an engagement on a still target at (yaw, 0); returns the view yaw trace (degrees) after the reaction. */
function trace(skill: BotSkill, targetDeg: number, seconds: number, seed = 3) {
  const s = newAimState(0, 0);
  engage(s, skill, rng(seed), { yaw: targetDeg * DEG, pitch: 0 });
  const react = s.react;
  const ys: number[] = [];
  const ps: number[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepAim(s, skill, targetDeg * DEG, 0, DT, ctx);
    ys.push(s.yaw / DEG);
    ps.push(s.pitch / DEG);
  }
  return { s, react, ys, ps };
}

describe('bots: aim controller', () => {
  it('waits out a reaction drawn per engagement (regular ~385-715 ms)', () => {
    const skill = preset('regular');
    const reacts: number[] = [];
    const r = rng(5);
    for (let i = 0; i < 200; i++) {
      const s = newAimState();
      engage(s, skill, r, { yaw: 0.5 });
      reacts.push(s.react);
    }
    expect(Math.min(...reacts)).toBeGreaterThanOrEqual(0.38);
    expect(Math.max(...reacts)).toBeLessThanOrEqual(0.72);
    expect(new Set(reacts.map((x) => x.toFixed(3))).size).toBeGreaterThan(50);
    // The view doesn't move during the reaction.
    const { ys, react } = trace(skill, 40, 1);
    const frozen = Math.floor(react / DT) - 1;
    expect(Math.abs(ys[frozen]!)).toBeLessThan(1e-9);
  });

  it('never snaps: angular velocity stays under turnSpeedDeg and builds up gradually', () => {
    for (const id of ['recruit', 'regular', 'hardened', 'veteran']) {
      const skill = preset(id);
      const { ys } = trace(skill, 120, 2);
      let maxStep = 0;
      for (let i = 1; i < ys.length; i++) maxStep = Math.max(maxStep, Math.abs(ys[i]! - ys[i - 1]!));
      expect(maxStep / DT).toBeLessThanOrEqual(skill.turnSpeedDeg + 1e-6);
      // Ease in: the first moving tick is far below the max rate.
      const first = ys.findIndex((y) => Math.abs(y) > 1e-9);
      expect(Math.abs(ys[first]!) / DT).toBeLessThan(skill.turnSpeedDeg * 0.5);
      // And it does get there.
      expect(Math.abs(ys.at(-1)! - 120)).toBeLessThan(skill.aimErrorDeg * 1.5 + 1);
    }
  });

  it('a big flick takes human time: 90 degrees is not covered in under ~0.3 s even by veterans', () => {
    const { ys, react } = trace(preset('veteran'), 90, 1.5);
    const start = Math.floor(react / DT);
    const reach = ys.findIndex((y) => y > 80);
    expect((reach - start) * DT).toBeGreaterThan(0.15);
    const reg = trace(preset('regular'), 90, 2);
    const regReach = reg.ys.findIndex((y) => y > 80) - Math.floor(reg.react / DT);
    expect(regReach * DT).toBeGreaterThan(0.3);
  });

  it('overshoot is bounded and corrected; yaw and pitch settle at different rates (a curved arc)', () => {
    let maxOver = 0;
    for (let seed = 1; seed < 40; seed++) {
      const skill = preset('recruit');
      const { ys, s } = trace(skill, 60, 2.5, seed);
      maxOver = Math.max(maxOver, Math.max(...ys) - 60);
      // Corrected by the end (within the residual sway).
      expect(Math.abs(s.yaw / DEG - 60)).toBeLessThan(aimParams(skill).swayDeg * 2 + 1);
    }
    // Some overshoot happens for weak aimers, but bounded.
    expect(maxOver).toBeGreaterThan(0.5);
    expect(maxOver).toBeLessThan(60 * 0.3 + preset('recruit').aimErrorDeg);
    expect(aimParams(preset('regular')).pitchRatio).toBeLessThan(1);
  });

  it('keeps swaying while tracking (never perfectly still), more for worse aimers and hip fire on the move', () => {
    const swing = (skill: BotSkill, c: AimContext) => {
      const s = newAimState();
      engage(s, skill, rng(9), { yaw: 0 });
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 60 * 6; i++) {
        stepAim(s, skill, 0, 0, DT, c);
        if (i > 60 * 3) {
          lo = Math.min(lo, s.yaw);
          hi = Math.max(hi, s.yaw);
        }
      }
      return (hi - lo) / DEG;
    };
    const vet = swing(preset('veteran'), ctx);
    const rec = swing(preset('recruit'), ctx);
    expect(vet).toBeGreaterThan(0.01);
    expect(rec).toBeGreaterThan(vet);
    const s = newAimState();
    engage(s, preset('regular'), rng(1));
    s.clock = 2;
    const still = Math.hypot(...sway(s, preset('regular'), ctx));
    const hip = Math.hypot(...sway(s, preset('regular'), { dist: 15, latSpeed: 4, moving: true, ads: 0 }));
    expect(hip).toBeGreaterThan(still * 1.5);
  });

  it('trails a strafing target instead of leading it perfectly', () => {
    const skill = preset('regular');
    const s = newAimState();
    engage(s, skill, rng(2), { yaw: 0 });
    let err = 0;
    let n = 0;
    let target = 0;
    for (let i = 0; i < 60 * 3; i++) {
      // 20 deg/s across the view, reversing every 0.6 s.
      target += (Math.floor(i / 36) % 2 ? -1 : 1) * 20 * DEG * DT;
      const intended = stepAim(s, skill, target, 0, DT, { ...ctx, latSpeed: 5 });
      if (i > 60) {
        err += Math.abs(intended.yaw - target) / DEG;
        n++;
      }
    }
    expect(err / n).toBeGreaterThan(0.2);
  });

  it('flinch knocks the view off and the controller brings it back', () => {
    const skill = preset('regular');
    const { s } = trace(skill, 10, 1.5);
    const before = offDeg(s, 10 * DEG, 0);
    flinch(s, 2.5, rng(4));
    expect(offDeg(s, 10 * DEG, 0)).toBeGreaterThan(before + 1);
    for (let i = 0; i < 60; i++) stepAim(s, skill, 10 * DEG, 0, DT, ctx);
    expect(offDeg(s, 10 * DEG, 0)).toBeLessThan(1.5);
  });

  it('recoil kicks the view like a player`s and recovers; better burst control pulls more of it down', () => {
    const climb = (burstControl: number) => {
      const skill = { ...preset('regular'), burstControl };
      const { s } = trace(skill, 0, 1);
      const p0 = s.pitch;
      for (let i = 0; i < 10; i++) {
        addRecoil(s, { vertical: 1.1, horizontal: 0.45 }, 1, rng(i + 1));
        for (let k = 0; k < 3; k++) stepAim(s, skill, 0, 0, DT, ctx, 12);
      }
      return (s.pitch - p0) / DEG;
    };
    expect(climb(0)).toBeGreaterThan(climb(1));
    expect(climb(0)).toBeGreaterThan(0.3);
  });

  it('looking around without a target uses the same limits (no instant turns)', () => {
    const skill = preset('veteran');
    const s = newAimState(0, 0);
    lookToward(s, skill, Math.PI, 0, DT);
    expect(Math.abs(s.yaw) / DEG).toBeLessThan(skill.turnSpeedDeg * DT + 1e-6);
  });
});

describe('bots: perception gating', () => {
  it('nothing outside the FOV is noticed; noticing takes longer far away and in the periphery', () => {
    const skill = preset('regular');
    expect(noticeTime(skill, 10, skill.fovDeg / 2 + 1)).toBe(Infinity);
    expect(noticeTime(skill, 10, 180)).toBe(Infinity);
    expect(noticeTime(skill, 40, 0)).toBeGreaterThan(noticeTime(skill, 10, 0));
    expect(noticeTime(skill, 10, 50)).toBeGreaterThan(noticeTime(skill, 10, 0));
    expect(noticeTime(skill, 10, 30, true)).toBeLessThan(noticeTime(skill, 10, 30));
    expect(noticeTime(preset('recruit'), 20, 20)).toBeGreaterThan(noticeTime(preset('veteran'), 20, 20));
  });
});
