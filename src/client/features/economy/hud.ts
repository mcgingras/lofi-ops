/**
 * Economy HUD widgets (pixel HUD, render resolution):
 *   economy.lobby  85  wager lobby card (mode, ante, pot, players, start countdown, bots)
 *   economy.wager  52  pot, your stake, "IN THE MONEY #n +CP" / "OUT OF THE MONEY" / "PRACTICE" (under the score)
 *   economy.board  91  with the scoreboard open: pot, stake and every entrant's projected payout
 *                      with the IN THE MONEY cut line (bots included; their share goes to the house)
 *   economy.mode   53  mode state: OITC lives, Gun Game rung, Sharpshooter swap timer, tomahawks
 *   economy.award  86  CP toast after a match / payout / refund
 *   economy.splash 87  Sticks and Stones: BANKRUPTED / HUMILIATION, and the STUCK warning
 *   economy.reticle 21 the equipped reticle while aiming through an optic
 */
import { ATTACHMENT_BY_ID } from '../../../shared/defs/attachments';
import { WAGER_MODES } from '../../../shared/defs/economy';
import type { WagerHud, WagerModeHud } from '../../../shared/defs/economy-net';
import type { CpLine } from '../../../shared/defs/economy';
import { DEFAULT_RETICLE, RETICLE_BY_ID } from '../../../shared/defs/store';
import { sfx } from '../../game/audio';
import { rumble } from '../../game/gamepad';
import { promptKey } from '../../game/prompts';
import { blink, box, clock, HUD_COLORS as C, rect, textWidth, txt, unit } from '../../hud/draw';
import { net } from '../../net';
import { onFeature, registerHudWidget, registerMatchHook } from '../../registry';
import { currentMatch } from '../../state';
import { drawReticle } from './paint';

const GREEN = '#7adf6a';
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

const state: {
  wager: WagerHud | null;
  mode: WagerModeHud | null;
  award: { at: number; reason: string; lines: CpLine[]; total: number } | null;
  /** Big centre splash (match time it started). */
  splash: { at: number; title: string; sub: string; color: string } | null;
  /** A crossbow bolt is stuck in you until `until` (match time). */
  stuck: { until: number } | null;
} = { wager: null, mode: null, award: null, splash: null, stuck: null };

onFeature('economy.wager', (d) => (state.wager = d));
onFeature('economy.mode', (d) => (state.mode = d));
onFeature('economy.award', (d) => {
  state.award = { at: performance.now() / 1000, reason: d.reason, lines: d.lines, total: d.total };
  if (net.profile) net.profile.codPoints = d.codPoints;
});

