/** The Glitch killstreak's client state (the `killstreaks.glitch` push), for glitch.ts and the radar. */
import type { Team } from '../../../shared/constants';
import { glitchHits, type GlitchStateMsg } from '../../../shared/defs/glitch';
import type { Match } from '../../game/match';
import { currentMatch } from '../../state';

export type RunningGlitch = GlitchStateMsg['active'][number];

export const glitchClient = {
  active: [] as RunningGlitch[],
  /** Banner: local time it went up, and which line (`mine`: the caller's side). */
  banner: null as { t: number; text: string; mine: boolean } | null,
  /** My current screen strength 0..1. */
  strength: 0,
};

/** Glitches running now that hit (`id`, `team`). */
export const hitting = (m: Match, id: string, team: Team | null): RunningGlitch[] => glitchClient.active.filter((g) => g.until > m.serverTime && glitchHits(g, id, team));

/** Am I glitched right now? */
export const iAmGlitched = (): boolean => {
  const m = currentMatch();
  return !!m && hitting(m, m.myId, m.myTeam).length > 0;
};
