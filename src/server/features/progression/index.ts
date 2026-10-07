/**
 * Server side of the 'progression' feature: XP, levels 1-50, prestige 1-15, unlock gating at spawn,
 * challenges and the combat record. See docs/features/progression.md.
 *
 *   setup(api): RPCs progression.prestige / setEmblem / checkLoadout / lastMatch
 *   room(room): per-room tracker (tracker.ts)
 */
import { readProgressionExt, progressionExt } from '../../../shared/defs/progression';
import { gateLoadout, isUnlocked } from '../../../shared/defs/unlocks';
import { sanitizeLoadout } from '../../../shared/loadout';
import type { Feature } from '../../feature';
import { RpcError } from '../../rpc';
import { enterPrestige, prestigeBlockedReason } from './rules';
import { attachProgression } from './tracker';

const feature: Feature = {
  id: 'progression',
  setup(api) {
    api.rpc.handle('progression.prestige', (ctx) => {
      const prof = ctx.session.profile;
      if (ctx.room && (ctx.room.phase === 'playing' || ctx.room.phase === 'countdown')) throw new RpcError('in_match', 'Leave the match to enter prestige');
      const blocked = prestigeBlockedReason(prof);
      if (blocked) throw new RpcError('not_eligible', blocked);
      const res = enterPrestige(prof);
      if (!res.ok) throw new RpcError('not_eligible', res.reason);
      api.store.save(prof);
      for (const s of api.sessions()) if (s.profile === prof) s.send({ t: 'profile', profile: prof });
      ctx.room?.broadcastRoster();
      api.log(`[progression] ${prof.name} entered prestige ${res.prestige}`);
      return prof;
    });

    api.rpc.handle('progression.setEmblem', (ctx, data) => {
      const emblem = (data as { emblem?: unknown } | null)?.emblem;
      const prof = ctx.session.profile;
      if (emblem !== null && (typeof emblem !== 'string' || emblem.length > 32)) throw new RpcError('bad_request', 'emblem must be an id or null');
      if (emblem !== null && !isUnlocked(prof, 'emblem', emblem)) throw new RpcError('locked', 'emblem not earned');
      const ext = progressionExt(prof);
      if (emblem === null) delete ext.emblem;
      else ext.emblem = emblem;
      api.store.save(prof);
      return { emblem: ext.emblem ?? null };
    });

    api.rpc.handle('progression.checkLoadout', (ctx, data) => {
      const raw = (data as { loadout?: unknown } | null)?.loadout;
      if (!raw || typeof raw !== 'object') throw new RpcError('bad_request', 'loadout required');
      return gateLoadout(ctx.session.profile, sanitizeLoadout(raw));
    });

    api.rpc.handle('progression.lastMatch', (ctx) => readProgressionExt(ctx.session.profile).lastMatch ?? null);
  },
  room(room) {
    attachProgression(room);
  },
};

export default feature;
