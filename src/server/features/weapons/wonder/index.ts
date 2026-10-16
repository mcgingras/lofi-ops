/**
 * BO1 Zombies wonder weapons on the server (weapons feature; tuning in shared/defs/wonder.ts):
 * the four weapon behaviours, and per room the Ray Gun bolts, frost (slow, thaw, the ice
 * entity), Thundergun edge-kill credit, and the frost movement modifiers. Only the Mystery Box
 * killstreak hands these guns out (killstreaks/streaks/mysterybox.ts); dropped ones are ordinary
 * pickups that despawn sooner (pickups feature).
 */
import { frostSlow } from '../../../../shared/defs/wonder';
import type { ServerApi } from '../../../feature';
import type { Room } from '../../../room';
import { raygunBehavior, updateBolts } from './raygun';
import { creditEdgeKills, thundergunBehavior } from './thundergun';
import { updateFrost, winterBehavior } from './wintershowl';
import { wunderwaffeBehavior } from './wunderwaffe';

export { wonderBotDecision, wonderBotStyle, WONDER_BOT_STYLE, type WonderBotStyle } from './bots';
export { frostOf } from './wintershowl';
export { launch } from './thundergun';
export { wonderOf } from './common';

/** Register the four behaviours (idempotent: setup and every room both call it). */
export function registerWonderBehaviors(register: ServerApi['registerWeaponBehavior']): void {
  register('raygun', raygunBehavior);
  register('thundergun', thundergunBehavior);
  register('wunderwaffe', wunderwaffeBehavior);
  register('wintershowl', winterBehavior);
}

export function wireWonder(room: Room): void {
  room.bus.on('tick', ({ dt }) => {
    if (room.phase !== 'playing') return;
    creditEdgeKills(room);
    updateBolts(room, dt);
    updateFrost(room, dt);
  });
  room.bus.on('death', ({ victim }) => {
    const w = victim.ext.wonder;
    if (!w) return;
    w.frost = 0;
    w.frozenUntil = 0;
    w.knockBy = null;
  });
  room.bus.on('spawn', ({ player }) => {
    const w = player.ext.wonder;
    if (!w) return;
    w.frost = 0;
    w.frozenUntil = 0;
    w.knockBy = null;
  });
  // Frost: slower legs (and no sprint once half frozen); the turn slow is the victim's client.
  room.modifiers.add('speedMultiplier', (p) => {
    const f = p.ext.wonder?.frost ?? 0;
    return f > 0 ? frostSlow(f).speed : undefined;
  }, 'weapons.frost');
  room.modifiers.add('canSprint', (p) => ((p.ext.wonder?.frost ?? 0) >= 0.5 ? false : undefined), 'weapons.frost');
}
