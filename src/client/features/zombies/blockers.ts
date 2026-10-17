/**
 * Barriers, doors and fires on the client (layers that have them; see server blockers.ts):
 * - `zm_barrier`: the window's six boards nailed across the opening; a torn board is ripped outwards
 *   and drops, a rebuilt one flies in from the room and slams home (`zombies.board_tear`,
 *   `zombies.board_slam`);
 * - `zm_door`: the debris pile, furniture barricade or door (Nacht's "HELP" door) that closes a gap;
 *   once bought the debris lifts away and the door swings open (`zombies.door_clear`);
 * - the prediction world's gates follow the doors in the snapshot (a shut door blocks your own
 *   movement before the server says so);
 * - flames and smoke over the layer's fires;
 * - `blockerPrompts`: "HOLD F TO REBUILD BARRIER" / "HOLD F TO CLEAR DEBRIS [1000]" for the HUD.
 * All synthesized and original sounds (SFX_SYNTH_ONLY).
 */
import * as THREE from 'three';
import { BARRIER, barrierPoints, DOORS, ZM_ENTITY } from '../../../shared/defs/zombies';
import { zombiesLayer } from '../../../shared/maps/zombies/index';
import type { EntitySnap } from '../../../shared/protocol';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { registerEntityRenderer, registerMatchHook } from '../../registry';
import { grain } from '../../render/developer';
import { registerTexture } from '../../render/textures';
import { Kit } from '../killstreaks/models';
import { fxEmit } from '../weapons/wonder/index';
import { isZombiesMatch } from './store';

const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : d);
const lightOf = (m: Match) => (m.map ? (x: number, y: number, z: number) => m.map!.lightAt(x, y, z) : null);
const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

// ---------------------------------------------------------------------------------------------
// Textures and sounds
// ---------------------------------------------------------------------------------------------

registerTexture('zm_board', {
  w: 32,
  h: 8,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#7a5a3a', 0.18);
    g.fillStyle = 'rgba(40,24,12,.6)';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, h - 1, w, 1);
    g.fillStyle = '#2a2622';
    g.fillRect(2, 3, 1, 2);
    g.fillRect(w - 3, 3, 1, 2);
  },
  photos: ['brown_planks_05'],
  photo: (c) => c.fromPhoto('brown_planks_05', { w: 64, h: 16, tile: 64, filter: 'saturate(.6) brightness(.8)' }),
});

registerTexture('zm_helpdoor', {
  w: 32,
  h: 64,
  wrap: false,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5a4632', 0.16);
    g.fillStyle = 'rgba(20,12,6,.55)';
    for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 1, h);
    g.fillRect(0, 10, w, 2);
    g.fillRect(0, h - 12, w, 2);
  },
  photos: ['weathered_plank_siding'],
  photo: (c) => c.fromPhoto('weathered_plank_siding', { w: 64, h: 128, filter: 'saturate(.5) brightness(.75)' }),
});

/** Painted words (Nacht: "HELP" with the P left unfinished). */
function paintLabel(id: string, text: string): void {
  registerTexture(id, {
    w: 64,
    h: 32,
    wrap: false,
    posterize: false,
    photo: 'none',
    draw(g, w, h, R) {
      g.clearRect(0, 0, w, h);
      g.font = 'bold 20px serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let k = 0; k < 3; k++) {
        g.fillStyle = `rgba(${200 + R.rnd() * 40},${226 + R.rnd() * 20},${226 + R.rnd() * 20},${0.5 + R.rnd() * 0.3})`;
        g.fillText(text, w / 2 + (R.rnd() - 0.5) * 1.5, h / 2 + (R.rnd() - 0.5) * 1.5);
      }
      // The last letter's bowl was never finished.
      if (text.endsWith('P')) g.clearRect(w / 2 + 14, h / 2 - 2, 8, 6);
    },
  });
}
paintLabel('zm_label_HELP', 'HELP');

