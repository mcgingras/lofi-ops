/**
 * Lethal and tactical equipment the create-a-class menu offers (owner: frontend, until a feature
 * area ships equipment defs; then point these lists at those defs and keep the ids).
 * `Loadout.lethal` / `Loadout.tactical` store these ids; the server feature that implements the
 * throwables reads them from the spawn loadout.
 */
import { indexById } from '../defs/registry';

export interface EquipmentDef {
  id: string;
  name: string;
  kind: 'lethal' | 'tactical';
  description: string;
  unlockLevel: number;
}

export const EQUIPMENT: EquipmentDef[] = [
  { id: 'frag', name: 'Frag', kind: 'lethal', description: 'Cookable fragmentation grenade.', unlockLevel: 1 },
  { id: 'semtex', name: 'Semtex', kind: 'lethal', description: 'Sticky grenade with a short fuse.', unlockLevel: 1 },
  { id: 'tomahawk', name: 'Tomahawk', kind: 'lethal', description: 'Thrown axe. One hit kill. Retrievable.', unlockLevel: 1 },
  { id: 'flash', name: 'Flashbang', kind: 'tactical', description: 'Blinds and deafens enemies.', unlockLevel: 1 },
  { id: 'concussion', name: 'Concussion', kind: 'tactical', description: 'Slows enemy movement and aim.', unlockLevel: 1 },
  { id: 'smoke', name: 'Willy Pete', kind: 'tactical', description: 'Smoke screen for cover.', unlockLevel: 1 },
  { id: 'decoy', name: 'Decoy', kind: 'tactical', description: 'Fakes gunfire on enemy radar.', unlockLevel: 1 },
];

export const EQUIPMENT_BY_ID = indexById(EQUIPMENT);
