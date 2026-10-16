/**
 * Client-side pure pieces of the modes feature: announcer wording (team-relative), the summary
 * view model (MVP, team tables, stat columns, XP fallback) and the killcam timeline/interpolation.
 */
import { describe, expect, it } from 'vitest';
import { posesAt } from '../src/client/features/modes/killcam-math';
import { buildSummaryView, ordinal } from '../src/client/features/modes/summary-data';
import { eventLine } from '../src/client/features/modes/text';
import type { KillcamFrame, MatchSummaryExt } from '../src/shared/defs/modestate';
import type { MatchResults, PlayerResult } from '../src/shared/events';

const ctx = (myTeam: 0 | 1 | null, myId = 'me') => ({ myTeam, myId, nameOf: (id: string | null) => (id === 'p2' ? 'Mason' : (id ?? '')) });

describe('announcer lines', () => {
  it('words captures for each side', () => {
    expect(eventLine({ kind: 'dom.capture', team: 0, player: 'me', obj: 'B' }, ctx(0))).toMatchObject({ text: 'B CAPTURED', color: 'friend', big: true, points: 200 });
    expect(eventLine({ kind: 'dom.capture', team: 0, player: 'p2', obj: 'B' }, ctx(1))).toMatchObject({ text: 'ENEMY CAPTURED B', color: 'enemy' });
    expect(eventLine({ kind: 'dom.defend', team: 0, player: 'p2', obj: 'A' }, ctx(0))).toBeNull();
  });

  it('S&D: round start tells attackers who carries; round end reasons', () => {
    expect(eventLine({ kind: 'sd.round_start', team: 0, player: 'p2', points: 3 }, ctx(0))).toMatchObject({ text: 'ROUND 3 · ATTACK', sub: 'MASON HAS THE BOMB' });
    expect(eventLine({ kind: 'sd.round_start', team: 0, player: null, points: 3 }, ctx(1))).toMatchObject({ text: 'ROUND 3 · DEFEND', sub: 'DEFEND BOTH SITES' });
    expect(eventLine({ kind: 'sd.round_end', team: 1, player: null, reason: 'defused' }, ctx(1))).toMatchObject({ text: 'ROUND WON', sub: 'BOMB DEFUSED' });
    expect(eventLine({ kind: 'sd.round_end', team: 1, player: null, reason: 'eliminated' }, ctx(0))).toMatchObject({ text: 'ROUND LOST', sub: 'YOUR TEAM WAS ELIMINATED' });
    expect(eventLine({ kind: 'sd.plant', team: 0, player: 'p2', obj: 'A' }, ctx(1))).toMatchObject({ sub: 'SITE A · DEFUSE IT', sound: 'modes.alarm' });
  });

  it('KC confirms are personal', () => {
    expect(eventLine({ kind: 'kc.confirm', team: 0, player: 'me', points: 150 }, ctx(0))).toMatchObject({ text: 'KILL CONFIRMED', points: 150, big: false });
    expect(eventLine({ kind: 'kc.confirm', team: 0, player: 'p2', points: 150 }, ctx(0))).toBeNull();
  });
});

const pr = (o: Partial<PlayerResult> & { id: string }): PlayerResult => ({ profileId: null, name: o.id, team: 0, bot: false, kills: 0, deaths: 0, assists: 0, headshots: 0, score: 0, bestStreak: 0, place: 1, won: false, timePlayed: 60, ...o });

