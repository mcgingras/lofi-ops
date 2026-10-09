/**
 * Economy HUD widgets (pixel HUD, render resolution):
 *   economy.lobby  85  wager lobby card (mode, ante, pot, players, start countdown, bots)
 *   economy.wager  52  pot + "IN THE MONEY #n +CP" / "OUT OF THE MONEY" / "PRACTICE" (under the score)
 *   economy.mode   53  mode state: OITC lives, Gun Game rung, Sharpshooter swap timer, tomahawks
 *   economy.award  86  CP toast after a match / payout / refund
 *   economy.reticle 21 the equipped reticle while aiming through an optic
 */
import { ATTACHMENT_BY_ID } from '../../../shared/defs/attachments';
import { BOT_DIFFICULTY_BY_ID } from '../../../shared/defs/bots';
import { WAGER_MODES } from '../../../shared/defs/economy';
import type { WagerHud, WagerModeHud } from '../../../shared/defs/economy-net';
import type { CpLine } from '../../../shared/defs/economy';
import { DEFAULT_RETICLE, RETICLE_BY_ID } from '../../../shared/defs/store';
import { promptKey } from '../../game/prompts';
import { blink, box, clock, HUD_COLORS as C, rect, textWidth, txt, unit } from '../../hud/draw';
import { net } from '../../net';
import { onFeature, registerHudWidget, registerMatchHook } from '../../registry';
import { currentMatch } from '../../state';
import { drawReticle } from './paint';

const GREEN = '#7adf6a';
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

const state: { wager: WagerHud | null; mode: WagerModeHud | null; award: { at: number; reason: string; lines: CpLine[]; total: number } | null } = { wager: null, mode: null, award: null };

onFeature('economy.wager', (d) => (state.wager = d));
onFeature('economy.mode', (d) => (state.mode = d));
onFeature('economy.award', (d) => {
  state.award = { at: performance.now() / 1000, reason: d.reason, lines: d.lines, total: d.total };
  if (net.profile) net.profile.codPoints = d.codPoints;
});

registerMatchHook('economy.hud', {
  start() {
    state.wager = null;
    state.mode = null;
    return () => {
      state.wager = null;
      state.mode = null;
    };
  },
});

const isWager = () => {
  const m = currentMatch();
  return !!m && WAGER_MODES.some((x) => x.id === m.joined.mode);
};

/** The local player's standing in the wager HUD. */
export function myStanding(): { rank: number; payout: number; place: number } | null {
  const m = currentMatch();
  const w = state.wager;
  if (!m || !w) return null;
  const s = w.standings.find((x) => x.id === m.myId);
  return s ? { rank: s.rank, payout: s.payout, place: s.place } : null;
}

