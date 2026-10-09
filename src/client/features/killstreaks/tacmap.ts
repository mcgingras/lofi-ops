/**
 * Tactical map mode (BO1's radio for Napalm Strike, Mortar Team, Rolling Thunder and the Attack
 * Helicopter). STREAK with one of them selected makes the server raise the radio
 * (`killstreaks.state.map`); here the handset comes up in first person, the feed cuts in with a
 * burst of static, and the overhead map of the actual level fills the screen over a screen-door
 * view of the world: satellite picture (overhead.ts), lettered/numbered grid, compass, map and
 * streak names, a timer, you (yellow arrow), team mates (blue), enemies only when your radar shows
 * them, and friendly streaks already up. You place the strike (tacmap-logic.ts) with the mouse
 * (pointer-lock deltas, or the absolute pointer in ?devlook=1), WASD/arrows and a gamepad, and the
 * choice goes to the server as `killstreaks.mapTarget`. Esc / STREAK / B cancels and keeps the
 * streak; dying, the timeout or a refused lock also put the radio away.
 *
 * While the map is up the core controls are disabled (no movement, look, fire), matching the
 * server, which holds the body still with the weapon down.
 */
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../../../shared/defs/killstreaks';
import { STRIKE, dirOfYaw, mapPointsNeeded, strikeLength } from '../../../shared/defs/tactical-map';
import type { Match } from '../../game/match';
import { sfx } from '../../game/audio';
import { gamepad, PAD, padDown } from '../../game/gamepad';
import { radialDeadzone } from '../../game/pad';
import { HUD_COLORS as C, clock, rect, txt, unit } from '../../hud/draw';
import { net } from '../../net';
import { registerHudWidget, registerMatchHook } from '../../registry';
import { currentMatch } from '../../state';
import { overheadImage } from './overhead';
import { FirstPersonRadio } from './radio';
import { friendly, ksClient, streakName } from './store';
import { MapView, TacMapPicker, gridCell, gridRef, type MapRect, type MapSubmit } from './tacmap-logic';

/** Seconds: radio coming up, then static, then the map. Closing: static, radio going down. */
const RAISE = 0.4;
const FUZZ = 0.28;
const CLOSE_FUZZ = 0.16;

const ORANGE = '#ff9a3a';
const GRID = '#4f6a55';
const GRID_TXT = '#a8c8ad';

interface Open {
  id: string;
  picker: TacMapPicker;
  t0: number;
  until: number;
  staticPlayed: boolean;
}

const S = {
  open: null as Open | null,
  /** Local time the map closed (for the closing static and the radio going down). */
  closedAt: -99,
  /** The server's `until` of a map we already closed locally (don't reopen it on a late push). */
  closedFor: -1,
  raise: 0,
  error: null as { text: string; t: number } | null,
  view: null as MapView | null,
  image: null as HTMLCanvasElement | null,
  keys: new Set<string>(),
  /** Pad buttons last frame (A drags like a mouse button: press, then release). */
  pad: { a: false, b: false, x: false },
  /** Why the map last closed (dev helper / debugging). */
  lastClose: '',
};

const radio = new FirstPersonRadio();

/** True while the tactical map owns the screen and input. */
export const tacmapOpen = () => !!S.open;

function phaseOf(m: Match): 'raise' | 'fuzz' | 'map' | 'closing' | 'closed' {
  if (S.open) {
    const el = m.time - S.open.t0;
    return el < RAISE ? 'raise' : el < RAISE + FUZZ ? 'fuzz' : 'map';
  }
  return m.time - S.closedAt < CLOSE_FUZZ ? 'closing' : 'closed';
}

function mapRect(m: Match): MapRect | null {
  const b = m.map?.map.bounds;
  return b ? { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z } : null;
}

