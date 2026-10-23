/**
 * Client side of the Mystery Box's wonder weapons (weapons feature; rules in
 * shared/defs/wonder.ts, server in server/features/weapons/wonder/): textures, the four gun models
 * (first and third person, dropped, killcam, the box's cycle), effects and entities, HUD.
 * Their sounds are registered from ../sounds.ts (so the sound tests see them).
 */
import './textures';
import './bodies';
import './models';
import './fx';
import './hud';

export { WONDER_GUNS } from './models';
export { myFrost } from './hud';
export { bodyLook, lookOf, type BodyLook } from './bodies';
export { fxEmit, fxLightning, fxRing } from './fx';
