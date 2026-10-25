/** Client-side killstreak state: the pushed ladder, crate prompt, and HUD announcements. */
import { KILLSTREAK_BY_ID } from '../../../shared/defs/killstreaks';
import { VALKYRIE_LAUNCHER } from '../../../shared/defs/valkyrie';
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

export const streakName = (id: string) => (id === 'ammo' ? 'Ammo' : id === VALKYRIE_LAUNCHER ? 'Valkyrie Launcher' : (KILLSTREAK_BY_ID.get(id)?.name ?? id));

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
  if (d.id === 'glitch') return; // glitch.ts announces it (by side) when the glitch state arrives
  if (d.id === 'pack_a_punch') return; // packapunch.ts announces it when the upgrade lands, with the gun's new name
  const mine = d.owner === currentMatch()?.myId;
  const f = friendly(d.owner, d.team);
  const name = streakName(d.id);
  const text = mine ? `${name} called in` : f ? `Friendly ${name} inbound` : `Enemy ${name} inbound`;
  announce(text, f ? 'friend' : 'enemy');
  sfx.play(f ? 'ks_call' : 'ks_alarm', { volume: 0.5 });
});

onFeature('killstreaks.ended', (d) => {
  // Destroyed by someone: `killstreaks.shotDown` (below) says it, with who did it.
  if (!d.destroyed || d.by) return;
  const f = friendly(d.owner, d.team);
  announce(`${f ? 'Friendly' : 'Enemy'} ${streakName(d.id)} destroyed`, f ? 'enemy' : 'friend');
});

// Hardware shot down (BO1 "Spy Plane destroyed +100"): the destroyer gets the line and the points
// (progression also pops the XP), the owner hears who did it, everyone else friendly / enemy.
onFeature('killstreaks.shotDown', (d) => {
  const m = currentMatch();
  if (!m) return;
  if (d.by === m.myId) {
    announce(`${d.name} destroyed${d.xp > 0 ? ` +${d.xp}` : ''}`, 'hi');
    sfx.play('ks_confirm', { volume: 0.5 });
  } else if (d.owner === m.myId) announce(`Your ${d.name} was shot down by ${m.nameOf(d.by)}`, 'enemy');
  else {
    const f = d.owner ? friendly(d.owner, d.team) : false;
    announce(`${f ? 'Friendly' : 'Enemy'} ${d.name} destroyed`, f ? 'enemy' : 'friend');
  }
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
