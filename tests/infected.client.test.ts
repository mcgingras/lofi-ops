/** Infected on the client (pure pieces): announcer wording and the summary's team names. */
import { describe, expect, it } from 'vitest';
import { buildSummaryView } from '../src/client/features/modes/summary-data';
import { eventLine } from '../src/client/features/modes/text';
import type { MatchResults } from '../src/shared/events';

const ctx = (myTeam: 0 | 1 | null, myId = 'me') => ({ myTeam, myId, nameOf: (id: string | null) => (id === 'p2' ? 'Mason' : (id ?? '')) });

describe('Infected announcer lines', () => {
  it('FIRST INFECTED to them, a warning to everyone else', () => {
    expect(eventLine({ kind: 'infected.first', team: 1, player: 'me', reason: 'start' }, ctx(1))).toMatchObject({ text: 'FIRST INFECTED', big: true });
    expect(eventLine({ kind: 'infected.first', team: 1, player: 'p2', reason: 'start' }, ctx(0))).toMatchObject({ text: 'MASON IS INFECTED', sub: 'SURVIVE', big: true });
  });

  it('YOU ARE INFECTED to the victim; the infector gets the points', () => {
    expect(eventLine({ kind: 'infected.infect', team: 1, player: 'p2', reason: 'me', points: 100 }, ctx(1))).toMatchObject({ text: 'YOU ARE INFECTED', big: true, sound: 'modes.bad' });
    expect(eventLine({ kind: 'infected.infect', team: 1, player: 'me', reason: 'p2', points: 100 }, ctx(1))).toMatchObject({ text: 'INFECTED MASON', points: 100, big: false });
    expect(eventLine({ kind: 'infected.infect', team: 1, player: null, reason: 'p2' }, ctx(0))).toMatchObject({ text: 'MASON WAS INFECTED', color: 'enemy' });
  });

  it('LAST ONE STANDING, survival points, the final stand', () => {
    expect(eventLine({ kind: 'infected.last_alive', team: 0, player: 'me', points: 100 }, ctx(0))).toMatchObject({ text: 'LAST ONE STANDING', big: true, points: 100 });
    expect(eventLine({ kind: 'infected.last_alive', team: 0, player: 'p2' }, ctx(1))).toMatchObject({ text: 'ONE SURVIVOR LEFT', sub: 'FIND MASON' });
    expect(eventLine({ kind: 'infected.survive', team: 0, player: 'me', points: 50 }, ctx(0))).toMatchObject({ text: 'SURVIVOR', points: 50 });
    expect(eventLine({ kind: 'infected.final_stand', team: 0, player: 'me', points: 500 }, ctx(0))).toMatchObject({ text: 'FINAL STAND', big: true });
    expect(eventLine({ kind: 'infected.countdown', team: null, player: null, reason: 'repick', points: 4 }, ctx(0))).toMatchObject({ text: 'ALL INFECTED LEFT', sub: 'NEW FIRST INFECTED IN 4' });
  });

  it('the summary names the sides Survivors and Infected', () => {
    const results = { roomId: 'r', mode: 'infected', map: 'yard', reason: 'time', winnerTeam: 0, winners: ['me'], teamScores: [1, 5], players: [{ id: 'me', profileId: null, name: 'Me', team: 0, bot: false, kills: 3, deaths: 0, assists: 0, headshots: 0, score: 900, bestStreak: 3, place: 1, won: true, timePlayed: 600 }], durationSec: 600, ext: {} } as MatchResults;
    const view = buildSummaryView(results, 'me', 0);
    expect(view.title).toBe('VICTORY');
    expect(view.teams?.map((t) => t.name)).toEqual(['Survivors', 'Infected']);
    expect(view.reason).toBe('The survivors outlasted the infection');
  });
});
