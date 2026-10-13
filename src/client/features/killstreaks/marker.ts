/**
 * The Care Package marker on the client (BO1: the supply drop canister):
 * - STREAK with the Care Package selected raises the smoke canister in first person (the gun goes
 *   down), predicted at once and confirmed by `killstreaks.state.marker`; STREAK again, a weapon
 *   switch, a grenade, the knife or death puts it away (the streak is kept).
 * - While it is up, the throw preview: the arc and a landing ring, computed every frame with the
 *   server's own maths (`markerLaunch`, `simulateMarker` at TICK_DT, `resolveDrop` in
 *   shared/defs/care-marker.ts) from the predicted eye and aim. The ring is friendly blue where the
 *   crate will come down on the canister and red where it can't (out of the map, under a roof, a
 *   roof nobody can reach, inside a wall); then a second ring shows where the crate comes instead.
 * - FIRE (left mouse / RT) throws it: the server's `ks_marker` entity flies, bounces, settles and
 *   smokes (everyone sees it), and the Chinook drops the crate there.
 */
import * as THREE from 'three';
import { groundTop, markerLaunch, resolveDrop, simulateMarker, MARKER, type DropReason, type DropSpot } from '../../../shared/defs/care-marker';
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../../../shared/defs/killstreaks';
import { clamp, quantizeAngle, type Vec3 } from '../../../shared/math';
import { eyeHeight } from '../../../shared/movement';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { promptKey } from '../../game/prompts';
import { blink, txt, unit, HUD_COLORS as C } from '../../hud/draw';
import { drawWaypoint, type WaypointSlot } from '../../hud/waypoints';
import { registerEntityRenderer, registerHudWidget, registerMatchHook } from '../../registry';
import { setDynLight, type LookMaterial } from '../../render/shader';
import { getTexture } from '../../render/textures';
import { currentMatch } from '../../state';
import { buildMarkerCanister, Kit } from './models';
import { ksClient } from './store';

// ---------------------------------------------------------------------------------------------
// Holding the canister: local prediction over the server's state
// ---------------------------------------------------------------------------------------------

type LocalPhase = 'raise' | 'thrown' | 'away';

/** The marker as the local player sees it (prediction until the server state agrees). */
export const markerClient = {
  /** Canister up in first person right now. */
  held: false,
  /** Local time it came up (raise animation) and the last throw (throw animation). */
  raisedAt: -99,
  thrownAt: -99,
  /** This frame's throw preview (null while not held). */
  preview: null as MarkerPreview | null,
};

export interface MarkerPreview {
  path: Vec3[];
  rest: Vec3;
  settled: boolean;
  drop: DropSpot;
  /** Where the landing ring goes: the rest point, or where the arc leaves the map when it does. */
  ring: Vec3;
}

let local: { phase: LocalPhase; at: number } | null = null;
let prev = { streak: false, fire: false, slot: 0 };

/** The selected ready streak is thrown as a marker (the Care Package). */
function markerSelected(): string | null {
  const st = ksClient.state;
  const id = st?.ready[st.selected];
  return id && KILLSTREAK_BY_ID.get(id)?.targeting === 'marker' ? id : null;
}

/**
 * The throw preview from a predicted eye and aim: the same launch, per-tick flight and drop rules
 * as the server (which uses the eye and quantised aim of the command that carried FIRE).
 */
