/**
 * Domination: flags A/B/C (MapData.objectives.dom, or derived). Capture a neutral flag by
 * standing in it; an enemy flag must be neutralised first, then captured (see zone.ts for
 * contest/drain rules). Every `tickSec` each team scores `pointsPerFlag` per flag it holds.
 * Kills score player points only. Defends: killing an enemy near a flag your team holds (or
 * while standing on it). Spawns lean towards your flags and away from enemy ones.
 */
import type { Team } from '../../../shared/constants';
import type { MatchResults } from '../../../shared/events';
import { MODE_TUNING, MODE_XP } from '../../../shared/defs/modes';
import { MODE_ENTITY, type ModeStatePayload } from '../../../shared/defs/modestate';
import type { SpawnPoint } from '../../../shared/maps/types';
import type { Entity } from '../../entities';
import type { ModeRules } from '../../modes/types';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import type { BotObjective } from './bots';
import { allSpawns, announce, award, groundAt, initialSpawnWindow, isEnemyKill, near2D, objectivePoints, q2, qt, rankSpawns, resetModeExt, scoreKill } from './common';
import { TdmRules } from './tdm';
import { CaptureZone } from './zone';

const T = MODE_TUNING.dom;

interface Flag {
  zone: CaptureZone;
  ent: Entity | null;
}

export class DomRules extends TdmRules {
  override readonly id = 'dom';
  override readonly statKeys = ['captures', 'defends'];
  flags: Flag[] = [];
  private tickAcc = 0;

  override setup(room: Room): void {
    // TdmRules.setup would score kills as team points; DOM only gives player score.
    this.setupController(room);
    room.bus.on('death', (e) => {
      if (!scoreKill(room, e, false) || !isEnemyKill(room, e)) return;
      const a = e.attacker;
      for (const f of this.flags) {
        const z = f.zone;
        if (z.owner === null || z.owner !== a.team) continue;
        if (near2D(e.victim.move, z, z.r * T.defendRadii) || near2D(a.move, z, z.r)) {
          award(room, a, 'defend', MODE_XP.defend, 'defends');
          announce(room, { kind: 'dom.defend', team: a.team, player: a.id, obj: z.id }, a);
          break;
        }
      }
    });
    room.bus.on('tick', ({ dt }) => this.tick(dt));
    room.bus.on('playerLeave', () => (this.dirty = true));
  }

  override reset(room: Room): void {
    resetModeExt(room);
    this.tickAcc = 0;
    this.flags = objectivePoints(room.map, 'dom').map((p) => {
      const zone = new CaptureZone(p.id, p.x, groundAt(room, p.x, p.z, p.y), p.z, p.radius, T);
      return { zone, ent: null };
    });
    this.syncEntities();
    this.dirty = true;
  }

  private syncEntities(): void {
    const room = this.room;
    for (const f of this.flags) {
      const z = f.zone;
      if (!f.ent || !room.entities.get(f.ent.id)) f.ent = room.entities.add({ kind: MODE_ENTITY.flag, x: z.x, y: z.y, z: z.z, yaw: 0, team: null, s: {} });
      f.ent.team = z.owner;
      f.ent.s = { id: z.id, r: z.r, o: z.owner ?? -1, c: q2(z.cap), ct: z.capTeam ?? -1, x: z.contested };
    }
  }

