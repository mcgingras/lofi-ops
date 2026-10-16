/**
 * Zombies world props (entity renderers):
 * - `zm_wall`: a wall-buy, the gun drawn in chalk on the wall (the real gun model in a flat white
 *   chalk material, pressed flat) with a chalk frame and its price;
 * - `zm_perk`: a Perk-a-Cola vending machine in the perk's colour with a glowing logo panel, a sign
 *   and a halo; it plays its (original) jingle now and then when someone is near;
 * - `zm_box`: the Mystery Box (the killstreak box's model, beam and cycle) that opens, cycles, offers,
 *   closes again and, with the teddy bear, flies off up its beam;
 * - `zm_boxspot`: where the box can move to (a pallet and some straw);
 * - `zm_powerup`: a power-up floating, spinning and glowing green, blinking before it goes.
 * All face -z like every model (core turns them to the entity yaw).
 */
import * as THREE from 'three';
import { BOX_CYCLE_WAITS, BOX_PHASE, boxHeight, cycleModel, cycleTimes, MYSTERY_BOX } from '../../../shared/defs/mystery-box';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { PERK_COLA_BY_ID, POWERUP_RULES, WALL_PRICES, ZM_ENTITY, type PerkColaId, type PowerupId } from '../../../shared/defs/zombies';
import type { EntitySnap } from '../../../shared/protocol';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { registerEntityRenderer } from '../../registry';
import { grain } from '../../render/developer';
import { makeLookMaterial, setDynLight, type LookMaterial } from '../../render/shader';
import { registerTexture, unbindTexture } from '../../render/textures';
import { beam, buildBox, weaponModel } from '../killstreaks/mysterybox';
import { Kit } from '../killstreaks/models';
import { FURNITURE, GUNS, Kit as GunKit } from '../weapons/gunkit';
import { fxEmit } from '../weapons/wonder/index';

const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : d);
const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};
const hex = (c: string) => parseInt(c.slice(1), 16);
const lightOf = (m: Match) => (m.map ? (x: number, y: number, z: number) => m.map!.lightAt(x, y, z) : null);

// ---------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------

/** Chalk: rough white strokes on transparent. */
function chalkLine(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, R: { rnd(): number }): void {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let i = 0; i <= n; i++) {
    const t = i / Math.max(1, n);
    if (R.rnd() < 0.12) continue;
    g.fillStyle = R.rnd() < 0.5 ? '#f4f0e6' : '#d8d2c4';
    g.fillRect(Math.round(x0 + (x1 - x0) * t + (R.rnd() - 0.5)), Math.round(y0 + (y1 - y0) * t + (R.rnd() - 0.5)), 1, 1);
  }
}

/** A tiny 3x5 pixel font for digits (crisp at the lo-fi texture size). */
const DIGITS: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
};
function digits(g: CanvasRenderingContext2D, s: string, cx: number, y: number, scale: number, color: string): void {
  const w = s.length * 4 * scale - scale;
  let x = Math.round(cx - w / 2);
  g.fillStyle = color;
  for (const ch of s) {
    const rows = DIGITS[ch];
    if (rows) rows.forEach((row, ry) => [...row].forEach((c, rx) => c === '#' && g.fillRect(x + rx * scale, y + ry * scale, scale, scale)));
    x += 4 * scale;
  }
}

/** The chalk frame and price under a wall-buy. One texture per price. */
const prices = new Set([...Object.values(WALL_PRICES), 500, 750, 1000, 1200, 1500, 2000]);
for (const price of prices) {
  registerTexture(`zm_chalk_${price}`, {
    w: 64,
    h: 32,
    wrap: false,
    posterize: false,
    photo: 'none',
    draw(g, w, h, R) {
      g.clearRect(0, 0, w, h);
      // A loose frame around the gun (top two thirds), the price underneath.
      chalkLine(g, 3, 2, w - 4, 3, R);
      chalkLine(g, w - 4, 3, w - 3, 21, R);
      chalkLine(g, w - 3, 21, 4, 22, R);
      chalkLine(g, 4, 22, 3, 2, R);
      digits(g, String(price), w / 2, 24, 1, '#f4f0e6');
    },
  });
}

