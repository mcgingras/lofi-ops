/**
 * Store RPCs (buy, equip, per-weapon camo) and the spawn-time class check: humans only fight with
 * what they own and have unlocked. All validation is server side; the client only displays.
 */
import { CAMO_BY_ID } from '../../../shared/defs/camos';
import { isWagerMode } from '../../../shared/defs/economy';
import { canUse, EMBLEM_BACKGROUND_BY_ID, keyOf, LOCK_TEXT, purchase, RETICLE_BY_ID, enforceLoadout } from '../../../shared/defs/store';
import type { Profile } from '../../../shared/profile';
import type { ServerApi } from '../../feature';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { RpcError } from '../../rpc';
import { econ, recordPurchase, stateOf } from './ledger';

/** Integrators/tests can switch the spawn-time ownership check off (e.g. a sandbox playlist). */
export const economyConfig = { enforceOwnership: true };

export function registerShopRpcs(api: ServerApi): void {
  api.rpc.handle('economy.state', (ctx) => stateOf(ctx.session.profile));

  api.rpc.handle('economy.buy', (ctx, data) => {
    const item = (data as { item?: unknown } | null)?.item;
    if (typeof item !== 'string' || item.length > 96) throw new RpcError('bad_request', 'item required');
    const prof = ctx.session.profile;
    const res = purchase(prof, item);
    if (!res.ok) throw new RpcError(res.reason, LOCK_TEXT[res.reason]);
    recordPurchase(prof, res.item.price, res.item.name);
    api.store.save(prof);
    ctx.session.send({ t: 'profile', profile: prof });
    return { codPoints: prof.codPoints, owned: [...prof.owned], item: res.item.key };
  });

  api.rpc.handle('economy.equip', (ctx, data) => {
    const d = (data ?? {}) as { kind?: unknown; id?: unknown };
    if ((d.kind !== 'reticle' && d.kind !== 'emblem') || typeof d.id !== 'string') throw new RpcError('bad_request', 'kind and id required');
    const prof = ctx.session.profile;
    const key = d.kind === 'reticle' ? keyOf.reticle(d.id) : keyOf.emblem(d.id);
    const known = d.kind === 'reticle' ? RETICLE_BY_ID.has(d.id) : EMBLEM_BACKGROUND_BY_ID.has(d.id);
    if (!known) throw new RpcError('unknown', 'no such item');
    if (!canUse(prof, key)) throw new RpcError('locked', 'not owned');
    const e = econ(prof);
    e.equipped[d.kind] = d.id;
    api.store.save(prof);
    return { equipped: { ...e.equipped } };
  });

  api.rpc.handle('economy.setCamo', (ctx, data) => {
    const d = (data ?? {}) as { loadout?: unknown; slot?: unknown; camo?: unknown };
    const prof = ctx.session.profile;
    if (typeof d.loadout !== 'number' || !Number.isInteger(d.loadout) || d.loadout < 0 || d.loadout >= prof.loadouts.length) throw new RpcError('bad_request', 'loadout index');
    if (d.slot !== 'primary' && d.slot !== 'secondary') throw new RpcError('bad_request', 'slot');
    if (typeof d.camo !== 'string' || !CAMO_BY_ID.has(d.camo)) throw new RpcError('unknown', 'no such camo');
    if (!canUse(prof, keyOf.camo(d.camo))) throw new RpcError('locked', 'camo not owned');
    prof.loadouts[d.loadout]![d.slot].camo = d.camo;
    api.store.save(prof);
    return { loadouts: prof.loadouts };
  });
}

const noticed = new WeakMap<PlayerState, number>();

/** Per room: strip locked items from humans' classes at spawn (normal modes only). */
export function enforceClasses(room: Room): void {
  room.bus.on(
    'beforeSpawn',
    (ev) => {
      const p = ev.player;
      if (!economyConfig.enforceOwnership || p.isBot || !p.profile || isWagerMode(room.mode.id)) return;
      const { loadout, changed } = enforceLoadout(p.profile, ev.loadout);
      ev.loadout = loadout;
      if (changed.length && (noticed.get(p) ?? -1) < room.matchStartTime) {
        noticed.set(p, room.time);
        room.sendFeature(p, 'core.notice', { text: 'Locked items removed from your class (visit the Store)' });
      }
    },
    { priority: -50 },
  );
}

/** The profile's equipped reticle and emblem background. */
export function equippedOf(profile: Profile) {
  return { ...econ(profile).equipped };
}
