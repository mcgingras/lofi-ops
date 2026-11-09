/**
 * Radar minimap (top left, under the score): the map from above, rotating with the player; team
 * mates always; enemies the server lists in `snap.radar` (firing, Spy Plane sweeps every second as
 * blips that hold until the next sweep, Blackbird live with facing arrows); with either plane up,
 * enemies beyond the minimap show as small blips on its edge; friendly hardware; enemy aircraft;
 * enemy ground hardware with Hacker; static when jammed by a Counter-Spy Plane.
 */
import type { MapData } from '../../../shared/maps/types';
import { KS_ENTITY } from '../../../shared/defs/killstreaks';
import { HUD_COLORS as C, rect, txt, unit } from '../../hud/draw';
import { registerHudWidget } from '../../registry';
import { currentMatch } from '../../state';
import type { Match } from '../../game/match';
import { iHave } from '../perks/state';
import { friendly } from './store';
import { iAmGlitched } from './glitch-state';
import { clampToRadar, PULSE_SEC, sweepPings, type Ping } from './radar-logic';

const PX_PER_M = 4;
const VIEW_M = 50; // metres shown across the radar

let mapCanvas: HTMLCanvasElement | null = null;
let mapId = '';
let ox = 0;
let oz = 0;

/** Top-down picture of the map's walls (brushes standing above head height or thick). */
function buildMap(map: MapData): HTMLCanvasElement {
  const b = map.bounds;
  const w = Math.ceil((b.max.x - b.min.x) * PX_PER_M);
  const h = Math.ceil((b.max.z - b.min.z) * PX_PER_M);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2c3026';
  g.fillRect(0, 0, w, h);
  ox = b.min.x;
  oz = b.min.z;
  const ground = map.spawns.ffa[0]?.y ?? 0;
  const sorted = [...map.brushes].filter((br) => br.collide !== false && !br.noRender).sort((a, bb) => a.max.y - bb.max.y);
  for (const br of sorted) {
    const top = br.max.y - ground;
    if (top < 0.3) continue;
    g.fillStyle = top > 2.2 ? '#8a8a80' : top > 1 ? '#5e6254' : '#444a3c';
    g.fillRect((br.min.x - ox) * PX_PER_M, (br.min.z - oz) * PX_PER_M, Math.max(1, (br.max.x - br.min.x) * PX_PER_M), Math.max(1, (br.max.z - br.min.z) * PX_PER_M));
  }
  return c;
}

let pings: Ping[] = [];
let lastSweep = -Infinity;

function radarState(m: Match) {
  const snap = m.net.lastSnap;
  const ents = snap?.ents ?? [];
  const mine = (owner: string | undefined, team: number | null | undefined) => friendly(owner ?? '', team ?? null);
  const uav = ents.some((e) => e.kind === KS_ENTITY.uav && mine(e.owner, e.team));
  const blackbird = ents.some((e) => e.kind === KS_ENTITY.blackbird && mine(e.owner, e.team));
  return { snap, ents, uav, blackbird, jammed: !!snap?.jammed, radar: new Set(snap?.radar ?? []) };
}

