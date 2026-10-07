/**
 * Top-down map render for checking layouts against real overhead references.
 *
 *   npx tsx scripts/map-overhead.ts <mapId|all> [outDir] [--slice <y>]   -> <outDir>/<id>-overhead[-y<y>].svg and .png
 *
 * --slice <y> drops every brush whose bottom is above y (roofs, upper floors), giving a floor plan
 * at that height: e.g. --slice 2 for ground floors, --slice 5 for second storeys.
 *
 * Brush footprints are shaded by their top height (dark = low, light = high); ramps get an arrow
 * toward their high side; non-colliding trim is outlined only. Team spawns are blue (team 0) and
 * red (team 1) with a facing tick, FFA spawns grey, and objectives are labelled (DOM A/B/C, S&D
 * sites, HQ). The grid is every 5 m, labelled every 10 m, so distances can be compared with
 * callout maps. PNG conversion uses ImageMagick (`magick`) when it is installed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getMapData, MAPS } from '../src/shared/defs/maps';
import type { MapData } from '../src/shared/maps/types';

const PX = 8; // pixels per metre
const PAD = 40;

function render(map: MapData, sliceY: number | null): string {
  const b = map.bounds;
  const W = (b.max.x - b.min.x) * PX + PAD * 2;
  const H = (b.max.z - b.min.z) * PX + PAD * 2;
  const X = (x: number) => PAD + (x - b.min.x) * PX;
  const Z = (z: number) => PAD + (z - b.min.z) * PX;
  const floorY = Math.min(...map.brushes.map((r) => r.max.y).filter((y) => y > -5), 0);
  const topY = Math.max(...map.brushes.map((r) => r.max.y));
  const shade = (y: number) => {
    const t = Math.max(0, Math.min(1, (y - floorY) / Math.max(1, Math.min(14, topY - floorY))));
    const v = Math.round(40 + t * 190);
    return `rgb(${v},${v},${Math.round(v * 0.92)})`;
  };
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="${W}" height="${H}" fill="#14161a"/>`);
  // grid
  for (let x = Math.ceil(b.min.x / 5) * 5; x <= b.max.x; x += 5) out.push(`<line x1="${X(x)}" y1="${PAD}" x2="${X(x)}" y2="${H - PAD}" stroke="${x % 10 === 0 ? '#2c3038' : '#20232a'}" stroke-width="1"/>` + (x % 10 === 0 ? `<text x="${X(x)}" y="${PAD - 8}" fill="#6b7280" font-size="10" text-anchor="middle">${x}</text>` : ''));
  for (let z = Math.ceil(b.min.z / 5) * 5; z <= b.max.z; z += 5) out.push(`<line x1="${PAD}" y1="${Z(z)}" x2="${W - PAD}" y2="${Z(z)}" stroke="${z % 10 === 0 ? '#2c3038' : '#20232a'}" stroke-width="1"/>` + (z % 10 === 0 ? `<text x="${PAD - 6}" y="${Z(z) + 3}" fill="#6b7280" font-size="10" text-anchor="end">${z}</text>` : ''));
  // brushes, low to high so tall things draw on top
  const order = map.brushes.map((r, i) => ({ r, i })).filter(({ r }) => !r.noRender && r.max.y > floorY + 0.05 && (sliceY === null || r.min.y < sliceY)).sort((a, c) => a.r.max.y - c.r.max.y);
  for (const { r } of order) {
    const x = X(r.min.x), z = Z(r.min.z), w = (r.max.x - r.min.x) * PX, h = (r.max.z - r.min.z) * PX;
    const solid = (r.players ?? r.collide ?? true) !== false;
    if (!solid) {
      out.push(`<rect x="${x}" y="${z}" width="${w}" height="${h}" fill="none" stroke="#5b6472" stroke-width="1" stroke-dasharray="2 2"/>`);
      continue;
    }
    out.push(`<rect x="${x}" y="${z}" width="${w}" height="${h}" fill="${shade(r.max.y)}" stroke="#0b0c0e" stroke-width="0.6"/>`);
    if (r.ramp) {
      const cx = x + w / 2, cz = z + h / 2;
      const d = ({ '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] } as Record<string, [number, number]>)[r.ramp] ?? [0, 0];
      const len = Math.min(w, h) * 0.35;
      out.push(`<line x1="${cx - d[0]! * len}" y1="${cz - d[1]! * len}" x2="${cx + d[0]! * len}" y2="${cz + d[1]! * len}" stroke="#f2c14e" stroke-width="2" marker-end="url(#a)"/>`);
    }
  }
  for (const p of map.props) {
    if (p.kind !== 'cylinder') continue;
    const axis = p.axis ?? 'y';
    if (axis === 'y') out.push(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="${p.r * PX}" fill="${shade(p.y + p.len / 2)}" stroke="#0b0c0e" stroke-width="0.6"/>`);
    else {
      const hx = axis === 'x' ? p.len / 2 : p.r, hz = axis === 'z' ? p.len / 2 : p.r;
      out.push(`<rect x="${X(p.x - hx)}" y="${Z(p.z - hz)}" width="${hx * 2 * PX}" height="${hz * 2 * PX}" rx="${p.r * PX}" fill="${shade(p.y + p.r)}" stroke="#0b0c0e" stroke-width="0.6"/>`);
    }
  }
  // spawns
  const spawn = (s: { x: number; z: number; yaw: number }, color: string) => {
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    return `<circle cx="${X(s.x)}" cy="${Z(s.z)}" r="4" fill="${color}"/><line x1="${X(s.x)}" y1="${Z(s.z)}" x2="${X(s.x) + fx * 10}" y2="${Z(s.z) + fz * 10}" stroke="${color}" stroke-width="2"/>`;
  };
  map.spawns.ffa.forEach((s) => out.push(spawn(s, '#9ca3af')));
  map.spawns.teams[0].forEach((s) => out.push(spawn(s, '#3b82f6')));
  map.spawns.teams[1].forEach((s) => out.push(spawn(s, '#ef4444')));
  // objectives
  const objColor: Record<string, string> = { dom: '#f59e0b', sd: '#a855f7', hq: '#10b981' };
  for (const [kind, pts] of Object.entries(map.objectives)) {
    for (const o of pts) {
      const c = objColor[kind] ?? '#e5e7eb';
      out.push(`<circle cx="${X(o.x)}" cy="${Z(o.z)}" r="${Math.max(6, o.radius * PX)}" fill="none" stroke="${c}" stroke-width="2"/><text x="${X(o.x)}" y="${Z(o.z) + 4}" fill="${c}" font-size="12" font-weight="700" text-anchor="middle">${kind.toUpperCase()} ${o.id}</text>`);
    }
  }
  out.push(`<defs><marker id="a" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#f2c14e"/></marker></defs>`);
  out.push(`<text x="${PAD}" y="${H - 12}" fill="#e5e7eb" font-size="13" font-weight="700">${map.name} (${map.id})${sliceY === null ? '' : ` · slice below y=${sliceY}`}</text>`);
  out.push(`<text x="${W - PAD}" y="${H - 12}" fill="#9ca3af" font-size="11" text-anchor="end">grid 5 m · x right, z down · light = high · blue/red = team spawns · grey = FFA · yellow arrow = ramp up</text>`);
  out.push('</svg>');
  return out.join('\n');
}

const argv = process.argv.slice(2);
const sliceAt = argv.indexOf('--slice');
const sliceY = sliceAt >= 0 ? Number(argv.splice(sliceAt, 2)[1]) : null;
const which = argv[0] ?? 'all';
const outDir = resolve(argv[1] ?? 'docs/maps/overhead');
mkdirSync(outDir, { recursive: true });
const ids = which === 'all' ? MAPS.map((m) => m.id) : [which];
for (const id of ids) {
  const suffix = sliceY === null ? '' : `-y${sliceY}`;
  const svgPath = join(outDir, `${id}-overhead${suffix}.svg`);
  writeFileSync(svgPath, render(getMapData(id), sliceY));
  try {
    const font = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find((f) => existsSync(f));
    execFileSync('magick', [...(font ? ['-font', font] : []), svgPath, svgPath.replace(/\.svg$/, '.png')], { stdio: 'ignore' });
    console.log(`wrote ${svgPath} and .png`);
  } catch {
    console.log(`wrote ${svgPath} (install ImageMagick for a PNG)`);
  }
}
