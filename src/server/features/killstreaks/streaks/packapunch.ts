/**
 * Pack-a-Punch (BO1 Zombies' upgrade machine as a self-use streak; rules and numbers in
 * shared/defs/pack-a-punch.ts).
 *
 * Calling it takes the gun in your hands (the primary when the underbarrel launcher is up) down
 * for `PACK_A_PUNCH.durationSec`: the weapon slot is locked (`slotLock`) and nothing fires. At
 * `applyAt`, out of view, the weapon instance is packed (`packWeaponState`: packed def, camo,
 * full magazine and reserve) and `killstreaks.packed` goes out; then the gun comes back up.
 * Dying (or leaving) before it lands gives the streak back. Already packed: refused, streak kept.
 *
 * Packed damage is one `damageDealt` modifier: damage credited to a weapon id the attacker carries
 * packed is multiplied by `papDamageMult` (hitscan, projectiles and wonder weapons alike; never
 * the attacker's own splash). Explosive rounds (Cobra, Mustang & Sally) burst where a packed
 * pistol's bullet stops (`fire` event).
 */
import { PACK_A_PUNCH, PAP_ID, isPackable, packWeaponState, papDamageMult, papExplosive, papName } from '../../../../shared/defs/pack-a-punch';
import type { Vec3 } from '../../../../shared/math';
import { forceSlot } from '../../../combat';
import type { PlayerState, WeaponState } from '../../../player';
import type { Room } from '../../../room';
import { grant } from '../state';
import type { Active, KsRoom } from '../world';
import type { CallArgs } from './types';

/** The underbarrel launcher's slot: packing with it up packs the gun it hangs under. */
const GL_SLOT = 2;

/** The gun `p` would pack: the one in their hands (the primary under a raised launcher). */
export function papTarget(p: PlayerState): WeaponState | null {
  return p.weapons[p.slot >= GL_SLOT ? 0 : p.slot] ?? null;
}

/** Why `p` can't Pack-a-Punch now, or null. */
export function papBlocker(ctx: KsRoom, p: PlayerState): string | null {
  const w = papTarget(p);
  if (!w || !isPackable(w.def.base.id)) return 'no_weapon';
  if (w.pap) return 'already_packed';
  if (ctx.activeOf(p, PAP_ID).length) return 'busy';
  return null;
}

/** Called through `callKillstreak(room, p, 'pack_a_punch')`. */
export function callPackAPunch(ctx: KsRoom, p: PlayerState, _args: CallArgs): string | null {
  const why = papBlocker(ctx, p);
  if (why) return why;
  const room = ctx.room;
  const w = papTarget(p)!;
  if (p.slot >= GL_SLOT) forceSlot(room, p, 0);
  const t0 = room.time;
  const end = t0 + PACK_A_PUNCH.durationSec;
  const hold = () => {
    p.reloadEnd = 0;
    p.swapEnd = Math.max(p.swapEnd, end);
    p.slotLock = { slot: p.slot, until: end };
  };
  hold();
  let applied = false;
  const act: Active = {
    streak: PAP_ID,
    owner: p,
    entities: [],
    update() {
      const here = room.players.get(p.id) === p;
      if (!applied) {
        // Died (or the gun left their hands somehow) before the upgrade landed: the streak comes back.
        if (!here || !p.alive || !p.weapons.includes(w)) {
          if (here) grant(room, p, PAP_ID);
          return false;
        }
        hold();
        if (room.time >= t0 + PACK_A_PUNCH.applyAt - 1e-6) {
          applied = true;
          packWeaponState(w);
          room.bus.emit('killstreaks.packed', { player: p, weapon: w.def.base.id, name: w.def.name });
          room.sendFeature(null, 'killstreaks.packed', { p: p.id, w: w.def.base.id, name: w.def.name });
        }
        return true;
      }
      if (here && p.alive && room.time < end) hold();
      return here && p.alive && room.time < end;
    },
  };
  ctx.add(act);
  room.sendFeature(null, 'killstreaks.pap', { p: p.id, w: w.def.base.id, name: papName(w.def.base.id), t0, dur: PACK_A_PUNCH.durationSec, at: PACK_A_PUNCH.applyAt });
  return null;
}

/** A packed weapon `p` carries with this id (damage is credited by weapon id). */
const packedCarried = (p: PlayerState, id: string): WeaponState | undefined => p.weapons.find((w) => w.pap && w.def.base.id === id);

/** Per room: the packed damage multiplier and explosive rounds. */
export function wirePackAPunch(room: Room): void {
  room.modifiers.add(
    'damageDealt',
    (attacker, info) => {
      if (info.victim === attacker || info.means === 'killstreak' || info.means === 'melee') return undefined;
      return packedCarried(attacker, info.weapon) ? papDamageMult(info.weapon) : undefined;
    },
    'killstreaks.pack_a_punch',
  );
  room.bus.on('fire', (e) => {
    const ex = papExplosive(e.weapon);
    if (!ex || !packedCarried(e.player, e.weapon)) return;
    const w = packedCarried(e.player, e.weapon)!;
    const range = w.def.range ?? 200;
    const len = Math.hypot(e.end.x - e.origin.x, e.end.y - e.origin.y, e.end.z - e.origin.z);
    // Only where the bullet stopped on something (not at the end of its range in the sky).
    if (len >= range - 0.5) return;
    const back = Math.min(0.15, len);
    const at: Vec3 = { x: e.end.x - e.dir.x * back, y: e.end.y - e.dir.y * back, z: e.end.z - e.dir.z * back };
    room.radiusDamage(at, ex.radius, ex.max, ex.min, { attacker: e.player, weapon: e.weapon, means: 'explosive' });
    room.sendFeature(null, 'killstreaks.fx', { kind: 'boom', x: Math.round(at.x * 100) / 100, y: Math.round(at.y * 100) / 100, z: Math.round(at.z * 100) / 100, r: ex.radius });
  });
}

declare module '../../../../shared/events' {
  interface RoomEvents<P> {
    /** `player`'s gun was Pack-a-Punched (`name`: its upgraded name). */
    'killstreaks.packed': { player: P; weapon: string; name: string };
  }
}