/** Chalk itself (the gun drawing's material). */
registerTexture('zm_chalk', {
  w: 8,
  h: 8,
  posterize: false,
  photo: 'none',
  draw(g, w, h, R) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        g.fillStyle = R.rnd() < 0.2 ? '#cfc8b8' : '#f6f2e8';
        g.fillRect(x, y, 1, 1);
      }
  },
});

/** Perk machine logos: a simple glyph per perk on its colour. */
const LOGOS: Record<PerkColaId, string[]> = {
  jugg: ['..####..', '.#....#.', '#..##..#', '#.####.#', '#.####.#', '#..##..#', '.#....#.', '..####..'],
  speed: ['....##..', '...##...', '..##....', '.######.', '....##..', '...##...', '..##....', '.##.....'],
  doubletap: ['.##..##.', '.##..##.', '.##..##.', '#..##..#', '#..##..#', '#..##..#', '#..##..#', '.##..##.'],
  revive: ['...##...', '...##...', '...##...', '########', '########', '...##...', '...##...', '...##...'],
};
for (const [id, rows] of Object.entries(LOGOS) as [PerkColaId, string[]][]) {
  const col = PERK_COLA_BY_ID.get(id)!.color;
  registerTexture(`zm_perk_${id}`, {
    w: 16,
    h: 16,
    wrap: false,
    posterize: false,
    photo: 'none',
    draw(g) {
      g.fillStyle = col;
      g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#1a1a1a';
      g.fillRect(1, 1, 14, 14);
      g.fillStyle = col;
      g.fillRect(2, 2, 12, 12);
      rows.forEach((row, y) => [...row].forEach((c, x) => {
        if (c !== '#') return;
        g.fillStyle = '#fff8e8';
        g.fillRect(4 + x, 4 + y, 1, 1);
      }));
    },
  });
}

registerTexture('zm_machine', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d8d0c0', 0.14);
    g.fillStyle = '#a89c88';
    for (let y = 4; y < h; y += 9) g.fillRect(0, y, w, 1);
  },
  photos: ['rusty_painted_metal'],
  photo: (c) => c.fromPhoto('rusty_painted_metal', { w: 64, h: 64, tile: 64, filter: 'saturate(.25) brightness(1.15)' }),
});

registerTexture('zm_glow', {
  w: 8,
  h: 8,
  posterize: false,
  wrap: false,
  photo: 'none',
  draw(g) {
    g.clearRect(0, 0, 8, 8);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const d = Math.hypot(x - 3.5, y - 3.5);
        if (d < 3.6) {
          g.fillStyle = d < 1.6 ? '#ffffff' : '#d8ffd0';
          g.fillRect(x, y, 1, 1);
        }
      }
  },
});

registerTexture('zm_fur', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8a5a32', 0.25);
  },
  photo: 'auto',
});

registerTexture('zm_straw', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#b89a58', 0.3);
    g.fillStyle = '#d8c078';
    for (let i = 0; i < 12; i++) g.fillRect(Math.floor(R.rnd() * w), Math.floor(R.rnd() * h), 3, 1);
  },
  photo: 'auto',
});

// ---------------------------------------------------------------------------------------------
// Wall-buys
// ---------------------------------------------------------------------------------------------

