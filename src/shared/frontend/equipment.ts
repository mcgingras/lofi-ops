/**
 * Lethal and tactical equipment the create-a-class menu offers. The list comes from the weapons
 * area's defs (src/shared/defs/equipment.ts), which the server simulates, so every pick works in a
 * match and the default loadouts' ids (frag, semtex, flashbang, concussion) validate.
 * `Loadout.lethal` / `Loadout.tactical` store these ids.
 */
import { EQUIPMENT as EQUIPMENT_DEFS } from '../defs/equipment';
import { indexById } from '../defs/registry';

export interface EquipmentDef {
  id: string;
  name: string;
  kind: 'lethal' | 'tactical';
  description: string;
  unlockLevel: number;
}

export const EQUIPMENT: EquipmentDef[] = EQUIPMENT_DEFS.map((e) => ({
  id: e.id,
  name: e.name,
  kind: e.kind,
  description: e.blurb ?? '',
  unlockLevel: e.unlockLevel,
}));

export const EQUIPMENT_BY_ID = indexById(EQUIPMENT);
