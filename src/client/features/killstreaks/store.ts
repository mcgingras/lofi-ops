/** Client-side killstreak state: the pushed ladder, crate prompt, and HUD announcements. */
import { KILLSTREAK_BY_ID } from '../../../shared/defs/killstreaks';
import type { KillstreakStateMsg } from '../../../shared/defs/perks-streaks-protocol';
import { net } from '../../net';
import { onFeature } from '../../registry';
import { currentMatch } from '../../state';
import { sfx } from '../../game/audio';

export interface Announcement {
  t: number;
  text: string;
  color: 'friend' | 'enemy' | 'hi';
}

export const ksClient = {
  state: null as KillstreakStateMsg | null,
  crate: null as { entity: number; contents: string; progress: number; at: number } | null,
  announcements: [] as Announcement[],
  /** Local time the last streak was earned (ready flash). */
  earnedAt: -99,
  earned: '',
};

export const streakName = (id: string) => (id === 'ammo' ? 'Ammo' : (KILLSTREAK_BY_ID.get(id)?.name ?? id));

const now = () => currentMatch()?.time ?? performance.now() / 1000;

export function announce(text: string, color: Announcement['color']): void {
  ksClient.announcements.push({ t: now(), text, color });
  if (ksClient.announcements.length > 3) ksClient.announcements.shift();
}

/** Is a streak owner on my side? */
export function friendly(owner: string, team: number | null): boolean {
  const m = currentMatch();
  if (!m) return false;
  if (owner === m.myId) return true;
  if (team === null || m.myTeam === null) return false;
  return team === m.myTeam;
}

onFeature('killstreaks.state', (d) => {
  ksClient.state = d;
});

onFeature('killstreaks.earned', (d) => {
  ksClient.earnedAt = now();
  ksClient.earned = d.id;
  announce(`${streakName(d.id)} ready`, 'hi');
  sfx.play('ks_ready', { volume: 0.6 });
});

onFeature('killstreaks.called', (d) => {
  const mine = d.owner === currentMatch()?.myId;
  const f = friendly(d.owner, d.team);
  const name = streakName(d.id);
  const text = mine ? `${name} called in` : f ? `Friendly ${name} inbound` : `Enemy ${name} inbound`;
  announce(text, f ? 'friend' : 'enemy');
  sfx.play(f ? 'ks_call' : 'ks_alarm', { volume: 0.5 });
});

onFeature('killstreaks.ended', (d) => {
  if (!d.destroyed) return;
  const f = friendly(d.owner, d.team);
  announce(`${f ? 'Friendly' : 'Enemy'} ${streakName(d.id)} destroyed`, f ? 'enemy' : 'friend');
});

onFeature('killstreaks.crate', (d) => {
  ksClient.crate = d ? { ...d, at: now() } : null;
});

/** Ask for the full ladder (after joining a room). */
export async function refreshState(): Promise<void> {
  try {
    ksClient.state = await net.rpc('killstreaks.state', {});
  } catch {
    /* not in a match */
  }
}

export function resetClient(): void {
  ksClient.state = null;
  ksClient.crate = null;
  ksClient.announcements = [];
}
