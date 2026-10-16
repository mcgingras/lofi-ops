/**
 * The killcam replay renderer shared by the per-death killcam (deathcam.ts) and the final killcam
 * (killcam.ts), so both look the same:
 * - the killer's eyes: eye height eased through crouch / prone, their gun as the viewmodel (the
 *   weapon in their hands at that moment, camo and attachments), ADS zoom of that weapon and the
 *   sniper scope overlay when scoped (the HUD draws it from `scoped`), the killer's injuries as
 *   the damage tint, a knife swing on a melee kill;
 * - grenade, launcher and thrown-weapon kills follow the projectile once it leaves the hand
 *   (BO1's killcam locks on to it), then hold on the blast;
 * - killstreak kills from the streak's camera (helicopter, sentry, dog, RC-XD, top-down for
 *   strikes, riding the Valkyrie rocket);
 * - the recorded shots: kick and flash on the viewmodel, tracers, impacts (blood on hits),
 *   penetration puffs, gunshots of each shooter's own weapon; wonder weapons draw their own
 *   effect through the shot-fx registry;
 * - other players as stand-in soldiers holding their real weapons (replay.ts), projectiles in
 *   flight drawn with the weapons feature's own models.
 * All the replay's sounds go through `sfx.replay` (their own bus, slowed with the slow motion)
 * while the live game is ducked (`sfx.duckLive`).
 */
import * as THREE from 'three';
import { effectiveWeapon } from '../../../shared/defs/attachments';
import { parseGear, valueAt, type DeathcamPayload, type ProjectileTrack, type UnpackedClip } from '../../../shared/defs/deathcam';
import { NADE_ENTITY } from '../../../shared/defs/equipment';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { viewDir } from '../../../shared/math';
import { PlayerFlags, type EntitySnap } from '../../../shared/protocol';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { ViewmodelRig } from '../../game/viewmodel';
import { entityRenderers, shotFxs, type EntityView } from '../../registry';
import { getTexture } from '../../render/textures';
import { aimAt, eyeOf, trackPose } from './deathcam-math';
import { deathEffects, killProjectile, posesAt, projectileAt, replayGun, type DeathFx, type Pose } from './killcam-math';
import { ReplayActors } from './replay';

/** What to replay (the per-death and the final killcam payloads both carry this). */
export interface ReplaySource {
  killer: string;
  victim: string;
  weapon: string;
  means: string;
  at: number;
  view: 'eyes' | 'streak';
  cam?: DeathcamPayload['cam'];
  vm?: DeathcamPayload['vm'];
  clip: UnpackedClip;
}

/** How far behind and above a followed projectile the camera rides (m). */
const CHASE_BACK = 2.2;
const CHASE_UP = 0.55;

interface Proj {
  track: ProjectileTrack;
  view: EntityView | null;
  done: boolean;
}

export class ReplayView {
  /** The killer is looking through a scope right now (the HUD draws the scope overlay). */
  scoped = false;
  private src: ReplaySource | null = null;
  private actors = new ReplayActors();
  private rig: ViewmodelRig | null = null;
  private hiddenVm: { root: THREE.Object3D; parent: THREE.Object3D } | null = null;
  private lastT = -Infinity;
  private ads = 0;
  private eye = -1;
  private lastK: Pose | null = null;
  private target: { x: number; y: number; z: number } | null = null;
  private melee = false;
  private follow: ProjectileTrack | null = null;
  private chase: THREE.Vector3 | null = null;
  private projs: Proj[] = [];
  private deaths = new Map<string, DeathFx>();
  private hold = new Set<string>();
  private glows: { sprite: THREE.Sprite; life: number }[] = [];

  get active(): boolean {
    return this.src !== null;
  }

  /** Start replaying `src` from clip time `t`. `duck`: the live game's volume meanwhile (0 = muted). */
  begin(m: Match, src: ReplaySource, t: number, duck = 0): void {
    if (this.src) this.end(m);
    this.src = src;
    this.lastT = t - 0.05;
    this.ads = 0;
    this.eye = -1;
    this.lastK = null;
    this.target = null;
    this.melee = false;
    this.chase = null;
    this.scoped = false;
    this.hold = new Set([src.killer, src.victim]);
    this.deaths = deathEffects(src);
    const vAt = posesAt(src.clip.frames, src.at, this.hold).get(src.victim) ?? null;
    this.follow = src.view === 'eyes' ? killProjectile(src.clip.projectiles, src.killer, src.at, vAt) : null;
    this.projs = src.clip.projectiles.map((track) => ({ track, view: null, done: false }));
    // The local player's gun leaves the viewmodel scene while the killer's is shown.
    const root = m.viewmodel.root;
    if (root.parent && !this.hiddenVm) {
      this.hiddenVm = { root, parent: root.parent };
      root.removeFromParent();
    }
    this.rig ??= new ViewmodelRig(m.renderer.vmScene);
    sfx.duckLive(duck, 0.25);
  }