export function previewThrow(m: Match, yaw: number, pitch: number): MarkerPreview | null {
  const map = m.map?.map;
  if (!map) return null;
  const st = m.net.predictor.state;
  const world = m.net.world;
  const eye = { x: st.x, y: st.y + eyeHeight(st), z: st.z };
  const launch = markerLaunch(world, eye, quantizeAngle(yaw), clamp(quantizeAngle(pitch), -1.55, 1.55), { x: st.vx, y: st.vy, z: st.vz });
  const flight = simulateMarker(world, launch, map.bounds.min.y - 20);
  const drop = resolveDrop(world, map, flight.rest, { x: st.x, y: st.y, z: st.z }, flight.settled);
  let ring = flight.rest;
  if (drop.reason === 'lost' || drop.reason === 'bounds') {
    const b = map.bounds;
    const inside = (v: Vec3) => v.x > b.min.x && v.x < b.max.x && v.z > b.min.z && v.z < b.max.z && v.y > b.min.y;
    for (let i = flight.path.length - 1; i >= 0; i--) {
      const v = flight.path[i]!;
      if (inside(v)) {
        ring = { x: v.x, y: groundTop(world, b, v.x, v.z, v.y), z: v.z };
        break;
      }
    }
  }
  return { path: flight.path, rest: flight.rest, settled: flight.settled, drop, ring };
}

// ---------------------------------------------------------------------------------------------
// First person: the canister in a gloved hand
// ---------------------------------------------------------------------------------------------

class FirstPersonCanister {
  private kit: Kit | null = null;
  private readonly off = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.35, 0.12));

  /** `raise` 0..1 (down..up), `thrown` 0..1 through the throw (hidden after), or both 0 to hide. */
  update(m: Match, raise: number, thrown: number): void {
    const show = raise > 0.001 && thrown < 1;
    if (!show) {
      if (this.kit) this.kit.root.visible = false;
      return;
    }
    if (!this.kit) {
      const kit = new Kit();
      buildMarkerCanister(kit);
      // Gloved fingers round the can's lower half, the wrist and sleeve running back off screen.
      const glove = kit.mat('glove', { rep: 0.25 });
      const sleeve = kit.mat('camo', { rep: 0.4 });
      kit.box(kit.root, 0.074, 0.05, 0.05, glove, 0, 0.04, 0.012);
      kit.box(kit.root, 0.05, 0.05, 0.06, glove, 0.01, 0.02, 0.05);
      kit.box(kit.root, 0.06, 0.06, 0.2, sleeve, 0.02, 0.0, 0.17);
      kit.root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        (o.material as THREE.ShaderMaterial).depthTest = false; // never clips into the wall you face
        o.renderOrder = 900;
      });
      kit.root.frustumCulled = false;
      this.kit = kit;
    }
    const root = this.kit.root;
    if (root.parent !== m.renderer.scene) m.renderer.scene.add(root);
    root.visible = true;
    const cam = m.renderer.cam;
    cam.updateMatrixWorld();
    const k = 1 - Math.pow(1 - Math.min(1, raise), 3);
    // Throw: the hand swings forward and up, out of view.
    const t = Math.min(1, thrown);
    this.off.set(0.2 - 0.12 * t, -0.48 + 0.22 * k + 0.3 * t, -0.48 - 0.4 * t);
    root.position.copy(this.off).applyMatrix4(cam.matrixWorld);
    root.quaternion.copy(cam.getWorldQuaternion(this.q)).multiply(this.tilt);
    if (t > 0) root.rotateX(-1.6 * t);
    if (m.map) setDynLight(this.kit.mats as LookMaterial[], m.map.lightAt(cam.position.x, cam.position.y, cam.position.z));
  }

  dispose(): void {
    if (!this.kit) return;
    this.kit.root.removeFromParent();
    this.kit.dispose();
    this.kit = null;
  }
}

// ---------------------------------------------------------------------------------------------
// The throw preview in the world: dotted arc and landing rings
// ---------------------------------------------------------------------------------------------

const FRIEND = 0x7ab0ff;
const BAD = 0xff4a3a;
const FALLBACK = 0xffd84a;
const MAX_DOTS = 160;

