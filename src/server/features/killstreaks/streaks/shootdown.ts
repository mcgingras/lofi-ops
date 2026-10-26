/**
 * Shooting down killstreaks (BO1: "Spy Plane destroyed +100"). Destructible hardware is already
 * damaged by bullets (`KsRoom.onFire`), blasts and the secondary launchers' rockets and missiles
 * (the weapons feature's launchers/); when one is destroyed by an enemy, `hurtEntity` gives its
 * points as score and emits `killstreaks.destroyed` with them. Here:
 *
 * - the destroyer earns the same amount as XP, as a "<STREAK> DESTROYED" line (`progression.xp`);
 * - everyone hears `killstreaks.shotDown {id, kind, owner, team, by, xp}`: the destroyer's HUD
 *   pops "SPY PLANE DESTROYED +100", the owner is told who shot it down, the rest see the usual
 *   friendly / enemy line.
 *
 * Points (score = XP) per piece, set where each registers its hit points: Spy Plane, Counter-Spy
 * Plane, the Care Package chopper, Valkyrie rocket, Sentry Gun, SAM Turret 100; Attack Helicopter
 * 200; Chopper Gunner 300; RC-XD and a dog their own. A Hacker Pro takeover (no `score`) gives
 * nothing here.
 */
import { KILLSTREAK_BY_ID } from '../../../../shared/defs/killstreaks';
import type { Room } from '../../../room';
import type { KsRoom } from '../world';

/** Display name for a destroyed piece (the Care Package's chopper is not the crate). */
export function destroyedName(id: string, kind: string): string {
  if (kind === 'ks_dropheli') return 'Supply Chopper';
  if (kind === 'ks_rocket') return 'Valkyrie Rocket';
  return KILLSTREAK_BY_ID.get(id)?.name ?? id;
}

export function wireShootDowns(room: Room, ctx: KsRoom): void {
  room.bus.on('killstreaks.destroyed', ({ owner, id, kind, by, score }) => {
    if (!by || score === undefined || (owner && ctx.sameSide(by, owner))) return;
    const name = destroyedName(id, kind);
    if (score > 0) room.bus.emit('progression.xp', { player: by, amount: score, label: `${name.toUpperCase()} DESTROYED`, key: 'x.destroyed' });
    room.sendFeature(null, 'killstreaks.shotDown', { id, kind, name, owner: owner?.id ?? null, team: owner?.team ?? null, by: by.id, xp: score });
  });
}