  end(m: Match | null): void {
    if (!this.src && !this.hiddenVm) return;
    this.src = null;
    this.scoped = false;
    this.actors.dispose();
    for (const p of this.projs) this.dropProj(m, p);
    this.projs = [];
    for (const g of this.glows) this.dropGlow(m, g);
    this.glows = [];
    if (this.rig) this.rig.visible = false;
    if (this.hiddenVm) {
      this.hiddenVm.parent.add(this.hiddenVm.root);
      this.hiddenVm = null;
    }
    if (m) {
      m.renderer.feed = 0;
      m.renderer.damage = 0;
      m.renderer.zoom = 1;
      m.renderer.updateFov();
    }
    sfx.duckLive(1, 0.4);
  }

  /** Throw away the viewmodel rig (match teardown). */
  dispose(): void {
    this.end(null);
    this.rig?.dispose();
    this.rig = null;
  }

  /** Draw clip time `t`. `rate`: playback speed (slow motion < 1) for animation and sound pitch. */
  frame(m: Match, t: number, dt: number, rate = 1): void {
    const src = this.src;
    if (!src || !m.map) return;
    const sound = Math.max(0.45, rate);
    sfx.replay(() => this.draw(m, src, t, dt, rate), sound);
    this.lastT = Math.max(this.lastT, t);
  }

  private draw(m: Match, src: ReplaySource, t: number, dt: number, rate: number): void {
    const r = m.renderer;
    const cam = r.cam;
    const poses = posesAt(src.clip.frames, t, this.hold);
    const step = dt * rate;
    const following = this.follow && t >= this.follow.points[0]!.t + 0.1;
    const eyes = src.view === 'eyes' && !following;
    this.actors.update(m, poses, eyes ? src.killer : null, dt, rate, { t, teams: src.clip.teams, deaths: this.deaths });
    const k = poses.get(src.killer);
    let killerGun = false;
    this.scoped = false;
    r.feed = 0;
    if (src.view === 'eyes' && following && this.follow) {
      this.chaseCam(m, this.follow, t, step);
      r.zoom = 1;
      r.damage = 0;
    } else if (eyes && k) {
      // Eye height eases through crouch / prone like the live view (the frames only carry flags).
      const want = eyeOf(k, PlayerFlags.CROUCH, PlayerFlags.PRONE);
      this.eye = this.eye < 0 ? want : this.eye + (want - this.eye) * Math.min(1, step * 10);
      cam.position.set(k.x, k.y + this.eye, k.z);
      cam.rotation.set(k.pitch, k.yaw, 0, 'YXZ');
      const gun = replayGun(k, src.vm);
      const eff = gun?.eff ?? null;
      this.ads += ((k.f & PlayerFlags.ADS ? 1 : 0) - this.ads) * Math.min(1, step * 12);
      r.zoom = 1 + ((eff?.zoom ?? 1.15) - 1) * this.ads;
      this.scoped = !!eff?.scope && this.ads > 0.85;
      const speed = this.lastK ? Math.hypot(k.x - this.lastK.x, k.z - this.lastK.z) / Math.max(1e-3, step) : 0;
      this.lastK = k;
      if (this.rig && gun) {
        killerGun = true;
        this.rig.setWeapon(gun.model, gun.attachments, gun.camo);
        this.rig.visible = !this.scoped;
        if (src.means === 'melee' && !this.melee && t >= src.at - 0.25) {
          this.melee = true;
          this.rig.action('melee', 0.45);
        }
        this.rig.update({ dt: step, time: m.time, ads: this.ads, move: Math.min(1, speed / 5) * (k.f & PlayerFlags.GROUND ? 1 : 0.2), sprint: (k.f & PlayerFlags.SPRINT) !== 0, yaw: k.yaw, pitch: k.pitch, reload: -1, raise: -1, light: m.map!.lightAt(k.x, k.y + 1.3, k.z) });
      }
      // The killer's injuries tint the screen, as in BO1's killcam.
      r.damage = Math.max(0, 0.85 - k.hp / 100) / 0.85;
    } else if (src.cam?.track) {
      // Valkyrie: ride the rocket's flight under the camera-feed look, then hold on the blast.
      const p = trackPose(src.cam.track, t);
      cam.position.set(p.x, p.y, p.z);
      cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
      r.zoom = 1;
      r.damage = 0;
      r.feed = p.done ? 0.6 : 1;
    } else if (src.cam) {
      const pv = poses.get(src.victim);
      const v = pv && pv.f & PlayerFlags.ALIVE ? pv : null; // (a victim still dead from an earlier life isn't there yet)
      // Top-down (strikes): high over the victim, a little behind so the soldier reads as a figure.
      const from = src.cam.top ? { x: src.cam.x, y: src.cam.y, z: src.cam.z + src.cam.y * 0.35 } : src.cam;
      // Follow the victim while alive; once they fall, keep looking where they were.
      if (v) this.target = { x: v.x, y: v.y + 1.1, z: v.z };
      const spot = posesAt(src.clip.frames, src.at, this.hold).get(src.victim);
      const target = this.target ?? (spot ? { x: spot.x, y: spot.y + 1.1, z: spot.z } : { x: src.cam.x, y: 0, z: src.cam.z - 1 });
      const aim = aimAt(from, target);
      cam.position.set(from.x, from.y, from.z);
      cam.rotation.set(aim.pitch, aim.yaw, 0, 'YXZ');
      r.zoom = 1;
      r.damage = 0;
    }
    r.updateFov();
    if (this.rig && !killerGun) this.rig.visible = false;
    // Rendering the viewmodel pass needs the match rig's flag; its own model is out of the scene.
    m.viewmodel.visible = killerGun && !!this.rig?.visible;
    const fwd = viewDir(cam.rotation.y, cam.rotation.x);
    sfx.listener(cam.position.x, cam.position.y, cam.position.z, fwd.x, fwd.y, fwd.z);
    this.projectiles(m, t, dt);
    this.shots(m, src, t, poses, eyes);
    this.glowStep(m, dt * rate);
  }

