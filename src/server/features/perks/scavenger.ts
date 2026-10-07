/**
 * Scavenger: every death drops a resupply pack (`perks_pack` entity, rendered only for Scavenger
 * users). An enemy of the dead player with Scavenger who walks over it gets a magazine of reserve
 * back for each weapon; Pro also refills a lethal and a tactical (`perks.resupply` event for the
 * weapons area) and spawns with extra mags.
 */
import { KS_ENTITY } from '../../../shared/defs/killstreaks';
import { PERK_TUNING as T } from '../../../shared/defs/perks';
import type { Entity } from '../../entities';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { hasPerk, isPro, progress } from './common';

interface PackData {
  victim: string;
  expires: number;
}

const MAX_PACKS = 24;

/** Give a Scavenger pickup to `p` (exported for tests). */
export function resupply(room: Room, p: PlayerState): void {
  for (const w of p.weapons) {
    const cap = w.def.reserve + (isPro(p, 'scavenger') ? w.def.magazine * T.scavengerProMags : 0);
    w.reserve = Math.min(cap, w.reserve + w.def.magazine * T.scavengerMags);
  }
  if (isPro(p, 'scavenger')) room.bus.emit('perks.resupply', { player: p, lethal: 1, tactical: 1 });
  progress(room, p, 'scavenger_pro');
  room.sendFeature(p, 'perks.notice', { text: 'Resupplied' });
}

export function setupScavenger(room: Room): void {
  room.bus.on('spawn', ({ player }) => {
    if (!isPro(player, 'scavenger')) return;
    for (const w of player.weapons) w.reserve += w.def.magazine * T.scavengerProMags;
  });

  room.bus.on('death', ({ victim }) => {
    const packs = room.entities.byKind(KS_ENTITY.scavenger);
    if (packs.length >= MAX_PACKS) room.entities.remove(packs[0]!.id);
    const data: PackData = { victim: victim.id, expires: room.time + T.scavengerPackLife };
    room.entities.add({ kind: KS_ENTITY.scavenger, x: victim.move.x, y: victim.move.y + 0.15, z: victim.move.z, yaw: Math.random() * Math.PI * 2, team: victim.team, data });
  });

  room.bus.on('tick', ({ tick }) => {
    if (tick % 6 !== 0) return;
    const packs = room.entities.byKind(KS_ENTITY.scavenger);
    if (!packs.length) return;
    for (const e of packs) {
      const d = e.data as PackData;
      if (room.time >= d.expires) {
        room.entities.remove(e.id);
        continue;
      }
      const taker = findTaker(room, e, d);
      if (taker) {
        room.entities.remove(e.id);
        resupply(room, taker);
      }
    }
  });
}

function findTaker(room: Room, e: Entity, d: PackData): PlayerState | null {
  const victim = room.players.get(d.victim);
  for (const p of room.players.values()) {
    if (!p.alive || p.id === d.victim || !hasPerk(p, 'scavenger')) continue;
    const enemy = victim ? room.isEnemy(p, victim) : !room.mode.teams || p.team !== e.team;
    if (!enemy) continue;
    if (Math.hypot(p.move.x - e.x, p.move.z - e.z) <= T.scavengerRadius && Math.abs(p.move.y - e.y) < 1.6) return p;
  }
  return null;
}