registerMatchHook('economy.hud', {
  start(m) {
    state.wager = null;
    state.mode = null;
    state.splash = null;
    state.stuck = null;
    const offs = [
      onFeature('economy.bankrupt', (d) => {
        const victim = m.nameOf(d.victim);
        if (d.victim === m.myId) {
          state.splash = { at: m.time, title: 'BANKRUPTED', sub: d.attacker ? `BY ${m.nameOf(d.attacker).toUpperCase()}` : 'SUICIDE', color: C.warn };
          sfx.play('weapons.thump', { volume: 0.9 });
        } else if (d.attacker === m.myId) {
          state.splash = { at: m.time, title: 'HUMILIATION', sub: `${victim.toUpperCase()} BANKRUPTED`, color: GREEN };
        }
        else {
          // Everyone else: a feed line (the two involved get the splash instead).
          m.notices.push({ t: m.time, text: d.attacker ? `${victim} was BANKRUPTED by ${m.nameOf(d.attacker)}` : `${victim} BANKRUPTED themselves` });
          if (m.notices.length > 4) m.notices.shift();
        }
      }),
      onFeature('economy.stuck', (d) => {
        state.stuck = { until: m.time + d.fuse };
        rumble('explosion', 0.4);
      }),
      onFeature('economy.blade', () => {
        sfx.play('weapons.shell', { volume: 0.8 });
        m.notices.push({ t: m.time, text: '+1 BLADE' });
      }),
    ];
    return () => {
      offs.forEach((f) => f());
      state.wager = null;
      state.mode = null;
      state.splash = null;
      state.stuck = null;
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
      [!w.ante ? 'PRACTICE: NOTHING AT STAKE' : !w.practice ? `ANTE ${fmt(w.ante)} CP   POT ${fmt(w.pot)} CP` : `ANTE ${fmt(w.ante)} CP: NEEDS AN OPPONENT, ELSE PRACTICE`, w.ante ? C.paper : C.dim],
      [`PLAYERS ${w.humans}/${w.target}`, C.paper],
      [w.startsIn !== null ? `STARTS IN ${Math.ceil(w.startsIn)}` : 'WAITING FOR PLAYERS', w.startsIn !== null ? GREEN : blink(m.time, 1.2, 0.8) ? C.paper : C.dim],
      [w.bots.fill ? `OPPONENTS: ${w.bots.opponents.toUpperCase()} BOTS` : 'NO BOTS', C.dim],
    ];
    if (w.ante && !w.practice && w.payouts.length) {
      lines.push([`YOUR STAKE ${fmt(w.ante)} CP${w.bots.fill ? '  HOUSE COVERS THE BOTS' : ''}`, C.paper]);
      lines.push([`PAYS ${w.payouts.map((p, i) => `#${i + 1} ${fmt(p)}`).join('  ')}`, C.ammo]);
    }
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
    const me = myStanding();
    txt(g, `POT ${fmt(w.pot)} CP${me && me.rank ? `  STAKE ${fmt(w.ante)}` : ''}`, x, y, 8, C.ammo, 'left', u);
    y += 10 * u;
    if (!me || me.rank === 0) {
      txt(g, 'NOT STAKED', x, y, 8, C.dim, 'left', u);
      return;
    }
    const inMoney = me.payout > 0;
    const label = inMoney ? `IN THE MONEY #${me.rank}  +${fmt(me.payout)}` : `OUT OF THE MONEY #${me.rank}  TOP ${w.payouts.length} PAID`;
    rect(g, x - u, y - u, textWidth(g, label, 8, u) + 4 * u, 10 * u, inMoney ? 'rgba(20,60,20,.75)' : 'rgba(70,20,14,.75)');
    txt(g, label, x + u, y, 8, inMoney ? GREEN : C.warn, 'left', u);
  },
  52,
);

// The money view next to the Tab scoreboard (BO1 showed each player's cut on the wager scoreboard).
registerHudWidget(
  'economy.board',
  (g, W, H) => {
    const m = currentMatch();
    const w = state.wager;
    if (!m || !w || !isWager() || !m.scoreboardOpen || m.loading || w.practice || m.phase === 'lobby') return;
    const u = unit(H);
    const entrants = w.standings.filter((s) => s.rank > 0).sort((a, b) => a.rank - b.rank);
    const bw = 112 * u;
    const rows = entrants.length + 3;
    const bh = rows * 9 * u + 14 * u;
    // Left of the scoreboard (230 units wide, centred) when it fits, else along the bottom.
    const side = (W - Math.min(W - 16 * u, 230 * u)) / 2 >= bw + 6 * u;
    const x = side ? 4 * u : Math.round(W / 2 - bw / 2);
    const y = side ? (m.phase === 'ended' ? 38 : 30) * u : H - bh - 8 * u;
    box(g, x, y, bw, bh, 'rgba(12,12,16,0.9)', u);
    let ry = y + 4 * u;
    txt(g, `POT ${fmt(w.pot)} CP`, x + 4 * u, ry, 8, C.ammo, 'left', u);
    ry += 9 * u;
    const me = myStanding();
    txt(g, me && me.rank ? `YOUR STAKE ${fmt(w.ante)} CP` : 'NOT STAKED', x + 4 * u, ry, 8, C.paper, 'left', u);
    ry += 11 * u;
    const paid = w.payouts.length;
    entrants.forEach((s, i) => {
      if (i === paid) {
        rect(g, x + 2 * u, ry - u, bw - 4 * u, u, C.warn);
        ry += u;
      }
      const mine = s.id === m.myId;
      const col = mine ? C.hi : s.payout > 0 ? GREEN : C.dim;
      txt(g, `${s.rank} ${s.bot ? '[BOT] ' : ''}${s.name}`.slice(0, 18), x + 4 * u, ry, 8, col, 'left', u);
      txt(g, s.payout > 0 ? fmt(s.payout) : '-', x + bw - 4 * u, ry, 8, col, 'right', u);
      ry += 9 * u;
    });
    txt(g, `IN THE MONEY: TOP ${paid}`, x + 4 * u, ry + u, 8, C.dim, 'left', u);
  },
  91,
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
      case 'sticks': {
        const n = d.tomahawks ?? 0;
        txt(g, n > 0 ? `TOMAHAWK  HOLD ${promptKey('lethal', { brackets: true })}` : 'TOMAHAWK  PICK IT UP', x, y, 8, n > 0 ? C.hi : C.dim, 'left', u);
        txt(g, 'A TOMAHAWK KILL BANKRUPTS', x, y + 10 * u, 8, C.dim, 'left', u);
        break;
      }
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
  'economy.splash',
  (g, W, H) => {
    const m = currentMatch();
    if (!m) return;
    const u = unit(H);
    const sp = state.splash;
    if (sp) {
      const age = m.time - sp.at;
      if (age > 3 || age < 0) state.splash = null;
      else {
        // Above the death card (core.death sits at 30 % of the height).
        const y = H * 0.14;
        rect(g, 0, y - 6 * u, W, 34 * u, 'rgba(10,10,10,.55)');
        txt(g, sp.title, W / 2, y, 16, age < 0.6 && blink(m.time, 0.15, 0.075) ? C.paper : sp.color, 'center', u);
        txt(g, sp.sub, W / 2, y + 18 * u, 8, C.paper, 'center', u);
      }
    }
    const st = state.stuck;
    if (st) {
      if (!m.alive || m.time > st.until) state.stuck = null;
      else {
        // BO1-style: a red frame and a flashing STUCK! under the crosshair.
        const on = blink(m.time, 0.25, 0.125);
        const t = 2 * u;
        const col = on ? 'rgba(220,40,30,.85)' : 'rgba(220,40,30,.35)';
        rect(g, 0, 0, W, t, col);
        rect(g, 0, H - t, W, t, col);
        rect(g, 0, 0, t, H, col);
        rect(g, W - t, 0, t, H, col);
        txt(g, 'STUCK!', W / 2, H / 2 + 26 * u, 16, on ? C.warn : C.paper, 'center', u);
      }
    }
  },
  87,
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