  /** Ride behind a projectile (pulled in front of walls), then hold looking at where it went off. */
  private chaseCam(m: Match, tr: ProjectileTrack, t: number, step: number): void {
    const cam = m.renderer.cam;
    const end = tr.points.at(-1)!;
    const p = projectileAt(tr, Math.min(t, end.t));
    if (!p) return;
    const want = new THREE.Vector3(p.x - p.dx * CHASE_BACK, p.y - p.dy * CHASE_BACK + CHASE_UP, p.z - p.dz * CHASE_BACK);
    // Keep the camera on this side of walls between it and the projectile.
    const dir = new THREE.Vector3(want.x - p.x, want.y - p.y, want.z - p.z);
    const len = dir.length();
    if (len > 1e-3) {
      dir.divideScalar(len);
      const hit = m.net.world.raycast({ x: p.x, y: p.y, z: p.z }, { x: dir.x, y: dir.y, z: dir.z }, len, 'bullets');
      if (hit) want.set(p.x + dir.x * Math.max(0.2, hit.t - 0.15), p.y + dir.y * Math.max(0.2, hit.t - 0.15), p.z + dir.z * Math.max(0.2, hit.t - 0.15));
    }
    if (t <= end.t) {
      if (!this.chase) this.chase = want.clone();
      else this.chase.lerp(want, Math.min(1, step * 9));
    }
    const at = this.chase ?? want;
    cam.position.copy(at);
    const aim = aimAt(at, t <= end.t ? p : end);
    cam.rotation.set(aim.pitch, aim.yaw, 0, 'YXZ');
  }

  /** Projectiles in flight: the weapons feature's own models, at their recorded positions; a blast where grenades end. */
  private projectiles(m: Match, t: number, dt: number): void {
    for (const pr of this.projs) {
      const pts = pr.track.points;
      const p = projectileAt(pr.track, t);
      if (!p) {
        if (pr.view) this.dropProj(m, pr);
        if (!pr.done && pts.length && t > pts.at(-1)!.t) {
          pr.done = true;
          const last = pts.at(-1)!;
          if (pr.track.kind === NADE_ENTITY && !['flashbang', 'concussion'].includes(pr.track.sub) && t - last.t < 0.5) this.blast(m, last);
        }
        continue;
      }
      if (!pr.view) {
        const snap: EntitySnap = { id: -1 - pr.track.id, kind: pr.track.kind, x: p.x, y: p.y, z: p.z, yaw: Math.atan2(-p.dx, -p.dz), owner: pr.track.owner ?? undefined, s: { e: pr.track.sub, k: 0 } };
        pr.view = entityRenderers.get(pr.track.kind)?.(snap, m) ?? null;
        if (pr.view) m.renderer.scene.add(pr.view.object);
      }
      if (!pr.view) continue;
      const yaw = Math.atan2(-p.dx, -p.dz);
      const snap: EntitySnap = { id: -1 - pr.track.id, kind: pr.track.kind, x: p.x, y: p.y, z: p.z, yaw, owner: pr.track.owner ?? undefined, s: { e: pr.track.sub, k: 0 } };
      const positioned = pr.view.update?.(snap, dt, m);
      if (positioned !== false) {
        pr.view.object.position.set(p.x, p.y, p.z);
        pr.view.object.rotation.y = yaw;
      }
    }
  }