class PreviewView {
  readonly root = new THREE.Group();
  private dots: THREE.Points;
  private dotPos = new Float32Array(MAX_DOTS * 3);
  // Drawn over the world (like the waypoint labels), so the landing spot reads behind low cover.
  private dotMat = new THREE.PointsMaterial({ color: FRIEND, size: 4, sizeAttenuation: false, depthWrite: false, depthTest: false });
  private ringMat = new THREE.MeshBasicMaterial({ map: getTexture('ks_drop_ring'), color: FRIEND, transparent: true, alphaTest: 0.4, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  private dropMat = new THREE.MeshBasicMaterial({ map: getTexture('ks_drop_ring'), color: FALLBACK, transparent: true, alphaTest: 0.4, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  private ring: THREE.Mesh;
  private dropRing: THREE.Mesh;
  private ringGeo = new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2);

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.dotPos, 3));
    this.dots = new THREE.Points(geo, this.dotMat);
    this.dots.frustumCulled = false;
    this.ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    this.dropRing = new THREE.Mesh(this.ringGeo, this.dropMat);
    this.dots.renderOrder = this.ring.renderOrder = this.dropRing.renderOrder = 800;
    this.root.add(this.dots, this.ring, this.dropRing);
  }

  show(m: Match, p: MarkerPreview | null): void {
    if (!p) {
      this.root.visible = false;
      return;
    }
    if (this.root.parent !== m.renderer.scene) m.renderer.scene.add(this.root);
    this.root.visible = true;
    const col = p.drop.valid ? FRIEND : BAD;
    this.dotMat.color.setHex(col);
    this.ringMat.color.setHex(col);
    // A dot every other tick (every 1/30 s), skipping the first metre so it starts past the hand.
    let n = 0;
    for (let i = 4; i < p.path.length && n < MAX_DOTS; i += 2, n++) {
      const v = p.path[i]!;
      this.dotPos[n * 3] = v.x;
      this.dotPos[n * 3 + 1] = v.y;
      this.dotPos[n * 3 + 2] = v.z;
    }
    const geo = this.dots.geometry;
    geo.setDrawRange(0, n);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    const spin = m.time * 1.5;
    this.ring.position.set(p.ring.x, p.ring.y + 0.04, p.ring.z);
    this.ring.rotation.y = spin;
    this.ring.scale.setScalar(p.drop.valid ? 1 : 0.8);
    this.dropRing.visible = !p.drop.valid;
    this.dropRing.position.set(p.drop.x, p.drop.y + 0.05, p.drop.z);
    this.dropRing.rotation.y = -spin;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.dots.geometry.dispose();
    this.ringGeo.dispose();
    this.dotMat.dispose();
    this.ringMat.dispose();
    this.dropMat.dispose();
  }
}

let fp: FirstPersonCanister | null = null;
let view: PreviewView | null = null;

registerMatchHook('killstreaks.marker', {
  start() {
    local = null;
    prev = { streak: false, fire: false, slot: 0 };
    markerClient.held = false;
    markerClient.preview = null;
    fp = new FirstPersonCanister();
    view = new PreviewView();
    return () => {
      fp?.dispose();
      view?.dispose();
      fp = view = null;
      markerClient.held = false;
      markerClient.preview = null;
    };
  },
  frame(m) {
    const c = m.controls;
    const st = ksClient.state;
    const ok = m.alive && m.phase === 'playing' && c.locked;
    const serverHeld = !!st?.marker && m.alive;
    const shownBefore = markerClient.held;
    const streak = c.isHeld('streak');
    const fire = c.triggerHeld;
    if (ok && streak && !prev.streak) {
      if (shownBefore) local = { phase: 'away', at: m.time };
      else if (markerSelected() && !st?.map && !st?.control && !st?.armed) local = { phase: 'raise', at: m.time };
    }
    if (ok && shownBefore && fire && !prev.fire) {
      local = { phase: 'thrown', at: m.time };
      markerClient.thrownAt = m.time;
      sfx.play('weapons.knife', { volume: 0.5 });
    }
    // A weapon switch, grenade or knife puts it away on the server too.
    if (shownBefore && (m.slot !== prev.slot || c.isHeld('lethal') || c.isHeld('tactical') || c.isHeld('melee'))) local = { phase: 'away', at: m.time };
    prev = { streak, fire, slot: m.slot };
    // Prediction ends once the server agrees, or after a round trip and a bit (then trust it).
    if (local) {
      const agreed = local.phase === 'raise' ? serverHeld : !serverHeld;
      if (agreed || m.time - local.at > Math.max(0.4, m.netRtt * 2 + 0.3)) local = null;
    }
    const held = m.alive && (local ? local.phase === 'raise' : serverHeld);
    if (held && !shownBefore) markerClient.raisedAt = m.time;
    markerClient.held = held;
    markerClient.preview = held ? previewThrow(m, m.yaw, m.pitch) : null;
    if (held || m.time - markerClient.thrownAt < 0.3) m.viewmodel.visible = false;
    const thrownK = m.time - markerClient.thrownAt < 0.3 ? (m.time - markerClient.thrownAt) / 0.3 : held ? 0 : 1;
    fp?.update(m, held || thrownK < 1 ? Math.min(1, (m.time - markerClient.raisedAt) / 0.25) : 0, held ? 0 : thrownK);
    view?.show(m, markerClient.preview);
  },
});