registerEntityRenderer(ZM_ENTITY.wall, (e, m) => {
  const root = new THREE.Group();
  const mats: LookMaterial[] = [];
  const chalk = makeLookMaterial({ texture: 'zm_chalk', dyn: true, emissive: 0.55, rep: 0.2 });
  mats.push(chalk);
  const weapon = String(e.s?.w ?? 'mp5k');
  const price = num(e.s?.p, 1000);
  // The gun, flattened against the wall, in chalk.
  const gun = new THREE.Group();
  const inner = new THREE.Group();
  gun.add(inner);
  const model = WEAPON_BY_ID.get(weapon)?.model ?? weapon;
  const build = GUNS[model] ?? GUNS.ak47!;
  build(new GunKit(inner, () => chalk, null, FURNITURE[model] ?? 'poly'), []);
  inner.rotation.y = Math.PI / 2;
  gun.scale.set(1.2, 1.2, 0.08);
  gun.position.set(0.12, 1.45, -0.02);
  // Centre the drawing on its bounding box.
  const bb = new THREE.Box3().setFromObject(gun);
  gun.position.x -= (bb.min.x + bb.max.x) / 2;
  gun.position.y += 1.45 - (bb.min.y + bb.max.y) / 2;
  root.add(gun);
  // The chalk frame and the price.
  const frameMat = makeLookMaterial({ texture: `zm_chalk_${prices.has(price) ? price : 1000}`, dyn: true, emissive: 0.55 });
  mats.push(frameMat);
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), frameMat);
  frame.rotation.y = Math.PI;
  frame.position.set(0, 1.42, -0.015);
  root.add(frame);
  let lt = 0;
  return {
    object: root,
    update(_s, dt) {
      lt -= dt;
      if (lt <= 0 && m.map) {
        lt = 0.5;
        setDynLight(mats, m.map.lightAt(root.position.x, root.position.y + 1.4, root.position.z), 0.3);
      }
    },
    dispose() {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const mat of mats) {
        unbindTexture(mat);
        mat.dispose();
      }
    },
  };
});

// ---------------------------------------------------------------------------------------------
// Perk-a-Cola machines
// ---------------------------------------------------------------------------------------------

/** Machine body tints per perk (BO1-ish: red Jug, green Speed Cola, amber Double Tap, light blue Quick Revive). */
const BODY: Record<PerkColaId, number> = { jugg: 0xb83a2a, speed: 0x3a9a4a, doubletap: 0xa8742a, revive: 0x6aa8d8 };

registerEntityRenderer(ZM_ENTITY.perk, (e, m) => {
  const id = (String(e.s?.k ?? 'jugg') as PerkColaId);
  const def = PERK_COLA_BY_ID.get(id) ?? PERK_COLA_BY_ID.get('jugg')!;
  const kit = new Kit();
  const r = kit.root;
  const body = kit.mat('zm_machine', { rep: 0.6, tint: BODY[id] });
  const dark = kit.mat('ks_dark');
  const steel = kit.mat('gunmetal', { rep: 0.3 });
  const logo = kit.mat(`zm_perk_${id}`, { emissive: 1 });
  const W = 0.95;
  const H = 1.95;
  const D = 0.8;
  kit.box(r, W, H, D, body, 0, H / 2, 0);
  kit.box(r, W + 0.04, 0.08, D + 0.04, steel, 0, 0.04, 0);
  kit.box(r, W + 0.06, 0.12, D + 0.06, body, 0, H + 0.06, 0);
  // Front: the glowing logo panel, a coin slot and the bottle hatch.
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), logo);
  panel.position.set(0, 1.35, -D / 2 - 0.006);
  panel.rotation.y = Math.PI;
  r.add(panel);
  kit.box(r, 0.5, 0.18, 0.04, dark, 0, 0.45, -D / 2 - 0.01);
  kit.box(r, 0.06, 0.12, 0.03, steel, 0.36, 0.95, -D / 2 - 0.01);
  // A lit sign on top in the perk's colour.
  const sign = kit.box(r, W * 0.9, 0.2, 0.06, kit.mat('zm_machine', { tint: hex(def.color), emissive: 0.85 }), 0, H + 0.24, -0.1);
  void sign;
  const glow = kit.sprite('zm_glow', 2.4, hex(def.color));
  const gm = glow.material as THREE.SpriteMaterial;
  gm.blending = THREE.AdditiveBlending;
  gm.transparent = true;
  gm.alphaTest = 0;
  gm.depthWrite = false;
  glow.position.set(0, 1.4, -D / 2 - 0.25);
  r.add(glow);
  let jingleIn = 6 + Math.random() * 20;
  const jingle = `zombies.perk.${id}`;
  return {
    object: r,
    update(s: EntitySnap, dt) {
      const off = s.s?.off === 1;
      kit.light(dt, lightOf(m), r.position);
      gm.color.setHex(hex(def.color)).multiplyScalar(off ? 0.05 : 0.35 + 0.08 * Math.sin(m.time * 3));
      panel.visible = !off;
      // BO1's machines play their jingle now and then while someone is around.
      jingleIn -= dt;
      if (jingleIn <= 0) {
        jingleIn = 35 + Math.random() * 40;
        const cam = m.renderer.cam.position;
        if (!off && Math.hypot(cam.x - r.position.x, cam.z - r.position.z) < 18) sfx.play(jingle, { at: { x: r.position.x, y: r.position.y + 1.2, z: r.position.z }, volume: 0.8 });
      }
    },
    dispose: () => kit.dispose(),
  };
});

