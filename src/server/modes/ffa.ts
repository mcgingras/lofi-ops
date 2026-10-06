/** Free-for-All: kills count toward the limit (mode.scoreLimit kills); score is 100 per kill. */
import { XP_SOURCES } from '../../shared/defs/progression';
import type { ModeRules } from './types';

export function ffa(): ModeRules {
  return {
    id: 'ffa',
    setup(room) {
      room.bus.on('death', (e) => {
        if (!e.attacker || e.attacker === e.victim) return;
        room.addPlayerScore(e.attacker, XP_SOURCES.kill + (e.headshot ? XP_SOURCES.headshot : 0), 'kill');
        for (const a of e.assisters) room.addPlayerScore(a, XP_SOURCES.assist, 'assist');
      });
    },
    assignTeam: () => null,
    checkEnd(room) {
      const limit = room.mode.scoreLimit;
      if (limit <= 0) return null;
      for (const p of room.players.values()) if (p.stats.kills >= limit) return 'score';
      return null;
    },
  };
}
