/**
 * Gun Game (BO1 wager): everyone starts on the first gun of the ladder; a kill with your gun moves
 * you up one rung (your new gun is handed over immediately); a knife kill sets the victim back a
 * rung (humiliation) and a suicide sets you back too. The first kill with the last gun wins.
 */
import { GUN_GAME, GUN_GAME_LADDER_INTENT } from '../../../../shared/defs/economy';
import { WEAPON_BY_ID } from '../../../../shared/defs/weapons';
import { Buttons } from '../../../../shared/input';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import { byScore, giveWeapons, pushHud, rankedResults, wagerMelee, weaponName, wx, type WagerRules } from './common';

/** The ladder with only the weapons that exist in this build (always at least 2 rungs). */
export function gunGameLadder(): string[] {
  const l = GUN_GAME_LADDER_INTENT.filter((id) => WEAPON_BY_ID.has(id));
  return l.length >= 2 ? l : ['m1911', 'ak47'];
}

export function gunGameRules(): WagerRules {
  let ladder = gunGameLadder();
  let finished = false;
  const level = (p: PlayerState) => Math.max(0, Math.min(ladder.length - 1, wx(p).gunLevel ?? 0));
  const setLevel = (room: Room, p: PlayerState, n: number) => {
    const st = wx(p);
    st.gunLevel = Math.max(0, n);
    st.gunAt = room.time;
  };
  const arm = (room: Room, p: PlayerState) => {
    if (p.alive) giveWeapons(room, p, [ladder[level(p)]!]);
    pushHud(room, rules, p);
  };

  const rules: WagerRules = {
    id: 'gungame',
    setup(room) {
      room.bus.on('playerJoin', ({ player }) => {
        const st = wx(player);
        if (st.gunLevel === undefined) setLevel(room, player, 0);
      });
      room.bus.on('spawn', ({ player }) => arm(room, player));
      room.bus.on('buttons', ({ player, pressed }) => {
        if (pressed & Buttons.MELEE) wagerMelee(room, player);
      });
      room.bus.on('death', (e) => {
        if (finished) return;
        const a = e.attacker;
        const suicide = !a || a === e.victim;
        if (suicide) {
          if (GUN_GAME.demoteOnSuicide && level(e.victim) > 0) {
            setLevel(room, e.victim, level(e.victim) - 1);
            room.addPlayerScore(e.victim, -GUN_GAME.killScore, 'demoted');
          }
          pushHud(room, rules, e.victim);
          return;
        }
        if (e.means === 'melee') {
          if (GUN_GAME.demoteOnMelee && level(e.victim) > 0) {
            setLevel(room, e.victim, level(e.victim) - 1);
            room.addPlayerScore(e.victim, -GUN_GAME.killScore, 'humiliated');
          }
          room.addPlayerScore(a, GUN_GAME.killScore / 2, 'humiliation');
          pushHud(room, rules, e.victim);
          return;
        }
        const was = level(a);
        if (was >= ladder.length - 1) {
          setLevel(room, a, ladder.length);
          finished = true;
          room.addPlayerScore(a, GUN_GAME.killScore, 'final kill');
          room.endMatch('score');
          return;
        }
        setLevel(room, a, was + 1);
        room.addPlayerScore(a, GUN_GAME.killScore, 'promoted');
        arm(room, a);
      });
    },
    reset(room) {
      ladder = gunGameLadder();
      finished = false;
      for (const p of room.players.values()) setLevel(room, p, 0);
    },
    assignTeam: () => null,
    rank(room) {
      return [...room.players.values()].sort((a, b) => (wx(b).gunLevel ?? 0) - (wx(a).gunLevel ?? 0) || (wx(a).gunAt ?? 0) - (wx(b).gunAt ?? 0) || byScore(a, b));
    },
    results(room, reason) {
      return rankedResults(room, reason, rules.rank(room));
    },
    hud(_room, p) {
      const n = level(p);
      return { mode: 'gungame', gunLevel: Math.min(wx(p).gunLevel ?? 0, ladder.length), gunCount: ladder.length, gun: weaponName(ladder[n]), nextGun: n + 1 < ladder.length ? weaponName(ladder[n + 1]) : null };
    },
  };
  return rules;
}
