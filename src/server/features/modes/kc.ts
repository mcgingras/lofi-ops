/**
 * Kill Confirmed: every death drops the victim's dog tags where they fell (an entity in the
 * victim's team colour). An enemy of the victim walking over them confirms the kill (+1 team
 * score, the only way to score); a teammate of the victim denies it. Kills alone give player
 * score. Tags vanish after `tagLifeSec` (oldest first past `maxTags`).
 */
import type { Team } from '../../../shared/constants';
import { MODE_TUNING, MODE_XP } from '../../../shared/defs/modes';
import { MODE_ENTITY, type ModeStatePayload } from '../../../shared/defs/modestate';
import type { Entity } from '../../entities';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import type { BotObjective } from './bots';
import { announce, award, groundAt, qt, resetModeExt, scoreKill } from './common';
import { TdmRules } from './tdm';

const T = MODE_TUNING.kc;

interface TagData {
  victim: string;
  killer: string | null;
  at: number;
}

export class KcRules extends TdmRules {
  override readonly id = 'kc';
  override readonly statKeys = ['confirms', 'denies'];
  confirmed: [number, number] = [0, 0];
  denied: [number, number] = [0, 0];

  override setup(room: Room): void {
    this.setupController(room);
    room.bus.on('death', (e) => {
      scoreKill(room, e, false);
      if (room.phase !== 'playing' || e.victim.team === null) return;
      const v = e.victim;
      const y = groundAt(room, v.move.x, v.move.z, v.move.y);
      room.entities.add({ kind: MODE_ENTITY.tag, x: v.move.x, y, z: v.move.z, yaw: Math.random() * Math.PI * 2, team: v.team, s: { v: v.id }, data: { victim: v.id, killer: e.attacker?.id ?? null, at: room.time } satisfies TagData });
      const tags = this.tags();
      if (tags.length > T.maxTags) {
        tags.sort((a, b) => (a.data as TagData).at - (b.data as TagData).at);
        for (const t of tags.slice(0, tags.length - T.maxTags)) room.entities.remove(t.id);
      }
    });
    room.bus.on('tick', () => this.tick());
  }

  override reset(room: Room): void {
    resetModeExt(room);
    this.confirmed = [0, 0];
    this.denied = [0, 0];
    this.dirty = true;
  }

  tags(): Entity[] {
    return this.room.entities.byKind(MODE_ENTITY.tag);
  }

  private tick(): void {
    const room = this.room;
    if (room.phase !== 'playing') return;
    for (const tag of this.tags()) {
      const d = tag.data as TagData;
      if (room.time - d.at > T.tagLifeSec) {
        room.entities.remove(tag.id);
        continue;
      }
      const picker = this.pickerFor(tag);
      if (!picker || tag.team === null || tag.team === undefined || picker.team === null) continue;
      room.entities.remove(tag.id);
      if (picker.team !== tag.team) {
        const team: Team = picker.team;
        this.confirmed[team] += 1;
        award(room, picker, 'confirm', MODE_XP.confirm, 'confirms');
        announce(room, { kind: 'kc.confirm', team, player: picker.id, reason: d.victim, points: MODE_XP.confirm }, picker);
        room.addTeamScore(team, 1, 'confirm', picker);
      } else {
        this.denied[picker.team] += 1;
        award(room, picker, 'deny', MODE_XP.deny, 'denies');
        announce(room, { kind: 'kc.deny', team: picker.team, player: picker.id, reason: d.victim, points: MODE_XP.deny }, picker);
      }
      if (room.phase !== 'playing') return;
    }
  }

  private pickerFor(tag: Entity): PlayerState | null {
    let best: PlayerState | null = null;
    let bestD: number = T.pickupRadius;
    for (const p of this.room.players.values()) {
      if (!p.alive || p.team === null) continue;
      if (Math.abs(p.move.y - tag.y) > 2) continue;
      const d = Math.hypot(p.move.x - tag.x, p.move.z - tag.z);
      if (d <= bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  override state(): ModeStatePayload {
    return { mode: 'kc', time: qt(this.room.time), kc: { confirmed: [this.confirmed[0], this.confirmed[1]], denied: [this.denied[0], this.denied[1]] } };
  }

  override objectives(p: PlayerState): BotObjective[] {
    if (p.team === null) return [];
    const out: BotObjective[] = [];
    for (const tag of this.tags()) {
      const d = Math.hypot(tag.x - p.move.x, tag.z - p.move.z);
      if (d > 40) continue;
      const enemyTag = tag.team !== p.team;
      // Close tags are worth a detour; enemy tags score, own tags only deny.
      const priority = Math.max(0.1, (enemyTag ? 0.8 : 0.55) - d / 80);
      out.push({ kind: 'collect', id: `tag:${tag.id}`, pos: { x: tag.x, y: tag.y, z: tag.z }, radius: T.pickupRadius, priority });
    }
    return out;
  }
}
