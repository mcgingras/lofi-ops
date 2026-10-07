/** Explosions and other one-shot killstreak effects (`killstreaks.fx` pushes): chunky sprite fireballs, dust and sound. */
import * as THREE from 'three';
import { sfx } from '../../game/audio';
import { onFeature, registerMatchHook } from '../../registry';
import { currentMatch } from '../../state';
import { getTexture } from '../../render/textures';

interface Blast {
  sprites: THREE.Sprite[];
  life: number;
  max: number;
  size: number;
}

const blasts: Blast[] = [];
const COLORS = [0xfff0b0, 0xffb040, 0xff6a20, 0x5a4a3a];

function spawnBlast(at: THREE.Vector3, size: number): void {
  const m = currentMatch();
  if (!m) return;
  const sprites: THREE.Sprite[] = [];
  const n = Math.round(4 + size * 1.5);
  for (let i = 0; i < n; i++) {
    const mat = new THREE.SpriteMaterial({ map: getTexture(i < 2 ? 'flash' : 'puff'), color: COLORS[i % COLORS.length], alphaTest: 0.5, depthWrite: false });
    const s = new THREE.Sprite(mat);
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * size * 0.35;
    s.position.set(at.x + Math.cos(a) * d, at.y + 0.3 + Math.random() * size * 0.4, at.z + Math.sin(a) * d);
    s.scale.setScalar(size * (0.3 + Math.random() * 0.3));
    m.renderer.scene.add(s);
    sprites.push(s);
  }
  blasts.push({ sprites, life: 0.7, max: 0.7, size });
  for (let i = 0; i < 3; i++) m.effects.puff('dust', { x: at.x, y: at.y + 0.2, z: at.z }, { x: 0, y: 1, z: 0 }, 6);
}

onFeature('killstreaks.fx', (f) => {
  const m = currentMatch();
  if (!m) return;
  const at = new THREE.Vector3(f.x, f.y, f.z);
  const pos = { x: f.x, y: f.y, z: f.z };
  switch (f.kind) {
    case 'boom':
    case 'destroyed':
      spawnBlast(at, f.r ?? 3);
      sfx.play('ks_boom', { at: pos, volume: 2.2 });
      break;
    case 'bigboom':
    case 'shell':
      spawnBlast(at, (f.r ?? 6) * 0.9);
      sfx.play('ks_bigboom', { at: pos, volume: 2.6 });
      break;
    case 'napalm':
      spawnBlast(at, (f.r ?? 7) * 1.1);
      sfx.play('ks_bigboom', { at: pos, volume: 2.4, rate: 0.8 });
      break;
    case 'crate_land':
      m.effects.puff('dust', pos, { x: 0, y: 1, z: 0 }, 10);
      sfx.play('thud', { at: pos, volume: 1.6 });
      break;
    case 'crate_open':
      sfx.play('reload', { at: pos, volume: 1 });
      break;
    case 'hacked':
      m.effects.puff('spark', pos, { x: 0, y: 1, z: 0 }, 8);
      sfx.play('ks_call', { at: pos, volume: 1 });
      break;
    case 'sam_launch':
      m.effects.puff('dust', pos, { x: 0, y: 1, z: 0 }, 5);
      sfx.play('ks_launch', { at: pos, volume: 1.8 });
      break;
    case 'bite':
      m.effects.puff('blood', pos, undefined, 6);
      sfx.play('ks_bite', { at: pos, volume: 1.2 });
      break;
    case 'bark':
      sfx.play('ks_bark', { at: pos, volume: 1.4 });
      break;
  }
});

registerMatchHook('killstreaks.fx', {
  start() {
    return () => {
      for (const b of blasts) for (const s of b.sprites) {
        s.removeFromParent();
        s.material.dispose();
      }
      blasts.length = 0;
    };
  },
  frame(_m, dt) {
    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i]!;
      b.life -= dt;
      const k = 1 - b.life / b.max;
      for (const [j, s] of b.sprites.entries()) {
        s.scale.multiplyScalar(1 + dt * (j < 2 ? 3 : 1.2));
        s.position.y += dt * (j < 2 ? 0.5 : 1.5);
        s.visible = j < 2 ? k < 0.35 : k < 0.95;
      }
      if (b.life <= 0) {
        for (const s of b.sprites) {
          s.removeFromParent();
          s.material.dispose();
        }
        blasts.splice(i, 1);
      }
    }
  },
});
