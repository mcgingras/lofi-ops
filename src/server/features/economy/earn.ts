/**
 * Earning CoD Points: performance-based CP at the end of every normal match (codPointsBreakdown,
 * BO1-like), and `economy.grant` events from other areas (challenges, contracts). Wager modes pay
 * only through the pot (wager.ts). Bots never earn.
 */
import { codPointsBreakdown, isWagerMode } from '../../../shared/defs/economy';
import type { EconomyResultsExt } from '../../../shared/defs/economy-net';
import type { Room } from '../../room';
import { credit, econ } from './ledger';

export function wireEarning(room: Room): void {
  room.bus.on('matchEnd', ({ results }) => {
    const ext = (results.ext.economy ??= { awards: {}, wager: null }) as EconomyResultsExt;
    if (isWagerMode(results.mode) || !room.options.persist) return;
    for (const r of results.players) {
      if (r.bot) continue;
      const p = room.players.get(r.id);
      const prof = p?.profile;
      if (!p || !prof) continue;
      const b = codPointsBreakdown({ score: r.score, won: r.won, place: r.place, teams: room.mode.teams, bestStreak: r.bestStreak, timePlayed: r.timePlayed, durationSec: results.durationSec });
      credit(prof, b.total, 'match', `${room.mode.name} match`);
      econ(prof).lastMatch = { mode: results.mode, lines: b.lines, total: b.total };
      ext.awards[r.id] = b;
      room.sendFeature(p, 'economy.award', { reason: 'match', lines: b.lines, total: b.total, codPoints: prof.codPoints });
    }
  });

  room.bus.on('economy.grant', ({ player, amount, reason, kind }) => {
    const prof = player.profile;
    if (player.isBot || !prof || !(amount > 0)) return;
    const n = credit(prof, amount, kind ?? 'grant', reason);
    room.sendFeature(player, 'economy.award', { reason: kind ?? 'grant', lines: [{ label: reason, cp: n }], total: n, codPoints: prof.codPoints });
  });
}
