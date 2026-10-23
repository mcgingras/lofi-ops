/**
 * Blackout HUD: the alive counter and circle timer (top right, in place of the score corner), a
 * minimap with the circle and the next one (top left, in place of the radar), armour and heals
 * (bottom left), the two-slot inventory (bottom right), drop prompts, the out-of-circle warning,
 * pick-up notes, the big map (hold or tap M), and the placement / victory screen with spectating
 * ([F] next player). Core widgets that don't fit (score corner, radar, death screen) step aside in
 * Blackout matches only.
 */
import { BLACKOUT, outsideBy, planeAt, rarityOf, RARITY_COLOR, type Circle } from '../../../shared/defs/blackout';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { BLACKOUT_TOWNS, townRect } from '../../../shared/maps/blackout';
import type { MapData } from '../../../shared/maps/types';
import type { Match } from '../../game/match';
import { promptKey } from '../../game/prompts';
import { blink, clock, HUD_COLORS as C, rect, txt, unit } from '../../hud/draw';
import { net } from '../../net';
import { hudWidgets, registerHudWidget, registerMatchHook, type HudDraw } from '../../registry';
import { currentMatch } from '../../state';
import { bo, circleNow, isBlackout } from './store';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

// ---------------------------------------------------------------------------------------------
// The map picture (1 px per metre), shared by the minimap and the big map
// ---------------------------------------------------------------------------------------------

let picture: { id: string; canvas: HTMLCanvasElement; x0: number; z0: number } | null = null;

function mapPicture(map: MapData): { canvas: HTMLCanvasElement; x0: number; z0: number } {
  if (picture?.id === map.id) return picture;
  const b = map.bounds;
  const w = Math.ceil(b.max.x - b.min.x);
  const h = Math.ceil(b.max.z - b.min.z);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#4a5a3a';
  g.fillRect(0, 0, w, h);
  const x0 = b.min.x;
  const z0 = b.min.z;
  for (const t of BLACKOUT_TOWNS) {
    const r = townRect(t);
    g.fillStyle = '#6a6656';
    g.fillRect(r.x0 - x0, r.z0 - z0, r.x1 - r.x0, r.z1 - r.z0);
  }
  const sorted = map.brushes.filter((br) => br.collide !== false && !br.noRender && br.max.y > 0.4 && br.max.x - br.min.x < 70).sort((a, c) => a.max.y - c.max.y);
  for (const br of sorted) {
    const top = br.max.y;
    g.fillStyle = top > 6 ? '#b8b4a4' : top > 2.5 ? '#98948a' : '#7a786c';
    g.fillRect(br.min.x - x0, br.min.z - z0, Math.max(1, br.max.x - br.min.x), Math.max(1, br.max.z - br.min.z));
  }
  picture = { id: map.id, canvas, x0, z0 };
  return picture;
}

