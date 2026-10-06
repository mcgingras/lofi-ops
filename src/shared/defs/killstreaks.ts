/** Killstreaks (owner: perks-streaks feature). */
import { indexById } from './registry';

export interface KillstreakDef {
  id: string;
  name: string;
  /** Kills in a row needed (before Hardline). */
  kills: number;
  description: string;
  unlockLevel: number;
  /** passive: works on its own once earned/used; called: thrown in, then AI; controlled: player drives it. */
  kind: 'passive' | 'called' | 'controlled';
  /** Seconds it lasts once active, if timed. */
  durationSec?: number;
  icon?: string;
}

export const KILLSTREAKS: KillstreakDef[] = [
  { id: 'uav', name: 'Spy Plane', kills: 3, description: 'Shows enemies on the minimap.', unlockLevel: 1, kind: 'called', durationSec: 30 },
];

export const KILLSTREAK_BY_ID = indexById(KILLSTREAKS);
