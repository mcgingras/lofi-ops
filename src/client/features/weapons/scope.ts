/**
 * Sniper scopes and ADS feel: the pixel scope overlay (replaces `core.scope`), scope sway with
 * hold-breath on Shift (sprint is cancelled by ADS, so Shift is free while aiming), variable zoom
 * (X or middle mouse cycles levels), and local mechanical sounds (bolt, pump, magazine, shells).
 */
import { PRONE } from '../../../shared/constants';
import { fullyProne } from '../../../shared/movement';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { promptKey } from '../../game/prompts';
import { HUD_COLORS as C, rect, txt, unit } from '../../hud/draw';
import { registerHudWidget, registerMatchHook, unregisterHudWidget } from '../../registry';
import { settings } from '../../settings';
import { currentMatch } from '../../state';
import { equipState } from './equipment';

const DEG = Math.PI / 180;

/** Scope state shared with the HUD. */
export const scopeState = {
  scoped: false,
  /** Seconds of breath left, max, holding now, exhausted until (local time). */
  breath: 5,
  breathMax: 5,
  holding: false,
  exhausted: 0,
  /** Variable zoom level per weapon key. */
  level: new Map<string, number>(),
  zoom: 1,
};

let swayT = 0;
let applied = { yaw: 0, pitch: 0 };
let zoomPress = false;

function cycleZoom() {
  zoomPress = true;
}

function onKey(e: KeyboardEvent) {
  if (e.code === 'KeyX') cycleZoom();
}
function onMouse(e: MouseEvent) {
  if (e.button === 1) cycleZoom();
}

/** Remove whatever sway offset is applied to the controls. */
function clearSway(m: Match) {
  m.controls.yaw -= applied.yaw;
  m.controls.pitch -= applied.pitch;
  applied = { yaw: 0, pitch: 0 };
}

// Local mechanical sounds: watch ammo and reload progress. Kept sparse like CoD: one mag out and
// one mag in per reload (rifle or pistol recordings), the charging handle only at the end of an
// empty rifle/SMG/LMG reload, bolt and pump after the shot. No brass tinkle after shots.
// `empty`: the running reload started from an empty magazine.
let last = { key: '', mag: -1, reload: -1, empty: false };
const CHARGES = new Set(['ar', 'smg', 'lmg']);

function mechanics(m: Match) {
  const def = m.weapon();
  const me = m.me;
  if (!def || !me) return;
  const w = me.weapons[m.slot];
  const key = `${m.slot}|${w?.id}`;
  const { mag } = m.ammo();
  const reload = m.reloadProgress();
  let empty = reload >= 0 && last.empty;
  if (key === last.key && m.alive) {
    if (reload >= 0 && last.reload < 0) empty = last.mag === 0;
    if (mag === last.mag - 1) {
      if (def.mode === 'bolt') setTimeout(() => sfx.play('weapons.bolt', { volume: 0.7 }), 180);
      else if (def.mode === 'pump') setTimeout(() => sfx.play('weapons.pump', { volume: 0.7 }), 120);
    }
    if (def.shellReload && mag > last.mag && last.mag >= 0 && reload >= 0) sfx.play('weapons.shell', { volume: 0.6 });
    if (reload >= 0 && !def.shellReload) {
      const cross = (x: number) => last.reload < x && reload >= x;
      if (def.base.model === 'olympia') {
        if (cross(0.12)) sfx.play('weapons.break', { volume: 0.7 });
        if (cross(0.85)) sfx.play('weapons.breakclose', { volume: 0.7 });
      } else {
        const pistol = def.base.class === 'pistol';
        if (cross(0.2)) sfx.play(pistol ? 'weapons.magout.pistol' : 'weapons.magout', { volume: 0.6 });
        if (cross(0.68)) sfx.play(pistol ? 'weapons.magin.pistol' : 'weapons.magin', { volume: 0.7 });
        if (def.mode === 'bolt' && cross(0.9)) sfx.play('weapons.bolt', { volume: 0.6 });
        else if (empty && def.mode !== 'bolt' && CHARGES.has(def.base.class) && cross(0.86)) sfx.play('weapons.charge', { volume: 0.55 });
      }
    }
    if (def.shellReload && reload >= 0 && last.reload < 0.88 && reload >= 0.88 && me.weapons[m.slot]?.mag === 0) sfx.play('weapons.pump', { volume: 0.6 });
  }
  last = { key, mag, reload, empty };
}

