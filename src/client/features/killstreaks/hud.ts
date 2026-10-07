/**
 * Killstreak HUD: the streak ladder with pips (bottom right, above the ammo), the ready prompt,
 * announcements, the target designator, crate prompts, driving overlays and a mortar warning, plus
 * care package waypoints and the "HOLD F" prompt when you stand at a crate.
 */
import { CRATE_REACH, KILLSTREAK_BY_ID, KS_ENTITY } from '../../../shared/defs/killstreaks';
import { blink, box, clock, rect, txt, textWidth, unit, HUD_COLORS as C } from '../../hud/draw';
import { drawWaypoint, useKey, type Waypoint, type WaypointSlot } from '../../hud/waypoints';
import { registerHudWidget } from '../../registry';
import { currentMatch } from '../../state';
import { STRIKE } from '../../../shared/defs/tactical-map';
import { iHavePro } from '../perks/state';
import { friendly, ksClient, streakName } from './store';

const SHORT: Record<string, string> = {
  uav: 'SPY PLANE',
  rcxd: 'RC-XD',
  counter_uav: 'C-SPY',
  sam_turret: 'SAM',
  care_package: 'PACKAGE',
  napalm: 'NAPALM',
  sentry_gun: 'SENTRY',
  mortar: 'MORTAR',
  attack_helicopter: 'HELI',
  valkyrie: 'VALKYRIE',
  blackbird: 'BLACKBIRD',
  rolling_thunder: 'THUNDER',
  chopper_gunner: 'GUNNER',
  attack_dogs: 'DOGS',
};

// Ladder: one row per picked streak, pips up to its cost (filled = kills this life).
registerHudWidget(
  'killstreaks.ladder',
  (g, W, H) => {
    const m = currentMatch();
    const st = ksClient.state;
    if (!m || !st || !st.chosen.length || m.phase === 'ended') return;
    const u = unit(H);
    const pip = 3 * u;
    let y = H - 62 * u;
    for (let i = st.chosen.length - 1; i >= 0; i--) {
      const c = st.chosen[i]!;
      const ready = st.ready.includes(c.id);
      const right = W - 8 * u;
      const pipsW = c.cost * (pip + u);
      for (let k = 0; k < c.cost; k++) {
        const x = right - pipsW + k * (pip + u);
        rect(g, x - u, y - u, pip + 2 * u, pip + 2 * u, C.ink);
        rect(g, x, y, pip, pip, ready ? C.hi : k < st.count ? C.ammo : C.empty);
      }
      txt(g, SHORT[c.id] ?? c.id.toUpperCase(), right - pipsW - 4 * u, y - 2 * u, 8, ready ? C.hi : C.dim, 'right', u);
      y -= 9 * u;
    }
    // Ready list: the selected one first.
    if (st.ready.length && m.alive) {
      const sel = st.ready[st.selected] ?? st.ready[0]!;
      const flash = m.time - ksClient.earnedAt < 2 && blink(m.time, 0.3, 0.2);
      const label = st.map ? 'RADIO' : st.armed ? 'DESIGNATING' : `[4] ${streakName(sel).toUpperCase()}`;
      txt(g, label, W - 8 * u, y - 4 * u, 8, flash ? C.paper : C.hi, 'right', u);
      if (st.ready.length > 1) txt(g, `+${st.ready.length - 1}  [5] NEXT`, W - 8 * u, y - 13 * u, 8, C.dim, 'right', u);
    }
  },
  42,
);

// Announcements (center, under the compass).
registerHudWidget(
  'killstreaks.announce',
  (g, W, H) => {
    const m = currentMatch();
    if (!m) return;
    const u = unit(H);
    ksClient.announcements = ksClient.announcements.filter((a) => m.time - a.t < 3.5);
    ksClient.announcements.forEach((a, i) => {
      const col = a.color === 'friend' ? C.friend : a.color === 'enemy' ? C.enemy : C.hi;
      txt(g, a.text.toUpperCase(), W / 2, 22 * u + i * 10 * u, 8, col, 'center', u);
    });
  },
  62,
);

