/**
 * Infected on the client: the HUD (role badge, Survivors / Infected counts, the First Infected
 * countdown, First Infected / last Survivor / radar sweep lines), the look (Infected soldiers in
 * a sickly green, an "INFECTED" tag over them, a green-gloved knife in your own hands) and the
 * small wraps of core widgets this needs: the score corner shows the counts instead of team score
 * bars, and holding the knife shows "KNIFE" instead of an empty magazine and "NO AMMO".
 * Announcer lines ("YOU ARE INFECTED", "FIRST INFECTED", "LAST ONE STANDING") are in text.ts.
 */
import * as THREE from 'three';
import { INFECTED_TEAM_NAMES, INFECTED_WEAPON, type InfectedStatePayload } from '../../../shared/defs/infected';
import type { Match } from '../../game/match';
import { promptKey } from '../../game/prompts';
import { blink, box, clock, HUD_COLORS as C, rect, txt, unit } from '../../hud/draw';
import { hudWidgets, registerHudWidget, registerMatchHook, registerMenuItem, type HudDraw } from '../../registry';
import type { Soldier } from '../../render/models/soldier';
import { registerViewmodel } from '../../render/models/viewmodels';
import { navigate } from '../../router';
import { currentMatch } from '../../state';
import { actionHands } from '../weapons/viewmodels';
import { modes } from './store';

/** Sickly green: the Infected's tint (HUD and soldiers). */
export const INFECTED_GREEN = '#9fdc4a';
const SKIN = new THREE.Color(0.62, 0.95, 0.42);

registerMenuItem({ id: 'modes.infected', label: 'Quick Play', hint: 'Infected', order: 34, action: () => navigate('match', { mode: 'infected' }) });

/** The Infected state when the current match plays Infected (and no killcam is up). */
export function infectedState(): { m: Match; st: InfectedStatePayload } | null {
  const m = currentMatch();
  const st = modes.state;
  if (!m || m.loading || m.joined.mode !== 'infected' || st?.mode !== 'infected' || !st.infected) return null;
  return { m, st: st.infected };
}

const isInfectedMatch = (m: Match | null): m is Match => !!m && m.joined.mode === 'infected';
const holdingKnife = (m: Match) => m.alive && m.weapon()?.base.id === INFECTED_WEAPON;

// ---------------------------------------------------------------------------------------------
// HUD: top-centre panel
// ---------------------------------------------------------------------------------------------

registerHudWidget(
  'modes.infected',
  (g, W, H) => {
    const L = infectedState();
    if (!L || modes.killcamStart !== null) return;
    const { m, st } = L;
    const u = unit(H);
    let y = 20 * u;
    const infected = st.role === 'infected';
    const col = infected ? INFECTED_GREEN : C.friend;
    // Role badge.
    const label = infected ? 'INFECTED' : 'SURVIVOR';
    const bw = 60 * u;
    box(g, W / 2 - bw / 2, y, bw, 11 * u, infected ? '#2c4a14' : '#1e3456', u);
    txt(g, label, W / 2, y + 2 * u, 8, '#ffffff', 'center', u);
    y += 14 * u;
    // Counts.
    txt(g, `${st.survivors}`, W / 2 - 6 * u, y, 8, C.friend, 'right', u);
    txt(g, '·', W / 2, y, 8, C.dim, 'center', u);
    txt(g, `${st.infected}`, W / 2 + 6 * u, y, 8, INFECTED_GREEN, 'left', u);
    txt(g, 'SURVIVORS', W / 2 - 16 * u, y, 8, C.dim, 'right', u);
    txt(g, 'INFECTED', W / 2 + 16 * u, y, 8, C.dim, 'left', u);
    y += 11 * u;
    if (st.waiting) {
      txt(g, 'WAITING FOR PLAYERS', W / 2, y, 8, C.paper, 'center', u);
      return;
    }
    if (st.pickAt !== null && m.phase === 'playing') {
      const left = Math.max(0, st.pickAt - m.serverTime);
      txt(g, 'INFECTION IN', W / 2, y, 8, C.paper, 'center', u);
      txt(g, String(Math.ceil(left)), W / 2, y + 9 * u, 16, left < 3.5 && blink(m.time, 0.5, 0.3) ? C.warn : C.hi, 'center', u);
      return;
    }
    let line = '';
    let lc: string = C.dim;
    if (st.first === m.myId) {
      line = 'FIRST INFECTED · GUNS UNTIL THE NEXT INFECTION';
      lc = INFECTED_GREEN;
    } else if (st.last === m.myId) {
      line = st.sweepUntil !== null ? 'RADAR SWEEP · THEY SEE YOU' : 'LAST ONE STANDING';
      lc = st.sweepUntil !== null ? (blink(m.time, 0.4, 0.25) ? C.warn : C.paper) : C.hi;
    } else if (st.last) {
      line = infected ? `HUNT ${m.nameOf(st.last).toUpperCase()}` : '';
      lc = col;
    } else if (infected) line = 'INFECT THE SURVIVORS';
    else line = 'SURVIVE';
    if (line) txt(g, line, W / 2, y, 8, lc, 'center', u);
  },
  53,
);

