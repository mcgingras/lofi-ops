/**
 * Short-lived world effects: chunky puff sprites (blood, sparks, dust) and bullet tracers.
 * `effects.puff(kind, at, normal?)`, `effects.tracer(from, to)`.
 */
import * as THREE from 'three';
import { getTexture } from '../render/textures';

export type PuffKind = 'blood' | 'spark' | 'dust';

const PUFF_COLORS: Record<PuffKind, number[]> = {
  blood: [0x8a1010, 0xb01818, 0x5a0808],
  spark: [0xffd27a, 0xfff0c0, 0xc8b8a0],
  dust: [0x9a948a, 0x7a746a, 0xb8b2a6],
};

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  max: number;
  gravity: number;
  grow: number;
}

interface Tracer {
  line: THREE.Line;
  life: number;
}

export class Effects {
  private parts: Particle[] = [];
  private pool: THREE.Sprite[] = [];
  private tracers: Tracer[] = [];
  private tracerMat = new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.8, depthWrite: false });

  constructor(private scene: THREE.Scene) {}

  private sprite(color: number): THREE.Sprite {
    const s = this.pool.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({ map: getTexture('puff'), alphaTest: 0.5, depthWrite: true }));
    (s.material as THREE.SpriteMaterial).color.setHex(color);
    (s.material as THREE.SpriteMaterial).opacity = 1;
    s.visible = true;
    this.scene.add(s);
    return s;
  }

  /** A burst at a point; `normal` pushes it off the surface. */
  puff(kind: PuffKind, at: { x: number; y: number; z: number }, normal?: { x: number; y: number; z: number }, count = kind === 'blood' ? 6 : 4): void {
    const cols = PUFF_COLORS[kind];
    for (let i = 0; i < count; i++) {
      const s = this.sprite(cols[i % cols.length]!);
      const size = kind === 'blood' ? 0.12 + Math.random() * 0.12 : 0.06 + Math.random() * 0.08;
      s.scale.setScalar(size);
      s.position.set(at.x, at.y, at.z);
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2);
      if (normal) v.addScaledVector(new THREE.Vector3(normal.x, normal.y, normal.z), 1.6);
      v.multiplyScalar(kind === 'spark' ? 2.2 : 1.2);
      const max = kind === 'dust' ? 0.5 : 0.35 + Math.random() * 0.2;
      this.parts.push({ sprite: s, vel: v, life: max, max, gravity: kind === 'dust' ? 0.5 : 6, grow: kind === 'spark' ? -0.15 : 0.35 });
    }
  }

  tracer(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 2) return;
    // A short streak somewhere along the path reads better than a full line.
    const a = 0.15 + Math.random() * 0.3;
    const b = Math.min(1, a + 6 / len);
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(from.x + dx * a, from.y + dy * a, from.z + dz * a), new THREE.Vector3(from.x + dx * b, from.y + dy * b, from.z + dz * b)]);
    const line = new THREE.Line(geo, this.tracerMat);
    line.frustumCulled = false;
    this.scene.add(line);
    this.tracers.push({ line, life: 0.06 });
  }

  update(dt: number): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        p.sprite.removeFromParent();
        this.pool.push(p.sprite);
        this.parts.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.multiplyScalar(1 + p.grow * dt);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]!;
      t.life -= dt;
      if (t.life <= 0) {
        t.line.geometry.dispose();
        t.line.removeFromParent();
        this.tracers.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const p of this.parts) p.sprite.removeFromParent();
    for (const s of [...this.pool, ...this.parts.map((p) => p.sprite)]) (s.material as THREE.SpriteMaterial).dispose();
    for (const t of this.tracers) {
      t.line.geometry.dispose();
      t.line.removeFromParent();
    }
    this.tracerMat.dispose();
    this.parts = [];
    this.pool = [];
    this.tracers = [];
  }
}
