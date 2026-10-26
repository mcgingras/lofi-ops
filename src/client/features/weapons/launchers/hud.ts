/**
 * Launcher HUD: the lock-on box and tones (Strela-3, Stinger), launcher crosshairs, and killfeed
 * icons. The round count is core's ammo widget (`ammoNoun`: "2 ROCKETS" with a pip per round).
 *
 * - Lock-on (`weapons.lock` from the server): while seeking, corner brackets close in on the
 *   aircraft with the seeking beep quickening; locked, a solid red box, "LOCKED" and a steady
 *   tone. Aimed with nothing to lock: a seeker circle and "AIR TARGETS ONLY".
 * - Crosshair (wrapping `core.crosshair` while a launcher is in hand): from the hip, four corner
 *   brackets spread by the cone; the China Lake adds a drop ladder (ticks at 10 / 20 / 30 m); aimed,
 *   the RPG-7 shows the PGO-7's chevron and stadia.
 */
import * as THREE from 'three';
import { isLauncher, isLockOn, LAUNCHERS, lockProgress } from '../../../../shared/defs/launchers';
import { WEAPON_BY_ID } from '../../../../shared/defs/weapons';
import { sfx } from '../../../game/audio';
import { box, HUD_COLORS as C, rect, txt, unit } from '../../../hud/draw';
import { hudWidgets, onFeature, registerHudWidget, registerKillfeedIcon, registerMatchHook, type HudDraw } from '../../../registry';
import { currentMatch } from '../../../state';

/** What the server last said about my lock (room times). */
export const lockState = { e: null as number | null, t: 0, sec: 1, locked: false };
let nextTone = 0;

onFeature('weapons.lock', (d) => Object.assign(lockState, d));

const v = new THREE.Vector3();
const heldLauncher = (): string | null => {
  const m = currentMatch();
  const id = m?.alive ? m.weapon()?.base.id : undefined;
  return id && isLauncher(id) ? id : null;
};

/** Seeking tone interval (s) at lock progress k (0..1): 0.36 s down to 0.1 s. */
export const seekInterval = (k: number): number => 0.36 - 0.26 * Math.max(0, Math.min(1, k));

registerHudWidget(
  'weapons.lockon',
  (g, W, H) => {
    const m = currentMatch();
    const id = heldLauncher();
    if (!m || !id || !isLockOn(id) || m.phase === 'ended') {
      lockState.e = null;
      return;
    }
    const u = unit(H);
    const ads = m.net.predictor.state.ads;
    if (ads < 0.6) return;
    const now = m.serverTime;
    const ent = lockState.e != null ? m.net.lastSnap?.ents.find((x) => x.id === lockState.e) : undefined;
    const cx = W / 2;
    const cy = H / 2;
    if (!ent) {
      // Seeker circle, nothing in it.
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        rect(g, Math.round(cx + Math.cos(a) * 22 * u), Math.round(cy + Math.sin(a) * 22 * u), u, u, C.paper);
      }
      txt(g, 'AIR TARGETS ONLY', cx, cy + 30 * u, 8, C.dim, 'center', u);
      return;
    }
    v.set(ent.x, ent.y, ent.z).project(m.renderer.cam);
    if (v.z > 1) return;
    const x = Math.round((v.x * 0.5 + 0.5) * W);
    const y = Math.round((-v.y * 0.5 + 0.5) * H);
    const k = lockState.locked ? 1 : lockProgress(lockState.t, now, lockState.sec);
    const half = Math.round((26 - 14 * k) * u);
    const col = lockState.locked ? '#ff3a2a' : '#ffd040';
    const L = Math.round(5 * u);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const bx = x + sx * half;
      const by = y + sy * half;
      rect(g, sx < 0 ? bx : bx - L, by, L, u, col);
      rect(g, bx, sy < 0 ? by : by - L, u, L, col);
    }
    if (lockState.locked) {
      box(g, x - half, y - half, half * 2, half * 2, col, u);
      txt(g, 'LOCKED', x, y + half + 4 * u, 8, col, 'center', u);
    } else {
      // A bar filling under the box.
      rect(g, x - half, y + half + 4 * u, half * 2, 2 * u, C.ink);
      rect(g, x - half, y + half + 4 * u, Math.round(half * 2 * k), 2 * u, col);
    }
    // Tones: quickening beeps while seeking, a steady tone once locked.
    if (m.time >= nextTone) {
      if (lockState.locked) {
        sfx.play('weapons.lock.on', { volume: 0.45 });
        nextTone = m.time + 0.19;
      } else {
        sfx.play('weapons.lock.seek', { volume: 0.4 });
        nextTone = m.time + seekInterval(k);
      }
    }
  },
  22,
);

