/**
 * Client side of the "killstreaks" feature (owner: perks-streaks; auto-imported by main.ts):
 * low-poly hardware renderers (planes, helicopters, sentry, SAM, dogs, RC-XD, crate, missiles,
 * napalm fire, mortar marks), explosions and sounds, the streak ladder / ready prompt /
 * designator / announcements HUD, the radar minimap, and camera control for driven streaks.
 */
import './textures';
import './sounds';
import './store';
import './renderers';
import './fx';
import './hud';
import './radar';
import './control';

export { ksClient, streakName } from './store';