function begin(m: Match, id: string, until: number): void {
  const def = KILLSTREAK_BY_ID.get(id);
  const rect = mapRect(m);
  if (!def?.mapPick || !rect) return;
  const me = m.net.predictor.shown();
  S.open = { id, picker: new TacMapPicker(id, def.mapPick, mapPointsNeeded(def), rect, { x: me.x, z: me.z }, m.yaw), t0: m.time, until, staticPlayed: false };
  S.error = null;
  S.keys.clear();
  // Buttons already held when the map opens (D-pad up that called it) don't count as presses.
  const held = gamepad.snapshot();
  S.pad = { a: padDown(held, PAD.A), b: padDown(held, PAD.B), x: padDown(held, PAD.X) };
  m.controls.enabled = false;
  m.controls.ads = false;
  m.controls.fire = false;
}

function end(m: Match, why: string): void {
  if (!S.open) return;
  S.lastClose = why;
  S.closedFor = S.open.until;
  S.open = null;
  S.closedAt = m.time;
  S.keys.clear();
  m.controls.enabled = true;
  sfx.play('ks_static', { volume: 0.25 });
}

function cancel(m: Match, why = 'cancel'): void {
  if (!S.open) return;
  end(m, why);
  void net.rpc('killstreaks.mapCancel', {}).catch(() => {});
}

const REASONS: Record<string, string> = {
  out_of_bounds: 'OUTSIDE THE MAP',
  airspace_full: 'AIRSPACE TOO CROWDED',
  rate_limited: 'STAND BY',
  map_closed: 'RADIO DOWN',
  not_ready: 'NOT READY',
  dead: 'NOT WHILE DEAD',
};

function send(m: Match, req: MapSubmit | null): void {
  const o = S.open;
  if (!req || !o) return;
  sfx.play('ks_mark', { volume: 0.4 });
  net
    .rpc('killstreaks.mapTarget', req)
    .then((res) => {
      if (S.open !== o) return;
      if (res.ok) {
        sfx.play('ks_confirm', { volume: 0.45 });
        end(m, 'sent');
      } else {
        o.picker.refused();
        S.error = { text: REASONS[res.reason ?? ''] ?? 'INVALID TARGET', t: m.time };
      }
    })
    .catch(() => {
      if (S.open !== o) return;
      o.picker.refused();
      S.error = { text: 'NO SIGNAL', t: m.time };
    });
}

const undo = (p: TacMapPicker): null => {
  p.undo();
  return null;
};

/** Run the picker action and play the mark chirp for mortar marks that don't complete it yet. */
function act(m: Match, fn: (p: TacMapPicker) => MapSubmit | null): void {
  const o = S.open;
  if (!o || phaseOf(m) !== 'map') return;
  const before = o.picker.marks.length;
  const req = fn(o.picker);
  if (req) send(m, req);
  else if (o.picker.marks.length > before) sfx.play('ks_mark', { volume: 0.35 });
}

/** Screen pixel (client coords) -> HUD pixel. */
function hudPoint(m: Match, clientX: number, clientY: number): [number, number] {
  const r = m.renderer.canvas.getBoundingClientRect();
  return [((clientX - r.left) * m.renderer.width) / Math.max(1, r.width), ((clientY - r.top) * m.renderer.height) / Math.max(1, r.height)];
}

function pointerLocked(m: Match): boolean {
  return document.pointerLockElement === m.renderer.canvas;
}

/** Panel layout for the current render size (shared by the frame hook and the widget). */
function layout(m: Match): MapView | null {
  const rect = mapRect(m);
  if (!rect) return null;
  const W = m.renderer.width;
  const H = m.renderer.height;
  const u = unit(H);
  const top = 6 * u + 12 * u;
  const bottom = 6 * u + 14 * u;
  return new MapView(rect, { x: 8 * u, y: top, w: W - 16 * u, h: H - top - bottom });
}

