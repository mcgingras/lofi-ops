/**
 * Sticks and Stones (BO1 wager): everyone has the crossbow (6 explosive bolts), the ballistic
 * knife (2 blades) and a tomahawk. No scavenging and no ammo for kills: fired blades and thrown
 * tomahawks are picked back up from where they landed.
 *
 * Points (BO1): 100 for a crossbow / blade / other kill, 25 for a knife, 10 for a tomahawk, which
 * also bankrupts the victim (score to 0). Any suicide (your own bolt, falling) bankrupts yourself.
 *
 * Pieces live where they belong: the bolt and blade projectiles in `../projectiles.ts` (registered
 * from the feature setup), the tomahawk (hold to raise, release to throw, retrievable) in the
 * weapons feature as an ordinary lethal; this file forces the loadout, scores, bankrupts and
 * points bots at their lost blades and tomahawks.
 */
import { BLADE_ENTITY, STICKS } from '../../../../shared/defs/economy';
import { TOMAHAWK_ENTITY } from '../../../../shared/defs/equipment';
import { Buttons } from '../../../../shared/input';
import type { Entity } from '../../../entities';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import { registerBotGoal } from '../../bots/hooks';
import { canRetrieveTomahawk } from '../../weapons/index';
import { bladeRoom } from '../projectiles';
import { byScore, giveWeapons, pushHud, rankedResults, wagerMelee, type WagerRules } from './common';

/** Tomahawks the player carries right now (the weapons feature owns the count). */
const tomahawksOf = (p: PlayerState) => (p.ext.weapons?.lethal === STICKS.lethal ? p.ext.weapons.lethalN : 0);

/** Take a player's score to 0 and tell everyone (BO1 "BANKRUPTED"). */
export function bankrupt(room: Room, victim: PlayerState, attacker: PlayerState | null): void {
  const lost = Math.max(0, victim.stats.score);
  if (lost > 0) room.addPlayerScore(victim, -lost, 'bankrupt');
  room.sendFeature(null, 'economy.bankrupt', { victim: victim.id, attacker: attacker?.id ?? null, lost });
}

export function sticksRules(): WagerRules {
  const rules: WagerRules = {
    id: 'sticks',
    setup(room) {
      // Forced class (runs after progression's gate and the economy's no-grenades default).
      room.bus.on(
        'beforeSpawn',
        (e) => {
          e.loadout.primary = { weapon: STICKS.primary, attachments: [], camo: e.loadout.primary.camo };
          e.loadout.secondary = { weapon: STICKS.secondary, attachments: [], camo: e.loadout.secondary.camo };
          e.loadout.lethal = STICKS.lethal;
          e.loadout.tactical = null;
        },
        { priority: -30 },
      );
      room.bus.on('spawn', ({ player }) => {
        giveWeapons(room, player, [STICKS.primary, STICKS.secondary]);
        pushHud(room, rules, player);
      });
      room.bus.on('buttons', ({ player, pressed }) => {
        if (pressed & Buttons.MELEE) wagerMelee(room, player);
      });
      room.bus.on('weapons.thrown', ({ player }) => pushHud(room, rules, player));
      room.bus.on('weapons.retrieved', ({ player }) => pushHud(room, rules, player));
      room.bus.on('death', (e) => {
        const a = e.attacker;
        if (!a || a === e.victim) {
          bankrupt(room, e.victim, null);
          return;
        }
        if (e.weapon === STICKS.lethal) {
          room.addPlayerScore(a, STICKS.tomahawkScore, 'tomahawk');
          bankrupt(room, e.victim, a);
        } else if (e.means === 'melee') room.addPlayerScore(a, STICKS.meleeScore, 'melee');
        else room.addPlayerScore(a, STICKS.killScore, 'kill');
      });
    },
    assignTeam: () => null,
    rank(room) {
      return [...room.players.values()].sort(byScore);
    },
    results(room, reason) {
      return rankedResults(room, reason, rules.rank(room));
    },
    hud(_room, p) {
      return { mode: 'sticks', tomahawks: tomahawksOf(p) };
    },
  };
  return rules;
}

let botGoalsRegistered = false;

/**
 * Bots in Sticks and Stones: go and pick up a blade or tomahawk they can use (nearest first). The
 * goal is urgent when the bot is out of bolts and blades, mild when it's only missing a spare.
 * Registered once from the economy setup through the bots feature's public goal hook.
 */
export function registerSticksBotGoals(): void {
  if (botGoalsRegistered) return;
  botGoalsRegistered = true;
  registerBotGoal('sticks', (room, bot) => {
    const wantBlade = bladeRoom(bot) > 0;
    const wantHawk = canRetrieveTomahawk(room, bot);
    if (!wantBlade && !wantHawk) return null;
    let best: Entity | null = null;
    let bestD = 40;
    const consider = (e: Entity) => {
      const d = Math.hypot(e.x - bot.move.x, e.z - bot.move.z) + Math.abs(e.y - bot.move.y) * 2;
      if (d < bestD) {
        best = e;
        bestD = d;
      }
    };
    if (wantBlade) for (const e of room.entities.byKind(BLADE_ENTITY)) if (e.s?.k) consider(e);
    if (wantHawk) for (const e of room.entities.byKind(TOMAHAWK_ENTITY)) if (e.s?.k) consider(e);
    const target = best as Entity | null;
    if (!target) return null;
    const dry = bot.weapons.every((w) => w.mag + w.reserve === 0);
    return { at: { x: target.x, y: target.y - (target.s?.k === 1 ? 1 : 0), z: target.z }, radius: 0.6, priority: dry ? 0.95 : 0.55, sprint: dry, label: `retrieve ${target.kind}` };
  });
}
