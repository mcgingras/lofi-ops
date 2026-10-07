/**
 * A capture zone (Domination flag, Headquarters): a cylinder players stand in.
 *
 * - One team alone in it moves `cap` (0..1) towards that team: from neutral it captures
 *   (`captureSec`), from enemy-owned it first neutralises (`neutralizeSec`); more capturers go
 *   faster (`crowdBonus` per extra player, capped at `maxRate`).
 * - Both teams in it: contested, frozen.
 * - Partial progress of the other team drains first (at the same rate) before ours builds.
 * - Nobody in it: partial progress fades over `decaySec`.
 * - The owner alone in it: partial enemy progress drains.
 */
import type { Team } from '../../../shared/constants';
import type { ZoneState } from '../../../shared/defs/modestate';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { playersIn, q2 } from './common';

export interface ZoneTuning {
  captureSec: number;
  neutralizeSec: number;
  crowdBonus: number;
  maxRate: number;
  decaySec: number;
  height: number;
}

export type ZoneResult = { kind: 'captured' | 'neutralized'; team: Team; by: PlayerState[] } | null;

export class CaptureZone {
  owner: Team | null = null;
  cap = 0;
  capTeam: Team | null = null;
  contested = false;
  present: [PlayerState[], PlayerState[]] = [[], []];
  /** Progress per second in the last update (signed: >0 building for capTeam). */
  rate = 0;

  constructor(
    readonly id: string,
    public x: number,
    public y: number,
    public z: number,
    public r: number,
    public tuning: ZoneTuning,
  ) {}

  reset(owner: Team | null = null): void {
    this.owner = owner;
    this.cap = 0;
    this.capTeam = null;
    this.contested = false;
    this.present = [[], []];
    this.rate = 0;
  }

  /** Seconds for the stage the given team is on (neutralise an enemy zone, or capture). */
  stageSec(team: Team): number {
    return this.owner !== null && this.owner !== team ? this.tuning.neutralizeSec : this.tuning.captureSec;
  }

  private mult(n: number): number {
    return Math.min(this.tuning.maxRate, 1 + this.tuning.crowdBonus * Math.max(0, n - 1));
  }

  update(room: Room, dt: number): ZoneResult {
    this.present = playersIn(room, this, this.r, this.tuning.height);
    const n0 = this.present[0].length;
    const n1 = this.present[1].length;
    this.contested = n0 > 0 && n1 > 0;
    this.rate = 0;
    if (this.contested) return null;
    if (n0 === 0 && n1 === 0) {
      if (this.cap > 0) {
        this.rate = -1 / this.tuning.decaySec;
        this.cap = Math.max(0, this.cap - dt / this.tuning.decaySec);
        if (this.cap === 0) this.capTeam = null;
      }
      return null;
    }
    const team: Team = n0 > 0 ? 0 : 1;
    const crowd = this.present[team];
    const mult = this.mult(crowd.length);
    // Someone else's partial progress drains first.
    if (this.cap > 0 && this.capTeam !== null && this.capTeam !== team) {
      const r = mult / this.stageSec(this.capTeam);
      this.rate = -r;
      this.cap = Math.max(0, this.cap - dt * r);
      if (this.cap === 0) this.capTeam = null;
      return null;
    }
    if (this.owner === team) {
      this.cap = 0;
      this.capTeam = null;
      return null;
    }
    this.capTeam = team;
    const r = mult / this.stageSec(team);
    this.rate = r;
    this.cap = Math.min(1, this.cap + dt * r);
    if (this.cap < 1) return null;
    const by = [...crowd];
    this.cap = 0;
    if (this.owner !== null) {
      // Enemy zone neutralised; the same team keeps going for the capture.
      this.owner = null;
      this.capTeam = team;
      return { kind: 'neutralized', team, by };
    }
    this.owner = team;
    this.capTeam = null;
    return { kind: 'captured', team, by };
  }

  state(): ZoneState {
    return { id: this.id, x: q2(this.x), y: q2(this.y), z: q2(this.z), r: this.r, owner: this.owner, cap: q2(this.cap), capTeam: this.capTeam, contested: this.contested };
  }
}
