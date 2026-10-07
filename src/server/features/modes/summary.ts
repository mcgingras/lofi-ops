/**
 * End-of-match summary (`MatchResults.ext.modes`): MVP, per-player objective stats and an XP
 * breakdown. XP comes from the progression feature when it publishes one in
 * `results.ext.progression` (adapter below, shape-checked because that feature is built in
 * parallel); otherwise it is derived from this feature's per-reason score tallies plus the
 * match bonus from XP_SOURCES.
 */
import type { MatchResults, PlayerResult } from '../../../shared/events';
import type { MatchSummaryExt, PlayerSummary, XpLine } from '../../../shared/defs/modestate';
import { XP_SOURCES } from '../../../shared/defs/progression';
import type { Room } from '../../room';
import { controllerOf } from './common';

const LABELS: Record<string, string> = {
  kill: 'Kills',
  headshot: 'Headshots',
  assist: 'Assists',
  capture: 'Flag captures',
  neutralize: 'Flags neutralized',
  defend: 'Defends',
  plant: 'Bomb plants',
  defuse: 'Bomb defuses',
  hqCapture: 'HQ captures',
  hqDestroy: 'HQ destroyed',
  confirm: 'Kills confirmed',
  deny: 'Kills denied',
};
const ORDER = Object.keys(LABELS);

/** Pick the MVP: best score, then kills, then fewest deaths. Null when nobody scored. */
export function pickMvp(players: readonly PlayerResult[]): string | null {
  const sorted = [...players].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
  const top = sorted[0];
  return top && (top.score > 0 || top.kills > 0) ? top.id : null;
}

/** XP lines from the progression feature, if it published them (any of a few plausible shapes). */
export function progressionXp(results: MatchResults, r: PlayerResult): XpLine[] | null {
  const ext = results.ext.progression;
  if (!ext || typeof ext !== 'object') return null;
  const players = (ext as { players?: unknown }).players;
  if (!players || typeof players !== 'object') return null;
  const rec = (players as Record<string, unknown>)[r.id] ?? (r.profileId ? (players as Record<string, unknown>)[r.profileId] : undefined);
  if (!rec || typeof rec !== 'object') return null;
  const list = (rec as { breakdown?: unknown; xp?: unknown }).breakdown ?? (rec as { xp?: unknown }).xp;
  if (!Array.isArray(list)) return null;
  const out: XpLine[] = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const o = it as { label?: unknown; amount?: unknown; xp?: unknown; source?: unknown };
    const label = typeof o.label === 'string' ? o.label : typeof o.source === 'string' ? o.source : null;
    const amount = typeof o.amount === 'number' ? o.amount : typeof o.xp === 'number' ? o.xp : null;
    if (label !== null && amount !== null && Number.isFinite(amount)) out.push({ label, amount: Math.round(amount) });
  }
  return out.length ? out : null;
}

/** Derived XP: score tallies by reason, anything else other features scored, and the match bonus. */
export function derivedXp(r: PlayerResult, tally: Record<string, number> | undefined): XpLine[] {
  const lines: XpLine[] = [];
  let sum = 0;
  const keys = Object.keys(tally ?? {}).sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  for (const k of keys) {
    const v = Math.round(tally![k]!);
    if (v <= 0) continue;
    lines.push({ label: LABELS[k] ?? k, amount: v });
    sum += v;
  }
  if (!tally) {
    // No tallies (rules from another feature): rebuild from the scoreboard.
    const kills = r.kills * XP_SOURCES.kill + r.headshots * XP_SOURCES.headshot;
    const assists = r.assists * XP_SOURCES.assist;
    if (kills) lines.push({ label: 'Kills', amount: kills });
    if (assists) lines.push({ label: 'Assists', amount: assists });
    sum = kills + assists;
  }
  const other = Math.round(r.score - sum);
  if (other > 0) lines.push({ label: 'Other', amount: other });
  const time = Math.round(r.timePlayed * XP_SOURCES.matchPerSecond);
  if (time > 0) lines.push({ label: 'Time played', amount: time });
  if (r.won) lines.push({ label: 'Victory', amount: XP_SOURCES.matchWin });
  return lines;
}

export function buildSummary(room: Room, results: MatchResults): MatchSummaryExt {
  const c = controllerOf(room);
  const keys = c?.statKeys ?? [];
  const players: Record<string, PlayerSummary> = {};
  let fromProgression = false;
  for (const r of results.players) {
    const ext = room.players.get(r.id)?.ext.modes;
    const stats: Record<string, number> = {};
    for (const k of keys) stats[k] = ext?.stats[k] ?? 0;
    for (const [k, v] of Object.entries(ext?.stats ?? {})) stats[k] = v;
    const prog = progressionXp(results, r);
    if (prog) fromProgression = true;
    const xp = prog ?? derivedXp(r, ext?.xp);
    players[r.id] = { stats, xp, xpTotal: xp.reduce((s, l) => s + l.amount, 0) };
  }
  const out: MatchSummaryExt = { mvp: pickMvp(results.players), players, xpSource: fromProgression ? 'progression' : 'modes' };
  const rounds = (c as { roundsPlayed?: unknown } | null)?.roundsPlayed;
  if (typeof rounds === 'number') out.rounds = rounds;
  return out;
}