function tone(ctx: AudioContext, dur: number, f: (t: number) => number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, (dur * sr) | 0);
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < len; i++) {
    d[i] = f(i / sr);
    peak = Math.max(peak, Math.abs(d[i]!));
  }
  if (peak > 0.9) for (let i = 0; i < len; i++) d[i] = (d[i]! / peak) * 0.9;
  return b;
}
const noise = () => Math.random() * 2 - 1;

// A board wrenched off: a wooden crack, a splintering rattle, the nails squealing.
sfx.register('zombies.board_tear', (ctx) => {
  let lp = 0;
  return tone(ctx, 0.7, (t) => {
    const n = noise();
    lp += (n - lp) * 0.25;
    const crack = t < 0.03 ? n * (1 - t / 0.03) : 0;
    const splinter = lp * 1.8 * Math.exp(-t * 7) * (0.6 + 0.4 * Math.sin(t * 380));
    const squeal = Math.sin(2 * Math.PI * (1400 - 700 * t) * t) * 0.18 * Math.max(0, 1 - Math.abs(t - 0.15) / 0.12);
    return crack * 0.9 + splinter + squeal;
  });
});

// A board slammed back and nailed: a thud and two hammer taps.
sfx.register('zombies.board_slam', (ctx) =>
  tone(ctx, 0.6, (t) => {
    const thud = (Math.sin(2 * Math.PI * 95 * t) * 0.8 + noise() * 0.4) * Math.exp(-t * 22);
    const tap = (at: number) => (t < at ? 0 : (Math.sin(2 * Math.PI * 1800 * (t - at)) * 0.3 + noise() * 0.25) * Math.exp(-(t - at) * 60));
    return thud + tap(0.22) + tap(0.38);
  }),
);

// Debris cleared: rubble sliding and dropping away.
sfx.register('zombies.door_clear', (ctx) => {
  let lp = 0;
  return tone(ctx, 1.6, (t) => {
    lp += (noise() - lp) * 0.08;
    const slide = lp * 2.2 * Math.min(1, t / 0.15) * Math.exp(-t * 1.6);
    const thump = (at: number) => (t < at ? 0 : Math.sin(2 * Math.PI * 70 * (t - at)) * 0.6 * Math.exp(-(t - at) * 14));
    return slide + thump(0.1) + thump(0.55) * 0.7 + thump(0.9) * 0.5;
  });
});

// ---------------------------------------------------------------------------------------------
// Barriers
// ---------------------------------------------------------------------------------------------