registerMatchHook('weapons.scope', {
  start() {
    // Replace core's scope (core widgets may register after feature modules load).
    unregisterHudWidget('core.scope');
    applied = { yaw: 0, pitch: 0 };
    scopeState.breath = scopeState.breathMax;
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouse);
    };
  },
  frame(m, dt) {
    mechanics(m);
    const def = m.weapon();
    const ads = m.alive ? m.net.predictor.state.ads : 0;
    const scoped = !!def?.scope && ads > 0.85 && m.alive;
    // Controller: D-pad down cycles the zoom while scoped (the match leaves the press to us then).
    if (scoped && def?.zoomLevels.length && m.controls.consume('equipment')) cycleZoom();
    scopeState.scoped = scoped;
    const max = (def?.breathSec ?? 4) * equipState.breath; // Scout: x2
    scopeState.breathMax = max;

    // Variable zoom.
    const key = def ? `${def.id}|${def.attachmentIds.join(',')}` : '';
    if (def && def.zoomLevels.length) {
      let lv = scopeState.level.get(key) ?? 0;
      if (zoomPress && scoped) {
        lv = (lv + 1) % def.zoomLevels.length;
        scopeState.level.set(key, lv);
        sfx.play('click', { volume: 0.4, rate: 0.94 });
      }
      const z = def.zoomLevels[lv] ?? def.zoom ?? 1;
      const zoom = 1 + (z - 1) * ads;
      m.renderer.zoom = zoom;
      m.renderer.updateFov();
      m.controls.lookScale = (1 + (settings.adsSensitivity - 1) * ads) / (scoped ? Math.max(1, zoom * 0.5) : 1);
      scopeState.zoom = z;
    } else scopeState.zoom = def?.zoom ?? 1;
    zoomPress = false;

    // Sway + hold breath.
    const now = m.time;
    if (!scoped || !m.controls.locked) {
      if (applied.yaw || applied.pitch) clearSway(m);
      scopeState.holding = false;
      scopeState.breath = Math.min(max, scopeState.breath + dt * 1.5);
      return;
    }
    swayT += dt;
    const wantHold = m.controls.isHeld('sprint');
    const canHold = scopeState.breath > 0 && now >= scopeState.exhausted;
    scopeState.holding = wantHold && canHold;
    if (scopeState.holding) {
      scopeState.breath -= dt;
      if (scopeState.breath <= 0) {
        scopeState.breath = 0;
        scopeState.exhausted = now + 2;
        sfx.play('thud', { volume: 0.3, rate: 0.94 });
      }
    } else if (!wantHold) scopeState.breath = Math.min(max, scopeState.breath + dt * 0.8);
    const base = def?.sway ?? 0.8;
    // Prone steadies the scope (BO1: less idle sway lying down).
    const stance = fullyProne(m.net.predictor.state) ? PRONE.sway : 1;
    const amp = (scopeState.holding ? base * 0.06 : now < scopeState.exhausted ? base * 1.8 : base) * DEG * stance;
    const ty = amp * (Math.sin(swayT * 0.9) * 0.7 + Math.sin(swayT * 1.7 + 1) * 0.3);
    const tp = amp * (Math.sin(swayT * 1.3 + 2) * 0.6 + Math.sin(swayT * 0.6) * 0.4);
    // Ease towards the target so holding/releasing breath doesn't snap.
    const k = Math.min(1, dt * 6);
    const ny = applied.yaw + (ty - applied.yaw) * k;
    const np = applied.pitch + (tp - applied.pitch) * k;
    m.controls.yaw += ny - applied.yaw;
    m.controls.pitch += np - applied.pitch;
    applied = { yaw: ny, pitch: np };
  },
});

// The scope overlay: black mask, thin reticle with mil-dots, lens ring, breath meter.
registerHudWidget(
  'weapons.scope',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !scopeState.scoped) return;
    const u = unit(H);
    const r = Math.floor(H * 0.44);
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);
    g.fillStyle = C.ink;
    g.beginPath();
    g.rect(0, 0, W, H);
    g.arc(cx, cy, r, 0, Math.PI * 2, true);
    g.fill('evenodd');
    // Lens ring (stepped pixels).
    g.fillStyle = '#1c1c1a';
    for (let a = 0; a < Math.PI * 2; a += 1 / r) {
      const x = Math.round(cx + Math.cos(a) * (r - u));
      const y = Math.round(cy + Math.sin(a) * (r - u));
      g.fillRect(x, y, u * 2, u * 2);
    }
    // Reticle: thick outer posts, thin centre cross with a gap, mil-dots.
    const gap = 4 * u;
    rect(g, cx - r, cy - u, r - r * 0.55, 2 * u, C.ink);
    rect(g, cx + r * 0.55, cy - u, r - r * 0.55, 2 * u, C.ink);
    rect(g, cx - u, cy + r * 0.55, 2 * u, r - r * 0.55, C.ink);
    rect(g, cx - r * 0.55, cy, r * 0.55 - gap, u, C.ink);
    rect(g, cx + gap, cy, r * 0.55 - gap, u, C.ink);
    rect(g, cx, cy - r, u, r - gap, C.ink);
    rect(g, cx, cy + gap, u, r * 0.55 - gap, C.ink);
    for (let i = 1; i <= 4; i++) {
      const s = Math.round((r * 0.55 * i) / 5);
      rect(g, cx + s - u, cy - u, 2 * u + 1, 2 * u + 1, C.ink);
      rect(g, cx - s - u, cy - u, 2 * u + 1, 2 * u + 1, C.ink);
      rect(g, cx - u, cy + s - u, 2 * u + 1, 2 * u + 1, C.ink);
    }
    rect(g, cx, cy, u, u, '#c02018');
    // Breath meter and hints (inside the black, bottom).
    const bw = 60 * u;
    const by = H - 18 * u;
    const k = scopeState.breath / Math.max(0.1, scopeState.breathMax);
    rect(g, cx - bw / 2 - u, by - u, bw + 2 * u, 4 * u, '#3a3630');
    rect(g, cx - bw / 2, by, Math.round(bw * k), 2 * u, m.time < scopeState.exhausted ? C.warn : scopeState.holding ? C.hi : C.paper);
    const hint = m.time < scopeState.exhausted ? 'OUT OF BREATH' : scopeState.holding ? 'HOLDING BREATH' : 'HOLD SHIFT TO STEADY';
    txt(g, hint, cx, by - 11 * u, 8, m.time < scopeState.exhausted ? C.warn : C.dim, 'center', u);
    const def = m.weapon();
    if (def && def.zoomLevels.length) txt(g, `${scopeState.zoom.toFixed(1)}X  ${promptKey('zoom', { brackets: true })}`, cx + r * 0.7, cy + r * 0.62, 8, C.dim, 'center', u);
  },
  15,
);
