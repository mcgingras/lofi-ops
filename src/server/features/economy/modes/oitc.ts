/**
 * One in the Chamber (BO1 wager): an M1911 with one bullet, a knife, three lives. Any bullet hit
 * kills; any kill puts one more bullet in the pistol. Out of lives = eliminated (spectate). Last
 * player standing wins; on time, survivors rank by lives then score, the eliminated by how long
 * they lasted.
 */
import { OITC } from '../../../../shared/defs/economy';
import { Buttons } from '../../../../shared/input';
import type { PlayerState } from '../../../player';
import { byScore, giveWeapons, pushHud, pushHudAll, rankedResults, wagerMelee, wx, type WagerRules } from './common';

export function oitcRules(): WagerRules {
  const rules: WagerRules = {
    id: 'oitc',
    setup(room) {
      room.bus.on('playerJoin', ({ player }) => {
        const st = wx(player);
        if (room.phase === 'playing' || room.phase === 'countdown') {
          // Late joiners (and backfill bots) get as many lives as the worst survivor, at least one.
          const alive = [...room.players.values()].filter((q) => q !== player && !wx(q).out);
          st.lives = Math.max(1, Math.min(OITC.lives, ...alive.map((q) => wx(q).lives ?? OITC.lives)));
        } else st.lives = OITC.lives;
        st.out = false;
      });
      room.bus.on('spawn', ({ player }) => {
        giveWeapons(room, player, [OITC.weapon], { mag: 1, reserve: 0 });
        pushHud(room, rules, player);
      });
      room.bus.on('beforeDamage', (e) => {
        if (e.means === 'bullet' && e.attacker && e.attacker !== e.victim) e.amount = Math.max(e.amount, e.victim.health + 1);
      });
      room.bus.on('buttons', ({ player, pressed }) => {
        if (pressed & Buttons.MELEE) wagerMelee(room, player);
      });
      room.bus.on('death', (e) => {
        const v = wx(e.victim);
        v.lives = Math.max(0, (v.lives ?? OITC.lives) - 1);
        if (v.lives === 0 && !v.out) {
          v.out = true;
          v.outAt = room.time;
          e.victim.respawnAt = null;
          for (const q of room.players.values()) if (q !== e.victim && !wx(q).out) room.addPlayerScore(q, OITC.surviveScore, 'survive');
        }
        const a = e.attacker;
        if (a && a !== e.victim && a.alive) {
          const pistol = a.weapons[0];
          if (pistol) pistol.mag += 1;
          room.addPlayerScore(a, OITC.killScore, 'kill');
        }
        pushHudAll(room, rules);
      });
    },
    reset(room) {
      for (const p of room.players.values()) {
        const st = wx(p);
        st.lives = OITC.lives;
        st.out = false;
        st.outAt = undefined;
      }
    },
    assignTeam: () => null,
    respawnDelay(_room, p) {
      return (wx(p).lives ?? OITC.lives) > 0 ? 2 : null;
    },
    checkEnd(room) {
      if (room.players.size < 2) return null;
      const standing = [...room.players.values()].filter((p) => !wx(p).out);
      return standing.length <= 1 ? 'score' : null;
    },
    rank(room) {
      const ps = [...room.players.values()];
      const standing = ps.filter((p) => !wx(p).out).sort((a, b) => (wx(b).lives ?? 0) - (wx(a).lives ?? 0) || byScore(a, b));
      const out = ps.filter((p) => wx(p).out).sort((a, b) => (wx(b).outAt ?? 0) - (wx(a).outAt ?? 0) || byScore(a, b));
      return [...standing, ...out];
    },
    results(room, reason) {
      return rankedResults(room, reason, rules.rank(room));
    },
    hud(_room, p: PlayerState) {
      const st = wx(p);
      return { mode: 'oitc', lives: st.lives ?? OITC.lives, livesMax: OITC.lives, out: !!st.out };
    },
  };
  return rules;
}