registerMatchHook('killstreaks.tacmap', {
  start(m) {
    S.open = null;
    S.closedFor = -1;
    S.image = null;
    const canvas = m.renderer.canvas;
    const offs: (() => void)[] = [];
    const on = <K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void, capture = false) => {
      window.addEventListener(t, fn as EventListener, capture);
      offs.push(() => window.removeEventListener(t, fn as EventListener, capture));
    };
    on(
      'keydown',
      (e) => {
        if (!S.open) return;
        const c = e.code;
        if (c === 'Escape' || c === 'Digit4') {
          e.preventDefault();
          e.stopImmediatePropagation(); // devlook: don't also "unlock" into the pause menu
          if (!e.repeat) cancel(m, c === 'Escape' ? 'esc' : 'streak');
          return;
        }
        if (c === 'Backspace') {
          e.preventDefault();
          if (!e.repeat) act(m, undo);
          return;
        }
        if (c === 'Space' || c === 'Enter' || c === 'NumpadEnter') {
          e.preventDefault();
          if (!e.repeat) act(m, (p) => p.press());
          return;
        }
        if (c.startsWith('Arrow') || ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(c)) {
          e.preventDefault();
          S.keys.add(c);
        }
      },
      true,
    );
    on(
      'keyup',
      (e) => {
        S.keys.delete(e.code);
        if (S.open && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')) act(m, (p) => p.release());
      },
      true,
    );
    on('mousemove', (e) => {
      const o = S.open;
      const view = S.view;
      if (!o || !view || phaseOf(m) !== 'map') return;
      if (pointerLocked(m)) {
        // One screen pixel of mouse travel = one displayed pixel of map.
        const k = m.renderer.width / Math.max(1, canvas.clientWidth) / view.scale;
        o.picker.moveBy(e.movementX * k, e.movementY * k);
      } else {
        const [hx, hy] = hudPoint(m, e.clientX, e.clientY);
        const w = view.toWorld(hx, hy);
        o.picker.moveTo(w.x, w.z);
      }
    });
    on('mousedown', (e) => {
      if (!S.open || phaseOf(m) !== 'map') return;
      if (!pointerLocked(m) && S.view) {
        const [hx, hy] = hudPoint(m, e.clientX, e.clientY);
        const w = S.view.toWorld(hx, hy);
        S.open.picker.moveTo(w.x, w.z);
      }
      if (e.button === 0) act(m, (p) => p.press());
      if (e.button === 2) act(m, undo);
    });
    on('mouseup', (e) => {
      if (S.open && e.button === 0) act(m, (p) => p.release());
    });
    offs.push(
      m.controls.onLock((locked) => {
        if (!locked && S.open) cancel(m, 'unlocked');
      }),
    );
    if (m.controls.devlook) installDevHelpers(m, offs);
    return () => {
      for (const off of offs) off();
      if (S.open) end(m, 'stopped');
      S.open = null;
      m.controls.enabled = true;
      radio.dispose();
    };
  },
  frame(m, dt) {
    const st = ksClient.state;
    const want = st?.map && m.alive && m.phase === 'playing' ? st.map : null;
    if (want && !S.open && want.until !== S.closedFor) begin(m, want.id, want.until);
    else if (S.open && (!want || want.id !== S.open.id)) end(m, !m.alive ? 'died' : !st?.map ? 'server' : 'switched');
    if (!want) S.closedFor = -1;
    const o = S.open;
    const phase = phaseOf(m);
    if (o) {
      m.controls.enabled = false;
      if (!o.staticPlayed && phase !== 'raise') {
        o.staticPlayed = true;
        sfx.play('ks_static', { volume: 0.3 });
      }
      if (phase === 'map') steer(m, o.picker, dt);
    }
    // Radio up while the map is open (and while the feed cuts in/out).
    const target = o ? 1 : 0;
    S.raise += (target - S.raise) * Math.min(1, dt * (o ? 9 : 7));
    if (!o && S.raise < 0.02) S.raise = 0;
    if (S.raise > 0.02 && m.alive) m.viewmodel.visible = false;
    radio.update(m, m.alive ? S.raise : 0);
    // Panel layout and the satellite picture (rendered here, before the frame's own render).
    if (o && m.map && phase !== 'raise') {
      S.view = layout(m);
      if (S.view) S.image = overheadImage(m.renderer, m.map, S.view.w, S.view.h);
    }
  },
});

