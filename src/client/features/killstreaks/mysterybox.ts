/**
 * The Mystery Box on the client (timeline and maths in shared/defs/mystery-box.ts; server in
 * server/features/killstreaks/streaks/mysterybox.ts). Everyone sees it; only its owner can use it.
 *
 * The `ks_mbox` renderer plays the whole show from the entity's room times (`s.t0`, `s.tl`...):
 * - call-in: a beam of light shoots up from where the canister lies, the sky flickers
 *   (`renderer.white` pulses), lightning strikes the spot with a crack of thunder, then the box
 *   rides the beam down glowing while an original music-box tune plays, and crashes in with a burst
 *   of light, sparks and dust;
 * - a long, narrow, dark wooden chest with two glowing "?" on the lid (the right one reversed, as in
 *   BO1) and one on the front, the beam standing over it while it waits;
 * - opening: the lid rolls back 105 degrees, light spills out, weapons rise and flash past (the four
 *   wonder weapons and ordinary guns), ticking and slowing like BO1's box, and land on the roll;
 * - the offer: the weapon floats over the box, sinking back as the time runs out;
 * - leaving: the lid shuts and the box flies up the beam, which fades.
 *
 * HUD: a waypoint over the box (yours, a teammate's, or an enemy's up close), "HOLD [F] TO OPEN THE
 * MYSTERY BOX" with a fill bar, "PRESS [F] FOR <WEAPON>" with the time left (`useKey()`: "[X]" on a
 * pad), "ENEMY MYSTERY BOX" when you stand at someone else's. `boxClaimsUseLocally` keeps the
 * weapon-pickup prompt away while USE belongs to the box.
 */
import * as THREE from 'three';
import { BOX_CYCLE_WAITS, BOX_PHASE, boxHeight, cycleModel, cycleTimes, MYSTERY_BOX, MYSTERY_BOX_ENTITY } from '../../../shared/defs/mystery-box';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import type { EntitySnap } from '../../../shared/protocol';
import type { Vec3 } from '../../../shared/math';
import { sfx } from '../../game/audio';
import { rumble } from '../../game/gamepad';
import type { Match } from '../../game/match';
import { blink, box as hudBox, rect, txt, unit, HUD_COLORS as C } from '../../hud/draw';
import { drawWaypoint, useKey, type Waypoint, type WaypointSlot } from '../../hud/waypoints';
import { registerEntityRenderer, registerHudWidget, registerMatchHook } from '../../registry';
import { grain } from '../../render/developer';
import { makeLookMaterial, setDynLight, type LookMaterial } from '../../render/shader';
import { registerTexture, unbindTexture } from '../../render/textures';
import { currentMatch } from '../../state';
import { equipState } from '../weapons/equipment';
import { FURNITURE, GUNS, Kit as GunKit } from '../weapons/gunkit';
import { fxEmit, fxLightning, fxRing } from '../weapons/wonder/index';
import { Kit } from './models';
import { friendly } from './store';

// ---------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------

registerTexture('ks_mbox_wood', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#3e2616', 0.18);
    g.fillStyle = '#2a180c';
    for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 1);
  },
  photos: ['brown_planks_05'],
  photo: (c) => c.fromPhoto('brown_planks_05', { w: 128, h: 128, tile: 128, filter: 'brightness(.42) saturate(.85) contrast(1.15)' }),
});

/** A glowing "?" (alpha-tested decal). */
registerTexture('ks_mbox_qmark', {
  w: 16,
  h: 16,
  wrap: false,
  posterize: false,
  draw(g) {
    g.clearRect(0, 0, 16, 16);
    const rows = ['..XXXXX...', '.XXX.XXX..', '.XX...XX..', '......XX..', '.....XX...', '....XX....', '....XX....', '..........', '....XX....', '....XX....'];
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch !== 'X') return;
        g.fillStyle = '#bfe8ff';
        g.fillRect(3 + x, 3 + y, 1, 1);
      }),
    );
    g.fillStyle = '#ffffff';
    g.fillRect(5, 3, 3, 1);
  },
  photo: 'none',
});

registerTexture('ks_mbox_can', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#1c2448', 0.12);
    g.fillStyle = '#3a4a8a';
    g.fillRect(0, 7, w, 1);
  },
  photo: 'auto',
});

