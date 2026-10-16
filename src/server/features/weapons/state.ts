/**
 * Per-player weapons state (`player.ext.weapons`), the modifier keys this feature adds, and its
 * custom room events. Types only plus a tiny accessor.
 */
import type { EquipmentDef } from '../../../shared/defs/equipment';
import type { Loadout } from '../../../shared/loadout';
import type { PlayerState } from '../../player';

export interface ThrowState {
  equip: EquipmentDef;
  kind: 'lethal' | 'tactical';
  /** Room time the pin was pulled (fuse starts for cookable grenades). */
  pinAt: number;
  /** Room time the button was released (null while held). */
  releasedAt: number | null;
}

export interface WeaponsExt {
  lethal: string | null;
  lethalN: number;
  tactical: string | null;
  tacticalN: number;
  throwing: ThrowState | null;
  /** Room time the next knife is allowed. */
  meleeReady: number;
  /** Tactical effects on this player (room time they end, strength 0..1). */
  flashedUntil: number;
  flashAmount: number;
  stunnedUntil: number;
  stunAmount: number;
  /** Shell-by-shell reload in progress (shotguns). */
  shells: { slot: number; next: number; per: number; close: number } | null;
}

declare module '../../player' {
  interface PlayerExt {
    weapons?: WeaponsExt;
  }
}

/**
 * Modifier keys the weapons feature reads (other features, mostly perks, register them). One name
 * per contract: a key registered under any other name is never read (tests/modifier-keys.test.ts).
 */
declare module '../../modifiers' {
  interface ModifierMap {
    /**
     * Extra PRIMARY attachment slots on top of BO1's one (Warlord: +1). Sum. Read at `beforeSpawn`
     * with the loadout being spawned (`p.loadout` is still the previous life's, so look at
     * `loadout.perks`, not `p`); the primary is trimmed to `BASE_ATTACHMENT_SLOTS` + this, the
     * secondary always to one.
     */
    attachmentSlotsOffset: (p: PlayerState, loadout: Loadout) => number | undefined;
    /**
     * Strength of a flashbang/concussion on this victim (Tactical Mask: 0.35). Product. The effect's
     * duration scales with its strength.
     */
    tacticalMultiplier: (victim: PlayerState) => number | undefined;
    /** Extra lethal/tactical grenades at spawn and the carry cap for refills (Warlord Pro: +1 each). Sum. */
    equipmentCountOffset: (p: PlayerState, kind: 'lethal' | 'tactical') => number | undefined;
    /** Knife cooldown and recovery time (Steady Aim Pro: 0.7). Product. */
    meleeSpeedMultiplier: (p: PlayerState) => number | undefined;
    /** Scoped hold-breath time (Scout: 2). Product. Sent to the client in `weapons.equip.breath`. */
    holdBreathMultiplier: (p: PlayerState) => number | undefined;
  }
}

declare module '../../../shared/events' {
  interface RoomEvents<P> {
    /** A grenade/launcher round left someone's hand or barrel. */
    'weapons.thrown': { player: P; equipment: string };
    /** Someone picked thrown equipment back up (a tomahawk). */
    'weapons.retrieved': { player: P; equipment: string };
    /** A tactical hit someone (amount 0..1, effect lasts `duration` seconds). */
    'weapons.tactical': { player: P | null; victim: P; equipment: string; amount: number; duration: number };
    /** A knife swing (victim null on a miss). */
    'weapons.melee': { player: P; victim: P | null };
    /**
     * Equipment went off at x,y,z (frag, semtex, launcher round `gl`, flashbang, concussion), for
     * whatever else it should affect (killstreak hardware takes the blast; tacticals stun turrets).
     * `max`/`min` are the blast damage at the centre / edge of `radius` (0 for tacticals).
     */
    'weapons.detonated': { player: P | null; equipment: string; effect: string; x: number; y: number; z: number; radius: number; max: number; min: number };
  }
}

export function wext(p: PlayerState): WeaponsExt {
  return (p.ext.weapons ??= { lethal: null, lethalN: 0, tactical: null, tacticalN: 0, throwing: null, meleeReady: 0, flashedUntil: 0, flashAmount: 0, stunnedUntil: 0, stunAmount: 0, shells: null });
}