// "INFECTED" over Infected soldiers you can see (within 40 m).
const v3 = new THREE.Vector3();
registerHudWidget(
  'modes.infected.tags',
  (g, W, H) => {
    const m = currentMatch();
    if (!isInfectedMatch(m) || !m.map || modes.killcamStart !== null) return;
    const u = unit(H);
    const cam = m.renderer.cam;
    const eye = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
    for (const v of m.remotes.views.values()) {
      if (!v.alive || v.team !== 1) continue;
      const head = { x: v.x, y: v.y + (v.prone > 0.5 ? 0.8 : v.crouch > 0.5 ? 1.6 : 2.15), z: v.z };
      const d = Math.hypot(head.x - eye.x, head.z - eye.z);
      if (d > 40) continue;
      v3.set(head.x, head.y, head.z).applyMatrix4(cam.matrixWorldInverse);
      if (v3.z > -0.2) continue;
      if (!m.map.world.lineOfSight(eye, head)) continue;
      v3.set(head.x, head.y, head.z).project(cam);
      const sx = (v3.x * 0.5 + 0.5) * W;
      const sy = (-v3.y * 0.5 + 0.5) * H;
      if (sx < 0 || sx > W || sy < 0 || sy > H) continue;
      txt(g, 'INFECTED', sx, sy - 7 * u, 6, INFECTED_GREEN, 'center', u);
    }
  },
  7,
);

// ---------------------------------------------------------------------------------------------
// Wraps of core widgets (same ids and orders)
// ---------------------------------------------------------------------------------------------

/** Score corner in Infected: the clock and the two counts, as bars of the whole room. */
function drawScoreCorner(m: Match, g: CanvasRenderingContext2D, H: number): void {
  const u = unit(H);
  const x = 8 * u;
  let y = 6 * u;
  const left = m.phaseEndsAt !== null && m.phase === 'playing' ? m.phaseEndsAt - m.serverTime : m.timeLeft;
  if (left !== null && left !== undefined) {
    txt(g, clock(left), x, y, 8, left < 30 && blink(m.time, 1, 0.6) ? C.warn : C.paper, 'left', u);
    y += 10 * u;
  }
  const st = infectedState()?.st;
  const counts: [number, number] = st ? [st.survivors, st.infected] : [m.teamScores?.[0] ?? 0, m.teamScores?.[1] ?? 0];
  const total = Math.max(1, counts[0] + counts[1]);
  const barW = 60 * u;
  for (const [i, col] of [[0, C.friend], [1, INFECTED_GREEN]] as const) {
    rect(g, x, y, barW + 2 * u, 7 * u, 'rgba(10,10,10,.6)');
    rect(g, x + u, y + u, Math.round(barW * (counts[i] / total)), 5 * u, col);
    txt(g, String(counts[i]), x + barW + 5 * u, y - u, 8, col, 'left', u);
    txt(g, INFECTED_TEAM_NAMES[i]!.toUpperCase(), x + barW + 22 * u, y - u, 8, C.dim, 'left', u);
    y += 9 * u;
  }
}