// ---------------------------------------------------------------------------------------------
// Box spots and the box
// ---------------------------------------------------------------------------------------------

registerEntityRenderer(ZM_ENTITY.boxSpot, (_e, m) => {
  const kit = new Kit();
  const wood = kit.mat('ks_mbox_wood', { rep: 0.5 });
  const straw = kit.mat('zm_straw', { rep: 0.4 });
  for (const z of [-0.2, 0, 0.2]) kit.box(kit.root, 1.3, 0.05, 0.14, wood, 0, 0.1, z);
  kit.box(kit.root, 0.12, 0.08, 0.6, wood, -0.55, 0.04, 0);
  kit.box(kit.root, 0.12, 0.08, 0.6, wood, 0.55, 0.04, 0);
  kit.box(kit.root, 0.9, 0.04, 0.45, straw, 0.05, 0.14, 0.02).rotation.y = 0.2;
  return { object: kit.root, update: (_s, dt) => kit.light(dt, lightOf(m), kit.root.position), dispose: () => kit.dispose() };
});

/** The teddy bear (BO1's box joker), sat up in the box. */
function buildTeddy(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const fur = kit.mat('zm_fur', { rep: 0.2 });
  const dark = kit.mat('ks_dark');
  kit.box(g, 0.26, 0.3, 0.2, fur, 0, 0, 0);
  kit.box(g, 0.22, 0.2, 0.2, fur, 0, 0.24, 0);
  for (const s of [-1, 1]) {
    kit.box(g, 0.07, 0.07, 0.05, fur, 0.09 * s, 0.37, 0);
    kit.box(g, 0.08, 0.2, 0.08, fur, 0.17 * s, 0.02, -0.02).rotation.z = 0.5 * s;
    kit.box(g, 0.09, 0.16, 0.09, fur, 0.08 * s, -0.2, -0.05);
    kit.box(g, 0.03, 0.03, 0.02, dark, 0.05 * s, 0.27, -0.105);
  }
  kit.box(g, 0.08, 0.06, 0.05, fur, 0, 0.2, -0.12);
  kit.box(g, 0.03, 0.03, 0.02, dark, 0, 0.22, -0.15);
  return g;
}

/** One-shot cues keyed by room time (no replays when joining late). */
class Cues {
  private done = new Set<string>();
  at(key: string, when: number, now: number, fn: () => void): void {
    if (this.done.has(key) || now < when) return;
    this.done.add(key);
    if (now - when < 0.35) fn();
  }
  reset(prefix: string): void {
    for (const k of [...this.done]) if (k.startsWith(prefix)) this.done.delete(k);
  }
}

