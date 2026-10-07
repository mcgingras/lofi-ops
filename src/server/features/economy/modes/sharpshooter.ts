/**
 * Sharpshooter (BO1 wager): everyone has the same random gun, swapped for everyone every 45 s.
 * Kills in a row stack perk effects and a score multiplier (SHARPSHOOTER.bonuses); dying resets.
 */
import { SHARPSHOOTER } from '../../../../shared/defs/economy';
import { WAGER_ONLY_WEAPONS } from '../../../../shared/defs/wager-weapons';
import { WEAPONS } from '../../../../shared/defs/weapons';
import { Buttons } from '../../../../shared/input';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import { byScore, giveWeapons, pushHud, pushHudAll, rankedResults, wagerMelee, weaponName, type WagerRules } from './common';

export function sharpshooterPool(): string[] {
  return WEAPONS.filter((w) => SHARPSHOOTER.classes.includes(w.class) && !WAGER_ONLY_WEAPONS.has(w.id)).map((w) => w.id);
}

/** The streak bonus in effect at `streak` kills (or null). */
export function sharpshooterBonus(streak: number) {
  let b: (typeof SHARPSHOOTER.bonuses)[number] | null = null;
  for (const x of SHARPSHOOTER.bonuses) if (streak >= x.streak) b = x;
  return b;
}

export function sharpshooterRules(opts: { random?: () => number } = {}): WagerRules {
  const random = opts.random ?? Math.random;
  let weapon = 'ak47';
  let rotateAt = 0;
  let cancel: (() => void) | null = null;
  const streakOf = (p: PlayerState) => (p.alive ? p.stats.streak : 0);

  const pick = () => {
    const pool = sharpshooterPool();
    const choices = pool.length > 1 ? pool.filter((id) => id !== weapon) : pool;
    weapon = choices[Math.floor(random() * choices.length)] ?? 'ak47';
  };

  const rotate = (room: Room) => {
    pick();
    rotateAt = room.time + SHARPSHOOTER.rotateSec;
    for (const p of room.players.values()) if (p.alive) giveWeapons(room, p, [weapon]);
    pushHudAll(room, rules);
  };

  const rules: WagerRules = {
    id: 'sharpshooter',
    setup(room) {
      room.bus.on('spawn', ({ player }) => {
        giveWeapons(room, player, [weapon]);
        pushHud(room, rules, player);
      });
      room.bus.on('buttons', ({ player, pressed }) => {
        if (pressed & Buttons.MELEE) wagerMelee(room, player);
      });
      room.bus.on('death', (e) => {
        const a = e.attacker;
        if (a && a !== e.victim) {
          const bonus = sharpshooterBonus(a.stats.streak);
          room.addPlayerScore(a, SHARPSHOOTER.killScore * (bonus?.multiplier ?? 1), 'kill');
          pushHud(room, rules, a);
        }
        pushHud(room, rules, e.victim);
      });
      room.bus.on('matchEnd', () => {
        cancel?.();
        cancel = null;
      });
      // Perk effects of the streak bonuses.
      room.modifiers.add('reloadMultiplier', (p) => (streakOf(p) >= 2 ? 0.5 : undefined), 'economy.sharpshooter.soh');
      room.modifiers.add('spreadMultiplier', (p) => (streakOf(p) >= 3 ? 0.65 : undefined), 'economy.sharpshooter.steady');
      room.modifiers.add('speedMultiplier', (p) => (streakOf(p) >= 4 ? 1.07 : undefined), 'economy.sharpshooter.lightweight');
      room.modifiers.add('sprintMultiplier', (p) => (streakOf(p) >= 6 ? 1.08 : undefined), 'economy.sharpshooter.marathon');
    },
    reset(room) {
      cancel?.();
      pick();
      rotateAt = room.time + (room.options.countdownSec ?? 0) + SHARPSHOOTER.rotateSec;
      const self = rules;
      cancel = room.every(0.25, () => {
        if (room.rules !== self) {
          cancel?.();
          return;
        }
        if (room.phase === 'playing' && room.time >= rotateAt) rotate(room);
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
      const b = sharpshooterBonus(streakOf(p));
      return { mode: 'sharpshooter', weapon: weaponName(weapon), rotateAt, bonus: b?.name ?? null, multiplier: b?.multiplier ?? 1 };
    },
  };
  return rules;
}