registerTexture('ks_mbox_glow', {
  w: 4,
  h: 4,
  posterize: false,
  draw(g) {
    g.fillStyle = '#9ad8ff';
    g.fillRect(0, 0, 4, 4);
    g.fillStyle = '#ffffff';
    g.fillRect(1, 1, 1, 1);
  },
  photo: 'none',
});

/** Inside the box: straw lit from below. */
registerTexture('ks_mbox_inner', {
  w: 16,
  h: 16,
  posterize: false,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#ffe8a0', 0.2);
    g.fillStyle = '#fff8e0';
    for (let i = 0; i < 10; i++) g.fillRect(Math.floor(R.rnd() * w), Math.floor(R.rnd() * h), 3, 1);
  },
  photo: 'none',
});

// ---------------------------------------------------------------------------------------------
// The box model (exported for Zombies' fixed box: src/client/features/zombies/box.ts)
// ---------------------------------------------------------------------------------------------

const S = MYSTERY_BOX.size;
const BEAM_H = 70;
const BEAM = 0x5aa8ff;

export interface BoxModel {
  kit: Kit;
  body: THREE.Group;
  lid: THREE.Group;
  inner: THREE.Mesh;
  glow: THREE.Sprite;
}

export function buildBox(kit: Kit): BoxModel {
  const body = new THREE.Group();
  kit.root.add(body);
  const wood = kit.mat('ks_mbox_wood', { rep: 0.6 });
  const metal = kit.mat('gunmetal', { rep: 0.3 });
  const brass = kit.mat('weapons.brass', { rep: 0.3 });
  const q = kit.mat('ks_mbox_qmark', { emissive: 1 });
  const H = S.h;
  // Walls (open top: the straw and light show through when the lid is up).
  kit.box(body, S.w, 0.05, S.d, wood, 0, 0.025, 0);
  kit.box(body, S.w, H, 0.05, wood, 0, H / 2, -S.d / 2 + 0.025);
  kit.box(body, S.w, H, 0.05, wood, 0, H / 2, S.d / 2 - 0.025);
  kit.box(body, 0.05, H, S.d, wood, -S.w / 2 + 0.025, H / 2, 0);
  kit.box(body, 0.05, H, S.d, wood, S.w / 2 - 0.025, H / 2, 0);
  // Iron corner brackets and a brass lock plate.
  for (const x of [-1, 1]) for (const z of [-1, 1]) kit.box(body, 0.07, H + 0.01, 0.07, metal, (x * S.w) / 2, H / 2, (z * S.d) / 2);
  kit.box(body, S.w + 0.02, 0.04, S.d + 0.02, metal, 0, 0.06, 0);
  kit.box(body, 0.1, 0.12, 0.02, brass, 0, H - 0.08, -S.d / 2 - 0.01);
  // The straw inside, lit.
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(S.w - 0.1, S.d - 0.1).rotateX(-Math.PI / 2), kit.mat('ks_mbox_inner', { emissive: 1 }));
  inner.position.y = H - 0.12;
  body.add(inner);
  // "?" on the front.
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), q);
  front.position.set(0, H * 0.5, -S.d / 2 - 0.012);
  front.rotation.y = Math.PI;
  body.add(front);
  // The lid hinges at the back top edge (+z); opening tilts its front up and back.
  const lid = new THREE.Group();
  lid.position.set(0, H, S.d / 2);
  body.add(lid);
  kit.box(lid, S.w + 0.03, 0.08, S.d + 0.03, wood, 0, 0.04, -S.d / 2);
  kit.box(lid, S.w + 0.05, 0.03, 0.06, metal, 0, 0.015, -S.d - 0.0);
  for (const [x, flip] of [[-0.3, 1], [0.3, -1]] as const) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.42), q);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.PI;
    m.scale.y = flip; // BO1: the right "?" is reversed
    m.position.set(x, 0.082, -S.d / 2);
    lid.add(m);
  }
  const glow = kit.sprite('wonder.glow', 2.2, BEAM);
  (glow.material as THREE.SpriteMaterial).blending = THREE.AdditiveBlending;
  (glow.material as THREE.SpriteMaterial).transparent = true;
  (glow.material as THREE.SpriteMaterial).alphaTest = 0;
  glow.position.y = H * 0.6;
  body.add(glow);
  return { kit, body, lid, inner, glow };
}