  private tick(dt: number): void {
    const room = this.room;
    if (room.phase !== 'playing' || !this.flags.length) return;
    for (const f of this.flags) {
      const before = `${f.zone.owner}|${f.zone.capTeam}|${f.zone.contested}`;
      const res = f.zone.update(room, dt);
      if (`${f.zone.owner}|${f.zone.capTeam}|${f.zone.contested}` !== before) this.dirty = true;
      if (!res) continue;
      const id = f.zone.id;
      if (res.kind === 'captured') {
        for (const p of res.by) award(room, p, 'capture', MODE_XP.capture, 'captures');
        announce(room, { kind: 'dom.capture', team: res.team, player: res.by[0]?.id ?? null, obj: id }, res.by[0] ?? null);
      } else {
        for (const p of res.by) award(room, p, 'neutralize', MODE_XP.neutralize, 'neutralizes');
        announce(room, { kind: 'dom.neutralize', team: res.team, player: res.by[0]?.id ?? null, obj: id }, res.by[0] ?? null);
      }
      if (room.phase !== 'playing') return;
    }
    this.syncEntities();
    this.tickAcc += dt;
    if (this.tickAcc >= T.tickSec) {
      this.tickAcc -= T.tickSec;
      const held: [number, number] = [0, 0];
      for (const f of this.flags) if (f.zone.owner !== null) held[f.zone.owner] += T.pointsPerFlag;
      for (const team of [0, 1] as const) {
        if (held[team] > 0 && room.phase === 'playing') room.addTeamScore(team, held[team], 'flags');
      }
    }
  }

  override spawnPoints(room: Room, p: PlayerState): SpawnPoint[] {
    if (p.team === null) return rankSpawns(room, p, room.map.spawns.ffa);
    const own = room.map.spawns.teams[p.team];
    if (initialSpawnWindow(room) && own.length) return own;
    const team = p.team;
    const mine = this.flags.filter((f) => f.zone.owner === team).map((f) => f.zone);
    const theirs = this.flags.filter((f) => f.zone.owner !== null && f.zone.owner !== team).map((f) => f.zone);
    const pool = allSpawns(room.map);
    return rankSpawns(room, p, pool, (pt) => {
      let s = 0;
      if (mine.length) s -= Math.min(...mine.map((z) => Math.hypot(z.x - pt.x, z.z - pt.z))) * 0.5;
      else s -= Math.hypot(own[0] ? own[0].x - pt.x : 0, own[0] ? own[0].z - pt.z : 0) * 0.3;
      if (theirs.length) s += Math.min(20, Math.min(...theirs.map((z) => Math.hypot(z.x - pt.x, z.z - pt.z)))) * 0.6;
      return s;
    });
  }

  override checkEnd(room: Room): MatchResults['reason'] | null {
    const limit = room.mode.scoreLimit;
    return limit > 0 && (room.teamScores[0] >= limit || room.teamScores[1] >= limit) ? 'score' : null;
  }

  override state(viewer: PlayerState): ModeStatePayload {
    const me = viewer.team === null ? null : this.flags.find((f) => f.zone.present[viewer.team as Team].includes(viewer));
    let action: ModeStatePayload['me'] = null;
    if (me && viewer.team !== null && me.zone.capTeam === viewer.team && !me.zone.contested) {
      action = { kind: me.zone.owner === null ? 'capture' : 'neutralize', target: me.zone.id, progress: q2(me.zone.cap), rate: q2(me.zone.rate) };
    }
    return { mode: 'dom', time: qt(this.room.time), flags: this.flags.map((f) => f.zone.state()), me: action };
  }

  override objectives(p: PlayerState): BotObjective[] {
    if (p.team === null) return [];
    const team = p.team;
    const out: BotObjective[] = [];
    const ownedCount = this.flags.filter((f) => f.zone.owner === team).length;
    for (const f of this.flags) {
      const z = f.zone;
      const pos = { x: z.x, y: z.y, z: z.z };
      if (z.owner === team) {
        // Ours: defend, more urgently when the enemy is taking it.
        const threatened = z.capTeam !== null && z.capTeam !== team && z.cap > 0;
        out.push({ kind: 'defend', id: z.id, pos, radius: z.r, priority: threatened || z.contested ? 0.9 : 0.25 });
      } else {
        const neutral = z.owner === null;
        // B (the middle one) is the usual swing flag; neutral flags are quicker.
        const base = neutral ? 0.75 : 0.6;
        out.push({ kind: 'capture', id: z.id, pos, radius: z.r, priority: Math.min(1, base + (ownedCount === 0 ? 0.15 : 0) + (z.capTeam === team ? 0.1 : 0)), stay: true });
      }
    }
    return out;
  }
}