registerEntityRenderer(ZM_ENTITY.barrier, (e, m) => {
  const kit = new Kit();
  const wood = kit.mat('zm_board', { rep: 0.6 });
  const w = num(e.s?.w, 1.4);
  const h = num(e.s?.h, 1.3);
  const sill = num(e.s?.sl, BARRIER.sill);
  // Six planks across the opening, nailed on the outer half of the wall, each at its own angle.
  let seed = (e.id * 9301 + 49297) % 233280;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const boards = Array.from({ length: BARRIER.boards }, (_, i) => {
    const g = new THREE.Group();
    const y = sill + ((i + 0.5) / BARRIER.boards) * h;
    const tilt = (i % 2 ? 1 : -1) * (0.08 + rnd() * 0.16);
    kit.box(g, w + 0.32, Math.min(0.2, h / BARRIER.boards + 0.03), 0.05, wood, 0, 0, 0);
    g.rotation.z = tilt;
    g.position.set((rnd() - 0.5) * 0.08, y, 0.1 + i * 0.006);
    kit.root.add(g);
    return { g, home: g.position.clone(), tilt, anim: 0 as number, kind: '' as '' | 'tear' | 'slam' };
  });
  // Torn off from the top down, put back from the bottom up.
  let shown = Math.round(num(e.s?.b, BARRIER.boards));
  boards.forEach((b, i) => (b.g.visible = i < shown));
  const at = () => ({ x: kit.root.position.x, y: kit.root.position.y + sill + h * 0.5, z: kit.root.position.z });
  return {
    object: kit.root,
    update(s: EntitySnap, dt) {
      const want = Math.round(num(s.s?.b, BARRIER.boards));
      while (shown > want) {
        shown--;
        const b = boards[shown]!;
        b.kind = 'tear';
        b.anim = 0;
        sfx.play('zombies.board_tear', { at: at(), volume: 0.9 });
      }
      while (shown < want) {
        const b = boards[shown]!;
        b.kind = 'slam';
        b.anim = 0;
        b.g.visible = true;
        shown++;
        sfx.play('zombies.board_slam', { at: at(), volume: 0.9 });
      }
      for (const b of boards) {
        if (!b.kind) continue;
        b.anim += dt;
        if (b.kind === 'tear') {
          // Ripped outwards (+z is outside), spinning, then gone.
          const k = b.anim / 0.7;
          b.g.position.set(b.home.x, b.home.y + 0.6 * k - 2.2 * k * k, b.home.z + 1.4 * k);
          b.g.rotation.z = b.tilt + k * 2.5;
          if (k >= 1) {
            b.kind = '';
            b.g.visible = false;
            b.g.position.copy(b.home);
            b.g.rotation.z = b.tilt;
          }
        } else {
          // Swung in from the room side and slammed home.
          const k = smooth(b.anim / 0.28);
          b.g.position.set(b.home.x, b.home.y, b.home.z - 0.8 * (1 - k));
          b.g.rotation.z = b.tilt + (1 - k) * 0.6;
          if (k >= 1) b.kind = '';
        }
      }
      kit.light(dt, lightOf(m), kit.root.position);
    },
    dispose: () => kit.dispose(),
  };
});

// ---------------------------------------------------------------------------------------------
// Doors and debris
// ---------------------------------------------------------------------------------------------

