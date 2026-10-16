/**
 * Zombies layer authoring aid: a top-down PNG of a map's walkable nav cells (shaded by height),
 * spawns, hotspots and the map's zombies layer (wall-buys, box spots, perk machines, zombie spawns,
 * barriers), with a 5 m grid and labelled axes, so placements can be checked by eye.
 *
 *   npx tsx scripts/zm-layout.ts nuketown out.png [scale]
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { getMapData } from '../src/shared/defs/maps';
import { navFor } from '../src/server/features/bots/nav';
import { zombiesLayer } from '../src/shared/maps/zombies/index';

const [id = 'nuketown', out = 'layout.png', sArg = '8'] = process.argv.slice(2);
const S = Number(sArg);
const map = getMapData(id);
const nav = navFor(map);
const b = map.bounds;
const W = Math.ceil((b.max.x - b.min.x) * S);
const H = Math.ceil((b.max.z - b.min.z) * S);
const img = new Uint8Array(W * H * 3);
const px = (x: number, z: number, c: [number, number, number]) => {
  const i = Math.floor((x - b.min.x) * S);
  const j = Math.floor((z - b.min.z) * S);
  if (i < 0 || j < 0 || i >= W || j >= H) return;
  const o = (j * W + i) * 3;
  img[o] = c[0];
  img[o + 1] = c[1];
  img[o + 2] = c[2];
};
const fill = (x: number, z: number, r: number, c: [number, number, number]) => {
  for (let dx = -r; dx <= r; dx += 1 / S) for (let dz = -r; dz <= r; dz += 1 / S) if (dx * dx + dz * dz <= r * r) px(x + dx, z + dz, c);
};
// Solids (dark red by top height).
for (const s of nav.world.solids) {
  if (!s.players) continue;
  const top = s.max.y;
  if (top < 0.3) continue;
  const v = Math.min(255, 60 + top * 12);
  for (let x = s.min.x; x < s.max.x; x += 1 / S) for (let z = s.min.z; z < s.max.z; z += 1 / S) px(x, z, [v, 30, 30]);
}
// Cells: green core, grey others, brighter higher; ground floor wins (drawn last) so upper floors don't hide it.
const floor = Number(process.env.ZM_FLOOR ?? '1.5');
const cells = [...nav.cells].filter((c) => c.y < b.min.y + 2 + floor || !c.core).sort((a, c) => Number(a.core) - Number(c.core) || c.y - a.y);
for (const c of cells) {
  const k = Math.max(0, Math.min(1, (c.y - b.min.y) / 10));
  const col: [number, number, number] = c.core ? [40, Math.round(120 + 120 * k), 60] : [90, 90, 90];
  for (let x = c.x - 0.25; x < c.x + 0.25; x += 1 / S) for (let z = c.z - 0.25; z < c.z + 0.25; z += 1 / S) px(x, z, col);
}
// Grid every 5 m.
for (let x = Math.ceil(b.min.x / 5) * 5; x < b.max.x; x += 5) for (let z = b.min.z; z < b.max.z; z += 1 / S) px(x, z, x === 0 ? [255, 255, 255] : [20, 20, 20]);
for (let z = Math.ceil(b.min.z / 5) * 5; z < b.max.z; z += 5) for (let x = b.min.x; x < b.max.x; x += 1 / S) px(x, z, z === 0 ? [255, 255, 255] : [20, 20, 20]);
for (const p of map.spawns.ffa) fill(p.x, p.z, 0.4, [80, 140, 255]);
for (const p of map.hotspots ?? []) fill(p.x, p.z, 0.3, [255, 255, 255]);
const layer = zombiesLayer(id);
if (layer) {
  for (const z of layer.zombieSpawns) fill(z.x, z.z, 0.45, [200, 0, 200]);
  for (const w of layer.wallBuys) fill(w.x, w.z, 0.4, [255, 230, 60]);
  for (const s of layer.boxSpots) fill(s.x, s.z, 0.5, [80, 200, 255]);
  for (const p of layer.perks) fill(p.x, p.z, 0.5, [255, 120, 0]);
  for (const s of layer.playerSpawns ?? []) fill(s.x, s.z, 0.35, [0, 0, 255]);
  for (const w of layer.barriers ?? []) fill(w.x, w.z, 0.45, [140, 90, 40]);
}

// PNG encode.
const raw = new Uint8Array(H * (W * 3 + 1));
for (let j = 0; j < H; j++) {
  raw[j * (W * 3 + 1)] = 0;
  raw.set(img.subarray(j * W * 3, (j + 1) * W * 3), j * (W * 3 + 1) + 1);
}
const crcT = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf: Uint8Array) => {
  let c = 0xffffffff;
  for (const v of buf) c = crcT[(c ^ v) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(Buffer.from(type, 'ascii'), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
};
const ihdr = new Uint8Array(13);
const dv = new DataView(ihdr.buffer);
dv.setUint32(0, W);
dv.setUint32(4, H);
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]);
writeFileSync(out, png);
console.log(`${id}: ${W}x${H} px, x ${b.min.x}..${b.max.x}, z ${b.min.z}..${b.max.z} (top-left = min x, min z; +x right, +z down)`);
