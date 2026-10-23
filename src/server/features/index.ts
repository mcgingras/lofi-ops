/**
 * Every server feature area, in registration order (setup() and room() run in this order).
 * Each area owns its folder; this list is pre-seeded so areas never need to edit it.
 * A new area: add a folder with an index.ts default-exporting a Feature, then one line here.
 */
import type { Feature } from '../feature';
import weapons from './weapons/index';
import perks from './perks/index';
import killstreaks from './killstreaks/index';
import progression from './progression/index';
import economy from './economy/index';
import frontend from './frontend/index';
import bots from './bots/index';
import modes from './modes/index';
import pickups from './pickups/index';
import zombies from './zombies/index';
import blackout from './blackout/index';

export const FEATURES: Feature[] = [weapons, perks, killstreaks, progression, economy, frontend, bots, modes, pickups, zombies, blackout];