/** The launcher crosshair (hip) and the RPG's PGO-7 picture (aimed). */
function launcherCross(g: CanvasRenderingContext2D, W: number, H: number, id: string): void {
  const m = currentMatch()!;
  const u = unit(H);
  const mx = Math.floor(W / 2);
  const my = Math.floor(H / 2);
  const st = m.net.predictor.state;
  if (st.sprinting) return;
  if (st.ads > 0.5) {
    if (id !== 'rpg') return;
    // PGO-7: a chevron over the aim point and range stadia below it.
    for (let i = 0; i < 4; i++) {
      rect(g, mx - (4 - i) * u, my - (4 - i) * u, u, u, C.paper);
      rect(g, mx + (4 - i) * u, my - (4 - i) * u, u, u, C.paper);
    }
    for (let i = 1; i <= 4; i++) {
      const y = my + i * 7 * u;
      rect(g, mx - (6 - i) * u, y, (12 - 2 * i) * u + u, u, C.paper);
      txt(g, String(i * 10 + 10), mx + (8 - i) * u, y - 3 * u, 6, C.dim, 'left', u);
    }
    return;
  }
  const fovRad = (m.renderer.cam.fov * Math.PI) / 180;
  const px = (Math.tan((m.spread * Math.PI) / 180) / Math.tan(fovRad / 2)) * (H / 2);
  const gap = Math.round(Math.max(5 * u, px));
  const L = 3 * u;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const bx = mx + sx * gap;
    const by = my + sy * gap;
    box(g, sx < 0 ? bx : bx - L, by, L, u, C.paper, u);
    box(g, bx, sy < 0 ? by : by - L, u, L, C.paper, u);
  }
  rect(g, mx, my, u, u, C.paper);
  // China Lake: where the grenade drops to at 10, 20 and 30 m (hip, level ground).
  if (LAUNCHERS[id]?.kind === 'grenade') {
    const t = LAUNCHERS[id]!;
    for (const d of [10, 20, 30]) {
      const time = d / t.speed;
      const drop = 0.5 * t.gravity * time * time;
      const y = my + Math.round((Math.atan2(drop, d) / Math.tan(fovRad / 2)) * (H / 2));
      rect(g, mx - 2 * u, y, 5 * u, u, C.dim);
    }
  }
}

// Wrap core's crosshair once the HUD is up (features load after core widgets).
let wrapped = false;
registerMatchHook('weapons.launcherHud', {
  start() {
    lockState.e = null;
    if (wrapped) return;
    const w = hudWidgets.get('core.crosshair');
    if (!w) return;
    wrapped = true;
    const orig: HudDraw = w.draw;
    registerHudWidget(
      'core.crosshair',
      (g, W, H, dt) => {
        const m = currentMatch();
        const id = heldLauncher();
        if (!m || !id || m.phase === 'ended') return orig(g, W, H, dt);
        launcherCross(g, W, H, id);
      },
      w.order,
    );
  },
});

// Killfeed icons (12 x 5 pixel units): the launcher's silhouette.
const icon = (draw: (g: CanvasRenderingContext2D, x: number, y: number, u: number) => void) => (g: CanvasRenderingContext2D, x: number, y: number, u: number) => {
  const w = 14 * u;
  draw(g, x - w, y + u, u);
  return w;
};
registerKillfeedIcon('china_lake', icon((g, x, y, u) => {
  rect(g, x, y + u, 9 * u, 2 * u, '#4a4e44');
  rect(g, x + u, y + 3 * u, 6 * u, u, '#6a5030');
  rect(g, x + 9 * u, y + u, 4 * u, 3 * u, '#6a5030');
  rect(g, x + 8 * u, y + 3 * u, u, 2 * u, '#2a2a2a');
}));
registerKillfeedIcon('rpg', icon((g, x, y, u) => {
  rect(g, x, y, 3 * u, 4 * u, '#5a6248');
  rect(g, x + 3 * u, y + u, 11 * u, 2 * u, '#3a3e3a');
  rect(g, x + 6 * u, y + u, 3 * u, 2 * u, '#7a5030');
  rect(g, x + 8 * u, y + 3 * u, u, 2 * u, '#7a5030');
  rect(g, x + 13 * u, y, u, 4 * u, '#3a3e3a');
}));
registerKillfeedIcon('m72law', icon((g, x, y, u) => {
  rect(g, x + u, y + u, 11 * u, 2 * u, '#56603e');
  rect(g, x, y + u, u, 2 * u, '#222');
  rect(g, x + 12 * u, y + u, u, 2 * u, '#222');
  rect(g, x + 6 * u, y, 2 * u, u, '#c03020');
}));
registerKillfeedIcon('strela', icon((g, x, y, u) => {
  rect(g, x, y + u, 14 * u, 2 * u, '#56603e');
  rect(g, x, y + u, u, 2 * u, '#9ae8ff');
  rect(g, x + 3 * u, y - u, u, 2 * u, '#888');
  rect(g, x + 7 * u, y + 3 * u, 3 * u, 2 * u, '#2a2a2a');
}));
registerKillfeedIcon('stinger', icon((g, x, y, u) => {
  rect(g, x, y + u, 14 * u, 2 * u, '#a08a5a');
  rect(g, x + 3 * u, y - u, 2 * u, 5 * u, '#555');
  rect(g, x + 7 * u, y + 3 * u, 3 * u, 2 * u, '#2a2a2a');
}));

/** Weapons with a launcher crosshair (tests). */
export const launcherCrosshairIds = (): string[] => [...WEAPON_BY_ID.values()].filter((w) => isLauncher(w.id)).map((w) => w.id);
