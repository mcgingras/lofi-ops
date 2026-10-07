/**
 * Z-fighting report: for every map, the faces the renderer draws that share a plane (or sit within
 * NEAR_GAP of one) and overlap, and whether the depth plan (polygon-offset levels) settles them.
 *
 *   npx tsx scripts/zfight.ts                 counts per map
 *   npx tsx scripts/zfight.ts -v [--map=id]   every pair, with its winner
 *   npx tsx scripts/zfight.ts --unresolved    only pairs the plan leaves fighting (should be none)
 */
import { getMapData, MAPS } from '../src/shared/defs/maps';
import { describeFace, faceKey, mapFaces, planDepth, winner, type DepthFight } from '../src/shared/maps/faces';

const args = process.argv.slice(2);
const verbose = args.includes('-v');
const onlyUnresolved = args.includes('--unresolved');
const only = args.find((a) => a.startsWith('--map='))?.slice(6);

/** Report class: kind, what is involved (brush faces / decals / cylinder caps), buried or not. */
export function fightClass(f: DepthFight): string {
  const kinds = new Set([f.a.src.kind, f.b.src.kind]);
  const who = kinds.has('decal') ? (kinds.size === 1 ? 'decal/decal' : 'decal/surface') : kinds.has('cap') ? 'cap' : 'brush';
  return `${who} ${f.kind}${f.buried ? ' (buried)' : ''}`;
}

for (const def of MAPS) {
  if (only && def.id !== only) continue;
  const map = getMapData(def.id);
  const faces = mapFaces(map);
  const plan = planDepth(map, faces);
  const counts: Record<string, number> = {};
  for (const f of plan.fights) counts[fightClass(f)] = (counts[fightClass(f)] ?? 0) + 1;
  const visible = plan.fights.filter((f) => !f.buried).length;
  console.log(`${def.id}: ${faces.length} faces, ${plan.fights.length} fights (${visible} visible), unresolved after plan: ${plan.unresolved.length}, dropped faces: ${plan.drop.size}, offset faces: ${plan.level.size}, levels: ${plan.maxLevel}, flush decals: ${plan.flush.size} (${plan.flush.size ? Math.max(...plan.flush.values()) + 1 : 0} layers)`);
  for (const [k, n] of Object.entries(counts).sort()) console.log(`  ${String(n).padStart(4)}  ${k}`);
  const list = onlyUnresolved ? plan.unresolved : verbose ? plan.fights : [];
  const lv = (k: string) => plan.level.get(k) ?? 0;
  for (const f of list) {
    const w = winner(f);
    const l = w === f.a ? f.b : f.a;
    console.log(`    ${fightClass(f).padEnd(28)} gap ${f.gap.toFixed(4)} area ${f.area.toFixed(3)}  WIN L${lv(faceKey(w.src))} ${describeFace(map, w)}  over L${lv(faceKey(l.src))} ${describeFace(map, l)}`);
  }
}