// ---------------------------------------------------------------------------------------------
// HUD: prompt and the drop zone label
// ---------------------------------------------------------------------------------------------

const REASON: Record<DropReason, string> = { ok: '', bounds: 'OUT OF MAP', covered: 'NO OPEN SKY', roof: 'CAN’T REACH', solid: 'BLOCKED', lost: 'NO LANDING' };

registerHudWidget(
  'killstreaks.marker',
  (g, W, H) => {
    const m = currentMatch();
    const p = markerClient.preview;
    if (!m || !markerClient.held || !m.alive) return;
    const u = unit(H);
    const placed: WaypointSlot[] = [];
    if (p) {
      if (p.drop.valid) drawWaypoint(m, g, W, H, { x: p.rest.x, y: p.rest.y + 1.2, z: p.rest.z, label: 'DROP ZONE', color: C.friend }, placed);
      else {
        drawWaypoint(m, g, W, H, { x: p.ring.x, y: p.ring.y + 1.2, z: p.ring.z, label: 'NO DROP', caption: REASON[p.drop.reason], color: C.warn }, placed);
        drawWaypoint(m, g, W, H, { x: p.drop.x, y: p.drop.y + 1.2, z: p.drop.z, label: 'CRATE HERE', color: C.hi, small: true }, placed);
      }
    }
    const y = H - 52 * u;
    txt(g, `${promptKey('fire', { brackets: true })} THROW MARKER   ${promptKey('streak', { brackets: true })} PUT AWAY`, W / 2, y, 8, blink(m.time, 1.2, 0.9) ? C.hi : C.paper, 'center', u);
  },
  63,
);

// ---------------------------------------------------------------------------------------------
// The canister in the world (everyone): flying, lying on its side, pouring smoke
// ---------------------------------------------------------------------------------------------

interface Puff {
  s: THREE.Sprite;
  age: number;
  life: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
}

const SHADES = [0, 0.06, -0.08, 0.12];
/** One wind direction for every plume (m/s): BO1 smoke leans and drifts. */
const WIND = { x: 0.55, z: 0.25 };

/** A column of chunky smoke sprites at a point, in world space. */
export class SmokePlume {
  private puffs: Puff[] = [];
  private mats: THREE.SpriteMaterial[] = [];
  private acc = 0;
  private hiss = 0;

  constructor(private scene: THREE.Scene, color: number) {
    const base = new THREE.Color(color);
    for (const k of SHADES) {
      const c = base.clone().offsetHSL(0, -0.05, k);
      this.mats.push(new THREE.SpriteMaterial({ map: getTexture('puff'), color: c, alphaTest: 0.5, depthWrite: false }));
    }
  }

