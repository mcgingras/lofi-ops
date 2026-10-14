/**
 * The first-person gun (prototype viewmodel): hip/ADS blend, walk bob, mouse sway, recoil kick,
 * reload dip, raise/lower on weapon switch, muzzle flash (and the world flash light). Prone: the
 * gun sits lower with a slow side-to-side crawl bob and less sway; it dips out of the way while
 * going down or getting up, and during a mantle.
 */
import * as THREE from 'three';
import { G, setDynLight } from '../render/shader';
import { getTexture, unbindTexture } from '../render/textures';
import { buildViewmodel, type BuiltViewmodel } from '../render/models/viewmodels';

export interface ViewmodelPose {
  dt: number;
  time: number;
  ads: number;
  /** 0..1 how fast we're moving (bob). */
  move: number;
  sprint: boolean;
  yaw: number;
  pitch: number;
  /** 0..1 progress of a reload, or -1. */
  reload: number;
  /** 0..1 progress of a raise (switch/spawn), or -1. */
  raise: number;
  light: readonly number[];
  /** Prone transition 0 (up) .. 1 (lying down). */
  prone?: number;
  /** 0..1 how fast we're crawling (prone bob). */
  crawl?: number;
  /** 0..1 progress of a mantle, or -1. */
  mantle?: number;
}

