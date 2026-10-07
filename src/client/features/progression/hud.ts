/**
 * Progression HUD widgets (pixel HUD, render resolution):
 *
 *   progression.ticker  26   "+150" near the crosshair with the labels of what earned it
 *   progression.xpbar   42   thin XP bar along the bottom edge (level progress)
 *   progression.matchxp 86   after the match: XP earned and level change (modes may replace it)
 *   progression.popups  75   promotion, challenge complete, new unlock, locked items
 */
import { levelProgress } from '../../../shared/defs/progression';
import { box, HUD_COLORS as C, rect, txt, unit } from '../../hud/draw';
import { registerHudWidget } from '../../registry';
import { currentMatch } from '../../state';
import { progressionState as S } from './api';
import { badgePixels, drawPixels } from './emblems';

const now = () => performance.now() / 1000;
const fmt = (n: number) => n.toLocaleString('en-US');

registerHudWidget(
  'progression.ticker',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || m.loading) return;
    const t = now();
    const recent = S.gains.filter((x) => t - x.at < 2.2);
    if (!recent.length) return;
    const u = unit(H);
    const total = recent.reduce((s, x) => s + x.xp, 0);
    const x = W / 2 + 16 * u;
    let y = H / 2 - 22 * u;
    const fresh = t - recent[recent.length - 1]!.at < 0.12;
    txt(g, `+${fmt(total)}`, x, y, fresh ? 16 : 8, C.hi, 'left', u);
    y += (fresh ? 18 : 10) * u;
    const labels = new Map<string, number>();
    for (const r of recent) labels.set(r.label, (labels.get(r.label) ?? 0) + 1);
    let i = 0;
    for (const [label, n] of labels) {
      if (i++ >= 4) break;
      txt(g, n > 1 ? `${label} x${n}` : label, x, y, 8, C.paper, 'left', u);
      y += 9 * u;
    }
  },
  26,
);

registerHudWidget(
  'progression.xpbar',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || m.loading || m.phase === 'ended') return;
    const u = unit(H);
    const frac = levelProgress(S.xp);
    const y = H - 2 * u;
    rect(g, 0, y - u, W, 3 * u, C.ink);
    rect(g, 0, y, Math.round(W * frac), u, C.hi);
    // Tick marks every 10%.
    for (let i = 1; i < 10; i++) rect(g, Math.round((W * i) / 10), y, u, u, C.ink);
  },
  42,
);

registerHudWidget(
  'progression.matchxp',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || m.phase !== 'ended') return;
    const s = S.lastSummary;
    if (!s || s.playerId !== m.myId) return;
    const u = unit(H);
    const lv = s.levelAfter > s.levelBefore ? `LEVEL ${s.levelBefore} > ${s.levelAfter}` : `LEVEL ${s.levelAfter}`;
    const done = s.challenges.filter((c) => c.completedTiers.length).length;
    const parts = [`+${fmt(s.total)} XP`, lv, done ? `${done} CHALLENGE${done > 1 ? 'S' : ''}` : ''].filter(Boolean);
    const y = H - 27 * u;
    const bw = Math.min(W - 16 * u, 200 * u);
    rect(g, (W - bw) / 2, y - 2 * u, bw, 11 * u, 'rgba(10,10,10,.75)');
    txt(g, parts.join('  ·  '), W / 2, y, 8, C.hi, 'center', u);
    const frac = levelProgress(s.xpAfter);
    rect(g, (W - bw) / 2, y + 9 * u, bw, u, C.empty);
    rect(g, (W - bw) / 2, y + 9 * u, Math.round(bw * frac), u, C.hi);
  },
  86,
);

registerHudWidget(
  'progression.popups',
  (g, W, H) => {
    const m = currentMatch();
    // Wait for the map title card to clear before showing (or advancing) popups.
    if (!m || m.loading || m.time - m.cardAt < 3.6) return;
    const p = S.activePopup();
    if (!p) return;
    const u = unit(H);
    const age = now() - p.shownAt;
    // Pop in: two quick frames of the title only.
    const top = Math.round(H * 0.17);
    const col = p.kind === 'locked' ? C.warn : p.kind === 'level' ? C.hi : C.paper;
    if (p.kind === 'level') {
      const s = 2 * u;
      const px = badgePixels(p.level ?? S.level, p.prestige ?? 0);
      const n = Math.round(Math.sqrt(px.length));
      const bx = Math.round(W / 2 - (n * s) / 2);
      drawPixels(g, px, bx, top, s);
      let y = top + n * s + 3 * u;
      txt(g, p.title, W / 2, y, 8, C.paper, 'center', u);
      y += 10 * u;
      if (age > 0.15) txt(g, p.head, W / 2, y, 16, col, 'center', u);
      y += 18 * u;
      if (age > 0.4) for (const line of p.lines) {
        txt(g, line, W / 2, y, 8, line.startsWith('NEW') ? C.hi : C.dim, 'center', u);
        y += 9 * u;
      }
      return;
    }
    const bw = Math.min(W - 24 * u, 170 * u);
    const bh = (24 + p.lines.length * 9) * u;
    const x0 = Math.round((W - bw) / 2);
    box(g, x0, top, bw, bh, 'rgba(14,14,18,.85)', u);
    rect(g, x0, top, bw, u, col);
    txt(g, p.title, W / 2, top + 3 * u, 8, col, 'center', u);
    txt(g, p.head, W / 2, top + 12 * u, 8, C.paper, 'center', u);
    let y = top + 22 * u;
    for (const line of p.lines) {
      txt(g, line, W / 2, y, 8, p.kind === 'locked' ? C.dim : C.hi, 'center', u);
      y += 9 * u;
    }
  },
  75,
);
