/**
 * Client side of the "modes" feature (auto-imported by main.ts via import.meta.glob):
 * objective state store, HUD widgets, world props, sounds, the per-death and final killcams, the end-of-match
 * summary screen and quick-play menu entries for the objective modes. See docs/features/modes.md.
 */
import { HUD_COLORS as C, rect, txt, unit } from '../../hud/draw';
import { hudWidgets, registerHudWidget, registerMatchHook, registerMenuItem, type HudDraw } from '../../registry';
import { navigate } from '../../router';
import { currentMatch } from '../../state';
import './sounds';
import './store';
import './hud';
import './props';
import './infected';
import { deathcamPlaying } from './deathcam';
import { killcamPlaying } from './killcam';
import { summaryOpen } from './summary';

for (const [order, mode, hint] of [
  [30, 'dom', 'Domination'],
  [31, 'sd', 'Search and Destroy'],
  [32, 'hq', 'Headquarters'],
  [33, 'kc', 'Kill Confirmed'],
] as const) {
  registerMenuItem({ id: `modes.${mode}`, label: 'Quick Play', hint, order, action: () => navigate('match', { mode }) });
}

/**
 * Small wraps of core widgets (same ids and orders, so a later replacement by another feature
 * still wins): the scoreboard and result title stay out of the way of the final killcam and
 * the summary screen, and the death screen explains Headquarters' "no respawn while your HQ
 * stands" instead of "waiting for next round". The death screen also steps aside while the
 * per-death killcam plays.
 */
let wrapped = false;
function wrapCoreWidgets(): void {
  if (wrapped) return;
  wrapped = true;
  const wrap = (id: string, fn: (orig: HudDraw) => HudDraw) => {
    const w = hudWidgets.get(id);
    if (w) registerHudWidget(id, fn(w.draw), w.order);
  };
  for (const id of ['core.scoreboard', 'core.phase'])
    wrap(id, (orig) => (g, W, H, dt) => {
      if (killcamPlaying() || summaryOpen()) return;
      orig(g, W, H, dt);
    });
  // A final or round killcam is the killer's screen, not yours (you may still be alive in S&D's post-round).
  for (const id of ['core.names', 'core.damage', 'core.crosshair', 'core.hitmarker', 'core.compass', 'core.health', 'core.ammo', 'core.score', 'core.killfeed', 'core.status', 'core.title'])
    wrap(id, (orig) => (g, W, H, dt) => {
      if (killcamPlaying()) return;
      orig(g, W, H, dt);
    });
  wrap('core.death', (orig) => (g, W, H, dt) => {
    if (deathcamPlaying() || killcamPlaying()) return;
    const m = currentMatch();
    if (!m || m.joined.mode !== 'hq' || m.alive || !m.death || m.phase === 'ended' || (m.me?.respawnAt ?? null) !== null) return orig(g, W, H, dt);
    const u = unit(H);
    const y = H * 0.3;
    rect(g, 0, y - 6 * u, W, 44 * u, 'rgba(10,10,10,.55)');
    const d = m.death;
    if (d.attacker && d.attacker !== m.myId) {
      txt(g, 'KILLED BY', W / 2, y, 8, C.paper, 'center', u);
      txt(g, m.nameOf(d.attacker), W / 2, y + 9 * u, 16, C.enemy, 'center', u);
    } else txt(g, 'YOU DIED', W / 2, y + 9 * u, 16, C.warn, 'center', u);
    txt(g, 'YOUR HQ STANDS · RESPAWN WHEN IT FALLS', W / 2, H * 0.62, 8, C.hi, 'center', u);
  });
}

registerMatchHook('modes.core-wraps', {
  start: () => wrapCoreWidgets(),
  frame(m) {
    // HQ: a respawn granted after death (the HQ fell) only shows up in `me.respawnAt`.
    if (m.death && m.death.respawnAt === null && m.me && !m.me.alive && m.me.respawnAt !== null) m.death.respawnAt = m.me.respawnAt;
  },
});
