/**
 * Client state of the modes feature: the latest objective state (`modes.state`), announcer lines
 * worded for this player, score popups, the final killcam clip and the match results. Cleared on
 * every `joined` (new room or map). Read by the HUD widgets, props, killcam and summary screen.
 */
import type { KillcamPayload, ModeStatePayload } from '../../../shared/defs/modestate';
import type { MatchResults } from '../../../shared/events';
import { sfx } from '../../game/audio';
import { net } from '../../net';
import { onFeature } from '../../registry';
import { currentMatch } from '../../state';
import { eventLine, type AnnouncerLine } from './text';

export interface TimedLine extends AnnouncerLine {
  /** Local seconds (performance.now / 1000) it arrived. */
  at: number;
}

export const modes = {
  state: null as ModeStatePayload | null,
  banner: null as TimedLine | null,
  feed: [] as TimedLine[],
  popups: [] as { at: number; text: string }[],
  killcam: null as KillcamPayload | null,
  results: null as MatchResults | null,
  /** Killcam playback: local start time, or null when not playing / done. */
  killcamStart: null as number | null,
  killcamDone: false,
  summaryShown: false,
};

export const now = () => performance.now() / 1000;

export function resetModes(): void {
  modes.state = null;
  modes.banner = null;
  modes.feed = [];
  modes.popups = [];
  modes.killcam = null;
  modes.results = null;
  modes.killcamStart = null;
  modes.killcamDone = false;
  modes.summaryShown = false;
}

/** Progress of my current action, extrapolated from the last push (0..1), or null. */
export function myAction(): (NonNullable<ModeStatePayload['me']> & { shown: number }) | null {
  const st = modes.state;
  const m = currentMatch();
  if (!st?.me || !m) return null;
  const shown = Math.max(0, Math.min(1, st.me.progress + st.me.rate * Math.max(0, Math.min(0.5, m.serverTime - st.time))));
  return { ...st.me, shown };
}

net.on('joined', () => resetModes());
net.on('phase', (m) => {
  if (m.phase === 'playing' || m.phase === 'countdown' || m.phase === 'lobby') {
    modes.results = null;
    modes.killcam = null;
    modes.killcamStart = null;
    modes.killcamDone = false;
    modes.summaryShown = false;
  }
});
net.on('matchEnd', (m) => {
  modes.results = m.results;
});

onFeature('modes.state', (d) => {
  modes.state = d;
});

onFeature('modes.killcam', (d) => {
  modes.killcam = d;
  modes.killcamStart = null;
  modes.killcamDone = false;
  // The server holds the post-match for the killcam (BO1 plays it before the scoreboard).
  const m = currentMatch();
  if (m && d.endsAt !== null && m.phase === 'ended') m.phaseEndsAt = d.endsAt;
});

onFeature('modes.event', (ev) => {
  const m = currentMatch();
  if (!m) return;
  const line = eventLine(ev, { myTeam: m.myTeam, myId: m.myId, nameOf: (id) => m.nameOf(id) });
  if (!line) return;
  const t = now();
  const timed = { ...line, at: t };
  if (line.big) modes.banner = timed;
  else if (!line.points) {
    modes.feed.unshift(timed);
    if (modes.feed.length > 4) modes.feed.length = 4;
  }
  // Personal points pop up under the crosshair (small lines say what for).
  if (line.points) {
    modes.popups.push({ at: t, text: line.big ? `+${line.points}` : `${line.text} +${line.points}` });
    if (modes.popups.length > 3) modes.popups.shift();
  }
  if (line.sound) sfx.play(line.sound, { volume: 0.55 });
});