describe('summary view', () => {
  const players = [pr({ id: 'me', team: 1, kills: 5, score: 900, place: 2, won: true }), pr({ id: 'p2', team: 0, kills: 9, score: 1200, place: 1 }), pr({ id: 'b1', team: 1, bot: true, place: 3, won: true })];
  const ext: MatchSummaryExt = {
    mvp: 'p2',
    xpSource: 'modes',
    players: { me: { stats: { captures: 2, defends: 1 }, xp: [{ label: 'Kills', amount: 500 }, { label: 'Victory', amount: 500 }], xpTotal: 1000 }, p2: { stats: { captures: 0, defends: 3 }, xp: [], xpTotal: 0 }, b1: { stats: {}, xp: [], xpTotal: 0 } },
  };
  const results: MatchResults = { roomId: 'r', mode: 'dom', map: 'yard', reason: 'score', winnerTeam: 1, winners: ['me', 'b1'], teamScores: [150, 200], players, durationSec: 300, ext: { modes: ext } };

  it('builds team tables (mine first), MVP, stat columns and my XP', () => {
    const v = buildSummaryView(results, 'me', 1);
    expect(v.title).toBe('VICTORY');
    expect(v.modeName).toBe('Domination');
    expect(v.teams!.map((t) => [t.team, t.score, t.mine])).toEqual([[1, 200, true], [0, 150, false]]);
    expect(v.teams![0]!.rows.map((r) => r.id)).toEqual(['me', 'b1']);
    expect(v.mvp?.id).toBe('p2');
    expect(v.statKeys).toEqual(['captures', 'defends']);
    expect(v.xpTotal).toBe(1000);
  });

  it('uses the XP progression actually awarded when it is in the results', () => {
    const progression = { me: { playerId: 'me', profileId: 'x', mode: 'dom', total: 776, xpBefore: 0, xpAfter: 776, levelBefore: 1, levelAfter: 1, prestige: 0, lines: [{ key: 'kill', label: 'KILL', count: 5, xp: 500 }, { key: 'complete', label: 'MATCH COMPLETE', count: 1, xp: 100 }, { key: 'time', label: 'TIME PLAYED', count: 1, xp: 76 }, { key: 'zero', label: 'NOTHING', count: 1, xp: 0 }], challenges: [], unlocked: [], codPoints: 0 } };
    const v = buildSummaryView({ ...results, ext: { modes: ext, progression } }, 'me', 1);
    expect(v.xp).toEqual([{ label: 'KILL x5', amount: 500 }, { label: 'MATCH COMPLETE', amount: 100 }, { label: 'TIME PLAYED', amount: 76 }]);
    expect(v.xpTotal).toBe(776);
  });

  it('falls back to the scoreboard without the modes summary; FFA has one table', () => {
    const ffa: MatchResults = { ...results, mode: 'ffa', teamScores: null, winnerTeam: null, winners: ['p2'], ext: {} };
    const v = buildSummaryView(ffa, 'me', null);
    expect(v.title).toBe('DEFEAT');
    expect(v.teams).toBeNull();
    expect(v.rows.map((r) => r.id)).toEqual(['p2', 'me', 'b1']);
    expect(v.mvp).toBeNull();
    expect(v.xp).toEqual([{ label: 'Kills', amount: 500 }, { label: 'Time played', amount: 60 }, { label: 'Victory', amount: 500 }]);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1ST', '2ND', '3RD', '4TH', '11TH', '12TH', '13TH', '21ST', '22ND']);
  });
});

describe('killcam interpolation', () => {
  it('interpolates poses between frames (yaw the short way round), holding the last frame past the end', () => {
    const frames: KillcamFrame[] = [
      { t: 10, p: [['a', 0, 0, 0, 3.0, 0, 1]] },
      { t: 10.05, p: [['a', 1, 0, 2, -3.0, 0.2, 3]] },
    ];
    const mid = posesAt(frames, 10.025).get('a')!;
    expect(mid.x).toBeCloseTo(0.5, 5);
    expect(mid.z).toBeCloseTo(1, 5);
    expect(Math.abs(mid.yaw)).toBeGreaterThan(3); // through PI, not through 0
    expect(posesAt(frames, 11).get('a')!.f).toBe(3);
    expect(posesAt(frames, 11).get('a')!.x).toBeCloseTo(1, 5);
  });
});