registerEntityRenderer(ZM_ENTITY.door, (e, m) => {
  const kit = new Kit();
  const kind = String(e.s?.k ?? 'debris');
  const w = num(e.s?.w, 1.5);
  const h = num(e.s?.h, 2.4);
  const lift = new THREE.Group();
  kit.root.add(lift);
  let leaf: THREE.Group | null = null;
  let seed = (e.id * 7919 + 13) % 233280;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  if (kind === 'door') {
    // A plank door, hinged on its left, with the painted label.
    leaf = new THREE.Group();
    leaf.position.set(-w / 2, 0, 0);
    lift.add(leaf);
    const door = kit.mat('zm_helpdoor', { rep: 1 });
    kit.box(leaf, w, h, 0.08, door, w / 2, h / 2, 0);
    const label = typeof e.s?.l === 'string' ? e.s.l : '';
    if (label) {
      const tex = kit.mat(`zm_label_${label}`, { emissive: 0.6 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.85, w * 0.42), tex);
      plane.position.set(w / 2, h * 0.62, -0.045);
      plane.rotation.y = Math.PI;
      leaf.add(plane);
    }
    const iron = kit.mat('gunmetal', { rep: 0.3 });
    for (const y of [0.4, h - 0.4]) kit.box(leaf, w * 0.9, 0.08, 0.1, iron, w / 2, y, 0);
  } else if (kind === 'furniture') {
    // The barricade on the stairs: a sofa on its end, a cabinet, chairs and planks.
    const cloth = kit.mat('bo_fabric', { tint: 0x6a5040, rep: 0.6 });
    const wood = kit.mat('bo_wood', { rep: 0.6 });
    const board = kit.mat('zm_board', { rep: 0.6 });
    const sofa = kit.box(lift, w * 0.95, 0.8, 0.85, cloth, 0, 0.4, 0.1);
    sofa.rotation.z = 0.12;
    kit.box(lift, w * 0.9, 0.5, 0.25, cloth, 0, 1.05, 0.38).rotation.x = -0.3;
    kit.box(lift, 0.7, 1.4, 0.45, wood, w * 0.25, 1.15, -0.15).rotation.z = -0.25;
    for (let i = 0; i < 4; i++) {
      const p = kit.box(lift, w * 1.1, 0.16, 0.05, board, (rnd() - 0.5) * 0.3, 0.6 + i * 0.42, -0.42);
      p.rotation.z = (rnd() - 0.5) * 0.7;
    }
    const chair = kit.box(lift, 0.45, 0.9, 0.45, wood, -w * 0.3, 1.6, 0.05);
    chair.rotation.set(0.8, 0.3, 1.2);
  } else {
    // A pile of rubble, broken planks and a beam choking the stairs.
    const rubble = kit.mat('nd_rubble', { rep: 0.5 });
    const board = kit.mat('zm_board', { rep: 0.6 });
    for (let i = 0; i < 9; i++) {
      const s = 0.35 + rnd() * 0.45;
      const b = kit.box(lift, s * 1.3, s, s, rubble, (rnd() - 0.5) * w, s * 0.4 + (i > 5 ? 0.6 : 0), (rnd() - 0.5) * 0.6);
      b.rotation.set(rnd(), rnd() * 3, rnd() * 0.5);
    }
    for (let i = 0; i < 6; i++) {
      const p = kit.box(lift, w * (0.8 + rnd() * 0.5), 0.15, 0.05, board, (rnd() - 0.5) * 0.4, 0.3 + rnd() * (h - 0.6), (rnd() - 0.5) * 0.3);
      p.rotation.set(rnd() * 0.4, (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 1.6);
    }
    kit.box(lift, 0.25, 0.25, w * 1.6, kit.mat('bo_wood', { rep: 0.5 }), 0, 1.2, 0).rotation.set(0.6, Math.PI / 2, 0.4);
  }
  let played = -1;
  return {
    object: kit.root,
    update(s: EntitySnap, dt) {
      const o = typeof s.s?.o === 'number' ? s.s.o : null;
      const now = m.serverTime;
      if (o !== null) {
        const k = smooth((now - o) / DOORS.openSec);
        if (played !== o) {
          played = o;
          if (now - o < 0.5) sfx.play('zombies.door_clear', { at: { x: s.x, y: s.y + 1, z: s.z }, volume: 1.1 });
        }
        if (leaf) leaf.rotation.y = -1.75 * k;
        else {
          // BO1 debris lifts away and vanishes.
          lift.position.y = 3.2 * k;
          lift.rotation.y = 0.4 * k;
          lift.visible = k < 0.98;
        }
      } else {
        if (leaf) leaf.rotation.y = 0;
        lift.position.y = 0;
        lift.rotation.y = 0;
        lift.visible = true;
      }
      kit.light(dt, lightOf(m), kit.root.position);
    },
    dispose: () => kit.dispose(),
  };
});

// ---------------------------------------------------------------------------------------------
// Prompts (the HUD's `promptFor` asks)
// ---------------------------------------------------------------------------------------------

export interface BlockerPrompt {
  d: number;
  text: string;
  cost: number;
}

/** What USE would do at a window or a door from `pos` (mirrors the server's reach rules). */
export function blockerPrompts(m: Match, pos: { x: number; y: number; z: number }, key: string): BlockerPrompt[] {
  const out: BlockerPrompt[] = [];
  for (const e of m.net.lastSnap?.ents ?? []) {
    if (e.kind === ZM_ENTITY.barrier) {
      if (num(e.s?.b, BARRIER.boards) >= BARRIER.boards) continue;
      const { inside } = barrierPoints({ x: e.x, y: e.y, z: e.z, yaw: e.yaw });
      const d = Math.hypot(pos.x - inside.x, pos.z - inside.z);
      const fx = -Math.sin(e.yaw);
      const fz = -Math.cos(e.yaw);
      if (d > BARRIER.reach || Math.abs(pos.y - e.y) > 1.2 || (pos.x - e.x) * fx + (pos.z - e.z) * fz < 0.1) continue;
      out.push({ d: d + 0.3, text: `HOLD ${key} TO REBUILD BARRIER`, cost: 0 });
    } else if (e.kind === ZM_ENTITY.door) {
      if (typeof e.s?.o === 'number') continue;
      const d = Math.hypot(pos.x - e.x, pos.z - e.z);
      const h = num(e.s?.h, 2.4);
      if (d > DOORS.reach || pos.y < e.y - 1.2 || pos.y > e.y + Math.max(1.2, h * 0.6)) continue;
      const cost = num(e.s?.c, 1000);
      const what = e.s?.k === 'door' ? 'OPEN DOOR' : e.s?.k === 'furniture' ? 'CLEAR THE BARRICADE' : 'CLEAR DEBRIS';
      out.push({ d, text: `HOLD ${key} TO ${what} [${cost}]`, cost });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The prediction world's gates, and the fires
// ---------------------------------------------------------------------------------------------

registerMatchHook('zombies.blockers', {
  start(m) {
    if (!isZombiesMatch(m)) return;
    const layer = zombiesLayer(m.joined.map);
    if (!layer?.doors?.length && !layer?.fires?.length) return;
    const world = m.net.world;
    const open = new Set<string>();
    const ids = new Set((layer.doors ?? []).map((d) => `door:${d.id}`));
    // A gate is shut until the snapshot says its door is open.
    if (ids.size) world.gateOn = (g) => !open.has(g);
    const fires = layer.fires ?? [];
    let acc = 0;
    const frame = (dt: number) => {
      open.clear();
      for (const e of m.net.lastSnap?.ents ?? []) if (e.kind === ZM_ENTITY.door && typeof e.s?.o === 'number') for (const d of layer.doors ?? []) if (Math.hypot(d.x - e.x, d.z - e.z) < 0.05) open.add(`door:${d.id}`);
      if (!fires.length) return;
      acc += dt;
      if (acc < 1 / 30) return;
      const step = acc;
      acc = 0;
      const cam = m.renderer.cam.position;
      for (const f of fires) {
        if (Math.hypot(cam.x - f.x, cam.z - f.z) > 55) continue;
        const s = f.size ?? 1;
        // Tongues of flame licking up, a few sparks.
        for (let n = Math.floor(30 * step * s + Math.random()); n > 0; n--) {
          const r = 0.55 * s;
          fxEmit({ x: f.x + (Math.random() - 0.5) * r * 2, y: f.y + 0.1, z: f.z + (Math.random() - 0.5) * r * 2 }, { color: Math.random() < 0.5 ? 0xff7a20 : 0xffb030, life: 0.45 + Math.random() * 0.45, size: (0.7 + Math.random() * 0.5) * s, size1: 0.15, vel: { x: (Math.random() - 0.5) * 0.4, y: 1.4 + Math.random() * 1.2, z: (Math.random() - 0.5) * 0.4 } });
        }
        if (Math.random() < 4 * step * s) fxEmit({ x: f.x + (Math.random() - 0.5) * s, y: f.y + 0.5, z: f.z + (Math.random() - 0.5) * s }, { color: 0xffe0a0, life: 1.2, size: 0.06, vel: { x: (Math.random() - 0.5) * 1.2, y: 2.5 + Math.random() * 2, z: (Math.random() - 0.5) * 1.2 }, grav: 1.2 });
      }
    };
    frames.set(m, frame);
    return () => {
      frames.delete(m);
      if (world.gateOn) world.gateOn = null;
    };
  },
  frame(m, dt) {
    frames.get(m)?.(dt);
  },
});

const frames = new WeakMap<Match, (dt: number) => void>();
