/**
 * BO1 Zombies wonder weapons on the server (weapons feature; tuning in shared/defs/wonder.ts):
 * the four weapon behaviours, and per room the Ray Gun bolts, frost (slow, thaw, the ice
 * entity), Thundergun edge-kill credit, and the frost movement modifiers. Only the Mystery Box
 * killstreak hands these guns out (killstreaks/streaks/mysterybox.ts); dropped ones are ordinary
 * pickups that despawn sooner (pickups feature).
 */
import { frostSlow, frostSuppress } from '../../../../shared/defs/wonder';
import type { ServerApi } from '../../../feature';
import type { PlayerState } from '../../../player';
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
  const frost = (p: PlayerState) => (p.alive ? (p.ext.wonder?.frost ?? 0) : 0);
  room.modifiers.add('speedMultiplier', (p) => {
    const f = frost(p);
    return f > 0 ? frostSlow(f).speed : undefined;
  }, 'weapons.frost');
  room.modifiers.add('canSprint', (p) => (frost(p) >= 0.5 ? false : undefined), 'weapons.frost');
  // Frost on the trigger: slower and wilder as it builds; frozen solid, no hands and no sights.
  room.modifiers.add('fireRateMultiplier', (p) => {
    const f = frost(p);
    return f > 0 ? frostSuppress(f).fireRate : undefined;
  }, 'weapons.frost');
  room.modifiers.add('spreadMultiplier', (p) => {
    const f = frost(p);
    return f > 0 ? frostSuppress(f).spread : undefined;
  }, 'weapons.frost');
  room.modifiers.add('canFire', (p) => (frost(p) >= 1 ? false : undefined), 'weapons.frost');
  room.modifiers.add('canAds', (p) => (frost(p) >= 1 ? false : undefined), 'weapons.frost');
  // Bots obey it too: frozen solid they stand with their aim held and never fire (the brain's
  // `botFrozen`), and partial frost slows their reactions and turning and shakes their aim.
  room.modifiers.add('botFrozen', (bot) => (frost(bot) >= 1 ? true : undefined), 'weapons.frost');
  room.modifiers.add('botSkillMultiplier', (bot, knob) => {
    const f = frost(bot);
    if (!(f > 0)) return undefined;
    if (knob === 'reactionMs') return 1 + f;
    if (knob === 'turnSpeedDeg') return frostSlow(f).turn;
    return undefined;
  }, 'weapons.frost');
  room.modifiers.add('botSkillOffset', (bot, knob) => {
    const f = frost(bot);
    return f > 0 && knob === 'aimErrorDeg' ? 4 * f : undefined;
  }, 'weapons.frost');
}
