/**
 * Client side of the "killstreaks" feature (owner: perks-streaks; auto-imported by main.ts):
 * low-poly hardware renderers (planes, helicopters, sentry, SAM, dogs, RC-XD, crate, missiles,
 * napalm fire, mortar marks), explosions and sounds, the streak ladder / ready prompt /
 * designator / announcements HUD, the radar minimap, camera control for driven streaks, and the
 * tactical map (radio + overhead map) for Napalm, Mortar Team, Rolling Thunder and the Attack Helicopter.
 */
import './textures';
import './sounds';
import './store';
import './renderers';
import './fx';
import './hud';
import './radar';
import './control';
import './radio';
import './tacmap';

export { ksClient, streakName } from './store';
export { tacmapOpen } from './tacmap';