registerEntityRenderer(ZM_ENTITY.box, (_e, m) => {
  const kit = new Kit();
  const model = buildBox(kit);
  const BEAM = 0x5aa8ff;
  const outer = beam(0.32, 0.75, BEAM);
  const core = beam(0.07, 0.17, 0xdff0ff);
  kit.root.add(outer, core);
  const holder = new THREE.Group();
  holder.scale.setScalar(1.15);
  model.body.add(holder);
  const teddy = buildTeddy(kit);
  teddy.visible = false;
  holder.add(teddy);
  const gunMats: LookMaterial[] = [];
  const guns = new Map<string, THREE.Group>();
  let shown = '';
  let lastStep = -1;
  let times: number[] | null = null;
  let timesFor = -1;
  const cues = new Cues();
  let lt = 0;
  const at = () => ({ x: kit.root.position.x, y: kit.root.position.y, z: kit.root.position.z });
  const show = (id: string) => {
    if (id === shown) return;
    shown = id;
    for (const g of guns.values()) g.visible = false;
    teddy.visible = id === 'teddy';
    if (!id || id === 'teddy') return;
    let g = guns.get(id);
    if (!g) {
      g = weaponModel(WEAPON_BY_ID.get(id)?.model ?? id, gunMats);
      guns.set(id, g);
      holder.add(g);
    }
    g.visible = true;
  };
  return {
    object: kit.root,
    update(s: EntitySnap, dt) {
      const now = m.serverTime;
      const ss = s.s ?? {};
      const B = MYSTERY_BOX;
      const t0 = num(ss.t0);
      const tl = num(ss.tl);
      const ph = num(ss.ph);
      const to = typeof ss.to === 'number' ? ss.to : undefined;
      const tw = num(ss.tw);
      const te = num(ss.te);
      const tx = typeof ss.tx === 'number' ? ss.tx : undefined;
      const tc = typeof ss.tc === 'number' ? ss.tc : undefined;
      // Beam: up while the box stands here; fades as it flies off.
      const grow = smooth((now - t0) / B.beamSec);
      let beamK = now < t0 ? 0 : grow;
      if (tx !== undefined) beamK *= 1 - smooth((now - tx - B.closeSec - B.leaveSec * 0.5) / (B.leaveSec * 0.6));
      outer.visible = core.visible = beamK > 0.01;
      outer.scale.set(1, Math.max(0.01, grow), 1);
      core.scale.set(1, Math.max(0.01, grow), 1);
      const cam = m.renderer.cam.position;
      const closeK = 0.25 + 0.75 * smooth((Math.hypot(cam.x - kit.root.position.x, cam.z - kit.root.position.z) - 2) / 5);
      const pulse = 0.8 + 0.2 * Math.sin(m.time * 3);
      (outer.material as THREE.MeshBasicMaterial).color.setHex(BEAM).multiplyScalar(0.16 * beamK * pulse * closeK);
      (core.material as THREE.MeshBasicMaterial).color.setHex(0xdff0ff).multiplyScalar(0.28 * beamK * pulse * closeK);
      // The box: comes down the beam when it moves here, flies off with the teddy.
      const y = boxHeight({ t0, tl, tx }, now);
      model.body.position.y = y;
      model.body.visible = now >= t0 + B.descendAt - 0.05 && (tx === undefined || y < B.dropHeight * 1.35);
      model.glow.visible = to === undefined;
      (model.glow.material as THREE.SpriteMaterial).color.setHex(BEAM).multiplyScalar(now < tl ? 0.5 : 0.2);
      cues.at(`land${t0}`, tl, now, () => {
        if (now - t0 > 1) sfx.play('ks_mbox_land', { at: at(), volume: 1.4 });
      });
      // Lid: opens with a purchase, shuts after the take / timeout or as it leaves.
      let lidK = to !== undefined ? smooth((now - to) / B.lidSec) : 0;
      if (tc !== undefined) lidK = Math.min(lidK, 1 - smooth((now - tc) / B.closeSec));
      if (tx !== undefined) lidK = Math.min(lidK, 1 - smooth((now - tx) / B.closeSec));
      model.lid.rotation.x = B.lidAngle * lidK;
      model.inner.visible = lidK > 0.02;
      if (to !== undefined) {
        cues.at(`open${to}`, to, now, () => {
          sfx.play('ks_mbox_open', { at: at(), volume: 1 });
          sfx.play('ks_mbox_jingle', { at: at(), volume: 1 });
        });
      }
      // The cycle, the offer (or the teddy), then nothing.
      const taken = num(ss.tk) === 1;
      if (to !== undefined && ph >= BOX_PHASE.open && !taken && !(tc !== undefined && now - tc > B.closeSec * 0.5)) {
        if (timesFor !== to) {
          times = cycleTimes(to);
          timesFor = to;
          lastStep = -1;
        }
        let step = 0;
        while (step < times!.length && times![step]! <= now) step++;
        const w = typeof ss.w === 'string' ? ss.w : '';
        show(step < BOX_CYCLE_WAITS.length ? cycleModel(num(ss.sd, 1), step, w) : w);
        if (step !== lastStep) {
          if (lastStep >= 0 && step > lastStep && step < BOX_CYCLE_WAITS.length) sfx.play('ks_mbox_tick', { at: at(), volume: 0.6 });
          lastStep = step;
        }
        const rise = smooth((now - to) / 1.2);
        let gy = MYSTERY_BOX.size.h * 0.5 + (B.floatY - MYSTERY_BOX.size.h * 0.5) * rise;
        if (ph >= BOX_PHASE.offer && te > tw && w !== 'teddy') gy = B.floatY - B.sinkY * Math.max(0, Math.min(1, (now - tw) / (te - tw)));
        holder.position.y = gy;
        holder.rotation.y = step < BOX_CYCLE_WAITS.length ? m.time * 2.2 : Math.sin(m.time * 0.8) * 0.5;
        if (w === 'teddy' && step >= BOX_CYCLE_WAITS.length) holder.rotation.y = Math.PI;
      } else show('');
      if (tx !== undefined) cues.at(`whoosh${tx}`, tx + B.closeSec, now, () => sfx.play('ks_mbox_whoosh', { at: at(), volume: 1.4, range: 'far' }));
      kit.light(dt, lightOf(m), kit.root.position);
      lt -= dt;
      if (lt <= 0 && m.map && gunMats.length) {
        lt = 0.25;
        setDynLight(gunMats, m.map.lightAt(kit.root.position.x, kit.root.position.y + 1, kit.root.position.z), 0.25);
      }
    },
    dispose() {
      for (const mesh of [outer, core]) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      for (const g of guns.values())
        g.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
      for (const mat of gunMats) {
        unbindTexture(mat);
        mat.dispose();
      }
      kit.dispose();
    },
  };
});

