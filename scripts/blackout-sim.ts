/**
 * Bot behaviour in a bots-only Blackout match (seeded: `Math.random` is replaced by a seeded PRNG,
 * so the drop, the bots and the far fights replay exactly). Every 30 s: alive counts, how many bots
 * are armed, armoured, outside the circle. At the end: deaths by cause, the match length, and how
 * bot-time on the ground was spent (sampled every 0.5 s per bot):
 *
 *   idle    no goal at all, or a goal with no purpose (the old brain's random "roam" point);
 *   stuck   wants to move (goal over 2 m away, not fighting or healing) but went under 0.75 m in
 *           the last 2 s;
 *   still   moved under 0.75 m in the last 2 s while not fighting, healing or deliberately holding
 *           a position (stuck plus standing about);
 *
 * plus the share of bot-time per goal kind.
 *
 *   npx tsx scripts/blackout-sim.ts [--seed=7] [--sec=900] [--quiet]
 */
import { TICK_RATE } from '../src/shared/constants';
import { outsideBy } from '../src/shared/defs/blackout';
import { rng } from '../src/shared/math';
import { bx } from '../src/server/features/blackout/state';
import { blackoutRoom } from '../tests/blackout-harness';
import { simMetrics } from '../tests/blackout-metrics';

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const quiet = process.argv.includes('--quiet');
const seed = arg('seed', 7);
Math.random = rng(seed * 7919 + 13);
const h = blackoutRoom({ seed });
h.room.options.onEnd = 'close';
const m = simMetrics(h);
for (let s = 0; s < arg('sec', 900) && h.room.phase === 'playing'; s += 30) {
  for (let i = 0; i < 30 * TICK_RATE && h.room.phase === 'playing'; i++) {
    h.room.step();
    m.sample();
  }
  if (quiet) continue;
  const alive = h.game.aliveEntrants();
  const c = h.game.circle();
  let armed = 0, armor = 0, outside = 0;
  for (const p of alive) {
    if (p.weapons.some((w) => w.def.base.id !== 'knife')) armed++;
    if (bx(p).armorMax > 0) armor++;
    if (c && outsideBy(c.cur, p.move.x, p.move.z) > 0) outside++;
  }
  console.log(`t=${s + 30}s alive ${alive.length} armed ${armed} armour ${armor} outside ${outside} circle ${c ? `${c.stage}${c.phase} r${c.cur.r.toFixed(0)}` : '-'}`);
}
const r = m.report();
console.log(`seed ${seed}: winner ${h.game.winner}, ended at ${(h.room.time - (h.game.t0 ?? 0)).toFixed(0)} s`);
console.log(`deaths ${JSON.stringify(r.causes)}`);
console.log(`ground bot-time ${r.samples} samples: idle ${(r.idle * 100).toFixed(1)} %, stuck ${(r.stuck * 100).toFixed(1)} %, still ${(r.still * 100).toFixed(1)} %`);
console.log(`goal kinds ${Object.entries(r.kinds).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(', ')}`);
h.close();
