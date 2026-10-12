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
    const r = simMatch({ map: 'nuketown', mode: 'kc', seconds: 90, seed: 5 });
    expect(r.confirms).toBeGreaterThan(5);
    expect(r.confirms).toBeGreaterThanOrEqual(r.denies);
  }, 60000);
});