/** A tall open cylinder of light (additive), base at y = 0. */
export function beam(r0: number, r1: number, color: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(r1, r0, BEAM_H, 12, 1, true).translate(0, BEAM_H / 2, 0);
  const mat = new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

/** Build a weapon model for the cycle (the same kit as the viewmodel, at world size). */
export function weaponModel(model: string, mats: LookMaterial[]): THREE.Group {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const build = GUNS[model] ?? GUNS.ak47!;
  const kit = new GunKit(
    inner,
    (texture, o = {}) => {
      const mat = makeLookMaterial({ texture, rep: o.rep, tint: o.tint, emissive: o.emissive, dyn: true });
      mats.push(mat);
      return mat;
    },
    null,
    FURNITURE[model] ?? 'poly',
  );
  build(kit, []);
  // Sideways along the box, centred on the receiver.
  inner.rotation.y = Math.PI / 2;
  inner.position.x = 0.05;
  return g;
}

const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};
const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : d);

/** One-shot cues keyed by their room time: fire only when crossed recently (no replays on late joins). */
class Cues {
  private done = new Set<string>();
  at(key: string, when: number, now: number, fn: () => void): void {
    if (this.done.has(key) || now < when) return;
    this.done.add(key);
    if (now - when < 0.35) fn();
  }
}

// The sky flicker and the strike's flash go through the post pass's white-out.
let whiteMine = 0;
function setWhite(m: Match, v: number): void {
  const r = m.renderer;
  // Never fight someone else's white-out (the Tactical Nuke): only lift it when it's ours.
  if (r.white > whiteMine + 1e-3 && v < r.white) return;
  r.white = v;
  whiteMine = v;
}