/** Stroke a circle given in world coordinates through a world->screen mapping. */
function ring(g: CanvasRenderingContext2D, c: Circle, to: (x: number, z: number) => [number, number], scale: number, color: string, u: number, dash = false) {
  const [sx, sy] = to(c.x, c.z);
  g.strokeStyle = color;
  g.lineWidth = Math.max(1, u);
  g.setLineDash(dash ? [3 * u, 3 * u] : []);
  g.beginPath();
  g.arc(sx, sy, Math.max(0.5, c.r * scale), 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
}

function myPos(m: Match): { x: number; z: number } {
  if (m.alive) {
    const s = m.net.predictor.shown();
    return { x: s.x, z: s.z };
  }
  return { x: m.renderer.cam.position.x, z: m.renderer.cam.position.z };
}

// ---------------------------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------------------------

function drawMinimap(m: Match, g: CanvasRenderingContext2D, W: number, H: number) {
  if (!m.map || m.phase === 'ended') return;
  void W;
  const u = unit(H);
  const size = 64 * u;
  const x0 = 8 * u;
  const y0 = 46 * u;
  const view = 220; // metres across
  const scale = size / view;
  const p = myPos(m);
  const pic = mapPicture(m.map.map);
  const to = (x: number, z: number): [number, number] => [x0 + size / 2 + (x - p.x) * scale, y0 + size / 2 + (z - p.z) * scale];
  rect(g, x0 - u, y0 - u, size + 2 * u, size + 2 * u, C.ink);
  g.save();
  g.beginPath();
  g.rect(x0, y0, size, size);
  g.clip();
  rect(g, x0, y0, size, size, '#1c2a3a');
  g.imageSmoothingEnabled = false;
  const [ix, iy] = to(pic.x0, pic.z0);
  g.drawImage(pic.canvas, ix, iy, pic.canvas.width * scale, pic.canvas.height * scale);
  const c = circleNow(m);
  if (c) {
    if (c.next) ring(g, c.next, to, scale, '#ffffff', u, true);
    ring(g, c.cur, to, scale, '#ff7a3a', u);
  }
  drawPlaneLine(m, g, to, u);
  g.restore();
  // Me: an arrow along the view.
  const cx = x0 + size / 2;
  const cy = y0 + size / 2;
  g.fillStyle = C.hi;
  g.beginPath();
  g.moveTo(cx - Math.sin(m.yaw) * 4 * u, cy - Math.cos(m.yaw) * 4 * u);
  g.lineTo(cx + Math.cos(m.yaw) * 2.5 * u, cy - Math.sin(m.yaw) * 2.5 * u);
  g.lineTo(cx - Math.cos(m.yaw) * 2.5 * u, cy + Math.sin(m.yaw) * 2.5 * u);
  g.fill();
  const town = BLACKOUT_TOWNS.find((t) => {
    const r = townRect(t);
    return p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1;
  });
  if (town) txt(g, town.name.toUpperCase(), x0 + size / 2, y0 + size + 3 * u, 8, C.paper, 'center', u);
}

function drawPlaneLine(m: Match, g: CanvasRenderingContext2D, to: (x: number, z: number) => [number, number], u: number) {
  const s = bo.state;
  if (!s || s.t0 < 0) return;
  const t = m.serverTime - s.t0;
  if (t > s.plane.duration + 2) return;
  const [ax, ay] = to(s.plane.x0, s.plane.z0);
  const [bx, by] = to(s.plane.x1, s.plane.z1);
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = Math.max(1, u);
  g.setLineDash([2 * u, 2 * u]);
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(bx, by);
  g.stroke();
  g.setLineDash([]);
  const at = planeAt(s.plane, t);
  const [px, py] = to(at.x, at.z);
  rect(g, px - 2 * u, py - 2 * u, 4 * u, 4 * u, '#ffffff');
}

function drawCorner(m: Match, g: CanvasRenderingContext2D, W: number, H: number) {
  const s = bo.state;
  if (!s) return;
  const u = unit(H);
  void W;
  // Top left, over the minimap (the killfeed has the top right).
  const x = 8 * u + 77 * u - 3 * u;
  let y = 6 * u;
  rect(g, 8 * u - u, y - 3 * u, 77 * u, 32 * u, 'rgba(10,10,10,.55)');
  txt(g, `${s.alive}`, x - 30 * u, y, 16, C.paper, 'right', u);
  txt(g, 'ALIVE', x, y + 5 * u, 8, C.dim, 'right', u);
  y += 16 * u;
  txt(g, `KILLS ${s.kills}`, x, y, 8, C.hi, 'right', u);
  const c = circleNow(m);
  if (c && c.endsAt !== null && s.t0 >= 0) {
    const left = Math.max(0, c.endsAt - (m.serverTime - s.t0));
    const label = c.stage === 'shrink' ? 'CIRCLE CLOSING' : 'CIRCLE MOVES IN';
    txt(g, `${label} ${clock(left)}`, 8 * u, y + 11 * u, 8, c.stage === 'shrink' ? C.warn : C.paper, 'left', u);
  } else if (c) txt(g, 'FINAL CIRCLE', 8 * u, y + 11 * u, 8, C.warn, 'left', u);
}

function drawGear(m: Match, g: CanvasRenderingContext2D, W: number, H: number) {
  const s = bo.state;
  if (!s || !m.alive || s.stage !== 'ground') return;
  const u = unit(H);
  const x = 8 * u;
  const y = H - 30 * u;
  // Armour bar over the health bar.
  if (s.armorMax > 0) {
    const w = 60 * u;
    rect(g, x - u, y - u, w + 2 * u, 4 * u, C.ink);
    rect(g, x, y, (w * s.armor) / Math.max(1, s.armorMax), 2 * u, C.blue);
    txt(g, `ARMOR LV${Math.round(s.armorMax / BLACKOUT.armor.perLevel)}`, x + w + 4 * u, y - 2 * u, 8, C.blue, 'left', u);
  }
  const heal = promptKey('streak', { brackets: true });
  const healing = s.healUntil !== null;
  txt(g, `${heal} ${healing ? 'HEALING...' : `HEAL  BANDAGE ${s.bandages}  MED KIT ${s.medkits}`}`, x, y - 12 * u, 8, healing ? C.hi : s.bandages + s.medkits > 0 ? C.paper : C.dim, 'left', u);
  // Inventory: the two slots (knife = empty).
  const me = m.me;
  if (!me) return;
  let iy = H - 52 * u;
  for (let i = 0; i < 2; i++) {
    const w = me.weapons[i];
    const def = w ? WEAPON_BY_ID.get(w.id) : undefined;
    const empty = !w || w.id === 'knife';
    const rarity = empty ? null : rarityOf(w.attachments.length, w.id);
    const label = empty ? 'EMPTY' : (def?.name ?? w.id).toUpperCase();
    const col = empty ? C.dim : hex(RARITY_COLOR[rarity!]);
    const sel = m.slot === i;
    txt(g, `${i + 1} ${sel ? '>' : ' '} ${label}${!empty && w ? `  ${w.mag}/${w.reserve}` : ''}`, W - 8 * u, iy, 8, sel ? col : empty ? C.dim : col, 'right', u);
    iy += 10 * u;
  }
}

function drawPrompts(m: Match, g: CanvasRenderingContext2D, W: number, H: number) {
  const s = bo.state;
  if (!s || m.phase !== 'playing') return;
  const u = unit(H);
  const jump = promptKey('jump');
  if (m.alive && s.stage === 'plane') {
    const doors = s.t0 >= 0 && m.serverTime - s.t0 >= BLACKOUT.plane.doorsSec;
    const left = s.t0 >= 0 ? Math.max(0, s.plane.duration - BLACKOUT.plane.forceJumpBeforeEnd - (m.serverTime - s.t0)) : 0;
    txt(g, doors ? `PRESS ${jump} TO JUMP` : 'DOORS OPENING', W / 2, H * 0.7, 16, C.hi, 'center', u);
    if (doors) txt(g, `${Math.ceil(left)} S UNTIL THE END OF THE LINE · M: MAP`, W / 2, H * 0.7 + 18 * u, 8, C.paper, 'center', u);
  } else if (m.alive && (s.stage === 'freefall' || s.stage === 'chute')) {
    const st = m.net.predictor.shown();
    const g0 = m.net.world.groundBelow(st.x, st.z, st.y, 400);
    const alt = g0 === null ? st.y : st.y - g0;
    txt(g, `ALT ${Math.max(0, Math.round(alt))} M`, W / 2, H * 0.72, 16, C.paper, 'center', u);
    txt(g, s.stage === 'freefall' ? `${jump} OPEN PARACHUTE · OPENS BY ITSELF AT ${BLACKOUT.deployHeight} M` : 'STEER WITH WASD', W / 2, H * 0.72 + 18 * u, 8, C.hi, 'center', u);
  }
  // Outside the circle.
  const c = circleNow(m);
  if (c && m.alive && s.stage === 'ground') {
    const p = myPos(m);
    const out = outsideBy(c.cur, p.x, p.z);
    if (out > 0) {
      const k = Math.min(1, 0.4 + c.dps / 20);
      g.strokeStyle = `rgba(255,90,40,${k})`;
      g.lineWidth = 4 * u;
      g.strokeRect(2 * u, 2 * u, W - 4 * u, H - 4 * u);
      if (blink(m.time, 0.8, 0.55)) txt(g, `OUTSIDE THE CIRCLE · ${Math.round(out)} M · -${c.dps} HP/S`, W / 2, H * 0.24, 8, C.warn, 'center', u);
    }
  }
  // Pick-up notes.
  const now = performance.now() / 1000;
  let ny = H * 0.62;
  for (const n of bo.notes) {
    if (now - n.t > 2.5) continue;
    txt(g, n.text, W / 2, ny, 8, C.hi, 'center', u);
    ny += 10 * u;
  }
}

/** Placement / victory screen and the spectate line. */
function drawPlaced(m: Match, g: CanvasRenderingContext2D, W: number, H: number) {
  const p = bo.placed;
  if (!p || m.phase === 'lobby') return;
  const u = unit(H);
  const y = H * 0.2;
  rect(g, 0, y - 8 * u, W, 58 * u, 'rgba(10,10,10,.6)');
  if (p.won) {
    txt(g, 'VICTORY', W / 2, y, 16, C.hi, 'center', u);
    txt(g, `#1 OF ${p.of} · LAST ONE STANDING`, W / 2, y + 20 * u, 8, C.paper, 'center', u);
  } else {
    txt(g, `#${p.place}`, W / 2, y, 16, p.place <= 10 ? C.hi : C.paper, 'center', u);
    txt(g, `OF ${p.of}`, W / 2, y + 18 * u, 8, C.dim, 'center', u);
  }
  txt(g, `KILLS ${p.kills} · SURVIVED ${clock(p.survived)} · +${p.xp} XP${p.killerName ? ` · KILLED BY ${p.killerName.toUpperCase()}` : ''}`, W / 2, y + 32 * u, 8, C.paper, 'center', u);
  const s = bo.state;
  if (!p.won && m.phase === 'playing') {
    const watching = s?.watching ? m.nameOf(s.watching) : null;
    txt(g, watching ? `SPECTATING ${watching.toUpperCase()} · ${promptKey('use', { brackets: true })} NEXT PLAYER · ESC: LEAVE` : 'ESC: LEAVE', W / 2, H - 22 * u, 8, C.hi, 'center', u);
  }
}

/** The big map (M). */
let bigMap = false;
let mHeldAt = 0;

function drawBigMap(m: Match, g: CanvasRenderingContext2D, W: number, H: number) {
  if (!bigMap || !m.map) return;
  const u = unit(H);
  const size = Math.min(W, H) - 30 * u;
  const x0 = (W - size) / 2;
  const y0 = (H - size) / 2;
  const pic = mapPicture(m.map.map);
  const scale = size / pic.canvas.width;
  const to = (x: number, z: number): [number, number] => [x0 + (x - pic.x0) * scale, y0 + (z - pic.z0) * scale];
  rect(g, x0 - 2 * u, y0 - 2 * u, size + 4 * u, size + 4 * u, C.ink);
  g.imageSmoothingEnabled = false;
  g.drawImage(pic.canvas, x0, y0, size, size);
  g.save();
  g.beginPath();
  g.rect(x0, y0, size, size);
  g.clip();
  const c = circleNow(m);
  if (c) {
    if (c.next) ring(g, c.next, to, scale, '#ffffff', u, true);
    ring(g, c.cur, to, scale, '#ff7a3a', 2 * u);
  }
  drawPlaneLine(m, g, to, u);
  g.restore();
  for (const t of BLACKOUT_TOWNS) {
    const r = townRect(t);
    const [sx, sy] = to((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    txt(g, t.name.toUpperCase(), sx, sy - 4 * u, 8, C.paper, 'center', u);
  }
  const p = myPos(m);
  const [mx, my] = to(p.x, p.z);
  rect(g, mx - 2 * u, my - 2 * u, 4 * u, 4 * u, C.hi);
  txt(g, 'M: CLOSE', x0 + size, y0 + size + 3 * u, 8, C.dim, 'right', u);
}

registerHudWidget('blackout.corner', (g, W, H) => {
  const m = currentMatch();
  if (isBlackout(m) && !bigMap) drawCorner(m, g, W, H);
}, 50);
registerHudWidget('blackout.minimap', (g, W, H) => {
  const m = currentMatch();
  if (isBlackout(m) && !bigMap) drawMinimap(m, g, W, H);
}, 45);
registerHudWidget('blackout.gear', (g, W, H) => {
  const m = currentMatch();
  if (isBlackout(m) && !bigMap) drawGear(m, g, W, H);
}, 42);
registerHudWidget('blackout.prompts', (g, W, H) => {
  const m = currentMatch();
  if (isBlackout(m) && !bigMap) drawPrompts(m, g, W, H);
}, 64);
registerHudWidget('blackout.placed', (g, W, H) => {
  const m = currentMatch();
  if (isBlackout(m) && !bigMap) drawPlaced(m, g, W, H);
}, 82);
registerHudWidget('blackout.bigmap', (g, W, H) => {
  const m = currentMatch();
  if (isBlackout(m)) drawBigMap(m, g, W, H);
}, 97);

// ---------------------------------------------------------------------------------------------
// Core widgets that step aside in Blackout, keys
// ---------------------------------------------------------------------------------------------

let wrapped = false;
function wrapCore(): void {
  if (wrapped) return;
  wrapped = true;
  const wrap = (id: string, fn: (orig: HudDraw) => HudDraw) => {
    const w = hudWidgets.get(id);
    if (w) registerHudWidget(id, fn(w.draw), w.order);
  };
  for (const id of ['core.score', 'core.death', 'killstreaks.radar', 'frontend.classHint'])
    wrap(id, (orig) => (g, W, H, dt) => {
      if (isBlackout(currentMatch())) return;
      orig(g, W, H, dt);
    });
  // In the plane and the air: no crosshair, no ammo counter.
  for (const id of ['core.crosshair', 'core.ammo'])
    wrap(id, (orig) => (g, W, H, dt) => {
      const m = currentMatch();
      if (isBlackout(m) && (bigMap || (bo.state && bo.state.stage !== 'ground'))) return;
      orig(g, W, H, dt);
    });
}

function onKey(e: KeyboardEvent) {
  const m = currentMatch();
  if (!isBlackout(m) || e.repeat) return;
  if (e.code === 'KeyM') {
    if (e.type === 'keydown') {
      bigMap = !bigMap;
      mHeldAt = performance.now();
    } else if (performance.now() - mHeldAt > 350) bigMap = false; // held: closes on release
  }
}

registerMatchHook('blackout.hud', {
  start(m) {
    wrapCore();
    if (!isBlackout(m)) return;
    bigMap = false;
    addEventListener('keydown', onKey);
    addEventListener('keyup', onKey);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('keyup', onKey);
    };
  },
  frame(m) {
    if (!isBlackout(m)) return;
    // Spectating: USE (F / pad X) watches the next player alive.
    if (!m.alive && bo.placed && !bo.placed.won && m.phase === 'playing' && m.controls.consume('use')) void net.rpc('blackout.spectate', { next: true }).catch(() => {});
  },
});