/** Keys and gamepad move the cursor and rotate the arrow. */
function steer(m: Match, p: TacMapPicker, dt: number): void {
  const r = p.rect;
  const speed = Math.max(r.maxX - r.minX, r.maxZ - r.minZ) * 0.45;
  let dx = 0;
  let dz = 0;
  let rot = 0;
  const k = S.keys;
  if (k.has('KeyW') || k.has('ArrowUp')) dz -= 1;
  if (k.has('KeyS') || k.has('ArrowDown')) dz += 1;
  if (k.has('KeyA') || k.has('ArrowLeft')) dx -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) dx += 1;
  if (k.has('KeyQ')) rot += 1;
  if (k.has('KeyE')) rot -= 1;
  // Controller (shared gamepad module; the match controls are disabled while the map is open, so
  // nothing else acts on these buttons): left stick / D-pad move, right stick X rotates, A marks,
  // X undoes, B cancels.
  const gp = gamepad.snapshot();
  if (gp) {
    const ls = radialDeadzone(gp.axes[0] ?? 0, gp.axes[1] ?? 0, 0.18, 1);
    dx += ls.x;
    dz += ls.y;
    rot -= radialDeadzone(gp.axes[2] ?? 0, 0, 0.18, 1).x;
    if (padDown(gp, PAD.LEFT)) dx -= 1;
    if (padDown(gp, PAD.RIGHT)) dx += 1;
    const a = padDown(gp, PAD.A);
    const b = padDown(gp, PAD.B);
    const x = padDown(gp, PAD.X);
    if (padDown(gp, PAD.UP)) dz -= 1;
    if (padDown(gp, PAD.DOWN)) dz += 1;
    if (a && !S.pad.a) act(m, (q) => q.press());
    if (!a && S.pad.a) act(m, (q) => q.release());
    if (x && !S.pad.x) act(m, undo);
    const cancelPress = b && !S.pad.b;
    S.pad = { a, b, x };
    if (cancelPress) return cancel(m, 'pad');
  }
  const l = Math.hypot(dx, dz);
  if (l > 0) p.moveBy((dx / Math.max(1, l)) * speed * dt, (dz / Math.max(1, l)) * speed * dt);
  if (rot) p.rotate(rot * 2.2 * dt);
}

/** `window.__lofi.tacmap` (devlook builds): drive the map from a script. */
function installDevHelpers(m: Match, offs: (() => void)[]): void {
  const w = window as unknown as { __lofi?: Record<string, unknown> };
  w.__lofi = w.__lofi ?? {};
  const pk = () => S.open?.picker ?? null;
  w.__lofi.tacmap = {
    state: () => {
      const p = pk();
      return { open: !!S.open, phase: phaseOf(m), id: S.open?.id ?? null, cursor: p?.cursor ?? null, yaw: p?.yaw ?? null, marks: p?.marks ?? [], anchor: p?.anchor ?? null, pending: p?.pending ?? false, error: S.error?.text ?? null, lastClose: S.lastClose };
    },
    moveTo: (x: number, z: number) => pk()?.moveTo(x, z),
    rotate: (d: number) => pk()?.rotate(d),
    press: () => act(m, (p) => p.press()),
    release: () => act(m, (p) => p.release()),
    undo: () => act(m, undo),
    cancel: () => cancel(m, 'script'),
    /** Screen (client px) position of a world point, for real mouse clicks. */
    screenOf: (x: number, z: number) => {
      const v = S.view;
      if (!v) return null;
      const [hx, hy] = v.toScreen(x, z);
      const r = m.renderer.canvas.getBoundingClientRect();
      return { x: r.left + (hx * r.width) / m.renderer.width, y: r.top + (hy * r.height) / m.renderer.height };
    },
  };
  offs.push(() => {
    if (w.__lofi) delete w.__lofi.tacmap;
  });
}

