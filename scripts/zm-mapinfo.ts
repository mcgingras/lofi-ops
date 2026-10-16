import { getMapData } from '../src/shared/defs/maps';
import { navFor } from '../src/server/features/bots/nav';
import { buildCollisionWorld } from '../src/shared/maps/types';

const r1 = (v: number) => Math.round(v * 10) / 10;
for (const id of process.argv.slice(2)) {
  const m = getMapData(id);
  const nav = navFor(m);
  const w = buildCollisionWorld(m);
  console.log('==', id, JSON.stringify(m.bounds), 'cells', nav.size, 'core', nav.coreCells.length);
  console.log('hotspots', (m.hotspots ?? []).map((h) => `(${r1(h.x)},${r1(h.y)},${r1(h.z)})`).join(' '));
  console.log('ffa', m.spawns.ffa.map((h) => `(${r1(h.x)},${r1(h.y)},${r1(h.z)})`).join(' '));
  // For each hotspot: nearest wall in 8 directions at 1.3 m height.
  for (const h of m.hotspots ?? []) {
    const c = nav.cellAt(h, true);
    if (!c) continue;
    const eye = { x: c.x, y: c.y + 1.3, z: c.z };
    const hits: string[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const dir = { x: Math.sin(a), y: 0, z: Math.cos(a) };
      const hit = w.raycast(eye, dir, 6, 'bullets');
      if (hit) hits.push(`${k}:${r1(hit.t)}@(${r1(eye.x + dir.x * hit.t)},${r1(eye.z + dir.z * hit.t)}) n(${r1(hit.normal?.x ?? 0)},${r1(hit.normal?.z ?? 0)})`);
    }
    console.log(` hot (${r1(c.x)},${r1(c.y)},${r1(c.z)})`, hits.join(' '));
  }
}
