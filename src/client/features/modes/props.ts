/**
 * Objective props in the world (entity renderers for the kinds in MODE_ENTITY): Domination flags
 * (pole, cloth and a ground ring in the owner's colour, relative to the viewer), the S&D bomb
 * (blinking faster as the fuse runs down), the HQ crate with a beacon, and Kill Confirmed dog
 * tags (bobbing, spinning, team-coloured). Low-poly boxes with the look material, lit from the
 * bake like players; their own small texture recipes below.
 */
import * as THREE from 'three';
import type { Team } from '../../../shared/constants';
import { MODE_ENTITY } from '../../../shared/defs/modestate';
import type { EntitySnap } from '../../../shared/protocol';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { registerEntityRenderer } from '../../registry';
import { makeLookMaterial, setDynLight, type LookMaterial } from '../../render/shader';
import { registerTexture, unbindTexture } from '../../render/textures';

const FRIEND = 0x7ab0ff;
const ENEMY = 0xff6a4a;
const NEUTRAL = 0xe8e0cc;

export function teamTint(team: number | null | undefined, myTeam: Team | null): number {
  if (team === null || team === undefined || team < 0) return NEUTRAL;
  return team === myTeam ? FRIEND : ENEMY;
}

// ---------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------

registerTexture('modes.white', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    g.fillStyle = '#e8e4dc';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = R.rnd() > 0.5 ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.12)';
      g.fillRect((R.rnd() * w) | 0, (R.rnd() * h) | 0, 1, 1);
    }
  },
  photo: 'small',
});

registerTexture('modes.cloth', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    g.fillStyle = '#e0dcd2';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      g.fillStyle = `rgba(0,0,0,${0.04 + R.rnd() * 0.06})`;
      g.fillRect(0, y, w, 1);
    }
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.fillRect(0, h * 0.4, w, h * 0.2);
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.fillRect(w * 0.42, h * 0.25, w * 0.16, h * 0.5);
  },
  photo: 'small',
});

registerTexture('modes.bomb', {
  w: 32,
  h: 16,
  draw(g, w, h) {
    g.fillStyle = '#4a4a3a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#c9a02f';
    for (let x = -h; x < w; x += 6) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 3, h);
      g.lineTo(x + 3 + h * 0.5, h * 0.5);
      g.lineTo(x + h * 0.5, h * 0.5);
      g.fill();
    }
    g.fillStyle = '#101010';
    g.fillRect(w * 0.3, 2, w * 0.4, h * 0.35);
    g.fillStyle = '#d23a2a';
    g.fillRect(w * 0.34, 3, w * 0.32, h * 0.2);
    g.fillStyle = '#2a2a2a';
    g.fillRect(2, 2, 4, h - 4);
    g.fillRect(w - 6, 2, 4, h - 4);
  },
  photo: 'small',
});

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

class Kit {
  readonly mats: LookMaterial[] = [];
  /** Materials lit from the bake (fully emissive ones are not). */
  readonly lit: LookMaterial[] = [];
  readonly geos: THREE.BufferGeometry[] = [];
  mat(texture: string, o: { tint?: number; emissive?: number; rep?: number } = {}): LookMaterial {
    const m = makeLookMaterial({ texture, dyn: true, ...o });
    this.mats.push(m);
    if ((o.emissive ?? 0) < 1) this.lit.push(m);
    return m;
  }
  box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    this.geos.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  light(match: Match, x: number, y: number, z: number): void {
    if (match.map) setDynLight(this.lit, match.map.lightAt(x, y + 1, z));
  }
  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) {
      unbindTexture(m);
      m.dispose();
    }
  }
}

const tint = (m: LookMaterial, c: number) => m.uniforms.uTint.value.setHex(c);

/** A dashed ring of small glowing blocks on the ground (zone radius). */
function ring(kit: Kit, parent: THREE.Object3D, r: number, mat: THREE.Material): void {
  const n = Math.max(12, Math.round(r * 6));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = kit.box(parent, 0.35, 0.04, 0.12, mat, Math.cos(a) * r, 0.03, Math.sin(a) * r);
    b.rotation.y = -a + Math.PI / 2;
  }
}

const sNum = (e: EntitySnap, k: string, d = 0) => (typeof e.s?.[k] === 'number' ? (e.s[k] as number) : d);

// ---------------------------------------------------------------------------------------------
// Flag (Domination)
// ---------------------------------------------------------------------------------------------

registerEntityRenderer(MODE_ENTITY.flag, (e0) => {
  const kit = new Kit();
  const root = new THREE.Group();
  const steel = kit.mat('steel', { rep: 0.5 });
  const cloth = kit.mat('modes.cloth', { tint: NEUTRAL, emissive: 0.25 });
  const glow = kit.mat('modes.white', { tint: NEUTRAL, emissive: 1 });
  kit.box(root, 0.08, 3.2, 0.08, steel, 0, 1.6, 0);
  kit.box(root, 0.5, 0.12, 0.5, steel, 0, 0.06, 0);
  const flag = new THREE.Group();
  flag.position.set(0, 2.75, 0);
  root.add(flag);
  const sheet = kit.box(flag, 1.1, 0.7, 0.03, cloth, 0.58, 0, 0);
  kit.box(root, 0.12, 0.12, 0.12, glow, 0, 3.25, 0);
  ring(kit, root, sNum(e0, 'r', 3), glow);
  let t = Math.random() * 10;
  let lastColor = -1;
  return {
    object: root,
    update(e, dt, m) {
      t += dt;
      const contested = e.s?.x === true;
      const c = contested && Math.floor(t * 4) % 2 ? 0xffd84a : teamTint(sNum(e, 'o', -1), m.myTeam);
      if (c !== lastColor) {
        tint(cloth, c);
        tint(glow, c);
        lastColor = c;
      }
      flag.rotation.y = Math.sin(t * 1.3) * 0.35;
      sheet.rotation.x = Math.sin(t * 3.1) * 0.06;
      kit.light(m, e.x, e.y, e.z);
    },
    dispose: () => kit.dispose(),
  };
});

