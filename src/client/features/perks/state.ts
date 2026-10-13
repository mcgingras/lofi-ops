/** What the local player has this life (from `spawned`), their Pro perks, and the public perk lists. */
import type { Loadout } from '../../../shared/loadout';
import { net } from '../../net';
import { onFeature } from '../../registry';

export const perkState = {
  loadout: null as Loadout | null,
  spawnedAt: 0,
  pro: new Set<string>(),
  ninja: new Set<string>(),
  ghostPro: new Set<string>(),
  lastStandUntil: null as number | null,
  revive: 0,
  /** Revived: the slot the server put back in your hands, for the match hook to follow (then null). */
  reviveSlot: null as number | null,
};

export const myPerks = (): string[] => perkState.loadout?.perks ?? [];
export const iHave = (id: string): boolean => myPerks().includes(id);
export const iHavePro = (id: string): boolean => iHave(id) && perkState.pro.has(id);

net.on('spawned', (m) => {
  perkState.loadout = m.loadout;
  perkState.spawnedAt = performance.now() / 1000;
  perkState.lastStandUntil = null;
  perkState.reviveSlot = null;
});

onFeature('perks.public', (d) => {
  perkState.ninja = new Set(d.ninja);
  perkState.ghostPro = new Set(d.ghostPro);
});

onFeature('perks.lastStand', (d) => {
  perkState.lastStandUntil = d.until;
  perkState.revive = d.revive;
  if (d.until === null && typeof d.slot === 'number') perkState.reviveSlot = d.slot;
});

/** Ask the server which perks the profile has Pro for (on match start and after match end). */
export async function refreshPro(): Promise<void> {
  try {
    const res = await net.rpc('perks.pro', {});
    perkState.pro = new Set(res.pro);
  } catch {
    /* offline / old server */
  }
}