// -------------------------------------------------------------------------------------------
// Drawing
// -------------------------------------------------------------------------------------------

let doorPat: { g: CanvasRenderingContext2D; p: CanvasPattern } | null = null;
/** 3 of 4 pixels dark: the world shows through like BO1's translucent map backdrop. */
function screenDoor(g: CanvasRenderingContext2D): CanvasPattern | null {
  if (doorPat?.g === g) return doorPat.p;
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const cg = c.getContext('2d')!;
  cg.fillStyle = '#0b100c';
  cg.fillRect(0, 0, 2, 2);
  cg.clearRect(1, 1, 1, 1);
  const p = g.createPattern(c, 'repeat');
  if (p) doorPat = { g, p };
  return p;
}

let noise: { w: number; h: number; frames: HTMLCanvasElement[] } | null = null;
function staticFrame(W: number, H: number, t: number): HTMLCanvasElement {
  if (!noise || noise.w !== W || noise.h !== H) {
    const frames = [0, 1, 2].map(() => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d')!;
      const img = g.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        const row = Math.floor(i / W);
        const v = Math.random() * 200 * (row % 2 ? 0.7 : 1) + 20;
        img.data[i * 4] = v * 0.9;
        img.data[i * 4 + 1] = v;
        img.data[i * 4 + 2] = v * 0.88;
        img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      return c;
    });
    noise = { w: W, h: H, frames };
  }
  return noise.frames[Math.floor(t * 30) % 3]!;
}

const ENT_LABEL: Record<string, string> = {
  [KS_ENTITY.sentry]: 'S',
  [KS_ENTITY.sam]: 'A',
  [KS_ENTITY.rcxd]: 'R',
  [KS_ENTITY.gunner]: 'G',
};

registerHudWidget(
  'killstreaks.tacmap',
  (g, W, H) => {
    const m = currentMatch();
    if (!m) return;
    const phase = phaseOf(m);
    if (phase === 'closed' || phase === 'raise') return;
    if (phase === 'fuzz' || phase === 'closing') {
      g.drawImage(staticFrame(W, H, m.time), 0, 0);
      return;
    }
    const o = S.open!;
    const view = S.view;
    const img = S.image;
    const map = m.map;
    if (!view || !img || !map) return;
    const u = unit(H);
    g.imageSmoothingEnabled = false;
    const door = screenDoor(g);
    if (door) {
      g.fillStyle = door;
      g.fillRect(0, 0, W, H);
    }
    // Header: map name, streak, timer.
    const hx = view.x0 - u;
    const hw = view.w + 2 * u;
    rect(g, hx, view.y0 - 12 * u, hw, 11 * u, C.ink);
    txt(g, map.map.name.toUpperCase(), hx + 3 * u, view.y0 - 10 * u, 8, C.paper, 'left', u);
    const left = Math.max(0, o.until - m.serverTime);
    txt(g, `${streakName(o.id).toUpperCase()}  ${clock(left)}`, hx + hw - 3 * u, view.y0 - 10 * u, 8, left < 6 && Math.floor(m.time * 4) % 2 ? C.warn : C.hi, 'right', u);
    // Picture + frame.
    rect(g, view.x0 - u, view.y0 - u, view.w + 2 * u, view.h + 2 * u, '#6f8a74');
    g.drawImage(img, view.x0, view.y0);
    g.save();
    g.beginPath();
    g.rect(view.x0, view.y0, view.w, view.h);
    g.clip();
    drawGrid(g, view, u);
    drawWorld(g, m, view, u);
    drawPreview(g, m, o.picker, view, u);
    drawCursor(g, o.picker, view, u);
    // Feed noise: a rolling bright band and a few hot pixels.
    const band = view.y0 + ((m.time * 40) % (view.h + 20 * u)) - 10 * u;
    g.globalAlpha = 0.07;
    rect(g, view.x0, band, view.w, 6 * u, '#e8ffe8');
    g.globalAlpha = 1;
    for (let i = 0; i < 24; i++) rect(g, view.x0 + Math.random() * view.w, view.y0 + Math.random() * view.h, u, u, Math.random() < 0.5 ? '#d8f0d8' : '#0c120d');
    g.restore();
    drawCompass(g, view, u);
    // Footer: prompts, cursor grid ref, errors.
    const fy = view.y0 + view.h + 2 * u;
    rect(g, hx, fy, hw, 11 * u, C.ink);
    const p = o.picker;
    const prompt =
      p.pick === 'line'
        ? p.anchor
          ? 'DRAG TO AIM  -  RELEASE TO CALL IN'
          : 'HOLD CLICK ON TARGET, DRAG TO AIM  Q/E ROTATE'
        : p.pick === 'points'
          ? `CLICK: MARK ${Math.min(p.need, p.marks.length + 1)}/${p.need}  RIGHT CLICK: UNDO`
          : 'CLICK: PATROL AREA';
    txt(g, p.pending ? 'TRANSMITTING...' : prompt, hx + 3 * u, fy + 2 * u, 8, p.pending ? C.hi : C.paper, 'left', u);
    const err = S.error && m.time - S.error.t < 2.2 ? S.error.text : null;
    txt(g, err ?? `${gridRef(view.rect, p.cursor)}   ESC: BACK`, hx + hw - 3 * u, fy + 2 * u, 8, err ? C.warn : C.dim, 'right', u);
  },
  88,
);