// ---------------------------------------------------------------------------------------------
// Bomb (Search and Destroy)
// ---------------------------------------------------------------------------------------------

registerEntityRenderer(MODE_ENTITY.bomb, () => {
  const kit = new Kit();
  const root = new THREE.Group();
  const body = kit.mat('modes.bomb');
  const dark = kit.mat('rubber', { rep: 0.3 });
  const led = kit.mat('modes.white', { tint: 0x401010, emissive: 1 });
  kit.box(root, 0.5, 0.22, 0.32, body, 0, 0.11, 0);
  kit.box(root, 0.08, 0.08, 0.36, dark, -0.16, 0.24, 0);
  kit.box(root, 0.08, 0.08, 0.36, dark, 0.16, 0.24, 0);
  kit.box(root, 0.1, 0.05, 0.06, led, 0, 0.25, 0.08);
  let nextBeep = 0;
  let t = 0;
  let on = false;
  return {
    object: root,
    update(e, dt, m) {
      t += dt;
      const planted = e.s?.st === 'planted';
      const end = sNum(e, 'end', 0);
      const left = planted ? end - m.serverTime : 99;
      const period = planted ? Math.max(0.18, Math.min(1, left / 40)) : 1.2;
      const lit = planted ? t % period < period * 0.35 : e.s?.st === 'dropped' && t % 1.2 < 0.15;
      if (lit !== on) {
        tint(led, lit ? 0xff3020 : 0x401010);
        on = lit;
      }
      if (planted && left > 0 && t >= nextBeep) {
        nextBeep = t + period;
        sfx.play('modes.beep', { at: { x: e.x, y: e.y, z: e.z }, volume: 0.6 });
      }
      if (e.s?.st === 'exploded' && t >= nextBeep) {
        nextBeep = t + 99;
        sfx.play('modes.boom', { at: { x: e.x, y: e.y, z: e.z }, volume: 1 });
        m.effects.puff('spark', { x: e.x, y: e.y + 0.5, z: e.z }, undefined, 24);
        m.effects.puff('dust', { x: e.x, y: e.y + 0.8, z: e.z }, undefined, 30);
      }
      root.visible = e.s?.st !== 'exploded';
      kit.light(m, e.x, e.y, e.z);
    },
    dispose: () => kit.dispose(),
  };
});

// ---------------------------------------------------------------------------------------------
// HQ crate (Headquarters)
// ---------------------------------------------------------------------------------------------

registerEntityRenderer(MODE_ENTITY.hq, (e0) => {
  const kit = new Kit();
  const root = new THREE.Group();
  const crate = kit.mat('crate', { rep: 1.2 });
  const steel = kit.mat('steel', { rep: 0.5 });
  const glow = kit.mat('modes.white', { tint: NEUTRAL, emissive: 1 });
  kit.box(root, 1.4, 0.9, 1.0, crate, 0, 0.45, 0);
  kit.box(root, 0.9, 0.5, 0.7, crate, 0.1, 1.15, -0.05);
  kit.box(root, 0.05, 2.2, 0.05, steel, -0.55, 1.6, 0.35);
  kit.box(root, 0.5, 0.3, 0.04, steel, 0.25, 1.15, 0.31);
  const beacon = kit.box(root, 0.16, 0.16, 0.16, glow, -0.55, 2.75, 0.35);
  ring(kit, root, sNum(e0, 'r', 3), glow);
  let t = 0;
  let last = -1;
  return {
    object: root,
    update(e, dt, m) {
      t += dt;
      const contested = e.s?.x === true;
      const c = contested && Math.floor(t * 4) % 2 ? 0xffd84a : teamTint(sNum(e, 'o', -1), m.myTeam);
      if (c !== last) {
        tint(glow, c);
        last = c;
      }
      beacon.visible = Math.floor(t * 2) % 2 === 0 || e.s?.st !== 'held';
      kit.light(m, e.x, e.y, e.z);
    },
    dispose: () => kit.dispose(),
  };
});

// ---------------------------------------------------------------------------------------------
// Dog tags (Kill Confirmed)
// ---------------------------------------------------------------------------------------------

registerEntityRenderer(MODE_ENTITY.tag, (e0, match) => {
  const kit = new Kit();
  const root = new THREE.Group();
  const spin = new THREE.Group();
  root.add(spin);
  const metal = kit.mat('modes.white', { tint: teamTint(e0.team, match.myTeam), emissive: 0.7 });
  const chain = kit.mat('steel', { rep: 0.2 });
  kit.box(spin, 0.16, 0.24, 0.02, metal, -0.03, 0, 0).rotation.z = 0.12;
  kit.box(spin, 0.16, 0.24, 0.02, metal, 0.04, -0.02, 0.02).rotation.z = -0.1;
  kit.box(spin, 0.02, 0.12, 0.02, chain, 0, 0.17, 0);
  let t = Math.random() * 6;
  let team = e0.team;
  return {
    object: root,
    update(e, dt, m) {
      t += dt;
      if (e.team !== team) {
        team = e.team;
        tint(metal, teamTint(team, m.myTeam));
      }
      spin.position.y = 0.55 + Math.sin(t * 2.4) * 0.08;
      spin.rotation.y = t * 2.2;
      kit.light(m, e.x, e.y, e.z);
    },
    dispose: () => kit.dispose(),
  };
});
