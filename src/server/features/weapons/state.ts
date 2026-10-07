/**
 * Per-player weapons state (`player.ext.weapons`), the modifier keys this feature adds, and its
 * custom room events. Types only plus a tiny accessor.
 */
import type { EquipmentDef } from '../../../shared/defs/equipment';
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

declare module '../../modifiers' {
  interface ModifierMap {
    /**
     * Extra attachment slots on top of BO1's one (Warlord: +1). Sum. Read at spawn by the
     * weapons feature, which trims each weapon's attachments to 1 + this.
     */
    attachmentSlotsOffset: (p: PlayerState) => number | undefined;
    /** Flashbang/concussion strength on this victim (Tactical Mask: e.g. 0.3). Product. */
    tacticalMultiplier: (victim: PlayerState) => number | undefined;
    /** Extra lethal/tactical grenades at spawn (Scavenger-like perks). Sum. */
    equipmentCountOffset: (p: PlayerState, kind: 'lethal' | 'tactical') => number | undefined;
  }
}

declare module '../../../shared/events' {
  interface RoomEvents<P> {
    /** A grenade/launcher round left someone's hand or barrel. */
    'weapons.thrown': { player: P; equipment: string };
    /** A tactical hit someone (amount 0..1). */
    'weapons.tactical': { player: P | null; victim: P; equipment: string; amount: number };
    /** A knife swing (victim null on a miss). */
    'weapons.melee': { player: P; victim: P | null };
  }
}

export function wext(p: PlayerState): WeaponsExt {
  return (p.ext.weapons ??= { lethal: null, lethalN: 0, tactical: null, tacticalN: 0, throwing: null, meleeReady: 0, flashedUntil: 0, flashAmount: 0, stunnedUntil: 0, stunAmount: 0, shells: null });
}
