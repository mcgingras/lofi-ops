/**
 * Bot behaviour in a bots-only Blackout match (seeded): alive counts, how many bots are armed,
 * armoured, outside the circle, stuck, every 30 s; deaths by cause; the match length.
 *
 *   npx tsx scripts/blackout-sim.ts [--seed=7] [--sec=900]
 */
import { TICK_RATE } from '../src/shared/constants';
import { outsideBy } from '../src/shared/defs/blackout';
import { bx } from '../src/server/features/blackout/state';
import { blackoutRoom } from '../tests/blackout-harness';

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const h = blackoutRoom({ seed: arg('seed', 7) });
h.room.options.onEnd = 'close';
const causes: Record<string, number> = {};
h.room.bus.on('death', (e) => {
  const k = e.means === 'storm' ? 'circle' : e.weapon === 'knife' ? 'knife' : 'gun';
  causes[k] = (causes[k] ?? 0) + 1;
});
const last = new Map<string, { x: number; z: number; t: number }>();
for (let s = 0; s < arg('sec', 900) && h.room.phase === 'playing'; s += 30) {
  for (let i = 0; i < 30 * TICK_RATE && h.room.phase === 'playing'; i++) h.room.step();
  const alive = h.game.aliveEntrants();
  const c = h.game.circle();
  let armed = 0, armor = 0, outside = 0, stuck = 0;
  for (const p of alive) {
    if (p.weapons.some((w) => w.def.base.id !== 'knife')) armed++;
    if (bx(p).armorMax > 0) armor++;
    if (c && outsideBy(c.cur, p.move.x, p.move.z) > 0) outside++;
    const l = last.get(p.id);
    if (l && Math.hypot(l.x - p.move.x, l.z - p.move.z) < 1 && bx(p).stage === 'ground') stuck++;
    last.set(p.id, { x: p.move.x, z: p.move.z, t: s });
  }
  console.log(`t=${s + 30}s alive ${alive.length} armed ${armed} armour ${armor} outside ${outside} still30s ${stuck} circle ${c ? `${c.stage}${c.phase} r${c.cur.r.toFixed(0)}` : '-'}`);
}
console.log('causes', causes, 'winner', h.game.winner, 'ended at', (h.room.time - (h.game.t0 ?? 0)).toFixed(0), 's');
h.close();
