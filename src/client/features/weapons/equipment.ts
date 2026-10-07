/**
 * Client side of equipment and melee: thrown grenades / launcher rounds (entity kind
 * `weapons.nade`), explosions, the flashbang whiteout (ordered-dither fade, ringing ears), the
 * concussion wobble and slowed aim, the equipment counter and grenade danger indicator on the
 * HUD, and the local knife / throw viewmodel actions and sounds.
 */
import * as THREE from 'three';
import { EQUIPMENT_BY_ID, MELEE, NADE_ENTITY, THROW_RECOVERY, THROW_WINDUP } from '../../../shared/defs/equipment';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { HUD_COLORS as C, rect, txt, unit } from '../../hud/draw';
import { onFeature, registerEntityRenderer, registerHudWidget, registerMatchHook } from '../../registry';
import { makeLookMaterial, setDynLight, type LookMaterial } from '../../render/shader';
import { getTexture, unbindTexture } from '../../render/textures';
import { currentMatch } from '../../state';
import { shakeAmplitude, stunStrength } from './camfx';

export const equipState = {
  lethal: null as string | null,
  lethalN: 0,
  tactical: null as string | null,
  tacticalN: 0,
  /** Local-time flash (start, duration, strength) and concussion. */
  flash: { at: -99, dur: 0, amount: 0 },
  stun: { at: -99, dur: 0, amount: 0 },
  shake: { at: -99, amount: 0 },
};

// Equipment arrives at spawn, possibly before the match hook starts (map still loading).
onFeature('weapons.equip', (d) => Object.assign(equipState, d));

// ---------------------------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------------------------

const COLORS: Record<string, number> = { frag: 0x8a9a60, semtex: 0xc8b890, flashbang: 0xdadada, concussion: 0x9ab0c8, gl: 0xb0a070 };

registerEntityRenderer(NADE_ENTITY, (e) => {
  const kind = String(e.s?.e ?? 'frag');
  const mats: LookMaterial[] = [];
  const mk = (texture: string, tint: number, emissive = 0) => {
    const m = makeLookMaterial({ texture, tint, emissive, dyn: true, rep: 0.1 });
    mats.push(m);
    return m;
  };
  const obj = new THREE.Group();
  let blink: THREE.Mesh | null = null;
  if (kind === 'frag') {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), mk('weapons.nadegreen', 0xffffff));
    m.scale.set(1, 1.25, 1);
    obj.add(m);
  } else if (kind === 'semtex') {
    obj.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.07), mk('weapons.tan', 0xffffff)));
    blink = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), mk('weapons.red', 0xffffff, 1));
    blink.position.y = 0.035;
    obj.add(blink);
  } else if (kind === 'gl') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.09, 6).rotateX(Math.PI / 2), mk('weapons.brass', 0xffffff));
    obj.add(m);
  } else {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6), mk('gunmetal', COLORS[kind] ?? 0xffffff));
    obj.add(m);
  }
  let spin = 0;
  const prev = new THREE.Vector3(e.x, e.y, e.z);
  let lastVy = 0;
  return {
    object: obj,
    update(s, dt, m) {
      const moved = prev.distanceTo(new THREE.Vector3(s.x, s.y, s.z));
      const vy = (s.y - prev.y) / Math.max(1e-3, dt);
      if (moved > 0.002 && kind !== 'gl') {
        spin += dt * 14;
        obj.children[0]!.rotation.set(spin, spin * 0.7, 0);
      }
      if (lastVy < -1 && vy > -0.2 && kind !== 'gl') sfx.play('weapons.bounce', { at: { x: s.x, y: s.y, z: s.z }, volume: 0.5, rate: 0.9 + Math.random() * 0.2 });
      lastVy = moved > 0.001 ? vy : 0;
      prev.set(s.x, s.y, s.z);
      if (blink) blink.visible = Math.floor(m.time * 6) % 2 === 0;
      if (m.map) setDynLight(mats, m.map.lightAt(s.x, s.y + 0.2, s.z));
    },
    dispose() {
      obj.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      for (const mt of mats) {
        unbindTexture(mt);
        mt.dispose();
      }
    },
  };
});

// ---------------------------------------------------------------------------------------------
// Explosions
// ---------------------------------------------------------------------------------------------

interface Blast {
  sprite: THREE.Sprite;
  life: number;
  max: number;
}
const blasts: Blast[] = [];

