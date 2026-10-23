/**
 * Pack-a-Punch (BO1 Zombies' upgrade machine as a timed, self-use buff; rules and numbers in
 * shared/defs/pack-a-punch.ts).
 *
 * Calling it takes the gun in your hands down for `PACK_A_PUNCH.durationSec`: the weapon slot is
 * locked (`slotLock`) and nothing fires. At `applyAt`, out of view, the buff starts (or restarts):
 * `KillstreakExt.papUntil` = now + `buffSec`, every carried gun is packed and filled to its packed
 * magazine and reserve, and `killstreaks.packed` goes out; then the gun comes back up. Dying (or
 * leaving) before it lands gives the streak back.
 *
 * While the buff runs (through death and respawn too) every tick packs any carried gun that isn't
 * yet: the respawn loadout (also packed at `spawn`), a pickup, a Mystery Box weapon. Each is filled
 * when it gets packed. When it runs out (or for anyone carrying a packed gun without the buff)
 * every gun reverts with its ammo clamped (`unpackWeaponState`) and the owner gets
 * `killstreaks.papEnd`. Dropped guns are never packed (pickups' `spawnDrop` drops the plain gun).
 *
 * Packed damage is one `damageDealt` modifier: damage credited to a weapon id the attacker carries
 * packed is multiplied by `papDamageMult` (hitscan, projectiles and wonder weapons alike; never
 * the attacker's own splash, never effect damage). Explosive rounds (Cobra, Mustang & Sally) burst
 * where a packed pistol's bullet stops (`fire` event); every other signature effect (burn, pierce,
 * ricochet, zap, frost, the underbarrel extras...) is in packapunch-effects.ts.
 */
import { PACK_A_PUNCH, PAP_ID, isPackable, packWeaponState, papDamageMult, papExplosive, papName, refillPacked, unpackWeaponState } from '../../../../shared/defs/pack-a-punch';
import type { Vec3 } from '../../../../shared/math';
import { forceSlot } from '../../../combat';
import type { PlayerState, WeaponState } from '../../../player';
import type { Room } from '../../../room';
import { grant, ksOf, markDirty } from '../state';
import type { Active, KsRoom } from '../world';
import { dropPapExtras, inPapFx, syncPapExtras, wirePapEffects } from './packapunch-effects';
import type { CallArgs } from './types';

/** The underbarrel launcher's slot: never packed; packing with it up packs the gun it hangs under. */
const GL_SLOT = 2;

/** The guns a buff packs: the two carried weapons (never the underbarrel launcher). */
const carried = (p: PlayerState): WeaponState[] => p.weapons.slice(0, GL_SLOT);

/** The gun in `p`'s hands (the primary under a raised launcher). */
export function papTarget(p: PlayerState): WeaponState | null {
  return p.weapons[p.slot >= GL_SLOT ? 0 : p.slot] ?? null;
}

/** Is `p`'s Pack-a-Punch buff running? */
export const papActive = (room: Room, p: PlayerState): boolean => (p.ext.killstreaks?.papUntil ?? -Infinity) > room.time;

/** Seconds of buff left (0 when none). */
export const papLeft = (room: Room, p: PlayerState): number => Math.max(0, (p.ext.killstreaks?.papUntil ?? 0) - room.time);

/** Why `p` can't Pack-a-Punch now, or null (re-using it while buffed is fine: it resets the clock). */
export function papBlocker(ctx: KsRoom, p: PlayerState): string | null {
  if (ctx.activeOf(p, PAP_ID).length) return 'busy';
  return null;
}

/** Pack every carried gun that isn't yet (each is filled as it gets packed), with its underbarrel extra. Returns how many. */
function packCarried(room: Room, p: PlayerState): number {
  let n = 0;
  for (const w of carried(p)) if (packWeaponState(w)) n++;
  syncPapExtras(room, p);
  return n;
}

/** Revert every packed gun `p` carries (ammo clamped) and take back the underbarrel extras. Returns how many. */
function unpackCarried(room: Room, p: PlayerState): number {
  let n = 0;
  for (const w of p.weapons) if (unpackWeaponState(w)) n++;
  dropPapExtras(room, p);
  return n;
}

