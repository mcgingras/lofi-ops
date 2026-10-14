/**
 * Stand-in soldiers for killcam replays (the final killcam and the per-death killcam): one Soldier
 * per replayed player, posed from recorded frames, while the live remotes are hidden.
 */
import * as THREE from 'three';
import { PRONE, type Team } from '../../../shared/constants';
import { PlayerFlags } from '../../../shared/protocol';
import type { Match } from '../../game/match';
import { FFA_LOOK, Soldier, TEAM_LOOKS } from '../../render/models/soldier';
import { getTexture } from '../../render/textures';
import type { Pose } from './killcam-math';

function lookFor(team: Team | null) {
  return team === 0 || team === 1 ? TEAM_LOOKS[team]! : FFA_LOOK;
}

export class ReplayActors {
  private soldiers = new Map<string, { s: Soldier; last: Pose | null; prone: number }>();

  get size(): number {
    return this.soldiers.size;
  }

  /** Pose everyone but `skip` (the camera's owner). `rate` < 1 for slow motion. */
  update(m: Match, poses: Map<string, Pose>, skip: string | null, dt: number, rate = 1): void {
    for (const r of m.remotes.views.values()) r.soldier.root.visible = false;
    for (const v of this.soldiers.values()) v.s.root.visible = false;
    for (const [id, p] of poses) {
      if (id === skip) continue;
      let v = this.soldiers.get(id);
      if (!v) {
        const s = new Soldier(lookFor(m.roster.get(id)?.team ?? null), getTexture('flash'));
        m.renderer.scene.add(s.root);
        v = { s, last: null, prone: p.f & PlayerFlags.PRONE ? 1 : 0 };
        this.soldiers.set(id, v);
      }
      const speed = v.last ? (Math.hypot(p.x - v.last.x, p.z - v.last.z) / Math.max(1e-3, dt)) * rate : 0;
      const fwd = v.last ? -Math.sin(p.yaw) * (p.x - v.last.x) - Math.cos(p.yaw) * (p.z - v.last.z) : 1;
      v.last = p;
      v.s.root.position.set(p.x, p.y, p.z);
      v.s.root.rotation.y = p.yaw + Math.PI;
      const alive = (p.f & PlayerFlags.ALIVE) !== 0;
      v.s.root.visible = true;
      // Ease into / out of prone like the live soldiers (the frames only carry the flag).
      const step = dt * rate;
      v.prone = p.f & PlayerFlags.PRONE ? Math.min(1, v.prone + step / PRONE.downSec) : Math.max(0, v.prone - step / PRONE.upSec);
      v.s.animate(step, { speed: alive ? Math.min(8, speed) : 0, forward: fwd, pitch: p.pitch, crouch: p.f & PlayerFlags.CROUCH ? 1 : 0, prone: v.prone, mantle: (p.f & PlayerFlags.MANTLE) !== 0, sprint: (p.f & PlayerFlags.SPRINT) !== 0, firing: (p.f & PlayerFlags.FIRING) !== 0, alive, time: m.time });
      if (m.map) v.s.setLight(m.map.lightAt(p.x, p.y + 1.2, p.z));
    }
  }

  /** World position of a stand-in's muzzle (tracers), or null if it isn't shown. */
  muzzle(id: string): THREE.Vector3 | null {
    const v = this.soldiers.get(id);
    return v && v.s.root.visible ? v.s.muzzle.getWorldPosition(new THREE.Vector3()) : null;
  }

  dispose(): void {
    for (const v of this.soldiers.values()) v.s.dispose();
    this.soldiers = new Map();
  }
}
