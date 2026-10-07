/**
 * Live 3D weapon preview on a turntable for create-a-class. Builds the real viewmodel
 * (`buildViewmodel`, attachments + camo) with look materials (developed photo textures, per-object
 * light) and renders it at a low internal resolution, upscaled with nearest filtering like the
 * game view. Uses its own small WebGL context so it also works as an overlay over a match.
 */
import * as THREE from 'three';
import { buildViewmodel, type BuiltViewmodel } from '../../render/models/viewmodels';
import { setDynLight } from '../../render/shader';
import { unbindTexture } from '../../render/textures';

/** Internal render height in pixels (the look's low-res target). */
const LOW_H = 180;

export class WeaponPreview {
  readonly canvas = document.createElement('canvas');
  private gl: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.01, 20);
  private pivot = new THREE.Group();
  private vm: BuiltViewmodel | null = null;
  private key = '';
  private raf = 0;
  private last = performance.now();
  private angle = 0.6;
  private drag: { x: number; a: number } | null = null;
  private idleUntil = 0;
  private ro: ResizeObserver | null = null;
  readonly ok: boolean;

  constructor(host: HTMLElement) {
    host.prepend(this.canvas);
    try {
      this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: true });
      this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
      this.gl.setPixelRatio(1);
      this.gl.setClearColor(0x000000, 0);
      this.ok = true;
    } catch {
      this.ok = false;
      return;
    }
    this.scene.add(this.pivot);
    this.cam.position.set(0, 0.06, 1.25);
    this.cam.lookAt(0, 0, 0);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    // Drag to spin.
    this.canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, a: this.angle };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.angle = this.drag.a + (e.clientX - this.drag.x) * 0.012;
    });
    const up = () => {
      this.drag = null;
      this.idleUntil = performance.now() + 1500;
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.loop();
  }

  private resize() {
    if (!this.gl) return;
    const r = this.canvas.getBoundingClientRect();
    const aspect = r.width > 0 && r.height > 0 ? r.width / r.height : 16 / 9;
    const h = LOW_H;
    const w = Math.max(1, Math.round(h * aspect));
    this.gl.setSize(w, h, false);
    this.cam.aspect = aspect;
    this.cam.updateProjectionMatrix();
  }

  /** Show a weapon (rebuilt only when model/attachments/camo change). */
  show(model: string, attachments: readonly string[], camo: string): void {
    if (!this.gl) return;
    const key = `${model}|${attachments.join(',')}|${camo}`;
    if (key === this.key) return;
    this.key = key;
    this.disposeModel();
    const vm = buildViewmodel(model, attachments, camo);
    this.vm = vm;
    // Centre the gun on the pivot and fit it to the view.
    const box = new THREE.Box3().setFromObject(vm.group);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    vm.group.position.sub(centre);
    const s = 0.75 / Math.max(0.2, size.x, size.y, size.z);
    this.pivot.scale.setScalar(s);
    this.pivot.add(vm.group);
    setDynLight(vm.mats, [0.95, 0.9, 0.82], 0.08);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.drag && now > this.idleUntil) this.angle += dt * 0.55;
    this.pivot.rotation.set(0.12 * Math.sin(now / 2400), this.angle, 0);
    if (this.vm) {
      // A little light swing as it turns (baked-light feel without real lights).
      const k = 0.85 + 0.15 * Math.cos(this.angle);
      setDynLight(this.vm.mats, [0.95 * k, 0.9 * k, 0.82 * k], 0.08);
    }
    this.gl?.render(this.scene, this.cam);
  };

  private disposeModel() {
    const vm = this.vm;
    if (!vm) return;
    this.pivot.remove(vm.group);
    vm.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const m of vm.mats) {
      unbindTexture(m);
      m.dispose();
    }
    this.vm = null;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.disposeModel();
    this.gl?.dispose();
    this.gl?.forceContextLoss();
    this.gl = null;
    this.canvas.remove();
  }
}