// ---------------------------------------------------------------------------------------------
// Power-ups
// ---------------------------------------------------------------------------------------------

function buildPowerup(kit: Kit, id: PowerupId): THREE.Group {
  const g = new THREE.Group();
  const metal = kit.mat('gunmetal', { rep: 0.3 });
  switch (id) {
    case 'full_ammo': {
      const olive = kit.mat('weapons.olive', { rep: 0.3 });
      kit.box(g, 0.42, 0.28, 0.2, olive, 0, 0, 0);
      kit.box(g, 0.44, 0.04, 0.22, metal, 0, 0.15, 0);
      kit.box(g, 0.16, 0.03, 0.04, metal, 0, 0.19, 0);
      kit.box(g, 0.3, 0.08, 0.005, kit.mat('weapons.brass', { emissive: 0.4 }), 0, 0, -0.103);
      break;
    }
    case 'insta_kill': {
      const bone = kit.mat('zm_chalk', { tint: 0xf0e8d8, rep: 0.2 });
      const dark = kit.mat('ks_dark');
      kit.box(g, 0.3, 0.28, 0.3, bone, 0, 0.04, 0);
      kit.box(g, 0.2, 0.12, 0.22, bone, 0, -0.14, -0.03);
      for (const s of [-1, 1]) kit.box(g, 0.08, 0.08, 0.02, dark, 0.07 * s, 0.05, -0.155);
      kit.box(g, 0.04, 0.06, 0.02, dark, 0, -0.04, -0.155);
      break;
    }
    case 'double_points': {
      const gold = kit.mat('weapons.brass', { emissive: 0.5, rep: 0.2 });
      // "x2" in blocks.
      const px = (x: number, y: number) => kit.box(g, 0.06, 0.06, 0.08, gold, x * 0.06 - 0.2, y * 0.06 - 0.12, 0);
      [[0, 4], [1, 3], [2, 2], [1, 1], [0, 0], [3, 4], [3, 0]].forEach(([x, y]) => px(x === 3 ? 2 : x!, y!));
      [[4, 4], [5, 4], [6, 4], [6, 3], [5, 2], [4, 1], [4, 0], [5, 0], [6, 0]].forEach(([x, y]) => px(x!, y!));
      break;
    }
    case 'nuke': {
      const dark = kit.mat('ks_dark');
      kit.cyl(g, 0.13, 0.13, 0.36, dark, 0, 0, 0, 'z', 8);
      kit.cyl(g, 0.13, 0.02, 0.14, dark, 0, 0, -0.24, 'z', 8);
      for (const a of [0, Math.PI / 2]) {
        const fin = kit.box(g, 0.36, 0.02, 0.12, metal, 0, 0, 0.2);
        fin.rotation.z = a;
      }
      kit.box(g, 0.27, 0.04, 0.04, kit.mat('weapons.red', { emissive: 1 }), 0, 0.12, 0);
      break;
    }
    case 'carpenter': {
      const wood = kit.mat('gunwood', { rep: 0.3 });
      kit.box(g, 0.05, 0.4, 0.05, wood, 0, -0.05, 0);
      kit.box(g, 0.26, 0.08, 0.08, metal, 0, 0.17, 0);
      break;
    }
  }
  return g;
}

