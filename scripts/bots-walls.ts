/**
 * Bots vs a scripted player who peeks out of cover and hides again (tests/bots-walls.ts), on the
 * synthetic cover box and on real maps. Prints, per map and difficulty, the share of the player's
 * deaths where the killing ray crossed bullet-stopping collision (must be 0), where the player was
 * fully hidden on the server when hit, where the ray crossed drawn bullet-stopping geometry, and
 * where the player was already behind cover on their own screen (latency), plus how soon bots
 * fired after each peek.
 *
 * Then the latency part: the player ducks back the moment it's hit, and the deaths that arrive
 * when the player is already fully behind cover on their own screen are counted for a few round
 * trips (Fly dfw from Colorado is about 30-40 ms).
 *
 *   npx tsx scripts/bots-walls.ts [seconds-per-spot=40] [rttMs=35]
 */
import { getMapData } from '../src/shared/defs/maps';
import { COVERS, coverMap, coverMapSpots, coverSpots, formatPeek, peekSim } from '../tests/bots-walls';

const seconds = Number(process.argv[2] ?? 40);
const rttMs = Number(process.argv[3] ?? 35);
const MAPS = ['nuketown', 'rust', 'terminal', 'firingrange', 'estate'];

for (const difficulty of ['regular', 'veteran'] as const) {
  const box = peekSim({ map: coverMap(), spots: coverMapSpots(), seconds, difficulty, rttMs, penetrable: (i) => COVERS[i]!.penetrable });
  console.log(formatPeek(`cover-box ${difficulty}`, box));
  for (const id of MAPS) {
    const map = getMapData(id);
    const walls = coverSpots(map, 6, 3);
    const rs = peekSim({ map: id, spots: walls, seconds, difficulty, rttMs });
    console.log(formatPeek(`${id} walls(${walls.length}) ${difficulty}`, rs));
    const drawn = coverSpots(map, 4, 5, 'render');
    if (drawn.length) {
      const rd = peekSim({ map: id, spots: drawn, seconds, difficulty, rttMs });
      console.log(formatPeek(`${id} drawn(${drawn.length}: ${drawn.map((d) => d.blocker).join(' ')}) ${difficulty}`, rd));
    }
  }
}

console.log('-- latency: the player ducks back into cover when hit (regular bots, wall spots on the five maps + the cover box)');
for (const rtt of [35, 80, 150]) {
  const all = [peekSim({ map: coverMap(), spots: coverMapSpots(), seconds, rttMs: rtt, retreatOnHit: true, penetrable: (i) => COVERS[i]!.penetrable })];
  for (const id of MAPS) all.push(peekSim({ map: id, spots: coverSpots(getMapData(id), 6, 3), seconds, rttMs: rtt, retreatOnHit: true }));
  const deaths = all.reduce((a, x) => a + x.deaths, 0);
  const onScreen = all.reduce((a, x) => a + x.hiddenOnScreen, 0);
  const retreating = all.reduce((a, x) => a + x.whileRetreating, 0);
  const eyeServer = all.reduce((a, x) => a + x.eyeHiddenOnServer, 0);
  const eyeScreen = all.reduce((a, x) => a + x.eyeHiddenOnScreen, 0);
  const pct = (n: number) => `${((100 * n) / Math.max(1, deaths)).toFixed(1)}%`;
  console.log(`rtt ${rtt} ms (+${(all[0]!.screenLagMs - rtt).toFixed(0)} ms input batching and tick wait): ${deaths} deaths, ${retreating} while ducking back; couldn't see the bot when the bullet hit ${eyeServer} (${pct(eyeServer)}), when the kill reached the screen ${eyeScreen} (${pct(eyeScreen)}); whole body behind cover on screen ${onScreen} (${pct(onScreen)})`);
}