registerHudWidget(
  'killstreaks.radar',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.map || m.phase === 'ended') return;
    const u = unit(H);
    const size = 56 * u;
    const x0 = 8 * u;
    const y0 = 40 * u;
    const cx = x0 + size / 2;
    const cy = y0 + size / 2;
    const map = m.map.map;
    if (mapId !== map.id) {
      mapCanvas = buildMap(map);
      mapId = map.id;
      pings = [];
    }
    const me = m.me;
    const shown = m.net.predictor.shown();
    const px = me?.alive ? shown.x : m.renderer.cam.position.x;
    const pz = me?.alive ? shown.z : m.renderer.cam.position.z;
    const yaw = m.yaw;
    const scale = size / VIEW_M; // px per metre on screen
    const st = radarState(m);

    rect(g, x0 - u, y0 - u, size + 2 * u, size + 2 * u, C.ink);
    g.save();
    g.beginPath();
    g.rect(x0, y0, size, size);
    g.clip();
    rect(g, x0, y0, size, size, '#1c1f18');
    // World (x,z) -> radar: rotate so the view direction points up.
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const toRadar = (wx: number, wz: number): [number, number] => {
      const dx = wx - px;
      const dz = wz - pz;
      // Forward (yaw 0) is -z; right is +x rotated. Screen up = forward.
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      return [cx + rx * scale, cy + rz * scale];
    };
    if (st.jammed) {
      for (let i = 0; i < 260; i++) {
        const v = Math.random();
        rect(g, x0 + Math.floor(Math.random() * size), y0 + Math.floor(Math.random() * size), 2 * u, u, v > 0.5 ? '#8a8a80' : '#3a3c34');
      }
      g.restore();
      txt(g, iAmGlitched() ? 'NO SIGNAL' : 'JAMMED', cx, y0 + size + 2 * u, 8, C.warn, 'center', u);
      return;
    }
    if (mapCanvas) {
      g.imageSmoothingEnabled = false;
      g.translate(cx, cy);
      g.rotate(yaw);
      g.scale(scale / PX_PER_M, scale / PX_PER_M);
      g.drawImage(mapCanvas, (ox - px) * PX_PER_M, (oz - pz) * PX_PER_M);
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    const mark = (sx: number, sy: number, col: string, s = 2) => {
      rect(g, sx - s * u * 0.5 - u * 0.5, sy - s * u * 0.5 - u * 0.5, s * u + u, s * u + u, C.ink);
      rect(g, sx - s * u * 0.5, sy - s * u * 0.5, s * u, s * u, col);
    };
    const dot = (wx: number, wz: number, col: string, s = 2) => mark(...toRadar(wx, wz), col, s);
    // An enemy a plane found: on the map, or a small blip on its edge when they are beyond it.
    const half = size / 2 - 2 * u;
    const found = (wx: number, wz: number, s = 2): boolean => {
      const [sx, sy] = toRadar(wx, wz);
      const p = clampToRadar(sx - cx, sy - cy, half);
      mark(cx + p.x, cy + p.y, C.enemy, p.out ? 1 : s);
      return !p.out;
    };
    // Hardware.
    for (const e of st.ents) {
      const f = friendly(e.owner ?? '', e.team ?? null);
      const air = e.kind === KS_ENTITY.heli || e.kind === KS_ENTITY.gunner || e.kind === KS_ENTITY.dropHeli || e.kind === KS_ENTITY.uav || e.kind === KS_ENTITY.counterUav;
      const ground = e.kind === KS_ENTITY.sentry || e.kind === KS_ENTITY.sam || e.kind === KS_ENTITY.crate || e.kind === KS_ENTITY.rcxd;
      if (e.kind === KS_ENTITY.mortarMark) {
        const [sx, sy] = toRadar(e.x, e.z);
        g.strokeStyle = C.warn;
        g.lineWidth = u;
        g.strokeRect(sx - 3 * u, sy - 3 * u, 6 * u, 6 * u);
      } else if (e.kind === KS_ENTITY.dog && f) dot(e.x, e.z, C.friend, 1);
      else if (air && (f || e.kind !== KS_ENTITY.uav)) dot(e.x, e.z, f ? '#a0c8ff' : '#ff9a7a', 3);
      else if (ground && (f || iHave('hacker'))) dot(e.x, e.z, f ? C.friend : C.enemy, 2);
    }
    // Team mates.
    for (const r of m.remotes.views.values()) if (r.alive && !m.isEnemy(r.id)) dot(r.x, r.z, C.friend);
    // Enemies: Spy Plane sweeps pin blips until the next sweep; Blackbird and gunfire are live.
    const now = m.time;
    const seen = [...m.remotes.views.values()].filter((r) => r.alive && st.radar.has(r.id));
    ({ pings, lastSweep } = sweepPings(pings, lastSweep, now, st.uav && !st.blackbird, seen));
    for (const p of pings) found(p.x, p.z, now - p.t < PULSE_SEC ? 3 : 2);
    for (const r of seen) {
      if (st.uav && !st.blackbird) continue; // drawn as pings
      if (!st.blackbird) dot(r.x, r.z, C.enemy);
      else if (found(r.x, r.z)) {
        const [sx, sy] = toRadar(r.x, r.z);
        const fx = -Math.sin(r.yaw);
        const fz = -Math.cos(r.yaw);
        const ax = fx * cos - fz * sin;
        const az = fx * sin + fz * cos;
        rect(g, sx + ax * 3 * u - u / 2, sy + az * 3 * u - u / 2, u, u, C.enemy);
      }
    }
    g.restore();
    // Me: an arrow pointing up.
    rect(g, cx - u, cy - 2 * u, 2 * u, 4 * u, C.hi);
    rect(g, cx - 2 * u, cy, 4 * u, u, C.hi);
    if (st.uav || st.blackbird) txt(g, st.blackbird ? 'BLACKBIRD' : 'SPY PLANE', cx, y0 + size + 2 * u, 8, C.friend, 'center', u);
  },
  45,
);