registerEntityRenderer(ZM_ENTITY.powerup, (e, m) => {
  const kit = new Kit();
  const id = String(e.s?.k ?? 'full_ammo') as PowerupId;
  const spin = new THREE.Group();
  spin.position.y = 0.9;
  kit.root.add(spin);
  const model = buildPowerup(kit, id);
  model.scale.setScalar(1.35);
  spin.add(model);
  const glow = kit.sprite('zm_glow', 1.6, 0x6aff5a);
  const gm = glow.material as THREE.SpriteMaterial;
  gm.blending = THREE.AdditiveBlending;
  gm.transparent = true;
  gm.alphaTest = 0;
  gm.depthWrite = false;
  spin.add(glow);
  const t0 = num(e.s?.t0, m.serverTime);
  let dropped = false;
  return {
    object: kit.root,
    update(s, dt) {
      const now = m.serverTime;
      if (!dropped) {
        dropped = true;
        if (now - t0 < 0.5) sfx.play('zombies.powerup_drop', { at: { x: s.x, y: s.y + 1, z: s.z }, volume: 1 });
      }
      spin.rotation.y = m.time * 2;
      spin.position.y = 0.9 + Math.sin(m.time * 2.5) * 0.08;
      const te = num(s.s?.te, t0 + POWERUP_RULES.solidSec + POWERUP_RULES.blinkSec);
      // Blink for the last stretch, faster near the end (BO1: 40 hide/show steps).
      const left = te - now;
      const blink = left < POWERUP_RULES.blinkSec ? Math.floor(now * (left < 4 ? 10 : 4)) % 2 === 0 : true;
      spin.visible = blink;
      gm.color.setHex(0x6aff5a).multiplyScalar(0.45 + 0.1 * Math.sin(m.time * 6));
      if (Math.random() < 0.15) fxEmit({ x: s.x + (Math.random() - 0.5) * 0.4, y: s.y + 0.6 + Math.random() * 0.6, z: s.z + (Math.random() - 0.5) * 0.4 }, { color: 0x9aff8a, life: 0.6, size: 0.05, size1: 0.01, vel: { x: 0, y: 0.6, z: 0 } });
      kit.light(dt, lightOf(m), kit.root.position);
    },
    dispose: () => kit.dispose(),
  };
});
