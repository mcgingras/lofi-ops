/**
 * The Mystery Box's wonder weapon on loan (rules: WONDER_LOAN in shared/defs/mystery-box.ts, the
 * server's `giveWonder` / `endLoan`): the countdown beside the weapon name on the HUD (warning red
 * through the last WONDER_LOAN.warnSec), a tick each of those seconds, the box's "bye-bye" laugh as
 * it is taken away, and following the slot the server puts in hand (back to the primary at the end,
 * the wonder weapon's slot at a respawn while the loan runs).
 */
import { loanLeft, WONDER_LOAN } from '../../../shared/defs/mystery-box';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { sfx } from '../../game/audio';
import { textWidth, txt, unit, HUD_COLORS as C } from '../../hud/draw';
import { onFeature, registerHudWidget, registerMatchHook } from '../../registry';
import { currentMatch } from '../../state';

/** The loan as the server last told us: weapon id and room time it ends (null: none). */
export const loanState: { w: string | null; until: number; slot: number | null; lastTick: number } = { w: null, until: 0, slot: null, lastTick: -1 };

onFeature('killstreaks.wonderLoan', (d) => {
  const was = loanState.w;
  loanState.w = d.w;
  loanState.until = d.until;
  if (typeof d.slot === 'number') loanState.slot = d.slot;
  if (!d.w && was) sfx.play('ks_mbox_byebye', { volume: 1.1 });
});

registerMatchHook('killstreaks.wonderLoan', {
  start() {
    loanState.w = null;
    loanState.slot = null;
    loanState.lastTick = -1;
  },
  frame(m) {
    // Follow the slot the server put in hand (once we are alive and it exists).
    if (loanState.slot !== null && m.alive && loanState.slot < (m.me?.weapons.length ?? 0)) {
      m.slot = loanState.slot;
      loanState.slot = null;
    }
    if (!loanState.w) return;
    const left = loanLeft(loanState.until, m.serverTime);
    // The last seconds tick away (once per whole second).
    const sec = Math.ceil(left);
    if (left > 0 && left <= WONDER_LOAN.warnSec && sec !== loanState.lastTick) {
      loanState.lastTick = sec;
      sfx.play('ks_mbox_tick', { volume: 0.9 });
    }
  },
});

registerHudWidget(
  'killstreaks.wonderLoan',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.alive || !loanState.w) return;
    const def = m.weapon();
    const u = unit(H);
    const left = loanLeft(loanState.until, m.serverTime);
    const warn = left <= WONDER_LOAN.warnSec;
    if (warn && Math.floor(m.time * 4) % 2 === 1) return;
    const label = `${Math.ceil(left)}s`;
    // Beside the weapon name (core.ammo draws it right-aligned at the bottom right).
    const name = (def?.name ?? WEAPON_BY_ID.get(loanState.w)?.name ?? '').toUpperCase();
    const x = W - 8 * u - textWidth(g, name, 8, u) - 4 * u;
    txt(g, label, x, H - 9 * u, 8, warn ? C.warn : '#bfe6f8', 'right', u);
  },
  41,
);