registerEntityRenderer(MYSTERY_BOX_ENTITY, (e, m) => {
  const kit = new Kit();
  const model = buildBox(kit);
  const outer = beam(0.32, 0.75, BEAM);
  const core = beam(0.07, 0.17, 0xdff0ff);
  kit.root.add(outer, core);
  const holder = new THREE.Group();
  holder.scale.setScalar(1.15);
  model.body.add(holder);
  const gunMats: LookMaterial[] = [];
  const guns = new Map<string, THREE.Group>();
  let shownGun = '';
  let lastStep = -1;
  let times: number[] | null = null;
  const cues = new Cues();
  let light = 0;
  const at = (): Vec3 => ({ x: kit.root.position.x, y: kit.root.position.y, z: kit.root.position.z });
  const near = (d: number) => Math.hypot(m.renderer.cam.position.x - kit.root.position.x, m.renderer.cam.position.z - kit.root.position.z) < d;
  const showGun = (id: string) => {
    if (id === shownGun) return;
    shownGun = id;
    for (const g of guns.values()) g.visible = false;
    if (!id) return;
    let g = guns.get(id);
    if (!g) {
      g = weaponModel(WEAPON_BY_ID.get(id)?.model ?? id, gunMats);
      guns.set(id, g);
      holder.add(g);
    }
    g.visible = true;
  };
  void e;
  return {
    object: kit.root,
    update(s: EntitySnap, dt: number) {
      const now = m.serverTime;
      const ss = s.s ?? {};
      const t0 = num(ss.t0);
      const tl = num(ss.tl);
      const ph = num(ss.ph);
      const to = typeof ss.to === 'number' ? ss.to : undefined;
      const tw = num(ss.tw);
      const te = num(ss.te);
      const tx = typeof ss.tx === 'number' ? ss.tx : undefined;
      const B = MYSTERY_BOX;
      // ---- Beam: shoots up at t0, stands while the box is here, fades as it flies off.
      const grow = smooth((now - t0) / B.beamSec);
      let beamK = now < t0 ? 0 : grow;
      if (tx !== undefined) beamK *= 1 - smooth((now - tx - B.closeSec - B.leaveSec * 0.5) / (B.leaveSec * 0.6));
      outer.visible = core.visible = beamK > 0.01;
      outer.scale.set(1, Math.max(0.01, grow), 1);
      core.scale.set(1, Math.max(0.01, grow), 1);
      const pulse = 0.8 + 0.2 * Math.sin(m.time * 3);
      // Thinner in your face: standing at the box, the beam mustn't hide it.
      const camD = Math.hypot(m.renderer.cam.position.x - kit.root.position.x, m.renderer.cam.position.z - kit.root.position.z);
      const closeK = 0.25 + 0.75 * smooth((camD - 2) / 5);
      (outer.material as THREE.MeshBasicMaterial).color.setHex(BEAM).multiplyScalar(0.2 * beamK * pulse * closeK);
      (core.material as THREE.MeshBasicMaterial).color.setHex(0xdff0ff).multiplyScalar(0.34 * beamK * pulse * closeK);
      cues.at('beam', t0, now, () => sfx.play('ks_mbox_beam', { at: at(), volume: 1.2, range: 'far' }));
      // ---- Sky flicker, then the lightning strike.
      const fl = now - t0 - B.flickerAt;
      if (fl >= 0 && fl < B.flickerSec) setWhite(m, Math.random() < 0.3 ? 0.08 + Math.random() * 0.18 : 0);
      const sinceStrike = now - t0 - B.strikeAt;
      cues.at('strike', t0 + B.strikeAt, now, () => {
        const p = at();
        // Down out of the sky at an angle, so the bolt reads apart from the beam.
        const a = Math.random() * Math.PI * 2;
        fxLightning({ x: p.x + Math.cos(a) * 14, y: p.y + 42, z: p.z + Math.sin(a) * 14 }, { x: p.x, y: p.y + 0.1, z: p.z }, 0xeef6ff, 0.4, 0.22);
        fxLightning({ x: p.x + Math.cos(a + 0.5) * 18, y: p.y + 40, z: p.z + Math.sin(a + 0.5) * 18 }, { x: p.x, y: p.y + 0.1, z: p.z }, BEAM, 0.3, 0.1);
        for (let i = 0; i < 24; i++) fxEmit({ x: p.x, y: p.y + 0.2, z: p.z }, { color: i % 2 ? 0xffe8a0 : 0xbfe2ff, life: 0.5 + Math.random() * 0.4, size: 0.1, size1: 0.03, vel: { x: (Math.random() - 0.5) * 10, y: 2 + Math.random() * 6, z: (Math.random() - 0.5) * 10 }, grav: 14 });
        fxRing({ x: p.x, y: p.y, z: p.z }, { x: 0, y: 1, z: 0 }, 0xdfeeff, 0.3, 5, 0.5);
        sfx.play('ks_mbox_thunder', { at: p, volume: 2.2, range: 'far' });
        if (near(25)) {
          equipState.shake = { at: m.time, amount: 0.4 };
          rumble('explosion', 0.4);
        }
      });
      if (sinceStrike >= 0 && sinceStrike < 0.3) setWhite(m, 0.6 * (1 - sinceStrike / 0.3));
      else if (whiteMine > 0 && !(fl >= 0 && fl < B.flickerSec)) setWhite(m, 0);
      // ---- The box: descends on the beam, crashes in, flies away.
      const y = boxHeight({ t0, tl, tx }, now);
      model.body.position.y = y;
      model.body.visible = now >= t0 + B.descendAt - 0.05 && (tx === undefined || y < B.dropHeight * 1.35);
      const falling = now >= t0 + B.descendAt && now < tl;
      // A blue glow: strong while it rides the beam down, a soft halo while it waits, none once open.
      model.glow.visible = to === undefined || now < to;
      model.glow.scale.setScalar(falling ? 1.9 + Math.sin(m.time * 12) * 0.2 : 1.4 + Math.sin(m.time * 2) * 0.1);
      (model.glow.material as THREE.SpriteMaterial).color.setHex(BEAM).multiplyScalar(falling ? 0.55 : 0.22);
      if (falling && Math.random() < 0.6) {
        const p = at();
        fxEmit({ x: p.x + (Math.random() - 0.5) * S.w, y: p.y + y + Math.random() * 0.5, z: p.z + (Math.random() - 0.5) * S.d }, { color: 0xbfe2ff, life: 0.6, size: 0.08, size1: 0.02, vel: { x: 0, y: 1.5, z: 0 } });
      }
      cues.at('jingle', t0 + B.descendAt, now, () => sfx.play('ks_mbox_jingle', { at: at(), volume: 1.2, range: 'far' }));
      cues.at('land', tl, now, () => {
        const p = at();
        fxEmit({ x: p.x, y: p.y + 0.4, z: p.z }, { color: 0xffffff, life: 0.25, size: 1.5, size1: 4 });
        fxEmit({ x: p.x, y: p.y + 0.4, z: p.z }, { color: BEAM, life: 0.6, size: 2, size1: 5 });
        for (let i = 0; i < 30; i++) fxEmit({ x: p.x, y: p.y + 0.3, z: p.z }, { color: i % 3 ? 0xffd890 : 0xbfe2ff, life: 0.5 + Math.random() * 0.5, size: 0.09, size1: 0.02, vel: { x: (Math.random() - 0.5) * 12, y: 1 + Math.random() * 6, z: (Math.random() - 0.5) * 12 }, grav: 16 });
        fxRing(p, { x: 0, y: 1, z: 0 }, 0xdfeeff, 0.4, 4, 0.45);
        for (let i = 0; i < 3; i++) m.effects.puff('dust', { x: p.x, y: p.y + 0.1, z: p.z }, { x: 0, y: 1, z: 0 }, 8);
        sfx.play('ks_mbox_land', { at: p, volume: 1.6 });
        if (near(14)) {
          equipState.shake = { at: m.time, amount: 0.55 };
          rumble('explosion', 0.5);
        }
      });
      // ---- Lid: opens with the roll, shuts when it leaves.
      let lidK = to !== undefined ? smooth((now - to) / B.lidSec) : 0;
      if (tx !== undefined) lidK = Math.min(lidK, 1 - smooth((now - tx) / B.closeSec));
      model.lid.rotation.x = B.lidAngle * lidK;
      model.inner.visible = lidK > 0.02;
      if (to !== undefined) cues.at('open', to, now, () => sfx.play('ks_mbox_open', { at: at(), volume: 1 }));
      if (lidK > 0.3 && Math.random() < 0.3) {
        const p = at();
        fxEmit({ x: p.x + (Math.random() - 0.5) * S.w * 0.8, y: p.y + y + S.h, z: p.z + (Math.random() - 0.5) * S.d * 0.6 }, { color: 0x7a6440, life: 0.7, size: 0.05, size1: 0.22, vel: { x: 0, y: 1.0, z: 0 } });
      }
      // ---- The cycle and the offer.
      if (to !== undefined && ph >= BOX_PHASE.open && !(tx !== undefined && num(ss.tk) === 1)) {
        times ??= cycleTimes(to);
        let step = 0;
        while (step < times.length && times[step]! <= now) step++;
        const w = typeof ss.w === 'string' ? ss.w : '';
        const id = cycleModel(num(ss.sd, 1), step, w);
        showGun(id);
        if (step !== lastStep) {
          if (lastStep >= 0 && step > lastStep && now - (times[step - 1] ?? now) < 0.3) {
            if (step < BOX_CYCLE_WAITS.length) sfx.play('ks_mbox_tick', { at: at(), volume: 0.6 });
            else {
              const p = at();
              for (let i = 0; i < 16; i++) fxEmit({ x: p.x, y: p.y + y + B.floatY, z: p.z }, { color: 0xffe8a0, life: 0.5, size: 0.08, size1: 0.02, vel: { x: (Math.random() - 0.5) * 3, y: Math.random() * 2, z: (Math.random() - 0.5) * 3 } });
            }
          }
          lastStep = step;
        }
        // Rises out of the box, spins while cycling, then floats and sinks back.
        const rise = smooth((now - to) / 1.2);
        let gy = S.h * 0.5 + (B.floatY - S.h * 0.5) * rise;
        if (ph >= BOX_PHASE.offer && te > tw) gy = B.floatY - B.sinkY * Math.max(0, Math.min(1, (now - tw) / (te - tw)));
        if (tx !== undefined) gy = Math.min(gy, B.floatY - B.sinkY - (S.h * 0.5) * smooth((now - tx) / B.closeSec));
        holder.position.y = gy;
        holder.rotation.y = step < BOX_CYCLE_WAITS.length ? m.time * 2.2 : Math.sin(m.time * 0.8) * 0.5;
        holder.visible = !(tx !== undefined && now - tx > B.closeSec);
      } else showGun('');
      if (tx !== undefined) cues.at('whoosh', tx + B.closeSec, now, () => sfx.play('ks_mbox_whoosh', { at: at(), volume: 1.4, range: 'far' }));
      // Light from the bake (the glowing bits are unlit).
      light -= dt;
      kit.light(dt, m.map ? (x, yy, z) => m.map!.lightAt(x, yy, z) : null, kit.root.position);
      if (light <= 0 && m.map && gunMats.length) {
        light = 0.25;
        setDynLight(gunMats, m.map.lightAt(kit.root.position.x, kit.root.position.y + 1, kit.root.position.z), 0.25);
      }
    },
    dispose() {
      if (whiteMine > 0) setWhite(m, 0);
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
// HUD: waypoints and prompts
// ---------------------------------------------------------------------------------------------

const inReach = (m: Match, e: EntitySnap) => {
  const p = m.net.predictor.shown();
  return Math.hypot(p.x - e.x, p.z - e.z) <= MYSTERY_BOX.reach && Math.abs(p.y - e.y) < MYSTERY_BOX.dy;
};
const usable = (ph: number) => ph === BOX_PHASE.idle || ph === BOX_PHASE.open || ph === BOX_PHASE.offer;

/** USE belongs to my box while I stand at it (the pickups prompt stands aside; mirrors the server's useClaimed). */
export function boxClaimsUseLocally(m: Match): boolean {
  for (const e of m.net.lastSnap?.ents ?? []) if (e.kind === MYSTERY_BOX_ENTITY && e.owner === m.myId && usable(num(e.s?.ph)) && inReach(m, e)) return true;
  return false;
}

const hold = { t: 0, box: -1 };

registerMatchHook('killstreaks.mbox', {
  start() {
    hold.t = 0;
    hold.box = -1;
    whiteMine = 0;
  },
  frame(m, dt) {
    let target: EntitySnap | null = null;
    for (const e of m.net.lastSnap?.ents ?? []) if (e.kind === MYSTERY_BOX_ENTITY && e.owner === m.myId && num(e.s?.ph) === BOX_PHASE.idle && inReach(m, e)) target = e;
    if (target && m.alive && m.controls.isHeld('use')) {
      if (hold.box !== target.id) hold.t = 0;
      hold.box = target.id;
      hold.t += dt;
    } else {
      hold.t = 0;
      hold.box = -1;
    }
  },
});

registerHudWidget(
  'killstreaks.mbox',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.net.lastSnap) return;
    const u = unit(H);
    const placed: WaypointSlot[] = [];
    let prompt: { text: string; color: string; bar?: number } | null = null;
    for (const e of m.net.lastSnap.ents) {
      if (e.kind !== MYSTERY_BOX_ENTITY) continue;
      const ph = num(e.s?.ph);
      if (ph === BOX_PHASE.leave) continue;
      const mine = e.owner === m.myId;
      const ours = friendly(e.owner ?? '', e.team ?? null);
      const w = typeof e.s?.w === 'string' ? e.s.w : '';
      const name = (WEAPON_BY_ID.get(w)?.name ?? '').toUpperCase();
      const caption = ph === BOX_PHASE.call ? 'INCOMING' : mine && ph === BOX_PHASE.offer ? name : undefined;
      const wp: Waypoint = { x: e.x, y: e.y + 1.6, z: e.z, label: ours ? 'MYSTERY BOX' : 'ENEMY MYSTERY BOX', caption, color: ours ? C.friend : C.enemy, hideWithin: MYSTERY_BOX.reach + 0.6, ...(mine ? {} : { maxDist: ours ? 60 : 35, small: true }) };
      drawWaypoint(m, g, W, H, wp, placed);
      if (!m.alive || !inReach(m, e)) continue;
      if (!mine) {
        if (usable(ph)) prompt = { text: ours ? 'TEAMMATE\'S MYSTERY BOX' : 'ENEMY MYSTERY BOX', color: ours ? C.friend : C.enemy };
        continue;
      }
      if (ph === BOX_PHASE.idle) prompt = { text: `HOLD ${useKey()} TO OPEN THE MYSTERY BOX`, color: blink(m.time, 1, 0.7) ? C.hi : C.paper, bar: hold.box === e.id ? Math.min(1, hold.t / MYSTERY_BOX.openHoldSec) : 0 };
      else if (ph === BOX_PHASE.offer && name) {
        const te = num(e.s?.te);
        const tw = num(e.s?.tw);
        prompt = { text: `PRESS ${useKey()} FOR ${name}`, color: blink(m.time, 0.6, 0.4) ? C.hi : C.paper, bar: te > tw ? Math.max(0, (te - m.serverTime) / (te - tw)) : 0 };
      }
    }
    if (!prompt) return;
    const y = H / 2 + 34 * u;
    txt(g, prompt.text, W / 2, y, 8, prompt.color, 'center', u);
    if (prompt.bar !== undefined) {
      const bw = 70 * u;
      hudBox(g, W / 2 - bw / 2, y + 10 * u, bw, 3 * u, C.empty, u);
      rect(g, W / 2 - bw / 2, y + 10 * u, bw * prompt.bar, 3 * u, C.hi);
    }
  },
  7,
);

