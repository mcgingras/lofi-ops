/**
 * Client side of the "killstreaks" feature (owner: perks-streaks; auto-imported by main.ts):
 * low-poly hardware renderers (planes, helicopters, sentry, SAM, dogs, RC-XD, crate, the Care
 * Package marker canister and its smoke (marker.ts: held canister, throw arc and landing ring), missiles,
 * napalm fire, mortar marks), explosions and sounds, the streak ladder / ready prompt /
 * designator / announcements HUD, the radar minimap, camera control for driven streaks, and the
 * tactical map (radio + overhead map) for Napalm, Mortar Team, Rolling Thunder and the Attack Helicopter,
 * the Tactical Nuke (laptop, countdown, flash, mushroom cloud: nuke.ts), and the Mystery Box
 * (beam, lightning, the box, its weapon cycle and prompts: mysterybox.ts), and Pack-a-Punch
 * (the animated camo, the dip, the jingle and the toast: packapunch.ts).
 */
import './textures';
import './sounds';
import './store';
import './renderers';
import './fx';
import './hud';
import './radar';
import './control';
import './marker';
import './turret';
import './radio';
import './tacmap';
import './nuke';
// After the nuke: its frame resets `renderer.white`, the rocket cam's white goes on top of it.
import './valkyrie';
// After the renderers: it wraps the hardware renderers to show the Glitch's knocked-out look.
import './glitch';
// After those too: the Mystery Box's sky flicker uses `renderer.white` only when nobody else does.
import './mysterybox';
import './packapunch';

export { ksClient, streakName } from './store';
export { tacmapOpen } from './tacmap';
