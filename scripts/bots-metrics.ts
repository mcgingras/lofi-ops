/**
 * Bot tuning report: `npx tsx scripts/bots-metrics.ts [duels|matches|ticks|all] [--quick]`.
 * Prints the duel table (per difficulty, distance and target motion) and the match table (spawn
 * deaths, clustering, lanes, KC, S&D, tick time) from the headless sims in tests/bots-sim.ts.
 */
import { duel, simMatch } from '../tests/bots-sim';

const what = process.argv[2] ?? 'all';
const quick = process.argv.includes('--quick');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const f = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '-');

if (what === 'duels' || what === 'all') {
  console.log('difficulty | dist | target | first shot s | TTK median s | kill<0.6s | killed | hit% first 0.5s | hit% all');
  for (const difficulty of ['recruit', 'regular', 'hardened', 'veteran'] as const) {
    if (only && only !== difficulty) continue;
    for (const distance of [10, 25, 40])
      for (const strafe of [false, true]) {
        const r = duel({ difficulty, distance, strafe, trials: quick ? 12 : 40, seed: distance * 7 + (strafe ? 1 : 0) });
        console.log(`${difficulty} | ${distance} | ${strafe ? 'strafe' : 'still'} | ${f(r.firstShot)} | ${f(r.ttkMedian)} | ${f(r.under06 * 100, 0)}% | ${f(r.killRate * 100, 0)}% | ${f(r.hit05 * 100, 0)}% | ${f(r.hitAll * 100, 0)}%`);
      }
  }
}

if (what === 'matches' || what === 'all') {
  const secs = quick ? 90 : 180;
  const sdSecs = quick ? 240 : 480;
  const runs: { map: string; mode: string; players?: number; seconds: number }[] = [
    { map: 'nuketown', mode: 'tdm', seconds: secs },
    { map: 'rust', mode: 'tdm', seconds: secs },
    { map: 'terminal', mode: 'tdm', seconds: secs },
    { map: 'firingrange', mode: 'tdm', seconds: secs },
    { map: 'highrise', mode: 'tdm', seconds: secs },
    { map: 'hijacked', mode: 'tdm', seconds: secs },
    { map: 'nuketown', mode: 'ffa', players: 8, seconds: secs },
    { map: 'rust', mode: 'ffa', players: 8, seconds: secs },
    { map: 'firingrange', mode: 'dom', seconds: secs },
    { map: 'nuketown', mode: 'kc', seconds: secs },
    { map: 'terminal', mode: 'kc', seconds: secs },
    { map: 'nuketown', mode: 'sd', players: 10, seconds: sdSecs },
    { map: 'rust', mode: 'sd', players: 10, seconds: sdSecs },
    { map: 'highrise', mode: 'sd', players: 10, seconds: sdSecs },
  ];
  console.log('map | mode | kills | spawns | died<3s | no safe spawn | enemy dist at spawn | mates<8m | 3+ mates | top lane | confirms | denies | rounds | plants | tick mean/p99/max ms');
  for (const o of runs) {
    if (only && !`${o.map}:${o.mode}`.includes(only)) continue;
    const r = simMatch(o);
    console.log(`${r.map} | ${r.mode} | ${r.kills} | ${r.spawns} | ${f(r.spawnDeathRate * 100, 1)}% | ${f(r.unsafeSpawns * 100, 0)}% | ${f(r.spawnEnemyDist, 1)} | ${f(r.mates8)} | ${f(r.pack3 * 100, 0)}% | ${f(r.topLane * 100, 0)}% | ${r.confirms} | ${r.denies} | ${r.rounds} | ${r.plants} | ${f(r.tickMean)}/${f(r.tickP99)}/${f(r.tickMax)}`);
  }
}

if (what === 'ticks' || what === 'all') {
  console.log('map | mode | players | tick mean/p99/max ms');
  for (const map of ['launch', 'estate', 'afghan']) {
    const r = simMatch({ map, mode: 'tdm', players: 11, seconds: quick ? 60 : 120 });
    console.log(`${map} | tdm | 11 | ${f(r.tickMean)}/${f(r.tickP99)}/${f(r.tickMax)}`);
  }
}