let wrapped = false;
function wrapCoreWidgets(): void {
  if (wrapped) return;
  wrapped = true;
  const wrap = (id: string, fn: (orig: HudDraw) => HudDraw) => {
    const w = hudWidgets.get(id);
    if (w) registerHudWidget(id, fn(w.draw), w.order);
  };
  wrap('core.score', (orig) => (g, W, H, dt) => {
    const m = currentMatch();
    if (!isInfectedMatch(m)) return orig(g, W, H, dt);
    drawScoreCorner(m, g, H);
  });
  wrap('core.ammo', (orig) => (g, W, H, dt) => {
    const m = currentMatch();
    if (!m || !holdingKnife(m)) return orig(g, W, H, dt);
    const u = unit(H);
    txt(g, 'KNIFE', W - 8 * u, H - 22 * u, 16, INFECTED_GREEN, 'right', u);
    txt(g, `${promptKey('melee')} LUNGE`, W - 8 * u, H - 9 * u, 8, C.dim, 'right', u);
  });
  // Holding the knife there is no ammo to warn about; everything else (notices) still draws.
  wrap('core.status', (orig) => (g, W, H, dt) => {
    const m = currentMatch();
    if (!m || !holdingKnife(m)) return orig(g, W, H, dt);
    const u = unit(H);
    m.notices = m.notices.filter((n) => m.time - n.t < 4);
    m.notices.forEach((n, i) => txt(g, n.text.toUpperCase(), W / 2, H * 0.62 + i * 10 * u, 8, C.hi, 'center', u));
  });
}

// ---------------------------------------------------------------------------------------------
// Look: green Infected, slot clamp
// ---------------------------------------------------------------------------------------------

const tinted = new WeakSet<Soldier>();

registerMatchHook('modes.infected', {
  start: () => wrapCoreWidgets(),
  frame(m) {
    // The server swaps weapons in place (First Infected -> knife): follow it.
    if (m.me && m.slot >= m.me.weapons.length) m.slot = 0;
    if (!isInfectedMatch(m)) return;
    for (const v of m.remotes.views.values()) {
      // The soldier is rebuilt when its team changes, so a new one starts untinted.
      if (v.team !== 1 || tinted.has(v.soldier)) continue;
      tinted.add(v.soldier);
      for (const mat of v.soldier.mats) mat.uniforms.uTint.value.multiply(SKIN);
    }
  },
});

// ---------------------------------------------------------------------------------------------
// Viewmodel: the Infected's knife (WeaponDef 'knife'), in a green glove
// ---------------------------------------------------------------------------------------------

registerViewmodel('knife', (c) => {
  const blade = c.mat('steel', { rep: 0.2, tint: 0xdadada });
  const guard = c.mat('gunmetal', { rep: 0.2 });
  const grip = c.mat('rubber', { rep: 0.2 });
  const glove = c.mat('glove', { tint: 0x9fc860 });
  const sleeve = c.mat('camo', { rep: 0.4, tint: 0xa8d070 });
  const gunRoot = new THREE.Group();
  c.group.add(gunRoot);
  const add = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const mesh = c.box(w, h, d, m, x, y, z, rx);
    gunRoot.add(mesh);
    return mesh;
  };
  // Blade forward and tipped up a little, grip in the fist, forearm back to the elbow.
  add(0.008, 0.035, 0.19, blade, 0, 0.02, -0.17, 0.12);
  add(0.004, 0.012, 0.05, blade, 0, 0.034, -0.27, 0.6);
  add(0.05, 0.016, 0.014, guard, 0, 0.01, -0.07);
  add(0.03, 0.034, 0.1, grip, 0, 0, -0.01);
  add(0.08, 0.085, 0.11, glove, 0, -0.01, 0.0);
  add(0.1, 0.1, 0.42, sleeve, 0.03, -0.1, 0.27, 0.22);
  const hip = new THREE.Vector3(0.17, -0.17, -0.34);
  const hands = actionHands(c, gunRoot, hip, glove, sleeve);
  return {
    muzzle: new THREE.Vector3(0, 0.03, -0.3),
    hip,
    ads: new THREE.Vector3(0.12, -0.15, -0.34),
    reload: 'none',
    animate: (s) => {
      // A slow, hungry sway while it is all you have.
      gunRoot.rotation.z = Math.sin(s.time * 1.7) * 0.04;
      hands(s);
    },
  };
});
