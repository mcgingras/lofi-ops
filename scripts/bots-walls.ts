/**
 * Bots vs a scripted player who peeks out of cover and hides again (tests/bots-walls.ts), on the
 * synthetic cover box and on real maps. Prints, per map and difficulty, the share of the player's
 * deaths where the killing ray crossed bullet-stopping collision (must be 0), where the player was
 * fully hidden on the server when hit, where the ray crossed drawn bullet-stopping geometry, and
 * where the player was already behind cover on their own screen (latency), plus how soon bots
 * fired after each peek.
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
