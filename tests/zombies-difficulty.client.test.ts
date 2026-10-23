/**
 * The Zombies difficulty on the client: remembered per browser, sent with Solo and the co-op lobby,
 * and the labels the scoreboard, game-over card and results show.
 */
import { describe, expect, it } from 'vitest';
import { bleedOutSecFor, coopRequest, DIFFICULTY_KEY, difficultyLabel, resultsSubtitle, saveDifficulty, savedDifficulty, soloRequest } from '../src/client/features/zombies/difficulty';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('Zombies difficulty (client)', () => {
  it('defaults to Casual and remembers the choice', () => {
    const s = memory();
    expect(savedDifficulty(s)).toBe('casual');
    saveDifficulty('classic', s);
    expect(s.m.get(DIFFICULTY_KEY)).toBe('classic');
    expect(savedDifficulty(s)).toBe('classic');
    saveDifficulty('casual', s);
    expect(savedDifficulty(s)).toBe('casual');
    // Junk, no storage, a throwing storage: Casual.
    s.m.set(DIFFICULTY_KEY, 'insane');
    expect(savedDifficulty(s)).toBe('casual');
    expect(savedDifficulty(null)).toBe('casual');
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(savedDifficulty(broken)).toBe('casual');
    expect(() => saveDifficulty('classic', broken)).not.toThrow();
  });

  it('Solo and Co-op lobby send it to the server', () => {
    expect(soloRequest('nacht', { count: 1, difficulty: 'veteran' }, 'classic')).toEqual({ map: 'nacht', allies: 1, allyDifficulty: 'veteran', difficulty: 'classic' });
    expect(coopRequest('yard', 'casual')).toEqual({ map: 'yard', difficulty: 'casual' });
  });

  it('labels: CASUAL / CLASSIC on the HUD and the results', () => {
    expect(difficultyLabel('casual')).toBe('CASUAL');
    expect(difficultyLabel('classic')).toBe('CLASSIC');
    expect(difficultyLabel(undefined)).toBe('');
    expect(resultsSubtitle('Nuketown', 'casual')).toBe('Nuketown · Zombies · CASUAL');
    expect(resultsSubtitle('Yard', 'classic')).toBe('Yard · Zombies · CLASSIC');
    expect(resultsSubtitle('Yard', undefined)).toBe('Yard · Zombies');
    expect(bleedOutSecFor('casual')).toBe(45);
    expect(bleedOutSecFor('classic')).toBe(30);
  });
});
