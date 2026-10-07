/**
 * Other players: interpolated snapshots -> team-tinted soldiers with walk cycle, crouch, aim pitch,
 * muzzle flash and the death topple; footsteps. Also keeps each one's head position on screen for
 * HUD name tags.
 */
import * as THREE from 'three';
import { hashString } from '../../shared/math';
import { PlayerFlags, type RosterEntry } from '../../shared/protocol';
import type { Team } from '../../shared/constants';
import type { SnapshotBuffer } from '../netcode/interp';
import type { MapScene } from '../render/mapbuilder';
import { FFA_LOOK, Soldier, TEAM_LOOKS, type SoldierLook } from '../render/models/soldier';
import { getTexture } from '../render/textures';
import { footstepVolume } from '../registry';
import { sfx } from './audio';

export interface RemoteView {
  id: string;
  soldier: Soldier;
  team: Team | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  alive: boolean;
  crouch: number;
  flags: number;
  weapon: string;
  /** Seconds since it died (for hiding the body). */
  deadFor: number;
  stride: number;
  /** Last seen in a snapshot (room render time). */
  present: boolean;
}

const FFA_TINTS = [0xffffff, 0xd8dcc8, 0xc8c0b0];

export class Remotes {
  readonly views = new Map<string, RemoteView>();

  constructor(private scene: THREE.Scene) {}

  private lookFor(id: string, team: Team | null): SoldierLook {
    if (team === 0 || team === 1) return TEAM_LOOKS[team]!;
    return { ...FFA_LOOK, vest: FFA_TINTS[hashString(id) % FFA_TINTS.length]! };
  }

  update(dt: number, t: number, interp: SnapshotBuffer, roster: Map<string, RosterEntry>, myId: string, map: MapScene | null, time: number): void {
    const seen = new Set<string>();
    for (const id of interp.ids(t)) {
      if (id === myId) continue;
      const s = interp.sample(id, t);
      if (!s) continue;
      seen.add(id);
      const team = roster.get(id)?.team ?? null;
      let v = this.views.get(id);
      if (v && v.team !== team) {
        v.soldier.dispose();
        this.views.delete(id);
        v = undefined;
      }
      if (!v) {
        const soldier = new Soldier(this.lookFor(id, team), getTexture('flash'));
        this.scene.add(soldier.root);
        v = { id, soldier, team, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, alive: true, crouch: 0, flags: s.f, weapon: s.w, deadFor: 0, stride: 0, present: true };
        this.views.set(id, v);
      }
      const alive = (s.f & PlayerFlags.ALIVE) !== 0;
      v.present = true;
      v.x = s.x;
      v.y = s.y;
      v.z = s.z;
      v.yaw = s.yaw;
      v.pitch = s.pitch;
      v.flags = s.f;
      v.weapon = s.w;
      if (alive && !v.alive) v.deadFor = 0;
      v.alive = alive;
      v.deadFor = alive ? 0 : v.deadFor + dt;
      const crouched = (s.f & PlayerFlags.CROUCH) !== 0;
      v.crouch += ((crouched ? 1 : 0) - v.crouch) * Math.min(1, dt * 12);
      const speed = Math.hypot(s.vx, s.vz);
      const fwd = -Math.sin(s.yaw) * s.vx - Math.cos(s.yaw) * s.vz;
      const sprint = (s.f & PlayerFlags.SPRINT) !== 0;
      const root = v.soldier.root;
      root.position.set(s.x, s.y, s.z);
      root.rotation.y = s.yaw + Math.PI;
      root.visible = alive || v.deadFor < 4;
      v.soldier.animate(dt, { speed: alive ? speed : 0, forward: fwd, pitch: s.pitch, crouch: v.crouch, sprint, firing: (s.f & PlayerFlags.FIRING) !== 0, alive, time });
      if (map) v.soldier.setLight(map.lightAt(s.x, s.y + 1.2, s.z));
      // Footsteps.
      const grounded = (s.f & PlayerFlags.GROUND) !== 0;
      if (alive && grounded && speed > 2 && !crouched) {
        v.stride += speed * dt;
        if (v.stride > (sprint ? 2.2 : 1.7)) {
          v.stride = 0;
          const volume = footstepVolume(id, sprint ? 0.9 : 0.5);
          if (volume > 0) sfx.play('step', { at: { x: s.x, y: s.y, z: s.z }, volume, rate: 0.9 + Math.random() * 0.2, lowpass: 1800 });
        }
      }
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      v.soldier.dispose();
      this.views.delete(id);
    }
  }

  dispose(): void {
    for (const v of this.views.values()) v.soldier.dispose();
    this.views.clear();
  }
}