  private dropProj(m: Match | null, pr: Proj): void {
    if (!pr.view) return;
    pr.view.object.removeFromParent();
    pr.view.dispose?.();
    pr.view = null;
    void m;
  }

  private blast(m: Match, at: { x: number; y: number; z: number }): void {
    m.effects.puff('spark', at, { x: 0, y: 1, z: 0 }, 14);
    m.effects.puff('dust', at, { x: 0, y: 1, z: 0 }, 18);
    m.effects.puff('dust', { x: at.x, y: at.y + 0.6, z: at.z }, { x: 0, y: 1, z: 0 }, 10);
    sfx.play('weapons.boom', { at, volume: 1.6 });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: getTexture('glow'), color: 0xffc060, transparent: true, depthWrite: false }));
    sprite.position.set(at.x, at.y + 0.3, at.z);
    sprite.scale.setScalar(4.5);
    m.renderer.scene.add(sprite);
    this.glows.push({ sprite, life: 0.3 });
  }

  private glowStep(m: Match, dt: number): void {
    for (const g of this.glows) {
      g.life -= dt;
      (g.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, g.life / 0.3);
    }
    for (const g of this.glows.filter((x) => x.life <= 0)) this.dropGlow(m, g);
    this.glows = this.glows.filter((x) => x.life > 0);
  }

  private dropGlow(m: Match | null, g: { sprite: THREE.Sprite }): void {
    g.sprite.removeFromParent();
    g.sprite.material.dispose();
    void m;
  }

  /** The weapon `id` held at clip time `t`. */
  private weaponOf(src: ReplaySource, id: string, t: number): string {
    const g = parseGear(valueAt(src.clip.gear.get(id), t)?.gear);
    return g?.weapon ?? (id === src.killer ? (src.vm?.weapon ?? src.weapon) : 'ak47');
  }

  private shots(m: Match, src: ReplaySource, t: number, poses: Map<string, Pose>, eyes: boolean): void {
    const cam = m.renderer.cam;
    for (const s of src.clip.shots) {
      if (s.t <= this.lastT || s.t > t) continue;
      const to = { x: s.end[0], y: s.end[1], z: s.end[2] };
      const weapon = this.weaponOf(src, s.id, s.t);
      const mine = s.id === src.killer && eyes;
      const held = parseGear(valueAt(src.clip.gear.get(s.id), s.t)?.gear);
      const def = WEAPON_BY_ID.get(weapon);
      const suppressed = def ? effectiveWeapon(def, held?.attachments ?? (s.id === src.killer ? src.vm?.attachments : []) ?? []).suppressed : false;
      const muzzle = () => (mine ? new THREE.Vector3(0.1, -0.12, -0.6).applyQuaternion(cam.quaternion).add(cam.position) : this.actors.muzzle(s.id));
      // A weapon with its own look (wonder weapons): its replay draws the bolt / blast / arc / frost.
      const fx = shotFxs.get(weapon)?.replay;
      const p = poses.get(s.id);
      const at = p ? { x: p.x, y: p.y + 1.5, z: p.z } : to;
      if (fx) {
        const from = muzzle();
        if (mine) this.rig?.shoot(m.time, 0.8);
        sfx.gunshot(weapon, mine ? undefined : at, false);
        if (from) fx(m, s.id, from, to, s.hit, s.t);
        continue;
      }
      if (mine) {
        this.rig?.shoot(m.time, 0.8);
        sfx.gunshot(weapon, undefined, suppressed);
        m.effects.tracer(muzzle()!, to);
      } else {
        const from = muzzle();
        if (from) m.effects.tracer(from, to);
        sfx.gunshot(weapon, at, suppressed);
      }
      if (s.hit) m.effects.puff('blood', to);
      else m.effects.puff('dust', to, undefined, 3);
      for (const q of s.pen ?? []) m.effects.puff('dust', { x: q[0], y: q[1], z: q[2] }, undefined, 3);
    }
  }
}