  /** Emit at `at` (rate scales the density; 0 stops emitting and lets the column thin out). */
  update(dt: number, at: Vec3, rate: number, hearAt?: (p: Vec3) => void): void {
    this.acc += dt * 11 * rate;
    while (this.acc >= 1 && this.puffs.length < 90) {
      this.acc -= 1;
      const s = new THREE.Sprite(this.mats[Math.floor(Math.random() * this.mats.length)]!);
      s.position.set(at.x + (Math.random() - 0.5) * 0.15, at.y + 0.1, at.z + (Math.random() - 0.5) * 0.15);
      this.scene.add(s);
      const a = Math.random() * Math.PI * 2;
      this.puffs.push({ s, age: 0, life: 4.5 + Math.random() * 2, vx: Math.cos(a) * 0.5, vy: 1.4 + Math.random() * 0.8, vz: Math.sin(a) * 0.5, size: 0.35 + Math.random() * 0.25 });
    }
    if (rate <= 0) this.acc = 0;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        p.s.removeFromParent();
        this.puffs.splice(i, 1);
        continue;
      }
      const k = p.age / p.life;
      // Pours out low and wide first, then rises and leans with the wind.
      p.vy *= 1 - dt * 0.35;
      p.s.position.x += (p.vx * (1 - k) + WIND.x * k) * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += (p.vz * (1 - k) + WIND.z * k) * dt;
      p.s.scale.setScalar(p.size + k * 3.2);
      // Thin out at the end: shrink the last stretch away (alpha-tested sprites can't fade).
      if (k > 0.8) p.s.scale.multiplyScalar(1 - (k - 0.8) * 2.5);
    }
    if (rate > 0 && hearAt) {
      this.hiss -= dt;
      if (this.hiss <= 0) {
        this.hiss = 0.8;
        hearAt(at);
      }
    }
  }

  get count(): number {
    return this.puffs.length;
  }

  dispose(): void {
    for (const p of this.puffs) p.s.removeFromParent();
    this.puffs = [];
    for (const m of this.mats) m.dispose();
  }
}

registerEntityRenderer(KS_ENTITY.marker, (e, m) => {
  const kit = new Kit();
  const tilt = new THREE.Group();
  kit.root.add(tilt);
  const can = buildMarkerCanister(kit, tilt);
  can.position.y = -0.075; // spin about its middle
  const plume = new SmokePlume(m.renderer.scene, MARKER.smokeColor);
  let spin = Math.random() * 6;
  let bounced = false;
  let lastY = e.y;
  const pos = new THREE.Vector3();
  return {
    object: kit.root,
    update(s, dt) {
      kit.light(dt, m.map ? (x, y, z) => m.map!.lightAt(x, y, z) : null, kit.root.position);
      const settled = s.s?.k === 1;
      if (settled) {
        // Lying on its side (BO1 rolls it 90 degrees once still), smoke from the head.
        tilt.rotation.set(0, 0, Math.PI / 2);
        tilt.position.y = 0.035;
      } else {
        spin += dt * 12;
        tilt.rotation.set(spin, 0, spin * 0.4);
        tilt.position.y = 0.075;
        if (lastY - s.y < -0.01 && !bounced) {
          bounced = true;
          sfx.play('weapons.bounce', { at: { x: s.x, y: s.y, z: s.z }, volume: 0.45 });
        } else if (s.y < lastY) bounced = false;
      }
      lastY = s.y;
      const sm = typeof s.s?.sm === 'number' ? s.s.sm : Infinity;
      kit.root.getWorldPosition(pos);
      plume.update(dt, { x: pos.x, y: pos.y, z: pos.z }, m.serverTime >= sm ? 1 : 0, (at) => sfx.play('ks_smoke', { at, volume: 0.9 }));
    },
    dispose() {
      plume.dispose();
      kit.dispose();
    },
  };
});