function drawGrid(g: CanvasRenderingContext2D, view: MapView, u: number): void {
  const r = view.rect;
  const cell = gridCell(r);
  const cols = Math.ceil((r.maxX - r.minX) / cell);
  const rows = Math.ceil((r.maxZ - r.minZ) / cell);
  for (let i = 1; i < cols; i++) {
    const [x] = view.toScreen(r.minX + i * cell, r.minZ);
    for (let y = view.y0; y < view.y0 + view.h; y += 3 * u) rect(g, x, y, u, 2 * u, GRID);
  }
  for (let j = 1; j < rows; j++) {
    const [, y] = view.toScreen(r.minX, r.minZ + j * cell);
    for (let x = view.x0; x < view.x0 + view.w; x += 3 * u) rect(g, x, y, 2 * u, u, GRID);
  }
  // BO1 labels every cell in its top-left corner (A1, A2 ... B1 ...).
  const cellPx = cell * view.scale;
  if (cellPx < 22 * u) return;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const [x, y] = view.toScreen(r.minX + i * cell, r.minZ + j * cell);
      txt(g, `${String.fromCharCode(65 + Math.min(25, j))}${i + 1}`, x + 3 * u, y + 2 * u, 8, GRID_TXT, 'left', u);
    }
}

function ring(g: CanvasRenderingContext2D, view: MapView, x: number, z: number, rM: number, color: string, u: number, dashed = false): void {
  const [sx, sy] = view.toScreen(x, z);
  const rr = Math.max(2 * u, rM * view.scale);
  g.strokeStyle = '#0a0a0a';
  g.lineWidth = 3 * u;
  g.setLineDash(dashed ? [3 * u, 2 * u] : []);
  g.beginPath();
  g.arc(sx, sy, rr, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = u;
  g.stroke();
  g.setLineDash([]);
}

/** A filled arrow at (sx, sy) pointing along world yaw. */
function arrow(g: CanvasRenderingContext2D, sx: number, sy: number, yaw: number, size: number, color: string, u: number): void {
  const d = dirOfYaw(yaw);
  const px = -d.z;
  const pz = d.x;
  const pts: [number, number][] = [
    [sx + d.x * size, sy + d.z * size],
    [sx - d.x * size * 0.7 + px * size * 0.7, sy - d.z * size * 0.7 + pz * size * 0.7],
    [sx - d.x * size * 0.3, sy - d.z * size * 0.3],
    [sx - d.x * size * 0.7 - px * size * 0.7, sy - d.z * size * 0.7 - pz * size * 0.7],
  ];
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.lineWidth = 2 * u;
  g.strokeStyle = '#0a0a0a';
  g.stroke();
  g.fillStyle = color;
  g.fill();
}

function dot(g: CanvasRenderingContext2D, view: MapView, x: number, z: number, color: string, u: number, s = 3): void {
  const [sx, sy] = view.toScreen(x, z);
  rect(g, sx - (s / 2 + 1) * u, sy - (s / 2 + 1) * u, (s + 2) * u, (s + 2) * u, C.ink);
  rect(g, sx - (s / 2) * u, sy - (s / 2) * u, s * u, s * u, color);
}

function drawWorld(g: CanvasRenderingContext2D, m: Match, view: MapView, u: number): void {
  const snap = m.net.lastSnap;
  // Friendly streaks already up.
  for (const e of snap?.ents ?? []) {
    if (!friendly(e.owner ?? '', e.team ?? null) || e.kind === KS_ENTITY.radio) continue;
    const s = e.s ?? {};
    if (e.kind === KS_ENTITY.heli) {
      if (typeof s.px === 'number' && typeof s.pz === 'number' && typeof s.pr === 'number') ring(g, view, s.px, s.pz, s.pr, C.friend, u, true);
      const [sx, sy] = view.toScreen(e.x, e.z);
      txt(g, 'H', sx, sy - 4 * u, 8, C.friend, 'center', u);
    } else if (e.kind === KS_ENTITY.mortarMark) ring(g, view, e.x, e.z, STRIKE.mortar.blastR, ORANGE, u);
    else if (e.kind === KS_ENTITY.fire) ring(g, view, e.x, e.z, typeof s.r === 'number' ? s.r : STRIKE.napalm.fireR, ORANGE, u, true);
    else if (e.kind === KS_ENTITY.jet || e.kind === KS_ENTITY.bomber || e.kind === KS_ENTITY.dropHeli) {
      const [sx, sy] = view.toScreen(e.x, e.z);
      arrow(g, sx, sy, e.yaw, 4 * u, '#a0c8ff', u);
    } else if (e.kind === KS_ENTITY.crate) dot(g, view, e.x, e.z, C.hi, u, 3);
    else if (e.kind === KS_ENTITY.dog) dot(g, view, e.x, e.z, C.friend, u, 1);
    else if (ENT_LABEL[e.kind]) {
      const [sx, sy] = view.toScreen(e.x, e.z);
      txt(g, ENT_LABEL[e.kind]!, sx, sy - 4 * u, 8, C.friend, 'center', u);
    }
  }
  // Team mates (blue arrows); enemies only when the radar shows them (Spy Plane, Blackbird, gunfire).
  const radar = snap && !snap.jammed ? new Set(snap.radar) : new Set<string>();
  for (const r of m.remotes.views.values()) {
    if (!r.alive) continue;
    const [sx, sy] = view.toScreen(r.x, r.z);
    if (!m.isEnemy(r.id)) arrow(g, sx, sy, r.yaw, 3 * u, C.friend, u);
    else if (radar.has(r.id)) dot(g, view, r.x, r.z, C.enemy, u, 3);
  }
  // You.
  const me = m.net.predictor.shown();
  const [mx, my] = view.toScreen(me.x, me.z);
  arrow(g, mx, my, m.yaw, 4 * u, C.hi, u);
  if (snap?.jammed) txt(g, 'SIGNAL JAMMED', view.x0 + view.w / 2, view.y0 + 4 * u, 8, C.warn, 'center', u);
}

function drawPreview(g: CanvasRenderingContext2D, m: Match, p: TacMapPicker, view: MapView, u: number): void {
  const pts = p.previewPoints();
  if (p.pick === 'line') {
    const at = pts[0]!;
    const d = dirOfYaw(p.yaw);
    const r = view.rect;
    const far = Math.hypot(r.maxX - r.minX, r.maxZ - r.minZ);
    const [ax, ay] = view.toScreen(at.x - d.x * far, at.z - d.z * far);
    const [bx, by] = view.toScreen(at.x + d.x * far, at.z + d.z * far);
    // Flight path across the map.
    g.setLineDash([4 * u, 3 * u]);
    g.strokeStyle = '#0a0a0a';
    g.lineWidth = 3 * u;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
    g.strokeStyle = ORANGE;
    g.lineWidth = u;
    g.stroke();
    g.setLineDash([]);
    for (const c of p.footprint()) ring(g, view, c.x, c.z, c.r, ORANGE, u);
    // Chevrons along the burn/bomb line (BO1's orange arrows), pointing along the run.
    const len = strikeLength(p.id);
    const n = Math.max(3, Math.round(len / 6));
    for (let i = 0; i < n; i++) {
      const o = -len / 2 + (len * (i + 0.5)) / n;
      const [cx, cy] = view.toScreen(at.x + d.x * o, at.z + d.z * o);
      arrow(g, cx, cy, p.yaw, 3 * u, ORANGE, u);
    }
    const [hx, hy] = view.toScreen(at.x + d.x * (len / 2 + 4), at.z + d.z * (len / 2 + 4));
    arrow(g, hx, hy, p.yaw, 6 * u, ORANGE, u);
    if (p.anchor) {
      const [sx, sy] = view.toScreen(p.anchor.x, p.anchor.z);
      rect(g, sx - u, sy - u, 3 * u, 3 * u, C.paper);
    }
    return;
  }
  if (p.pick === 'points') {
    p.marks.forEach((q, i) => {
      ring(g, view, q.x, q.z, STRIKE.mortar.blastR, ORANGE, u);
      const [sx, sy] = view.toScreen(q.x, q.z);
      txt(g, String(i + 1), sx, sy - 4 * u, 8, C.hi, 'center', u);
    });
    if (p.marks.length < p.need) {
      ring(g, view, p.cursor.x, p.cursor.z, STRIKE.mortar.blastR, C.paper, u, true);
      const [sx, sy] = view.toScreen(p.cursor.x, p.cursor.z);
      txt(g, String(p.marks.length + 1), sx + 6 * u, sy - 12 * u, 8, C.paper, 'left', u);
    }
    return;
  }
  for (const c of p.footprint()) ring(g, view, c.x, c.z, c.r, C.friend, u, true);
  const [sx, sy] = view.toScreen(p.cursor.x, p.cursor.z);
  txt(g, 'H', sx + 6 * u, sy - 12 * u, 8, C.friend, 'left', u);
  void m;
}

function drawCursor(g: CanvasRenderingContext2D, p: TacMapPicker, view: MapView, u: number): void {
  const [sx, sy] = view.toScreen(p.cursor.x, p.cursor.z);
  const x = Math.round(sx);
  const y = Math.round(sy);
  for (const [dx, dy, w, h] of [
    [-8, 0, 5, 1],
    [4, 0, 5, 1],
    [0, -8, 1, 5],
    [0, 4, 1, 5],
  ] as const) {
    rect(g, x + (dx - 1) * u, y + (dy - 1) * u, (w + 2) * u, (h + 2) * u, C.ink);
    rect(g, x + dx * u, y + dy * u, w * u, h * u, '#ffffff');
  }
}

function drawCompass(g: CanvasRenderingContext2D, view: MapView, u: number): void {
  const cx = view.x0 + view.w - 10 * u;
  const cy = view.y0 + 16 * u;
  arrow(g, cx, cy, 0, 5 * u, C.warn, u);
  txt(g, 'N', cx, cy - 15 * u, 8, C.warn, 'center', u);
}
