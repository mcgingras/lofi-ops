/**
 * Zombies layer authoring aid: snap rough targets to real spots on a map.
 *
 *   npx tsx scripts/zm-place.ts <map> wall:x,z[,dir] perk:x,z box:x,z spawn:x,z ...
 *
 * - `wall` finds the nearest tall wall face (>= 2.2 m above the floor, 1.2 m wide) beside a
 *   reachable ground cell within 4 m and prints the point on the face and the yaw facing out of it.
 *   `dir` (n/s/e/w = -z/+z/+x/-x) restricts the face direction looked for.
 * - `perk` / `box` find a reachable cell with a free footprint (1.0 x 1.4 m) backed by a wall, and
 *   print the item's position (centre of the footprint) and the yaw facing away from the wall.
 * - `spawn` snaps to the nearest reachable cell.
 */
import { getMapData } from '../src/shared/defs/maps';
import { navFor } from '../src/server/features/bots/nav';

const [id, ...args] = process.argv.slice(2);
const map = getMapData(id!);
const nav = navFor(map);
const w = nav.world;
const r2 = (v: number) => Math.round(v * 100) / 100;
const DIRS: Record<string, { x: number; z: number }> = { n: { x: 0, z: -1 }, s: { x: 0, z: 1 }, e: { x: 1, z: 0 }, w: { x: -1, z: 0 } };
const yawFacing = (dx: number, dz: number) => Math.atan2(-dx, -dz); // game yaw: 0 looks down -z

function cellsNear(x: number, z: number, r: number) {
  const maxY = Number(process.env.ZM_MAXY ?? '1');
  return nav.coreCells.filter((c) => Math.hypot(c.x - x, c.z - z) <= r && c.y < maxY).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
}

function wallFrom(c: { x: number; y: number; z: number }, d: { x: number; z: number }, maxT: number) {
  const eye = { x: c.x, y: c.y + 1.4, z: c.z };
  const hit = w.raycast(eye, { x: d.x, y: 0, z: d.z }, maxT, 'bullets');
  if (!hit || Math.abs(hit.normal.y) > 0.5) return null;
  if (hit.solid.max.y - c.y < 2.2 || hit.solid.min.y > c.y + 0.6) return null;
  // Wide enough: rays 0.6 m to each side hit at about the same distance.
  for (const s of [-0.6, 0.6]) {
    const o = { x: eye.x + d.z * s, y: eye.y, z: eye.z - d.x * s };
    const h2 = w.raycast(o, { x: d.x, y: 0, z: d.z }, maxT + 0.3, 'bullets');
    if (!h2 || Math.abs(h2.t - hit.t) > 0.05) return null;
  }
  return hit;
}

for (const a of args) {
  const [kind, rest] = a.split(':');
  const parts = rest!.split(',');
  const x = Number(parts[0]);
  const z = Number(parts[1]);
  const only = parts[2];
  const dirs = only ? [DIRS[only]!] : Object.values(DIRS);
  if (kind === 'free') {
    // A free-standing item (box / machine) on open ground: footprint 1.5 x 1.5 m clear.
    const yawDeg = Number(parts[2] ?? '0');
    const c = cellsNear(x, z, 5).find((c) => {
      for (let ox = -0.75; ox <= 0.75; ox += 0.25) for (let oz = -0.75; oz <= 0.75; oz += 0.25) if (!w.free(c.x + ox, c.y + 0.05, c.z + oz, 0.05, 1.8)) return false;
      const g = w.groundBelow(c.x, c.z, c.y + 0.3, 0.6, 0.6);
      return g !== null && Math.abs(g - c.y) < 0.05;
    });
    console.log(c ? `  { x: ${r2(c.x)}, y: ${r2(c.y)}, z: ${r2(c.z)}, yaw: ${r2((yawDeg * Math.PI) / 180)} }, // free near ${x},${z}` : `// free ${x},${z}: nothing`);
    continue;
  }
  if (kind === 'spawn') {
    const c = cellsNear(x, z, 6)[0];
    console.log(c ? `  { x: ${r2(c.x)}, y: ${r2(c.y)}, z: ${r2(c.z)} },` : `// no cell near ${x},${z}`);
    continue;
  }
  let done = false;
  for (const c of cellsNear(x, z, 4)) {
    for (const d of dirs) {
      if (kind === 'wall') {
        const hit = wallFrom(c, d, 0.9);
        if (!hit) continue;
        const yaw = yawFacing(-d.x, -d.z);
        console.log(`  { weapon: 'X', x: ${r2(hit.point.x - d.x * 0.02)}, y: ${r2(c.y)}, z: ${r2(hit.point.z - d.z * 0.02)}, yaw: ${r2(yaw)} }, // from cell ${r2(c.x)},${r2(c.z)}`);
        done = true;
        break;
      }
      // perk / box: a wall right behind the footprint.
      const depth = kind === 'perk' ? 0.8 : 0.6;
      const width = kind === 'perk' ? 1.0 : 1.4;
      const hit = wallFrom(c, d, depth + 0.6);
      if (!hit) continue;
      // Item centre: depth/2 off the wall face, toward the cell.
      const cx = hit.point.x - d.x * (depth / 2 + 0.02);
      const cz = hit.point.z - d.z * (depth / 2 + 0.02);
      const hw = (d.x !== 0 ? depth : width) / 2;
      const hd = (d.x !== 0 ? width : depth) / 2;
      let free = true;
      for (let ox = -hw; ox <= hw + 1e-6 && free; ox += hw) for (let oz = -hd; oz <= hd + 1e-6 && free; oz += hd) if (!w.free(cx + ox * 0.85, c.y + 0.05, cz + oz * 0.85, 0.03, 1.8)) free = false;
      const ground = w.groundBelow(cx, cz, c.y + 0.3, 0.6, 0.3);
      if (process.env.ZM_DEBUG) console.log('cand', r2(cx), r2(cz), 'free', free, 'ground', ground, c.y);
      if (!free || ground === null || Math.abs(ground - c.y) > 0.25) continue;
      const yaw = yawFacing(-d.x, -d.z);
      console.log(`  { ${kind === 'perk' ? "perk: 'X', " : ''}x: ${r2(cx)}, y: ${r2(ground)}, z: ${r2(cz)}, yaw: ${r2(yaw)} }, // wall ${only ?? ''} from cell ${r2(c.x)},${r2(c.z)}`);
      done = true;
      break;
    }
    if (done) break;
  }
  if (!done) console.log(`// ${a}: nothing found`);
}