registerHudWidget(
  'economy.lobby',
  (g, W, H) => {
    const m = currentMatch();
    const w = state.wager;
    if (!m || !w || !isWager() || m.phase !== 'lobby') return;
    const u = unit(H);
    const mode = WAGER_MODES.find((x) => x.id === w.mode);
    const lines: [string, string][] = [
      [(mode?.name ?? w.mode).toUpperCase(), C.hi],
      [!w.ante ? 'PRACTICE: NOTHING AT STAKE' : w.staked ? `ANTE ${fmt(w.ante)} CP   POT ${fmt(w.pot)} CP` : `ANTE ${fmt(w.ante)} CP: NEEDS 2 PLAYERS, ELSE PRACTICE`, w.ante ? C.paper : C.dim],
      [`PLAYERS ${w.humans}/${w.target}`, C.paper],
      [w.startsIn !== null ? `STARTS IN ${Math.ceil(w.startsIn)}` : 'WAITING FOR PLAYERS', w.startsIn !== null ? GREEN : blink(m.time, 1.2, 0.8) ? C.paper : C.dim],
      [w.bots.fill ? `BOT BACKFILL: ${(BOT_DIFFICULTY_BY_ID.get(w.bots.difficulty as never)?.name ?? w.bots.difficulty).toUpperCase()}` : 'NO BOTS', C.dim],
    ];
    if (w.ante && w.payouts.length) lines.push([`PAYS ${w.payouts.map((p, i) => `#${i + 1} ${fmt(p)}`).join('  ')}`, C.ammo]);
    let bw = 0;
    for (const [s] of lines) bw = Math.max(bw, textWidth(g, s, 8, u));
    const bh = lines.length * 11 * u + 14 * u;
    const x = Math.round(W / 2 - bw / 2 - 8 * u);
    // Above core.phase's "WAITING FOR PLAYERS" (0.36 H), below the compass.
    const y = Math.max(26 * u, Math.round(H * 0.36 - bh - 6 * u));
    box(g, x, y, bw + 16 * u, bh, 'rgba(12,12,16,0.92)', u);
    txt(g, 'WAGER LOBBY', W / 2, y + 4 * u, 8, C.dim, 'center', u);
    lines.forEach(([s, c], i) => txt(g, s, W / 2, y + 15 * u + i * 11 * u, 8, c, 'center', u));
    // Who's here, top right.
    let py = 30 * u;
    txt(g, 'IN LOBBY', W - 8 * u, py, 8, C.dim, 'right', u);
    for (const s of w.standings.slice(0, 10)) {
      py += 9 * u;
      txt(g, `${s.bot ? '[BOT] ' : ''}${s.name}`, W - 8 * u, py, 8, s.id === m.myId ? C.hi : s.bot ? C.dim : C.paper, 'right', u);
    }
  },
  85,
);

registerHudWidget(
  'economy.wager',
  (g, _W, H) => {
    const m = currentMatch();
    const w = state.wager;
    if (!m || !w || !isWager() || m.phase === 'lobby') return;
    const u = unit(H);
    const x = 8 * u;
    let y = 36 * u;
    if (w.practice) {
      txt(g, 'PRACTICE WAGER', x, y, 8, C.dim, 'left', u);
      return;
    }
    txt(g, `POT ${fmt(w.pot)} CP`, x, y, 8, C.ammo, 'left', u);
    y += 10 * u;
    const me = myStanding();
    if (!me || me.rank === 0) {
      txt(g, 'NOT STAKED', x, y, 8, C.dim, 'left', u);
      return;
    }
    const inMoney = me.payout > 0;
    const label = inMoney ? `IN THE MONEY #${me.rank}  +${fmt(me.payout)}` : `OUT OF THE MONEY #${me.rank}`;
    rect(g, x - u, y - u, textWidth(g, label, 8, u) + 4 * u, 10 * u, inMoney ? 'rgba(20,60,20,.75)' : 'rgba(70,20,14,.75)');
    txt(g, label, x + u, y, 8, inMoney ? GREEN : C.warn, 'left', u);
  },
  52,
);

registerHudWidget(
  'economy.mode',
  (g, W, H) => {
    const m = currentMatch();
    const d = state.mode;
    if (!m || !d || !isWager() || d.mode !== m.joined.mode || m.phase === 'lobby') return;
    const u = unit(H);
    const x = 8 * u;
    const y = 58 * u;
    switch (d.mode) {
      case 'oitc': {
        if (d.out) {
          txt(g, 'ELIMINATED - SPECTATING', W / 2, H * 0.3, 8, C.warn, 'center', u);
          return;
        }
        txt(g, 'LIVES', x, y, 8, C.dim, 'left', u);
        for (let i = 0; i < (d.livesMax ?? 3); i++) box(g, x + 30 * u + i * 8 * u, y + u, 5 * u, 5 * u, i < (d.lives ?? 0) ? C.health : C.empty, u);
        break;
      }
      case 'gungame':
        txt(g, `GUN ${Math.min((d.gunLevel ?? 0) + 1, d.gunCount ?? 1)}/${d.gunCount ?? '?'}  ${(d.gun ?? '').toUpperCase()}`, x, y, 8, C.hi, 'left', u);
        txt(g, d.nextGun ? `NEXT: ${d.nextGun.toUpperCase()}` : 'FINAL WEAPON', x, y + 10 * u, 8, C.dim, 'left', u);
        break;
      case 'sharpshooter': {
        const left = Math.max(0, (d.rotateAt ?? 0) - m.serverTime);
        txt(g, `${(d.weapon ?? '').toUpperCase()}  SWAP ${clock(left)}`, x, y, 8, left < 5 && blink(m.time) ? C.warn : C.hi, 'left', u);
        if (d.bonus) txt(g, `x${d.multiplier} ${d.bonus.toUpperCase()}`, x, y + 10 * u, 8, GREEN, 'left', u);
        break;
      }
      case 'sticks':
        txt(g, `TOMAHAWK x${d.tomahawks ?? 0}  ${promptKey('lethal', { brackets: true })}`, x, y, 8, (d.tomahawks ?? 0) > 0 ? C.hi : C.dim, 'left', u);
        break;
    }
  },
  53,
);

registerHudWidget(
  'economy.award',
  (g, W, H) => {
    const a = state.award;
    if (!a) return;
    const age = performance.now() / 1000 - a.at;
    if (age > 9) {
      state.award = null;
      return;
    }
    const u = unit(H);
    const title = a.reason === 'payout' ? 'WAGER' : a.reason === 'refund' ? 'REFUND' : 'COD POINTS';
    const lines = a.lines.slice(0, 6);
    const bw = 140 * u;
    const bh = (lines.length + 2) * 10 * u + 6 * u;
    const x = Math.round(W / 2 - bw / 2);
    const y = Math.round(H - bh - 50 * u);
    box(g, x, y, bw, bh, 'rgba(12,12,16,0.9)', u);
    txt(g, title, x + 6 * u, y + 4 * u, 8, C.dim, 'left', u);
    lines.forEach((l, i) => {
      txt(g, l.label.toUpperCase().slice(0, 24), x + 6 * u, y + 15 * u + i * 10 * u, 8, C.paper, 'left', u);
      txt(g, `${l.cp >= 0 ? '+' : ''}${fmt(l.cp)}`, x + bw - 6 * u, y + 15 * u + i * 10 * u, 8, l.cp >= 0 ? GREEN : C.warn, 'right', u);
    });
    const ty = y + 15 * u + lines.length * 10 * u + 2 * u;
    txt(g, 'TOTAL', x + 6 * u, ty, 8, C.hi, 'left', u);
    txt(g, `${a.total >= 0 ? '+' : ''}${fmt(a.total)} CP`, x + bw - 6 * u, ty, 8, a.total >= 0 ? GREEN : C.warn, 'right', u);
  },
  86,
);

registerHudWidget(
  'economy.reticle',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.alive || m.phase === 'ended') return;
    if (m.net.predictor.state.ads < 0.85) return;
    const wpn = m.weapon();
    if (!wpn || wpn.scope) return;
    const optic = wpn.attachmentIds.some((id) => ATTACHMENT_BY_ID.get(id)?.slot === 'optic');
    if (!optic) return;
    const e = (net.profile?.ext.economy ?? {}) as { equipped?: { reticle?: string } };
    // The weapons area already paints the default red dot / ring / chevron on the optic glass;
    // only an equipped (bought) reticle is drawn on top, so the default isn't shown twice.
    const r = RETICLE_BY_ID.get(e.equipped?.reticle ?? DEFAULT_RETICLE);
    if (!r || r.id === DEFAULT_RETICLE) return;
    const u = unit(H);
    drawReticle(g, Math.floor(W / 2) + 0.5, Math.floor(H / 2) + 0.5, 9 * u, r.shape, r.color);
  },
  21,
);
