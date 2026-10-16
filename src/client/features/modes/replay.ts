/**
 * Stand-in soldiers for killcam replays (the final killcam and the per-death killcam): one Soldier
 * per replayed player, posed from recorded frames, while the live remotes are hidden. Each holds
 * the weapon they held at that moment (their camo, the weapons feature's third-person models),
 * wears their team's look (Infected green for the Infected), frosts over under Winter's Howl, and
 * a Thundergun or a shattering Winter's Howl kill throws or breaks the body as it does live.
 */
import * as THREE from 'three';
import { PRONE, type Team } from '../../../shared/constants';
import { parseGear } from '../../../shared/defs/deathcam';
import { PlayerFlags } from '../../../shared/protocol';
import type { Match } from '../../game/match';
import { FFA_LOOK, Soldier, TEAM_LOOKS } from '../../render/models/soldier';
import { getTexture } from '../../render/textures';
import { dressSoldier, isWornMaterial } from '../weapons/worldmodels';
import { infectSoldier, isInfectedMatch } from './infected';
import type { DeathFx, Pose } from './killcam-math';

function lookFor(team: Team | null) {
  return team === 0 || team === 1 ? TEAM_LOOKS[team]! : FFA_LOOK;
}

const ICE = new THREE.Color(0.7, 0.88, 1.25);

interface Actor {
  s: Soldier;
  last: Pose | null;
  prone: number;
  team: Team | null;
  /** Body tints before any frost (restored as it thaws). */
  base: Map<THREE.Material, THREE.Color> | null;
}

export class ReplayActors {
  private actors = new Map<string, Actor>();

  get size(): number {
    return this.actors.size;
  }

  /**
   * Pose everyone but `skip` (the camera's owner) at clip time `t`. `rate` < 1 for slow motion.
   * `teams`: each player's team in the clip (falls back to the roster); `deaths`: bodies to throw or break.
   */
  update(m: Match, poses: Map<string, Pose>, skip: string | null, dt: number, rate = 1, o: { t?: number; teams?: ReadonlyMap<string, number | null>; deaths?: ReadonlyMap<string, DeathFx> } = {}): void {
    for (const r of m.remotes.views.values()) r.soldier.root.visible = false;
    for (const v of this.actors.values()) v.s.root.visible = false;
    const infected = isInfectedMatch(m);
    for (const [id, p] of poses) {
      if (id === skip) continue;
      const team = (o.teams?.get(id) ?? m.roster.get(id)?.team ?? null) as Team | null;
      let v = this.actors.get(id);
      if (v && v.team !== team) {
        v.s.dispose();
        this.actors.delete(id);
        v = undefined;
      }
      if (!v) {
        const s = new Soldier(lookFor(team), getTexture('flash'));
        m.renderer.scene.add(s.root);
        v = { s, last: null, prone: p.f & PlayerFlags.PRONE ? 1 : 0, team, base: null };
        this.actors.set(id, v);
      }
      const g = parseGear(p.gear);
      if (p.gear !== undefined) dressSoldier(v.s, g?.weapon ?? '', g?.camo ?? 'none');
      if (infected && team === 1) infectSoldier(v.s);
      this.frost(v, p.frost);
      const step = dt * rate;
      const speed = v.last ? Math.hypot(p.x - v.last.x, p.z - v.last.z) / Math.max(1e-3, step) : 0;
      const fwd = v.last ? -Math.sin(p.yaw) * (p.x - v.last.x) - Math.cos(p.yaw) * (p.z - v.last.z) : 1;
      v.last = p;
      v.s.root.position.set(p.x, p.y, p.z);
      v.s.root.rotation.y = p.yaw + Math.PI;
      const alive = (p.f & PlayerFlags.ALIVE) !== 0;
      v.s.root.visible = true;
      // Ease into / out of prone like the live soldiers (the frames only carry the flag).
      v.prone = p.f & PlayerFlags.PRONE ? Math.min(1, v.prone + step / PRONE.downSec) : Math.max(0, v.prone - step / PRONE.upSec);
      v.s.animate(step, { speed: alive ? Math.min(8, speed) : 0, forward: fwd, pitch: p.pitch, crouch: p.f & PlayerFlags.CROUCH ? 1 : 0, prone: v.prone, mantle: (p.f & PlayerFlags.MANTLE) !== 0, sprint: (p.f & PlayerFlags.SPRINT) !== 0, firing: (p.f & PlayerFlags.FIRING) !== 0, alive, time: m.time });
      const fx = !alive && o.t !== undefined ? o.deaths?.get(id) : undefined;
      if (fx && o.t! >= fx.t) {
        const k = Math.min(0.9, o.t! - fx.t);
        if (fx.kind === 'shatter') v.s.root.visible = false;
        else v.s.root.position.set(p.x + fx.dx * 9 * k, p.y + Math.max(0, 5 * k - 7 * k * k), p.z + fx.dz * 9 * k);
      }
      if (m.map) v.s.setLight(m.map.lightAt(p.x, p.y + 1.2, p.z));
    }
  }

  /** Frost tints the body towards ice (Winter's Howl), and thaws back. */
  private frost(v: Actor, frost: number): void {
    if (frost <= 0 && !v.base) return;
    const mats = v.s.mats.filter((mt) => !isWornMaterial(mt));
    if (!v.base) v.base = new Map(mats.map((mt) => [mt, mt.uniforms.uTint.value.clone()]));
    const k = Math.max(0, Math.min(1, frost / 100));
    for (const mt of mats) {
      const b = v.base.get(mt);
      if (b) mt.uniforms.uTint.value.copy(b).lerp(b.clone().multiply(ICE), k);
    }
  }

  /** World position of a stand-in's muzzle (tracers), or null if it isn't shown. */
  muzzle(id: string): THREE.Vector3 | null {
    const v = this.actors.get(id);
    return v && v.s.root.visible ? v.s.muzzle.getWorldPosition(new THREE.Vector3()) : null;
  }

  dispose(): void {
    for (const v of this.actors.values()) v.s.dispose();
    this.actors = new Map();
  }
}
