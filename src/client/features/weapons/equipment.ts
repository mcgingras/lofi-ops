/**
 * Client side of equipment and melee: thrown grenades / launcher rounds (entity kind
 * `weapons.nade`), tomahawks (`weapons.tomahawk`, spinning in flight, lying still once
 * retrievable), explosions, the flashbang whiteout (ordered-dither fade, ringing ears), the
 * concussion wobble and slowed aim, the equipment counter and grenade danger indicator on the
 * HUD, and the local knife / throw viewmodel actions and sounds (lethals and tacticals are raised
 * on the press, held up while the button is down and thrown on release, as on the server).
 */
import * as THREE from 'three';
import { cookLeft, cookTicksBetween, cookWarning, EQUIPMENT_BY_ID, MELEE, NADE_ENTITY, THROW_RECOVERY, THROW_WINDUP, TOMAHAWK_ENTITY } from '../../../shared/defs/equipment';
import { sfx } from '../../game/audio';
import { rumble } from '../../game/gamepad';
import type { Match } from '../../game/match';
import { blink, HUD_COLORS as C, rect, txt, unit } from '../../hud/draw';
import { onFeature, registerEntityRenderer, registerHudWidget, registerMatchHook } from '../../registry';
import { makeLookMaterial, setDynLight, type LookMaterial } from '../../render/shader';
import { getTexture, unbindTexture } from '../../render/textures';
import { currentMatch } from '../../state';
import { blastFeel, launcherBlast, shakeAmplitude, stunStrength } from './camfx';
import { frameTimeOfSeq, pushFrame, type FrameSeq } from './cook';
import { dangerRingPos, grenadeDangers, type DangerNade } from './danger';

export const equipState = {
  lethal: null as string | null,
  lethalN: 0,
  tactical: null as string | null,
  tacticalN: 0,
  /** Perk timing multipliers from the server (Scout hold breath, Steady Aim Pro knife). */
  breath: 1,
  melee: 1,
  /** Local-time flash (start, duration, strength) and concussion. */
  flash: { at: -99, dur: 0, amount: 0 },
  stun: { at: -99, dur: 0, amount: 0 },
  shake: { at: -99, amount: 0 },
  /** How hard blasts rattle you (camera shake, ringing ears, rumble): 0 with Flak Jacket Pro "Shockproof". */
  shock: 1,
};

// Equipment arrives at spawn, possibly before the match hook starts (map still loading).
onFeature('weapons.equip', (d) => Object.assign(equipState, { breath: 1, melee: 1, shock: 1 }, d));

/**
 * An explosion rattling the local player: camera shake (0..1), controller rumble and, for a close
 * one, ringing ears (`ring` 0..1). Every blast goes through here (grenades, launchers, killstreak
 * blasts, wonder weapons) so Shockproof (`equipState.shock`, from `blastShakeMultiplier`) can
 * silence them all.
 */
export function blastJolt(m: Match, amount: number, ring = 0): void {
  const k = equipState.shock;
  if (!(k > 0) || amount <= 0) return;
  const a = Math.min(1, amount * k);
  if (a >= equipState.shake.amount || m.time - equipState.shake.at > 0.3) equipState.shake = { at: m.time, amount: a };
  rumble('explosion', a);
  if (ring > 0.05 && m.alive) sfx.play('weapons.ring', { volume: 0.5 * Math.min(1, ring * k) });
}

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
      if (lastVy < -1 && vy > -0.2 && kind !== 'gl') sfx.play('weapons.bounce', { at: { x: s.x, y: s.y, z: s.z }, volume: 0.5 });
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

