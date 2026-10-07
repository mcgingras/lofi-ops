/**
 * The end-of-match summary as plain data (pure; tested in tests/modes.client.test.ts): title,
 * team tables or the FFA table, MVP, objective stat columns and this player's XP breakdown.
 * XP comes from the progression feature's summary (`results.ext.progression[me]`, the XP actually
 * awarded, including the match-complete bonus) when present; otherwise `results.ext.modes`, then
 * the scoreboard (e.g. a mode from another feature).
 */
import { TEAM_NAMES, type Team } from '../../../shared/constants';
import { MODE_BY_ID } from '../../../shared/defs/modes';
import { MAP_BY_ID } from '../../../shared/defs/maps';
import type { MatchSummaryExt, XpLine } from '../../../shared/defs/modestate';
import { matchSummaryFor, XP_SOURCES } from '../../../shared/defs/progression';
import type { MatchResults, PlayerResult } from '../../../shared/events';

export const STAT_COLUMNS: Record<string, string> = {
  captures: 'CAPS',
  neutralizes: 'NEUT',
  defends: 'DEF',
  plants: 'PLANT',
  defuses: 'DEFUSE',
  destroys: 'DESTR',
  confirms: 'CONF',
  denies: 'DENY',
};

export interface SummaryRow {
  id: string;
  name: string;
  team: Team | null;
  bot: boolean;
  score: number;
  kills: number;
  deaths: number;
  assists: number;
  place: number;
  stats: Record<string, number>;
  mvp: boolean;
  me: boolean;
}

export interface SummaryView {
  title: 'VICTORY' | 'DEFEAT' | 'DRAW' | 'MATCH OVER';
  modeName: string;
  mapName: string;
  reason: string;
  teams: { team: Team; name: string; score: number; rows: SummaryRow[]; mine: boolean }[] | null;
  rows: SummaryRow[];
  statKeys: string[];
  mvp: SummaryRow | null;
  me: SummaryRow | null;
  xp: XpLine[];
  xpTotal: number;
  rounds?: number;
}

const REASONS: Record<string, string> = { score: 'Score limit reached', time: 'Time limit reached', rounds: 'Round limit reached', forfeit: 'Forfeit', aborted: 'Match aborted' };

function fallbackXp(r: PlayerResult): XpLine[] {
  const lines: XpLine[] = [];
  if (r.kills) lines.push({ label: 'Kills', amount: r.kills * XP_SOURCES.kill });
  if (r.headshots) lines.push({ label: 'Headshots', amount: r.headshots * XP_SOURCES.headshot });
  if (r.assists) lines.push({ label: 'Assists', amount: r.assists * XP_SOURCES.assist });
  const t = Math.round(r.timePlayed * XP_SOURCES.matchPerSecond);
  if (t) lines.push({ label: 'Time played', amount: t });
  if (r.won) lines.push({ label: 'Victory', amount: XP_SOURCES.matchWin });
  return lines;
}

export function readSummaryExt(results: MatchResults): MatchSummaryExt | null {
  const e = results.ext.modes;
  if (!e || typeof e !== 'object' || !('players' in e)) return null;
  return e as MatchSummaryExt;
}

export function buildSummaryView(results: MatchResults, myId: string, myTeam: Team | null): SummaryView {
  const ext = readSummaryExt(results);
  const mvpId = ext?.mvp ?? null;
  const rows: SummaryRow[] = [...results.players]
    .sort((a, b) => a.place - b.place)
    .map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot, score: p.score, kills: p.kills, deaths: p.deaths, assists: p.assists, place: p.place, stats: ext?.players[p.id]?.stats ?? {}, mvp: p.id === mvpId, me: p.id === myId }));
  const present = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.stats)) if (k in STAT_COLUMNS) present.add(k);
  const statKeys = Object.keys(STAT_COLUMNS).filter((k) => present.has(k)).slice(0, 3);
  const meRes = results.players.find((p) => p.id === myId) ?? null;
  const me = rows.find((r) => r.me) ?? null;
  let title: SummaryView['title'] = 'MATCH OVER';
  if (meRes) title = results.winners.length === 0 ? 'DRAW' : results.winners.includes(myId) ? 'VICTORY' : 'DEFEAT';
  let teams: SummaryView['teams'] = null;
  if (results.teamScores) {
    const order: Team[] = myTeam === 1 ? [1, 0] : [0, 1];
    teams = order.map((t) => ({ team: t, name: TEAM_NAMES[t]!, score: results.teamScores![t], rows: rows.filter((r) => r.team === t), mine: t === myTeam }));
  }
  // The XP progression awarded wins: the modes summary is built at the same matchEnd priority and
  // may run first, so its own guess missed lines such as MATCH COMPLETE.
  const prog = meRes ? matchSummaryFor(results, myId) : null;
  const progXp = prog?.lines.filter((l) => l.xp > 0).map((l) => ({ label: l.count > 1 ? `${l.label} x${l.count}` : l.label, amount: l.xp }));
  const xp = progXp ?? ((meRes && ext?.players[myId]?.xp) || (meRes ? fallbackXp(meRes) : []));
  const view: SummaryView = {
    title,
    modeName: MODE_BY_ID.get(results.mode)?.name ?? results.mode.toUpperCase(),
    mapName: MAP_BY_ID.get(results.map)?.name ?? results.map,
    reason: REASONS[results.reason] ?? results.reason,
    teams,
    rows,
    statKeys,
    mvp: rows.find((r) => r.mvp) ?? null,
    me,
    xp,
    xpTotal: progXp ? prog!.total : xp.reduce((s, l) => s + l.amount, 0),
  };
  if (ext?.rounds !== undefined) view.rounds = ext.rounds;
  return view;
}

/** "1ST", "2ND"... */
export function ordinal(n: number): string {
  const j = n % 10;
  const k = n % 100;
  const s = j === 1 && k !== 11 ? 'ST' : j === 2 && k !== 12 ? 'ND' : j === 3 && k !== 13 ? 'RD' : 'TH';
  return `${n}${s}`;
}
