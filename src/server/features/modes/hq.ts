/**
 * Headquarters: one HQ at a time, rotating through MapData.objectives.hq (or derived points).
 * It comes online `firstSec` after the start (then `relocateSec` after the previous one goes),
 * is captured by standing in it (zone rules, `captureSec`), then scores its owners
 * `pointsPerSec` every second for up to `holdSec`. While it stands its defenders do not respawn;
 * enemies destroy it by standing in it without defenders (`destroySec`). When it is destroyed or
 * expires the dead defenders come back and the next HQ is picked. Unclaimed for `idleSec`, it
 * moves on.
 */
import type { Team } from '../../../shared/constants';
import { MODE_TUNING, MODE_XP } from '../../../shared/defs/modes';
import { MODE_ENTITY, type ModeStatePayload } from '../../../shared/defs/modestate';
import type { ObjectivePoint, SpawnPoint } from '../../../shared/maps/types';
import type { Entity } from '../../entities';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import type { BotObjective } from './bots';
import { allSpawns, announce, award, groundAt, initialSpawnWindow, isEnemyKill, near2D, objectivePoints, otherTeam, q2, qt, rankSpawns, resetModeExt, scoreKill } from './common';
import { TdmRules } from './tdm';
import { CaptureZone } from './zone';

const T = MODE_TUNING.hq;

export type HqPhase = 'waiting' | 'neutral' | 'held';

export class HqRules extends TdmRules {
  override readonly id = 'hq';
  override readonly statKeys = ['captures', 'destroys', 'defends'];
  phase: HqPhase = 'waiting';
  zone: CaptureZone | null = null;
  /** Room time the current phase ends (online / moves / expires). */
  endsAt = 0;
  private points: ObjectivePoint[] = [];
  private lastIndex = -1;
  private ent: Entity | null = null;
  private scoreAcc = 0;
  private started = false;

  override setup(room: Room): void {
    this.setupController(room);
    room.bus.on('death', (e) => {
      if (!scoreKill(room, e, false) || !isEnemyKill(room, e)) return;
      const z = this.zone;
      const a = e.attacker;
      if (!z || this.phase !== 'held' || z.owner !== a.team) return;
      if (near2D(e.victim.move, z, z.r * T.defendRadii) || near2D(a.move, z, z.r)) {
        award(room, a, 'defend', MODE_XP.hqDefend, 'defends');
        announce(room, { kind: 'hq.defend', team: a.team, player: a.id, obj: 'HQ' }, a);
      }
    });
    room.bus.on('matchStart', () => {
      this.started = true;
      this.phase = 'waiting';
      this.endsAt = room.time + T.firstSec;
      this.dirty = true;
    });
    room.bus.on('tick', ({ dt }) => this.tick(dt));
  }

  override reset(room: Room): void {
    resetModeExt(room);
    this.points = objectivePoints(room.map, 'hq');
    this.lastIndex = -1;
    this.zone = null;
    this.ent = null;
    this.phase = 'waiting';
    this.endsAt = room.time + T.firstSec;
    this.scoreAcc = 0;
    this.started = false;
    this.dirty = true;
  }

  /** Respawn: none for the HQ's owners while it stands. */
  override respawnDelay(_room: Room, p: PlayerState): number | null {
    if (this.phase === 'held' && this.zone && p.team !== null && p.team === this.zone.owner) return null;
    return T.respawnSec;
  }

  private activate(): void {
    const room = this.room;
    if (!this.points.length) return;
    let i = Math.floor(Math.random() * this.points.length);
    if (this.points.length > 1 && i === this.lastIndex) i = (i + 1 + Math.floor(Math.random() * (this.points.length - 1))) % this.points.length;
    this.lastIndex = i;
    const p = this.points[i]!;
    this.zone = new CaptureZone('HQ', p.x, groundAt(room, p.x, p.z, p.y), p.z, p.radius, { ...T, neutralizeSec: T.destroySec });
    this.phase = 'neutral';
    this.endsAt = room.time + T.idleSec;
    this.ent = room.entities.add({ kind: MODE_ENTITY.hq, x: p.x, y: this.zone.y, z: p.z, yaw: 0, team: null, s: {} });
    this.syncEntity();
    announce(room, { kind: 'hq.online', team: null, player: null, obj: 'HQ' });
  }

  /** The HQ goes away: dead owners get their respawn back, the next one comes after a pause. */
  private release(): void {
    const room = this.room;
    const owner = this.zone?.owner ?? null;
    if (owner !== null) {
      let k = 0;
      for (const p of room.players.values()) {
        if (p.team === owner && !p.alive && p.respawnAt === null) p.respawnAt = room.time + T.releaseRespawnSec + 0.15 * k++;
      }
    }
    if (this.ent) room.entities.remove(this.ent.id);
    this.ent = null;
    this.zone = null;
    this.phase = 'waiting';
    this.endsAt = room.time + T.relocateSec;
    this.scoreAcc = 0;
    this.dirty = true;
  }

