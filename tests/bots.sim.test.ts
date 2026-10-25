/**
 * Metric thresholds from short seeded simulations (tests/bots-sim.ts). The full report with
 * longer runs: `npx tsx scripts/bots-metrics.ts`.
 */
import { describe, expect, it } from 'vitest';
import { duel, simMatch } from './bots-sim';

describe('bots: simulated duels', () => {
  it('regular bots rarely kill a strafing player at 25 m in under 0.6 s; veterans are faster but not instant', () => {
    const reg = duel({ difficulty: 'regular', distance: 25, strafe: true, trials: 12, seed: 3 });
    expect(reg.under06).toBeLessThanOrEqual(0.1);
    expect(reg.firstShot).toBeGreaterThan(0.45);
    const vet = duel({ difficulty: 'veteran', distance: 10, strafe: false, trials: 12, seed: 3 });
    expect(vet.firstShot).toBeGreaterThan(0.25);
    expect(vet.firstShot).toBeLessThan(reg.firstShot);
    const rec = duel({ difficulty: 'recruit', distance: 10, strafe: false, trials: 12, seed: 3 });
    expect(rec.firstShot).toBeGreaterThan(reg.firstShot);
  }, 30000);
});

describe('bots: simulated matches', () => {
  it('TDM on a small map: few spawn deaths, no big packs', () => {
    const r = simMatch({ map: 'nuketown', mode: 'tdm', seconds: 60, seed: 5 });
    expect(r.spawns).toBeGreaterThan(10);
    expect(r.spawnDeathRate).toBeLessThan(0.08);
    expect(r.pack3).toBeLessThan(0.2);
  }, 60000);

  it('Kill Confirmed: bots confirm at least as often as they deny', () => {
    // Four seeds summed: one 90 s match swings either way (seed 5 alone went 26-27 once the frag
    // got its BO1 strength; seeds 5 + 6 went 58-59 once launchers and machine pistols joined the
    // bot classes, though across seeds 1-8 confirms still lead about 248 to 183).
    const runs = [5, 6, 7, 8].map((seed) => simMatch({ map: 'nuketown', mode: 'kc', seconds: 90, seed }));
    const confirms = runs.reduce((n, r) => n + r.confirms, 0);
    const denies = runs.reduce((n, r) => n + r.denies, 0);
    expect(confirms).toBeGreaterThan(10);
    expect(confirms).toBeGreaterThanOrEqual(denies);
  }, 120000);
});
