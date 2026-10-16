/**
 * Ally bots in Zombies (co-op lobbies with bot fill on; off by default): they play on the
 * survivors' side with the bots feature's soldier brain, steered through its hooks. Zombies
 * themselves never use this brain (brain.ts).
 *
 * - Goal (`registerBotGoal('zombies')`): stay with the humans: walk to within a few metres of the
 *   nearest human who is up, and hold there; a downed human is a goal of its own (stand over them).
 * - Style (`registerBotStyle('zombies')`): rush and knife up close (zombies only fight in melee),
 *   and back away from anything inside 4 m (kite) so the horde doesn't swarm them.
 */
import { registerBotGoal, registerBotStyle } from '../bots/api';
import { survivorOf } from './state';

let registered = false;

export function registerZombiesBots(): void {
  if (registered) return;
  registered = true;
  registerBotGoal('zombies', (room, bot) => {
    if (!survivorOf(bot)) return null;
    let best = null as null | { x: number; y: number; z: number; down: boolean; d: number };
    for (const h of room.humans()) {
      if (!h.alive || !survivorOf(h)) continue;
      const d = Math.hypot(h.move.x - bot.move.x, h.move.z - bot.move.z);
      const down = !!h.ext.perks?.lastStand;
      if (!best || (down && !best.down) || (down === best.down && d < best.d)) best = { x: h.move.x, y: h.move.y, z: h.move.z, down, d };
    }
    if (!best) return null;
    if (!best.down && best.d < 5) return null;
    return { at: { x: best.x, y: best.y, z: best.z }, radius: best.down ? 1.2 : 3.5, hold: true, priority: best.down ? 0.95 : 0.7, sprint: best.d > 10, label: best.down ? 'cover downed' : 'stay with the squad' };
  });
  registerBotStyle('zombies', (_room, bot) => (survivorOf(bot) ? { meleeHappy: true, kite: true, conserveAmmo: false, rush: false } : null));
}
