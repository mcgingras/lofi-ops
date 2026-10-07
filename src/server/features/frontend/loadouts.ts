/**
 * Create-a-class on the server (owner: frontend): `frontend.saveLoadout` validates an untrusted
 * class against the caller's unlocks (shared/frontend/loadout-rules.ts) and saves the profile;
 * `frontend.selectClass` picks the class for the next spawn. `trimSpawnLoadout` is the
 * beforeSpawn safety net (attachment slots / one perk per tier).
 */
import { attachmentSlotsFor, classSlotsFor, sortKillstreaks, validateLoadout } from '../../../shared/frontend/loadout-rules';
import { PERK_BY_ID } from '../../../shared/defs/perks';
import { cloneLoadout, DEFAULT_LOADOUTS, type Loadout } from '../../../shared/loadout';
import type { ServerApi } from '../../feature';
import { RpcError } from '../../rpc';

export function registerLoadoutRpcs(api: ServerApi): void {
  api.rpc.handle('frontend.saveLoadout', (ctx, data) => {
    const d = (data && typeof data === 'object' ? data : {}) as { index?: unknown; loadout?: unknown };
    const prof = ctx.session.profile;
    const index = d.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > prof.loadouts.length || index >= classSlotsFor(prof)) {
      throw new RpcError('bad_index', `class slot must be 0..${Math.min(prof.loadouts.length, classSlotsFor(prof) - 1)}`);
    }
    const fallback = DEFAULT_LOADOUTS[0]!;
    const { loadout, problems } = validateLoadout(prof, d.loadout, fallback);
    if (index === prof.loadouts.length) prof.loadouts.push(loadout);
    else prof.loadouts[index] = loadout;
    api.store.save(prof);
    return { index, loadout: cloneLoadout(loadout), loadouts: prof.loadouts.map(cloneLoadout), problems };
  });

  api.rpc.handle('frontend.selectClass', (ctx, data) => {
    const index = (data && typeof data === 'object' ? (data as { index?: unknown }).index : undefined) as unknown;
    const prof = ctx.session.profile;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= prof.loadouts.length) throw new RpcError('bad_index', 'no such class');
    prof.selectedLoadout = index;
    api.store.save(prof);
    return { selectedLoadout: index };
  });
}

/** In place: one perk per tier (tier order), killstreaks sorted (max 3), attachments capped by slots. */
export function trimSpawnLoadout(l: Loadout): void {
  const tiers = new Set<number>();
  l.perks = l.perks.filter((id) => {
    const t = PERK_BY_ID.get(id)?.tier;
    if (t === undefined || tiers.has(t)) return false;
    tiers.add(t);
    return true;
  });
  l.perks.sort((a, b) => PERK_BY_ID.get(a)!.tier - PERK_BY_ID.get(b)!.tier);
  l.killstreaks = sortKillstreaks(l.killstreaks).slice(0, 3);
  l.primary.attachments = l.primary.attachments.slice(0, attachmentSlotsFor(l.perks));
  l.secondary.attachments = l.secondary.attachments.slice(0, 1);
}