function boom(m: Match, x: number, y: number, z: number, e: string) {
  const at = { x, y, z };
  const tactical = e === 'flashbang' || e === 'concussion';
  if (tactical) {
    m.effects.puff('dust', at, { x: 0, y: 1, z: 0 }, 10);
    m.effects.puff('spark', at, undefined, 4);
    sfx.play('weapons.flashbang', { at, volume: 1.2 });
  } else {
    m.effects.puff('spark', at, { x: 0, y: 1, z: 0 }, 14);
    m.effects.puff('dust', at, { x: 0, y: 1, z: 0 }, 18);
    m.effects.puff('dust', { x, y: y + 0.6, z }, { x: 0, y: 1, z: 0 }, 10);
    sfx.play('weapons.boom', { at, volume: 1.6 });
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: getTexture('glow'), color: tactical ? 0xffffff : 0xffc060, transparent: true, depthWrite: false }));
  sprite.position.set(x, y + 0.3, z);
  sprite.scale.setScalar(tactical ? 3 : 4.5);
  m.renderer.scene.add(sprite);
  blasts.push({ sprite, life: 0.25, max: 0.25 });
  const cam = m.renderer.cam.position;
  const d = Math.hypot(cam.x - x, cam.y - y, cam.z - z);
  if (d < 16 && !tactical) equipState.shake = { at: m.time, amount: Math.min(1, (16 - d) / 12) };
}

// ---------------------------------------------------------------------------------------------
// Match hook: messages, local actions, camera effects
// ---------------------------------------------------------------------------------------------

let prevHeld = { melee: false, lethal: false, tactical: false };
let meleeReadyAt = 0;
let throwBusyUntil = 0;

registerMatchHook('weapons.equipment', {
  start(m) {
    equipState.flash = { at: -99, dur: 0, amount: 0 };
    equipState.stun = { at: -99, dur: 0, amount: 0 };
    // Times are room times: a shake left over from the previous room (whose clock was further
    // along) would read as "in the future" here and shake the camera for minutes.
    equipState.shake = { at: -99, amount: 0 };
    prevHeld = { melee: false, lethal: false, tactical: false };
    const offs = [
      onFeature('weapons.flash', (d) => {
        equipState.flash = { at: m.time, dur: d.dur, amount: d.amount };
        sfx.play('weapons.ring', { volume: 0.6 * d.amount });
      }),
      onFeature('weapons.stun', (d) => {
        equipState.stun = { at: m.time, dur: d.dur, amount: d.amount };
      }),
      onFeature('weapons.boom', (d) => boom(m, d.x, d.y, d.z, d.e)),
      onFeature('weapons.melee', (d) => {
        if (d.p === m.myId) {
          if (d.hit) sfx.play('weapons.stab', { volume: 0.8 });
          return;
        }
        const v = m.remotes.views.get(d.p);
        if (v) sfx.play(d.hit ? 'weapons.stab' : 'weapons.knife', { at: { x: v.x, y: v.y + 1.2, z: v.z }, volume: 0.8 });
      }),
      onFeature('weapons.throw', (d) => {
        if (d.p === m.myId) return;
        const v = m.remotes.views.get(d.p);
        if (v) sfx.play('weapons.pin', { at: { x: v.x, y: v.y + 1.4, z: v.z }, volume: 0.6 });
      }),
    ];
    return () => {
      offs.forEach((f) => f());
      for (const b of blasts.splice(0)) {
        b.sprite.removeFromParent();
        b.sprite.material.dispose();
      }
    };
  },
  frame(m, dt) {
    // Blast glows.
    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i]!;
      b.life -= dt;
      b.sprite.material.opacity = Math.max(0, b.life / b.max);
      if (b.life <= 0) {
        b.sprite.removeFromParent();
        b.sprite.material.dispose();
        blasts.splice(i, 1);
      }
    }

    // Local knife / throw: start the viewmodel action on the key edge (the server decides the outcome).
    const c = m.controls;
    const held = { melee: c.isHeld('melee'), lethal: c.isHeld('lethal'), tactical: c.isHeld('tactical') };
    const ok = m.alive && m.phase === 'playing' && c.locked;
    if (ok && held.melee && !prevHeld.melee && m.time >= meleeReadyAt && m.time >= throwBusyUntil) {
      meleeReadyAt = m.time + MELEE.cooldownSec;
      m.viewmodel.action('melee', MELEE.recoverySec);
      sfx.play('weapons.knife', { volume: 0.7 });
    }
    for (const kind of ['lethal', 'tactical'] as const) {
      if (!ok || !held[kind] || prevHeld[kind] || m.time < throwBusyUntil) continue;
      const n = kind === 'lethal' ? equipState.lethalN : equipState.tacticalN;
      if (n <= 0) continue;
      const id = kind === 'lethal' ? equipState.lethal : equipState.tactical;
      const cook = !!(id && EQUIPMENT_BY_ID.get(id)?.cookable);
      throwBusyUntil = m.time + THROW_WINDUP + THROW_RECOVERY;
      m.viewmodel.action('throw', THROW_WINDUP + THROW_RECOVERY + (cook ? 0.2 : 0));
      sfx.play('weapons.pin', { volume: 0.5 });
      break;
    }
    prevHeld = held;

    // Camera: explosion shake and concussion wobble (visual only), slowed look while stunned.
    const cam = m.renderer.cam;
    const a = shakeAmplitude(m.time, equipState.shake);
    if (a > 0) {
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
      cam.rotation.z += (Math.random() - 0.5) * a;
    }
    const k = m.alive ? stunStrength(m.time, equipState.stun) : 0;
    if (k > 0) {
      cam.rotation.z += Math.sin(m.time * 2.1) * 0.06 * k;
      cam.rotation.x += Math.sin(m.time * 1.4 + 1) * 0.02 * k;
      m.controls.lookScale *= 1 - 0.65 * k;
      }
  },
});