/** Start (or restart) the buff now: the full time, every carried gun packed and filled. */
export function startPapBuff(room: Room, p: PlayerState): void {
  const ks = ksOf(p);
  ks.papUntil = room.time + PACK_A_PUNCH.buffSec;
  for (const w of carried(p)) if (!packWeaponState(w)) refillPacked(w);
  syncPapExtras(room, p);
  markDirty(room, p);
  const held = papTarget(p);
  const id = held && isPackable(held.def.base.id) ? held.def.base.id : (carried(p).find((w) => w.pap)?.def.base.id ?? '');
  const name = id ? papName(id) : 'Pack-a-Punch';
  room.bus.emit('killstreaks.packed', { player: p, weapon: id, name, until: ks.papUntil });
  room.sendFeature(null, 'killstreaks.packed', { p: p.id, w: id, name, until: Math.round(ks.papUntil * 1000) / 1000 });
}

/** End the buff now (time up): guns revert, the owner hears it. */
export function endPapBuff(room: Room, p: PlayerState): void {
  const ks = ksOf(p);
  ks.papUntil = undefined;
  unpackCarried(room, p);
  markDirty(room, p);
  room.bus.emit('killstreaks.papEnd', { player: p });
  room.sendFeature(null, 'killstreaks.papEnd', { p: p.id });
}

/** Called through `callKillstreak(room, p, 'pack_a_punch')`. */
export function callPackAPunch(ctx: KsRoom, p: PlayerState, _args: CallArgs): string | null {
  const why = papBlocker(ctx, p);
  if (why) return why;
  const room = ctx.room;
  const w = papTarget(p);
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
        // Died before the upgrade landed: the streak comes back.
        if (!here || !p.alive) {
          if (here) grant(room, p, PAP_ID);
          return false;
        }
        hold();
        if (room.time >= t0 + PACK_A_PUNCH.applyAt - 1e-6) {
          applied = true;
          startPapBuff(room, p);
        }
        return true;
      }
      if (here && p.alive && room.time < end) hold();
      return here && p.alive && room.time < end;
    },
  };
  ctx.add(act);
  const id = w && isPackable(w.def.base.id) ? w.def.base.id : '';
  room.sendFeature(null, 'killstreaks.pap', { p: p.id, w: id, name: id ? papName(id) : 'Pack-a-Punch', t0, dur: PACK_A_PUNCH.durationSec, at: PACK_A_PUNCH.applyAt });
  return null;
}

/** A packed weapon `p` carries with this id (damage is credited by weapon id). */
const packedCarried = (p: PlayerState, id: string): WeaponState | undefined => p.weapons.find((w) => w.pap && w.def.base.id === id);

/** Per tick for one player: keep their guns in line with the buff. */
export function tickPap(room: Room, p: PlayerState): void {
  const until = p.ext.killstreaks?.papUntil;
  if (until !== undefined && room.time >= until) endPapBuff(room, p);
  else if (until !== undefined) {
    if (p.alive) packCarried(room, p);
  } else if (p.weapons.some((w) => w.pap || w.papExtra || w.papTopped)) unpackCarried(room, p); // packed without the buff (match reset): plain again
}

/** Per room: the buff upkeep, the packed damage multiplier, explosive rounds and the other signature effects. */
export function wirePackAPunch(room: Room): void {
  wirePapEffects(room);
  room.bus.on('tick', () => {
    for (const p of room.players.values()) tickPap(room, p);
  });
  // A respawn inside the window comes up packed straight away (after the weapons feature gave
  // the class its underbarrel launcher, so a packed launcher gun tops that up).
  room.bus.on(
    'spawn',
    ({ player }) => {
      if (papActive(room, player)) packCarried(room, player);
    },
    { priority: -20 },
  );
  room.modifiers.add(
    'damageDealt',
    (attacker, info) => {
      // Effect damage (burn, zaps, head blasts) is final: never scaled.
      if (info.victim === attacker || info.means === 'killstreak' || info.means === 'melee' || inPapFx()) return undefined;
      return packedCarried(attacker, info.weapon) ? papDamageMult(info.weapon) : undefined;
    },
    'killstreaks.pack_a_punch',
  );
  room.bus.on('fire', (e) => {
    const ex = papExplosive(e.weapon);
    const w = ex ? packedCarried(e.player, e.weapon) : undefined;
    if (!ex || !w) return;
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
    /** `player`'s Pack-a-Punch buff started (or restarted) until room time `until`; `name`: the held gun's upgraded name. */
    'killstreaks.packed': { player: P; weapon: string; name: string; until: number };
    /** `player`'s Pack-a-Punch buff ran out. */
    'killstreaks.papEnd': { player: P };
  }
}