export class ViewmodelRig {
  readonly root = new THREE.Group();
  private vm: BuiltViewmodel | null = null;
  private key = '';
  private flash: THREE.Mesh;
  private bob = 0;
  private kick = 0;
  private kickRot = 0;
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private lastShot = -9;
  private aim = new THREE.Vector3();
  private sprintBlend = 0;
  private crawlPhase = 0;
  private lastTime = 0;
  private act: { kind: string; start: number; dur: number; hold: boolean } | null = null;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: getTexture('flash'), alphaTest: 0.5, color: 0xffffff }));
    this.flash.visible = false;
  }

  /** Show a weapon (rebuilds only when model/attachments/camo change). */
  setWeapon(model: string, attachments: readonly string[], camo: string): void {
    const key = `${model}|${attachments.join(',')}|${camo}`;
    if (key === this.key) return;
    this.key = key;
    this.disposeModel();
    this.vm = buildViewmodel(model, attachments, camo);
    this.vm.group.add(this.flash);
    this.flash.position.copy(this.vm.spec.muzzle);
    this.root.add(this.vm.group);
  }

  /** A shot: kick and flash. `strength` scales the kick (recoil). */
  shoot(time: number, strength = 1): void {
    this.lastShot = time;
    this.kick = Math.min(1.6, this.kick + strength);
    this.kickRot = Math.min(1.6, this.kickRot + strength);
  }

  /**
   * Play a one-off action for `dur` seconds (the model's `animate` decides how it looks). With
   * `hold`, it stays at its last pose (actionT 1) until another action replaces it or `endAction`
   * (a grenade or tomahawk held up while the button is down).
   */
  action(kind: string, dur: number, hold = false): void {
    this.act = { kind, start: this.lastTime, dur: Math.max(0.01, dur), hold };
  }

  /** The action currently playing (null when none). */
  get currentAction(): string | null {
    return this.act?.kind ?? null;
  }

  /** Stop a held action. */
  endAction(): void {
    this.act = null;
  }

  update(p: ViewmodelPose): void {
    this.lastTime = p.time;
    const vm = this.vm;
    if (!vm) return;
    const { dt } = p;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.kickRot = Math.max(0, this.kickRot - dt * 7);
    this.sprintBlend += ((p.sprint ? 1 : 0) - this.sprintBlend) * Math.min(1, dt * 10);
    this.bob += dt * (p.sprint ? 13 : 8.5) * p.move;
    const k = Math.min(1, dt * 10);
    const pr = Math.max(0, Math.min(1, p.prone ?? 0));
    const lie = pr * pr * (3 - 2 * pr);
    // Prone: slower, smaller look sway.
    const swayK = 1.3 * (1 - 0.5 * lie);
    this.swayX += ((p.yaw - this.lastYaw) * swayK - this.swayX) * k * (1 - 0.4 * lie);
    this.swayY += ((p.pitch - this.lastPitch) * swayK - this.swayY) * k * (1 - 0.4 * lie);
    this.swayX = Math.max(-0.08, Math.min(0.08, this.swayX));
    this.swayY = Math.max(-0.08, Math.min(0.08, this.swayY));
    this.lastYaw = p.yaw;
    this.lastPitch = p.pitch;
    const free = 1 - p.ads * 0.85;
    const mv = p.move;
    const drop = vm.spec.reload === 'drop';
    const rl = p.reload >= 0 && vm.spec.reload !== 'none' ? Math.sin(p.reload * Math.PI) : 0;
    const raise = p.raise >= 0 ? 1 - p.raise : 0;
    this.aim.lerpVectors(vm.spec.hip, vm.spec.ads, p.ads);
    const sb = this.sprintBlend;
    // Crawl: a slow, wide side-to-side bob (elbows planting), the walk bob off.
    const crawl = Math.max(0, Math.min(1, p.crawl ?? 0)) * lie;
    this.crawlPhase += dt * 4.6 * crawl;
    const cp = this.crawlPhase;
    const walk = mv * (1 - lie);
    // The gun dips out of the way while going down / getting up, and over a mantle.
    const trans = 4 * pr * (1 - pr);
    const mt = p.mantle !== undefined && p.mantle >= 0 ? Math.sin(Math.min(1, p.mantle) * Math.PI) : 0;
    const g = vm.group;
    g.position.set(
      this.aim.x + this.swayX * free + Math.cos(this.bob) * 0.022 * walk * free - sb * 0.06 + Math.sin(cp) * 0.035 * crawl * free + 0.01 * lie * free,
      this.aim.y + this.swayY * free - Math.abs(Math.sin(this.bob)) * 0.026 * walk * free + Math.sin(p.time * 1.6) * 0.003 * free * (1 - 0.6 * lie) - rl * (drop ? 0.2 : 0.14) - raise * 0.25 - sb * 0.04 - 0.035 * lie * free - Math.abs(Math.cos(cp)) * 0.03 * crawl * free - trans * 0.12 - mt * 0.2,
      this.aim.z + this.kick * 0.06 * (1 - p.ads * 0.5),
    );
    g.rotation.set(
      this.kickRot * 0.12 * (1 - p.ads * 0.6) - rl * (drop ? 0.3 : 0.7) - raise * 0.6 - sb * 0.35 - trans * 0.35 - mt * 0.55,
      this.swayX * 1.6 + sb * 0.7 + Math.sin(cp) * 0.06 * crawl * free,
      rl * (drop ? 0.1 : 0.45) + Math.cos(this.bob) * 0.02 * walk * free + sb * 0.25 + 0.06 * lie * free + Math.sin(cp) * 0.09 * crawl * free + mt * 0.25,
    );
    if (this.act && !this.act.hold && p.time - this.act.start > this.act.dur) this.act = null;
    const act = this.act;
    vm.spec.animate?.({ dt, time: p.time, ads: p.ads, reload: p.reload, raise: p.raise, sinceShot: p.time - this.lastShot, sprint: p.sprint, action: act?.kind ?? null, actionT: act ? Math.min(1, (p.time - act.start) / act.dur) : 0 });
    const flashing = p.time - this.lastShot < 0.05;
    this.flash.visible = flashing;
    if (flashing) {
      this.flash.rotation.z = Math.random() * 6;
      this.flash.scale.setScalar(0.8 + Math.random() * 0.4);
    }
    G.uFlash.value = flashing ? 0.9 : 0;
    setDynLight(vm.mats, p.light, 0.06);
  }

  get visible(): boolean {
    return this.root.visible;
  }
  set visible(v: boolean) {
    this.root.visible = v;
  }

  private disposeModel() {
    const vm = this.vm;
    if (!vm) return;
    vm.group.remove(this.flash);
    vm.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const m of vm.mats) {
      unbindTexture(m);
      m.dispose();
    }
    vm.group.removeFromParent();
    this.vm = null;
  }

  dispose(): void {
    this.disposeModel();
    G.uFlash.value = 0;
    this.root.removeFromParent();
  }
}