// ---------------------------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------------------------

/** Ordered 4x4 Bayer thresholds for the flash fade (matches the look's crosshatch dither). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

registerHudWidget(
  'weapons.flash',
  (g, W, H) => {
    const m = currentMatch();
    if (!m) return;
    const f = equipState.flash;
    const t = m.time - f.at;
    if (t < 0 || t >= f.dur || !m.alive) return;
    // Full white for the first 40 % (scaled by strength), then a dithered fade.
    const k = f.amount * (t < f.dur * 0.4 ? 1 : 1 - (t - f.dur * 0.4) / (f.dur * 0.6));
    if (k <= 0) return;
    const u = unit(H) * 2;
    g.fillStyle = '#f4f0e8';
    if (k >= 0.97) {
      g.fillRect(0, 0, W, H);
      return;
    }
    for (let y = 0, yi = 0; y < H; y += u, yi++) for (let x = 0, xi = 0; x < W; x += u, xi++) if (BAYER[(yi & 3) * 4 + (xi & 3)]! < k) g.fillRect(x, y, u, u);
  },
  88,
);

function icon(g: CanvasRenderingContext2D, id: string, x: number, y: number, u: number, dim: boolean) {
  const col = dim ? C.empty : id === 'frag' ? '#8a9a60' : id === 'semtex' ? '#c8b890' : id === 'flashbang' ? '#e8e8e8' : '#9ab0c8';
  if (id === 'frag') {
    rect(g, x + u, y - u, 3 * u, u, C.ink);
    rect(g, x, y, 5 * u, 6 * u, C.ink);
    rect(g, x + u, y + u, 3 * u, 4 * u, col);
    rect(g, x + 2 * u, y - 2 * u, u, u, C.ink);
  } else if (id === 'semtex') {
    rect(g, x - u, y + u, 7 * u, 4 * u, C.ink);
    rect(g, x, y + 2 * u, 5 * u, 2 * u, col);
    rect(g, x + 2 * u, y, u, u, '#ff3020');
  } else {
    rect(g, x, y - u, 5 * u, 8 * u, C.ink);
    rect(g, x + u, y, 3 * u, 6 * u, col);
    if (id === 'concussion') rect(g, x + u, y + 2 * u, 3 * u, u, C.ink);
  }
}

registerHudWidget(
  'weapons.equipment',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.alive) return;
    const u = unit(H);
    let x = W - 92 * u;
    const y = H - 18 * u;
    for (const [id, n] of [[equipState.lethal, equipState.lethalN], [equipState.tactical, equipState.tacticalN]] as const) {
      if (!id) continue;
      icon(g, id, x, y, u, n <= 0);
      txt(g, String(n), x + 7 * u, y, 8, n > 0 ? C.paper : C.empty, 'left', u);
      x += 18 * u;
    }
  },
  42,
);

// Grenade danger: an icon over live grenades close to you (BO1-style), at the screen edge when behind.
const tmp = new THREE.Vector3();
registerHudWidget(
  'weapons.danger',
  (g, W, H) => {
    const m = currentMatch();
    const snap = m?.net.lastSnap;
    if (!m || !snap || !m.alive) return;
    const u = unit(H);
    const cam = m.renderer.cam;
    for (const e of snap.ents) {
      if (e.kind !== NADE_ENTITY) continue;
      const id = String(e.s?.e ?? '');
      if (id !== 'frag' && id !== 'semtex') continue;
      const d = Math.hypot(e.x - cam.position.x, e.y - cam.position.y, e.z - cam.position.z);
      if (d > 8) continue;
      tmp.set(e.x, e.y + 0.3, e.z).project(cam);
      let sx = (tmp.x * 0.5 + 0.5) * W;
      let sy = (-tmp.y * 0.5 + 0.5) * H;
      if (tmp.z > 1 || sx < 0 || sx > W || sy < 0 || sy > H) {
        // Behind / off screen: pin to the bottom edge on the right side.
        const yawTo = Math.atan2(-(e.x - cam.position.x), -(e.z - cam.position.z));
        const rel = -(yawTo - m.yaw);
        sx = W / 2 + Math.sin(rel) * W * 0.3;
        sy = H * 0.75;
      }
      const blinkOn = Math.floor(m.time * 6) % 2 === 0 || d < 4;
      if (!blinkOn) continue;
      icon(g, id, sx - 2 * u, sy - 3 * u, u, false);
      rect(g, sx - 6 * u, sy + 6 * u, 12 * u, u, d < 4 ? C.warn : C.hi);
    }
  },
  26,
);
