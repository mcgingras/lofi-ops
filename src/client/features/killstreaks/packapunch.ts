/**
 * Pack-a-Punch, client side (rules in shared/defs/pack-a-punch.ts, server in streaks/packapunch.ts):
 *
 * - The camo: texture `camo.pap` (the viewmodel, third-person and dropped-gun builders pick it up
 *   for camo id `pap` like any camo), repainted every animation step from `packapunch-camo.ts`, so
 *   every packed gun on screen shimmers together.
 * - Calling it (`killstreaks.pap`): your gun dips out of view and comes back (`papDip`, applied
 *   on top of the viewmodel after core posed it; the server holds the weapon down meanwhile, and
 *   core's own raise-after-switch pose is cancelled for that window so it doesn't snap), the
 *   machine jingle plays; as the gun comes back up, a ding and a toast with its new name. Other
 *   players hear the jingle where you stand, and an announcement names the upgraded gun.
 * - The buff is timed (60 s, through death): a countdown sits left of the weapon name
 *   (`ksClient.state.papUntil`); when it runs out (`killstreaks.papEnd`) a power-down cue and a toast.
 * - Prediction and HUD (bigger magazine, faster reload, the new name in the ammo box) come from
 *   `Match.weapon()`, which packs a weapon whose camo is `pap`.
 */
import { PACK_A_PUNCH, PAP_CAMO, papDip } from '../../../shared/defs/pack-a-punch';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { textWidth, txt, unit, HUD_COLORS as C } from '../../hud/draw';
import { onFeature, registerHudWidget, registerMatchHook } from '../../registry';
import { getTexture, registerTexture } from '../../render/textures';
import { currentMatch } from '../../state';
import { PAP_CAMO_FPS, PAP_CAMO_SIZE, papCamoPixels } from './packapunch-camo';
import { announce, ksClient } from './store';

export const PAP_TEXTURE = `camo.${PAP_CAMO}`;

registerTexture(PAP_TEXTURE, {
  w: PAP_CAMO_SIZE,
  h: PAP_CAMO_SIZE,
  posterize: false,
  draw(g, w, h) {
    const img = g.createImageData(w, h);
    img.data.set(papCamoPixels(0));
    g.putImageData(img, 0, 0);
  },
  // Animated: the drawn canvas is the texture in both looks (never developed from a photo).
  photo: 'none',
  fallback: 'none',
});

export const papClient = {
  /** My upgrade in progress (room times from the server). */
  mine: null as { t0: number; dur: number; name: string; dinged: boolean } | null,
  /** The toast: the new name (or the expiry), from local match time `t`. */
  toast: null as { name: string; t: number; ended?: boolean } | null,
  camoStep: -1,
  pixels: null as Uint8ClampedArray | null,
};

onFeature('killstreaks.pap', (d) => {
  const m = currentMatch();
  if (!m) return;
  if (d.p === m.myId) {
    papClient.mine = { t0: d.t0, dur: d.dur, name: d.name, dinged: false };
    sfx.play('ks_pap_jingle', { volume: 0.9 });
    return;
  }
  const q = m.net.lastSnap?.players.find((p) => p.id === d.p);
  if (q) sfx.play('ks_pap_jingle', { at: { x: q.x, y: q.y + 1.2, z: q.z }, volume: 0.8 });
});

onFeature('killstreaks.papEnd', (d) => {
  const m = currentMatch();
  if (!m || d.p !== m.myId) return;
  sfx.play('ks_pap_down', { volume: 0.9 });
  papClient.toast = { name: 'Pack-a-Punch expired', t: m.time, ended: true };
});

/** Seconds of my Pack-a-Punch buff left (0 when none). */
export function papSecondsLeft(m: Match): number {
  const until = ksClient.state?.papUntil;
  return until === undefined ? 0 : Math.max(0, until - m.serverTime);
}

onFeature('killstreaks.packed', (d) => {
  const m = currentMatch();
  if (!m || d.p === m.myId) return; // mine: the toast as the gun comes back up
  const f = !m.isEnemy(d.p);
  announce(`${f ? 'Friendly' : 'Enemy'} ${m.nameOf(d.p)}: ${d.name}`, f ? 'friend' : 'enemy');
});

