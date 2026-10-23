/**
 * Blackout server benchmark: one fake human plus 99 bots on the Blackout map, stepped tick by tick
 * for a whole match (or `--sec=N` of it). Prints tick times per stretch of the match (avg, p95,
 * max), snapshot bandwidth to the human, alive counts and memory.
 *
 *   npx tsx scripts/blackout-bench.ts [--sec=600] [--seed=7] [--humans=1] [--land]
 *
 * `--land`: the human jumps at once and stands still where they land (bots come to them).
 */
import { TICK_RATE } from '../src/shared/constants';
import { blackoutRoom, stats, stepTimed } from '../tests/blackout-harness';

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const sec = arg('sec', 900);
const seed = arg('seed', 7);
const humans = arg('humans', 1);

const t0 = performance.now();
const h = blackoutRoom({ humans, seed });
h.room.options.onEnd = 'lobby';
console.log(`setup ${(performance.now() - t0).toFixed(0)} ms, players ${h.room.players.size}, loot ${h.game.lootSpawned}, entities ${h.room.entities.size}`);
const chunk = 30;
let all: number[] = [];
for (let s = 0; s < sec && h.room.phase === 'playing'; s += chunk) {
  const b0 = h.humans[0]?.socket.snapBytes ?? 0;
  const n0 = h.humans[0]?.socket.snaps ?? 0;
  const g0 = h.game.prof.ms;
  const ms = stepTimed(h.room, chunk * TICK_RATE);
  all = all.concat(ms);
  const st = stats(ms);
  const sock = h.humans[0]?.socket;
  const kbps = sock ? (sock.snapBytes - b0) / chunk / 1024 : 0;
  const per = sock && sock.snaps > n0 ? (sock.snapBytes - b0) / (sock.snaps - n0) : 0;
  const stage = h.humans[0]?.player.ext.blackout?.stage ?? '-';
  const near = [...h.room.players.values()].filter((p) => p.isBot && h.game.isNear(p)).length;
  console.log(
    `t=${String(s + chunk).padStart(4)}s alive ${String(h.game.aliveCount()).padStart(3)} near ${String(near).padStart(2)} | tick avg ${st.avg.toFixed(2)} p95 ${st.p95.toFixed(2)} max ${st.max.toFixed(1)} ms (blackout ${((h.game.prof.ms - g0) / (chunk * TICK_RATE)).toFixed(2)}) | snap ${per.toFixed(0)} B, ${kbps.toFixed(1)} KB/s | ents ${h.room.entities.size} | heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB | human ${stage}`,
  );
}
const st = stats(all);
console.log(`\nALL: ticks ${all.length}, avg ${st.avg.toFixed(2)} ms, p50 ${st.p50.toFixed(2)}, p95 ${st.p95.toFixed(2)}, p99 ${st.p99.toFixed(2)}, max ${st.max.toFixed(1)}; phase ${h.room.phase}; alive ${h.game.aliveCount()}; winner ${h.game.winner}; farFights ${h.game.prof.farFights}`);
console.log(`rss ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB, heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`);
h.close();