  private syncEntity(): void {
    const z = this.zone;
    if (!z || !this.ent) return;
    this.ent.team = z.owner;
    this.ent.s = { r: z.r, o: z.owner ?? -1, c: q2(z.cap), ct: z.capTeam ?? -1, x: z.contested, st: this.phase };
  }

  private tick(dt: number): void {
    const room = this.room;
    if (room.phase !== 'playing' || !this.started) return;
    if (this.phase === 'waiting') {
      if (room.time >= this.endsAt) this.activate();
      return;
    }
    const z = this.zone;
    if (!z) return;
    const before = `${z.owner}|${z.capTeam}|${z.contested}`;
    const res = z.update(room, dt);
    if (`${z.owner}|${z.capTeam}|${z.contested}` !== before) this.dirty = true;
    if (res?.kind === 'captured') {
      this.phase = 'held';
      this.endsAt = room.time + T.holdSec;
      this.scoreAcc = 0;
      for (const p of res.by) award(room, p, 'hqCapture', MODE_XP.hqCapture, 'captures');
      announce(room, { kind: 'hq.capture', team: res.team, player: res.by[0]?.id ?? null, obj: 'HQ' }, res.by[0] ?? null);
    } else if (res?.kind === 'neutralized') {
      const loser = otherTeam(res.team);
      z.owner = loser; // for release(): the losers get their respawns back
      for (const p of res.by) award(room, p, 'hqDestroy', MODE_XP.hqDestroy, 'destroys');
      announce(room, { kind: 'hq.destroy', team: res.team, player: res.by[0]?.id ?? null, obj: 'HQ' }, res.by[0] ?? null);
      this.release();
      return;
    }
    if (room.phase !== 'playing') return;
    if (this.phase === 'held' && z.owner !== null) {
      this.scoreAcc += dt;
      while (this.scoreAcc >= 1 && room.phase === 'playing') {
        this.scoreAcc -= 1;
        room.addTeamScore(z.owner, T.pointsPerSec, 'hq');
      }
      if (room.phase !== 'playing') return;
      if (room.time >= this.endsAt) {
        announce(room, { kind: 'hq.expire', team: z.owner, player: null, obj: 'HQ' });
        this.release();
        return;
      }
    } else if (this.phase === 'neutral' && room.time >= this.endsAt) {
      announce(room, { kind: 'hq.move', team: null, player: null, obj: 'HQ' });
      this.release();
      return;
    }
    this.syncEntity();
  }

  override spawnPoints(room: Room, p: PlayerState): SpawnPoint[] {
    if (p.team === null) return rankSpawns(room, p, room.map.spawns.ffa);
    const own = room.map.spawns.teams[p.team];
    if (initialSpawnWindow(room) && own.length) return own;
    const z = this.zone;
    return rankSpawns(room, p, allSpawns(room.map), (pt) => {
      if (!z) return 0;
      // Not on top of the HQ, not across the map either.
      const d = Math.hypot(z.x - pt.x, z.z - pt.z);
      return d < 12 ? -30 : -Math.abs(d - 22) * 0.4;
    });
  }

  override state(viewer: PlayerState): ModeStatePayload {
    const z = this.zone;
    let me: ModeStatePayload['me'] = null;
    if (z && viewer.team !== null && z.present[viewer.team as Team].includes(viewer) && z.capTeam === viewer.team && !z.contested) {
      me = { kind: z.owner === null ? 'capture' : 'destroy', target: 'HQ', progress: q2(z.cap), rate: q2(z.rate) };
    }
    return { mode: 'hq', time: qt(this.room.time), hq: { state: this.phase, zone: z ? z.state() : null, endsAt: this.started ? qt(this.endsAt) : null }, me };
  }

  override objectives(p: PlayerState): BotObjective[] {
    const z = this.zone;
    if (!z || p.team === null) return [];
    const pos = { x: z.x, y: z.y, z: z.z };
    if (this.phase === 'neutral') return [{ kind: 'capture', id: 'HQ', pos, radius: z.r, priority: 0.85, stay: true }];
    if (z.owner === p.team) return [{ kind: 'defend', id: 'HQ', pos, radius: z.r * 2, priority: z.capTeam !== null && z.capTeam !== p.team ? 0.95 : 0.6, stay: true }];
    return [{ kind: 'destroy', id: 'HQ', pos, radius: z.r, priority: 0.9, stay: true }];
  }
}