/** Repaint the camo texture when its animation step changes. */
function animateCamo(m: Match): void {
  const step = Math.floor(m.time * PAP_CAMO_FPS);
  if (step === papClient.camoStep) return;
  papClient.camoStep = step;
  const tex = getTexture(PAP_TEXTURE);
  const c = tex.image as HTMLCanvasElement | undefined;
  const g = c?.getContext?.('2d');
  if (!c || !g) return;
  papClient.pixels = papCamoPixels(step / PAP_CAMO_FPS, papClient.pixels ?? undefined);
  const img = g.createImageData(c.width, c.height);
  if (img.data.length !== papClient.pixels.length) return;
  img.data.set(papClient.pixels);
  g.putImageData(img, 0, 0);
  tex.needsUpdate = true;
}

/** The gun dips out of view and comes back (on top of core's pose for this frame). */
function dipViewmodel(m: Match): void {
  const s = papClient.mine;
  if (!s) return;
  const t = m.serverTime - s.t0;
  if (!m.alive || t > s.dur + 0.2) {
    papClient.mine = null;
    return;
  }
  if (!s.dinged && t >= s.dur - PACK_A_PUNCH.raiseSec) {
    s.dinged = true;
    sfx.play('ks_pap_ding', { volume: 0.9 });
    papClient.toast = { name: s.name, t: m.time };
  }
  const g = m.viewmodel.root.children[0];
  if (!g || t < 0 || t > s.dur) return;
  // Core lowers the gun at once for the server's weapon hold (its raise-after-switch pose); undo
  // that so the dip is smooth, then dip: down, a little roll, a tremble while it's in the machine.
  const r = m.raiseProgress();
  const raise = r >= 0 ? 1 - r : 0;
  const dip = papDip(t);
  g.position.y += raise * 0.25 - dip * 0.42;
  g.position.x += dip * 0.06;
  g.rotation.x += raise * 0.6 - dip * 0.75;
  g.rotation.z += dip * 0.35 + (dip > 0.95 ? Math.sin(t * 60) * 0.01 : 0);
}

registerMatchHook('killstreaks.pap', {
  start() {
    papClient.mine = null;
    papClient.toast = null;
    papClient.camoStep = -1;
    return () => {
      papClient.mine = null;
      papClient.toast = null;
    };
  },
  frame(m) {
    animateCamo(m);
    dipViewmodel(m);
  },
});

// The toast: "PACK-A-PUNCHED" over the new name, the name flickering purple and blue.
registerHudWidget(
  'killstreaks.papToast',
  (g, W, H) => {
    const m = currentMatch();
    const s = papClient.toast;
    if (!m || !s) return;
    const age = m.time - s.t;
    if (age > 3 || m.phase === 'ended') {
      papClient.toast = null;
      return;
    }
    const u = unit(H);
    const y = Math.round(H * 0.3);
    if (s.ended) {
      txt(g, s.name.toUpperCase(), W / 2, y + 12 * u, 12, C.dim, 'center', u);
      return;
    }
    txt(g, 'PACK-A-PUNCHED', W / 2, y, 8, C.paper, 'center', u);
    const col = Math.floor(age * 8) % 2 ? '#b46cff' : '#6ab8ff';
    txt(g, s.name.toUpperCase(), W / 2, y + 12 * u, 16, age < 0.15 ? '#f2d2ff' : col, 'center', u);
  },
  87,
);

// The countdown, left of the weapon name in the ammo box: "PAP 0:42", blinking in the last 10 s.
registerHudWidget(
  'killstreaks.papTimer',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.alive || m.phase === 'ended') return;
    const left = papSecondsLeft(m);
    if (left <= 0) return;
    const def = m.weapon();
    const u = unit(H);
    const nameW = def ? textWidth(g, def.name.toUpperCase(), 8, u) : 0;
    const sec = Math.ceil(left);
    const label = `PAP ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    const warn = left < 10 && Math.floor(left * 4) % 2 === 0;
    txt(g, label, W - 8 * u - nameW - 6 * u, H - 9 * u, 8, warn ? C.warn : Math.floor(m.time * 3) % 2 ? '#b46cff' : '#6ab8ff', 'right', u);
  },
  42,
);