// Designator, driving overlays, crate prompt, mortar warning.
registerHudWidget(
  'killstreaks.overlay',
  (g, W, H) => {
    const m = currentMatch();
    const st = ksClient.state;
    if (!m) return;
    const u = unit(H);
    const cx = W / 2;
    const cy = H / 2;
    if (st?.armed && m.alive) {
      const def = KILLSTREAK_BY_ID.get(st.armed.id);
      const s = 10 * u;
      g.fillStyle = C.warn;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        rect(g, cx + dx * s - (dx > 0 ? 3 * u : 0), cy + dy * s - (dy > 0 ? u : 0), 3 * u, u, C.warn);
        rect(g, cx + dx * s - (dx > 0 ? u : 0), cy + dy * s - (dy > 0 ? 3 * u : 0), u, 3 * u, C.warn);
      }
      rect(g, cx - u, cy - u, 2 * u, 2 * u, C.warn);
      const need = st.armed.need;
      const label = need > 1 ? `MARK TARGET ${st.armed.marks.length + 1}/${need}` : def?.targeting === 'line' ? 'MARK TARGET (RUNS ALONG YOUR FACING)' : def?.id === 'care_package' ? 'MARK DROP ZONE' : 'MARK TARGET';
      txt(g, label, cx, cy + 16 * u, 8, C.hi, 'center', u);
      txt(g, `[4] CONFIRM  ${streakName(st.armed.id).toUpperCase()}`, cx, cy + 26 * u, 8, C.paper, 'center', u);
    }
    if (st?.control) {
      const left = Math.max(0, st.control.until - m.serverTime);
      const name = streakName(st.control.id).toUpperCase();
      const hint = st.control.id === 'chopper_gunner' ? 'FIRE: CANNON' : 'FIRE: DETONATE';
      txt(g, name, cx, 52 * u, 16, C.hi, 'center', u);
      txt(g, `${hint}   ${clock(left)}`, cx, 70 * u, 8, C.paper, 'center', u);
      // Reticle.
      const r = 14 * u;
      for (let a = 0; a < 16; a++) {
        if (a % 4 === 1) continue;
        const t = (a / 16) * Math.PI * 2;
        rect(g, cx + Math.cos(t) * r - u, cy + Math.sin(t) * r - u, 2 * u, 2 * u, C.warn);
      }
      rect(g, cx - 4 * u, cy, 8 * u, u, C.warn);
      rect(g, cx, cy - 4 * u, u, 8 * u, C.warn);
    }
    const crate = ksClient.crate;
    if (crate && m.time - crate.at < 1) {
      const bw = 70 * u;
      txt(g, `HOLD ${useKey()}  ${crate.contents === '?' ? 'CARE PACKAGE' : streakName(crate.contents).toUpperCase()}`, cx, cy + 34 * u, 8, C.hi, 'center', u);
      box(g, cx - bw / 2, cy + 44 * u, bw, 3 * u, C.empty, u);
      rect(g, cx - bw / 2, cy + 44 * u, bw * crate.progress, 3 * u, C.hi);
    }
    // Incoming mortar near me.
    const me = m.me;
    if (me?.alive && m.net.lastSnap) {
      for (const e of m.net.lastSnap.ents) {
        if (e.kind !== KS_ENTITY.mortarMark) continue;
        if (Math.hypot(e.x - me.move.x, e.z - me.move.z) < STRIKE.mortar.blastR * 2) {
          const t = 'MORTAR INCOMING';
          if (blink(m.time, 0.4, 0.25)) txt(g, t, cx, cy - 30 * u, 16, C.warn, 'center', u);
          void textWidth;
          break;
        }
      }
    }
  },
  63,
);

// Care packages: a waypoint over every crate on your side (enemy crates only up close), and the
// "HOLD F" prompt as soon as you are in reach, before you start taking it.
registerHudWidget(
  'killstreaks.crates',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.alive || !m.net.lastSnap) return;
    const u = unit(H);
    const pos = m.net.predictor.shown();
    const marks: Waypoint[] = [];
    let inReach: { ours: boolean } | null = null;
    for (const e of m.net.lastSnap.ents) {
      if (e.kind !== KS_ENTITY.crate) continue;
      const ours = friendly(e.owner ?? '', e.team ?? null);
      const landed = e.s?.l === true;
      const d = Math.hypot(pos.x - e.x, pos.z - e.z);
      if (landed && d <= CRATE_REACH.r && Math.abs(pos.y - e.y) < CRATE_REACH.dy) inReach = { ours };
      marks.push({ x: e.x, y: e.y + 1.4, z: e.z, label: 'CARE PACKAGE', caption: landed ? undefined : 'INCOMING', color: ours ? C.friend : C.enemy, hideWithin: CRATE_REACH.r + 0.7, ...(ours ? {} : { maxDist: 20, small: true }) });
    }
    const placed: WaypointSlot[] = [];
    for (const k of marks) drawWaypoint(m, g, W, H, k, placed);
    // While taking it, the progress prompt in killstreaks.overlay takes over.
    const taking = ksClient.crate && m.time - ksClient.crate.at < 1;
    if (!inReach || taking) return;
    const verb = inReach.ours ? 'FOR CARE PACKAGE' : iHavePro('hacker') ? 'TO BOOBY-TRAP CARE PACKAGE' : 'TO STEAL CARE PACKAGE';
    txt(g, `HOLD ${useKey()} ${verb}`, W / 2, H / 2 + 34 * u, 8, blink(m.time, 1, 0.7) ? C.hi : C.paper, 'center', u);
  },
  7,
);
