/** Team Deathmatch: each enemy kill is +1 team score (+100 player score, assists +50). */
import { XP_SOURCES } from '../../shared/defs/progression';
import type { ModeRules } from './types';

export function tdm(): ModeRules {
  return {
    id: 'tdm',
    setup(room) {
      room.bus.on('death', (e) => {
        if (!e.attacker || e.attacker === e.victim || !room.isEnemy(e.attacker, e.victim) || e.attacker.team === null) return;
        room.addPlayerScore(e.attacker, XP_SOURCES.kill + (e.headshot ? XP_SOURCES.headshot : 0), 'kill');
        for (const a of e.assisters) room.addPlayerScore(a, XP_SOURCES.assist, 'assist');
        room.addTeamScore(e.attacker.team, 1, 'kill', e.attacker);
      });
    },
    checkEnd(room) {
      const limit = room.mode.scoreLimit;
      return limit > 0 && (room.teamScores[0] >= limit || room.teamScores[1] >= limit) ? 'score' : null;
    },
  };
}
