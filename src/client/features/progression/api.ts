/**
 * Client-side progression state and the public API other areas use:
 *
 *   import { lastMatchSummary, onMatchSummary, progressionState } from '../progression/api';
 *   onMatchSummary((s) => renderXpBreakdown(s.lines, s.challenges));     // end-of-match screen
 *   const s = lastMatchSummary();                                           // or read it later
 *   // or straight from the results: matchSummaryFor(match.results, match.myId) (shared defs)
 *
 * It tracks live XP / level from `progression.xp` pushes (the profile copy only refreshes at match
 * end), queues HUD popups (level up, challenge complete, unlocks, locked items) and keeps the last
 * match summary.
 */
import '../../../shared/defs/progression-messages';
import { matchSummaryFor, type MatchXpSummary } from '../../../shared/defs/progression';
import type { LoadoutViolation, UnlockEntry } from '../../../shared/defs/unlocks';
import { net } from '../../net';
import { onFeature } from '../../registry';

export { matchSummaryFor };
export type { MatchXpSummary };

export type PopupKind = 'level' | 'challenge' | 'unlock' | 'locked';

export interface Popup {
  kind: PopupKind;
  title: string;
  /** Big line (level number, challenge name). */
  head: string;
  lines: string[];
  level?: number;
  prestige?: number;
  /** performance.now() seconds when it started showing (0 = queued). */
  shownAt: number;
  dur: number;
  queuedAt: number;
}

export interface Gain {
  label: string;
  xp: number;
  at: number;
}

const now = () => performance.now() / 1000;

class ProgressionState {
  xp = 0;
  level = 1;
  prestige = 0;
  lastSummary: MatchXpSummary | null = null;
  gains: Gain[] = [];
  popups: Popup[] = [];
  private summaryFns = new Set<(s: MatchXpSummary) => void>();
  private changeFns = new Set<() => void>();

  fromProfile(): void {
    const p = net.profile;
    if (!p) return;
    this.xp = p.xp;
    this.level = p.level;
    this.prestige = p.prestige;
    this.changed();
  }

  onSummary(fn: (s: MatchXpSummary) => void): () => void {
    this.summaryFns.add(fn);
    return () => this.summaryFns.delete(fn);
  }

  /** Any change to xp/level/prestige/summary. */
  onChange(fn: () => void): () => void {
    this.changeFns.add(fn);
    return () => this.changeFns.delete(fn);
  }

  changed(): void {
    for (const fn of this.changeFns) fn();
  }

  queue(p: Omit<Popup, 'shownAt' | 'queuedAt'>): void {
    // Keep the queue short: drop stale items so a burst of challenges doesn't play for a minute.
    const t = now();
    this.popups = this.popups.filter((x) => x.shownAt > 0 || t - x.queuedAt < 20);
    if (this.popups.length > 8) this.popups.splice(1, this.popups.length - 8);
    this.popups.push({ ...p, shownAt: 0, queuedAt: t });
  }

  /** The popup to draw now (advances the queue). */
  activePopup(): Popup | null {
    const t = now();
    while (this.popups.length) {
      const p = this.popups[0]!;
      if (p.shownAt === 0) {
        if (t - p.queuedAt > 20) {
          this.popups.shift();
          continue;
        }
        p.shownAt = t;
      }
      if (t - p.shownAt < p.dur) return p;
      this.popups.shift();
    }
    return null;
  }

  emitSummary(s: MatchXpSummary): void {
    this.lastSummary = s;
    for (const fn of this.summaryFns) {
      try {
        fn(s);
      } catch (err) {
        console.error('[progression] summary listener', err);
      }
    }
    this.changed();
  }
}

export const progressionState = new ProgressionState();

/** The last match's XP summary (this session, or the profile's stored one). */
export function lastMatchSummary(): MatchXpSummary | null {
  if (progressionState.lastSummary) return progressionState.lastSummary;
  const stored = (net.profile?.ext?.progression as { lastMatch?: MatchXpSummary } | undefined)?.lastMatch;
  return stored ?? null;
}

/** Called once per match end with this player's summary. Returns an unsubscribe. */
export const onMatchSummary = (fn: (s: MatchXpSummary) => void) => progressionState.onSummary(fn);

const unlockLine = (u: UnlockEntry) => `${u.name}${u.detail ? ` (${u.detail})` : ''}`;
const violationLine = (v: LoadoutViolation) => `${v.id.toUpperCase()}: ${v.reason}`;

net.on('welcome', () => progressionState.fromProfile());
net.on('profile', () => progressionState.fromProfile());

onFeature('progression.xp', (d) => {
  const t = now();
  for (const [label, xp] of d.gains) progressionState.gains.push({ label, xp, at: t });
  if (progressionState.gains.length > 24) progressionState.gains.splice(0, progressionState.gains.length - 24);
  progressionState.xp = d.xp;
  progressionState.level = d.level;
  progressionState.prestige = d.prestige;
  progressionState.changed();
});

onFeature('progression.levelUp', (d) => {
  progressionState.queue({ kind: 'level', title: 'PROMOTED', head: `LEVEL ${d.level}`, lines: [d.rank.toUpperCase(), ...d.unlocks.slice(0, 4).map((u) => `NEW: ${unlockLine(u)}`.toUpperCase())], level: d.level, prestige: d.prestige, dur: 4.5 });
});

onFeature('progression.challenge', (d) => {
  const reward = [`+${d.xp.toLocaleString('en-US')} XP`, d.codPoints > 0 ? `+${d.codPoints.toLocaleString('en-US')} CP` : ''].filter(Boolean).join('  ');
  progressionState.queue({ kind: 'challenge', title: 'CHALLENGE COMPLETE', head: d.name.toUpperCase(), lines: [reward], dur: 3 });
});

onFeature('progression.unlocked', (d) => {
  progressionState.queue({ kind: 'unlock', title: 'NEW UNLOCK', head: d.items[0] ? d.items[0].name.toUpperCase() : '', lines: d.items.slice(1, 4).map((u) => unlockLine(u).toUpperCase()), dur: 3 });
});

onFeature('progression.locked', (d) => {
  progressionState.queue({ kind: 'locked', title: 'LOCKED ITEMS REMOVED', head: 'CHECK YOUR CLASS', lines: d.violations.slice(0, 3).map((v) => violationLine(v).toUpperCase()), dur: 3.5 });
});

onFeature('progression.summary', (d) => progressionState.emitSummary(d));