registerEntityRenderer(TOMAHAWK_ENTITY, (e) => {
  const mats: LookMaterial[] = [];
  const mk = (texture: string, tint = 0xffffff) => {
    const m = makeLookMaterial({ texture, tint, dyn: true, rep: 0.1 });
    mats.push(m);
    return m;
  };
  const obj = new THREE.Group();
  const spinner = new THREE.Group();
  obj.add(spinner);
  const wood = mk('gunwood');
  const metal = mk('gunmetal');
  const steel = mk('weapons.steel');
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    spinner.add(b);
  };
  // Centred on its balance point so the spin looks right.
  box(0.026, 0.34, 0.03, wood, 0, -0.04, 0);
  box(0.014, 0.08, 0.13, metal, 0, 0.1, -0.045);
  box(0.01, 0.1, 0.035, steel, 0, 0.1, -0.12);
  let spin = e.s?.k ? 0 : Math.random() * 6;
  return {
    object: obj,
    update(s, dt, m) {
      if (s.s?.k) {
        // Lying on the ground, blade up a little.
        spinner.rotation.set(0, 0, Math.PI / 2 - 0.15);
        spinner.position.y = 0.03;
      } else {
        spin += dt * 20;
        spinner.rotation.set(-spin, 0, 0);
        spinner.position.y = 0;
      }
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
  // Secondary launchers: sized by their blast (an RPG-7 warhead is a lot bigger than a frag).
  const lb = launcherBlast(e);
  const size = lb ? Math.max(2.2, lb.radius * 0.85) : tactical ? 3 : 4.5;
  if (lb && lb.radius <= 0) {
    // A Killer Bee flak burst high up: a dark puff and sparks.
    m.effects.puff('spark', at, undefined, 16);
    m.effects.puff('dust', at, undefined, 14);
    sfx.play('weapons.rocketboom', { at, volume: 1.2, range: 'far' });
  } else if (lb) {
    m.effects.puff('spark', at, { x: 0, y: 1, z: 0 }, Math.round(8 + lb.radius * 2));
    m.effects.puff('dust', at, { x: 0, y: 1, z: 0 }, Math.round(10 + lb.radius * 3));
    m.effects.puff('dust', { x, y: y + 0.8, z }, { x: 0, y: 1, z: 0 }, Math.round(lb.radius * 2));
    sfx.play(lb.radius >= 6 ? 'weapons.rocketboom.big' : lb.radius >= 4 ? 'weapons.rocketboom' : 'weapons.boom', { at, volume: 1.6, ...(lb.radius >= 6 ? { range: 'far' as const } : {}) });
  } else if (tactical) {
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
  sprite.scale.setScalar(size);
  m.renderer.scene.add(sprite);
  blasts.push({ sprite, life: 0.25, max: 0.25 });
  const cam = m.renderer.cam.position;
  const d = Math.hypot(cam.x - x, cam.y - y, cam.z - z);
  if (!tactical) blastJolt(m, ...blastFeel(e, d));
}

// ---------------------------------------------------------------------------------------------
// Match hook: messages, local actions, camera effects
// ---------------------------------------------------------------------------------------------

let prevHeld = { melee: false, lethal: false, tactical: false };
let meleeReadyAt = 0;
let throwBusyUntil = 0;
/**
 * Equipment raised in the hand while the button is held (thrown on release). `since`: local time
 * of the input frame that carried the press (a cookable grenade's fuse runs from there; the
 * server's `weapons.cook` ack re-anchors it to the command it actually pulled the pin on).
 * `ticked`: held time of the last cook tick played.
 */
let holding: { kind: 'lethal' | 'tactical'; id: string; since: number; acked: boolean; ticked: number } | null = null;
/** Recent frames: the last input seq each one sent and its local time (to map the ack's seq back). */
const frameSeqs: FrameSeq[] = [];

/** The cook on screen right now: held seconds, fuse left and the warning flag, or null. */
export function cookState(now: number): { id: string; fuse: number; held: number; left: number; warn: boolean } | null {
  if (!holding) return null;
  const def = EQUIPMENT_BY_ID.get(holding.id);
  if (!def?.cookable) return null;
  const held = Math.max(0, now - holding.since);
  return { id: def.id, fuse: def.fuse, held, left: cookLeft(def.fuse, held), warn: cookWarning(def.fuse, held) };
}

registerMatchHook('weapons.equipment', {
  start(m) {
    equipState.flash = { at: -99, dur: 0, amount: 0 };
    equipState.stun = { at: -99, dur: 0, amount: 0 };
    // Times are room times: a shake left over from the previous room (whose clock was further
    // along) would read as "in the future" here and shake the camera for minutes.
    equipState.shake = { at: -99, amount: 0 };
    prevHeld = { melee: false, lethal: false, tactical: false };
    holding = null;
    frameSeqs.length = 0;
    const offs = [
      // The server pulled the pin on this command: run the cook timer from the frame that sent it.
      onFeature('weapons.cook', (d) => {
        if (!holding || holding.id !== d.e || holding.kind !== 'lethal') return;
        const t = frameTimeOfSeq(frameSeqs, d.seq);
        if (t !== null) holding.since = t;
        holding.acked = true;
      }),
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
      onFeature('weapons.retrieve', (d) => {
        sfx.play('weapons.shell', { volume: 0.8 });
        m.notices.push({ t: m.time, text: `+1 ${(EQUIPMENT_BY_ID.get(d.e)?.name ?? d.e).toUpperCase()}` });
      }),
      onFeature('weapons.throw', (d) => {
        if (d.p === m.myId) {
          // The server let go of the grenade we still show in hand (a hitch long enough for it to
          // idle our buttons): follow it rather than keep a cook timer for a grenade in the air.
          if (holding && holding.acked && holding.id === d.e) {
            m.viewmodel.action(`release:${holding.id}`, 0.4);
            throwBusyUntil = m.time + THROW_RECOVERY;
            holding = null;
          }
          return;
        }
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

    // This frame's input already went out (hooks run after the command): remember its last seq.
    pushFrame(frameSeqs, m.net.seq, m.time);

    // Local knife / throw: start the viewmodel action on the key edge (the server decides the outcome).
    const c = m.controls;
    const held = { melee: c.isHeld('melee'), lethal: c.isHeld('lethal'), tactical: c.isHeld('tactical') };
    const ok = m.alive && m.phase === 'playing' && c.locked;
    if (ok && held.melee && !prevHeld.melee && m.time >= meleeReadyAt && m.time >= throwBusyUntil) {
      meleeReadyAt = m.time + MELEE.cooldownSec * equipState.melee;
      m.viewmodel.action('melee', MELEE.recoverySec * equipState.melee);
      sfx.play('weapons.knife', { volume: 0.7 });
    }
    // Lethal / tactical: raise on the press and hold it up (a held viewmodel action) until release.
    if (holding) {
      const def = EQUIPMENT_BY_ID.get(holding.id);
      const heldSec = m.time - holding.since;
      const cookedOff = !!def?.cookable && cookLeft(def.fuse, heldSec) <= 0;
      // Cook ticks: one per second held, faster in the last second (shared schedule).
      if (def?.cookable && !cookedOff && heldSec > holding.ticked) {
        const warn = cookWarning(def.fuse, heldSec);
        if (cookTicksBetween(def.fuse, holding.ticked, heldSec) > 0) sfx.play('weapons.cook', { volume: warn ? 0.6 : 0.45, rate: warn ? 1.25 : 1 });
        holding.ticked = heldSec;
      }
      // A cook the server never acknowledged (it refused the press): drop the prediction.
      const unconfirmed = !!def?.cookable && !holding.acked && heldSec > Math.max(0.5, m.netRtt * 2 + 0.25);
      if (!ok || cookedOff || unconfirmed) {
        m.viewmodel.endAction();
        holding = null;
      } else if (!held[holding.kind]) {
        // The server throws no sooner than the wind-up after the press.
        const wait = Math.max(0, holding.since + THROW_WINDUP - m.time);
        m.viewmodel.action(`release:${holding.id}`, wait + 0.4);
        if (holding.id === 'tomahawk') sfx.play('weapons.knife', { volume: 0.6 });
        throwBusyUntil = m.time + wait + THROW_RECOVERY;
        holding = null;
      }
    } else {
      for (const kind of ['lethal', 'tactical'] as const) {
        if (!ok || !held[kind] || prevHeld[kind] || m.time < throwBusyUntil) continue;
        const n = kind === 'lethal' ? equipState.lethalN : equipState.tacticalN;
        const id = kind === 'lethal' ? equipState.lethal : equipState.tactical;
        if (n <= 0 || !id) continue;
        holding = { kind, id, since: m.time, acked: false, ticked: 0 };
        m.viewmodel.action(`ready:${id}`, THROW_WINDUP, true);
        if (id !== 'tomahawk') sfx.play('weapons.pin', { volume: 0.5 });
        break;
      }
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
  if (id === 'tomahawk') {
    // Handle and hatchet head.
    rect(g, x + u, y - 2 * u, 2 * u, 9 * u, C.ink);
    rect(g, x + 1.5 * u, y - u, u, 7 * u, dim ? C.empty : '#a07848');
    rect(g, x - 2 * u, y - 2 * u, 4 * u, 4 * u, C.ink);
    rect(g, x - 1.5 * u, y - 1.5 * u, 3 * u, 3 * u, dim ? C.empty : '#c8c8c8');
    return;
  }
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

// Cook timer under the crosshair while a cookable grenade (frag) is held with the pin out: the
// grenade icon, a bar that drains to the detonation (a notch per second) and the seconds left;
// the last second flashes red ("throw now"). It runs on the shared `cookLeft` maths from the
// frame whose input carried the press, re-anchored by the server's `weapons.cook` ack.
registerHudWidget(
  'weapons.cook',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.alive) return;
    const ck = cookState(m.time);
    if (!ck || ck.left <= 0) return;
    const u = unit(H);
    const bw = 40 * u;
    const bh = 3 * u;
    const x = Math.round(W / 2 - bw / 2);
    const y = Math.round(H / 2 + 30 * u);
    const flashOn = !ck.warn || blink(m.time, 0.16, 0.09);
    const col = ck.warn ? (flashOn ? C.warn : C.paper) : C.hi;
    icon(g, ck.id, x - 9 * u, y - 2 * u, u, false);
    rect(g, x - u, y - u, bw + 2 * u, bh + 2 * u, C.ink);
    rect(g, x, y, bw, bh, C.empty);
    rect(g, x, y, Math.round(bw * (ck.left / ck.fuse)), bh, col);
    for (let s = 1; s < ck.fuse; s++) rect(g, x + Math.round((bw * s) / ck.fuse), y, u, bh, C.ink);
    txt(g, ck.left.toFixed(1), x + bw + 4 * u, y - 2 * u, 8, col, 'left', u);
    if (ck.warn && flashOn) txt(g, 'THROW', W / 2, y + 6 * u, 8, C.warn, 'center', u);
  },
  27,
);

// Grenade indicator (BO1): a grenade icon on a ring around the crosshair with a pointer aimed at
// each live lethal that can kill you (danger.ts), red inside the kill radius itself.
registerHudWidget(
  'weapons.danger',
  (g, W, H) => {
    const m = currentMatch();
    const snap = m?.net.lastSnap;
    if (!m || !snap || !m.alive) return;
    const u = unit(H);
    const cam = m.renderer.cam;
    const nades: DangerNade[] = [];
    for (const e of snap.ents) if (e.kind === NADE_ENTITY) nades.push({ x: e.x, y: e.y, z: e.z, equip: String(e.s?.e ?? ''), owner: e.owner ?? null, stuckTo: typeof e.s?.p === 'string' ? e.s.p : null });
    if (!nades.length) return;
    const marks = grenadeDangers(nades, { x: cam.position.x, y: cam.position.y, z: cam.position.z, yaw: m.yaw, id: m.myId, canHurt: (owner) => !owner || owner === m.myId || m.isEnemy(owner) });
    const r = 42 * u;
    const u2 = u * 2;
    for (const mk of marks.slice(0, 4)) {
      // Inside the kill radius: solid red; in the margin: a steady yellow blink.
      if (!mk.lethal && !blink(m.time, 0.3, 0.2)) continue;
      const pos = dangerRingPos(mk.angle, W / 2, H / 2, r, 20 * u);
      const col = mk.lethal ? C.warn : C.hi;
      // Pointer: a wedge beyond the icon, aimed at the grenade.
      const ax = Math.sin(mk.angle);
      const ay = -Math.cos(mk.angle);
      const tip = { x: pos.tipX, y: pos.tipY };
      const base = { x: pos.x + ax * 9 * u, y: pos.y + ay * 9 * u };
      const wing = 7 * u;
      g.beginPath();
      g.moveTo(tip.x + ax * u, tip.y + ay * u);
      g.lineTo(base.x - ay * (wing + u), base.y + ax * (wing + u));
      g.lineTo(base.x + ay * (wing + u), base.y - ax * (wing + u));
      g.closePath();
      g.fillStyle = C.ink;
      g.fill();
      g.beginPath();
      g.moveTo(tip.x, tip.y);
      g.lineTo(base.x - ay * wing, base.y + ax * wing);
      g.lineTo(base.x + ay * wing, base.y - ax * wing);
      g.closePath();
      g.fillStyle = col;
      g.fill();
      // The grenade icon at double size on a dark tile with a coloured rim.
      rect(g, pos.x - 9 * u, pos.y - 9 * u, 18 * u, 18 * u, col);
      rect(g, pos.x - 8 * u, pos.y - 8 * u, 16 * u, 16 * u, 'rgba(10,10,10,.8)');
      icon(g, mk.equip, pos.x - 2.5 * u2, pos.y - 2.5 * u2, u2, false);
    }
  },
  26,
);
