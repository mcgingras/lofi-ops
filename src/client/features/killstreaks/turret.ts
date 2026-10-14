/**
 * Carrying a Sentry Gun / SAM Turret to place it, on the client (server: streaks/carry.ts; the rule
 * both run: shared/defs/turret-place.ts):
 * - STREAK with either selected brings it up (predicted on the press, confirmed by
 *   `killstreaks.state.carry`); your gun goes away. A ghost of the turret sits on the floor in
 *   front of you, following your feet and facing every frame (`turretPlacement` from the predicted
 *   feet and quantised aim, exactly what the server checks): green where it can go down, red where
 *   it can't, with the reason ("BLOCKED", "TOO STEEP", "OUT OF MAP", ...). Its arc shows on the
 *   floor for the Sentry Gun.
 * - FIRE or USE puts it down; STREAK puts a fresh one away (a picked-up one goes back where it
 *   was). Prompts go through `promptKey`, so a pad reads "[RT] PLACE  [↑] CANCEL".
 * - Standing at your own placed turret: "PRESS F TO MOVE SENTRY" (USE picks it up).
 * - A sentry tracking you: a red laser from its muzzle to you and a red "SENTRY" marker on it.
 */
import * as THREE from 'three';
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../../../shared/defs/killstreaks';
import { SENTRY } from '../../../shared/defs/sentry';
import { PLACE_REASON_TEXT, TURRET_PLACE, turretPlacement, type TurretSpot } from '../../../shared/defs/turret-place';
import { quantizeAngle } from '../../../shared/math';
import { PLAYER } from '../../../shared/constants';
import type { EntitySnap } from '../../../shared/protocol';
import type { Match } from '../../game/match';
import { promptKey } from '../../game/prompts';
import { blink, txt, unit, HUD_COLORS as C } from '../../hud/draw';
import { drawWaypoint, useKey, type WaypointSlot } from '../../hud/waypoints';
import { registerHudWidget, registerMatchHook } from '../../registry';
import { getTexture } from '../../render/textures';
import { currentMatch } from '../../state';
import { buildSam, buildSentry, Kit } from './models';
import { sentryObjects } from './renderers';
import { ksClient, streakName } from './store';

export const turretClient = {
  /** Carrying a turret right now (predicted), and which streak. */
  held: null as string | null,
  /** A placed turret picked back up (STREAK puts it back). */
  moved: false,
  /** This frame's preview spot (null while not carrying). */
  preview: null as TurretSpot | null,
};

let local: { phase: 'raise' | 'away'; id: string; at: number } | null = null;
let prev = { streak: false, fire: false, use: false, slot: 0 };

const isTurret = (id: string | undefined) => !!id && KILLSTREAK_BY_ID.get(id)?.targeting === 'place';

/** The preview spot from the predicted feet and the aim the server will get (quantised). */
export function previewSpot(m: Match, yaw = m.yaw): TurretSpot | null {
  const map = m.map?.map;
  if (!map) return null;
  const st = m.net.predictor.state;
  return turretPlacement(m.net.world, map, { x: st.x, y: st.y, z: st.z }, quantizeAngle(yaw));
}

// ---------------------------------------------------------------------------------------------
// The ghost on the floor
// ---------------------------------------------------------------------------------------------

const GOOD = 0x58ff78;
const BAD = 0xff4a3a;

class Ghost {
  readonly root = new THREE.Group();
  private kits = new Map<string, Kit>();
  private mat = new THREE.MeshBasicMaterial({ color: GOOD, transparent: true, opacity: 0.45, depthWrite: false });
  private ringMat = new THREE.MeshBasicMaterial({ map: getTexture('ks_drop_ring'), color: GOOD, transparent: true, alphaTest: 0.4, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  private ring = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2), this.ringMat);
  private arcMat = new THREE.LineBasicMaterial({ color: GOOD, transparent: true, opacity: 0.8, depthTest: false });
  private arc: THREE.Line;

  constructor() {
    this.ring.renderOrder = 800;
    const pts: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)];
    const n = 16;
    const r = 3;
    for (let i = 0; i <= n; i++) {
      const a = -SENTRY.arcHalf + (2 * SENTRY.arcHalf * i) / n;
      pts.push(new THREE.Vector3(-Math.sin(a) * r, 0, -Math.cos(a) * r));
    }
    pts.push(new THREE.Vector3(0, 0, 0));
    this.arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.arcMat);
    this.arc.renderOrder = 801;
    this.root.add(this.ring, this.arc);
  }

  private kitFor(id: string): Kit {
    let kit = this.kits.get(id);
    if (!kit) {
      kit = new Kit();
      if (id === 'sam_turret') buildSam(kit);
      else {
        const parts = buildSentry(kit);
        parts.flash.removeFromParent();
        parts.lamp.removeFromParent();
      }
      kit.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.material = this.mat;
      });
      for (const m of kit.mats) m.dispose();
      this.kits.set(id, kit);
      this.root.add(kit.root);
    }
    return kit;
  }

  show(m: Match, id: string | null, spot: TurretSpot | null): void {
    if (!id || !spot) {
      this.root.visible = false;
      return;
    }
    if (this.root.parent !== m.renderer.scene) m.renderer.scene.add(this.root);
    this.root.visible = true;
    for (const [k, kit] of this.kits) kit.root.visible = k === id;
    const kit = this.kitFor(id);
    kit.root.visible = true;
    const col = spot.valid ? GOOD : BAD;
    this.mat.color.setHex(col);
    this.ringMat.color.setHex(col);
    this.arcMat.color.setHex(col);
    this.root.position.set(spot.x, spot.y, spot.z);
    this.root.rotation.y = spot.yaw;
    this.ring.position.y = 0.04;
    this.ring.rotation.y = m.time * 1.5 - spot.yaw;
    this.arc.visible = id === 'sentry_gun';
    this.arc.position.y = 0.06;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const kit of this.kits.values()) {
      kit.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.ring.geometry.dispose();
    this.arc.geometry.dispose();
    this.mat.dispose();
    this.ringMat.dispose();
    this.arcMat.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// A sentry tracking you: the laser
// ---------------------------------------------------------------------------------------------

class Laser {
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(6);
  private mat = new THREE.LineBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.9, depthWrite: false });
  readonly line: THREE.Line;

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.line = new THREE.Line(this.geo, this.mat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 700;
  }

  show(m: Match, e: EntitySnap | null): void {
    if (!e) {
      this.line.visible = false;
      return;
    }
    if (this.line.parent !== m.renderer.scene) m.renderer.scene.add(this.line);
    const obj = sentryObjects.get(e.id);
    const at = obj?.position ?? new THREE.Vector3(e.x, e.y, e.z);
    const yaw = obj?.rotation.y ?? e.yaw;
    const me = m.net.predictor.shown();
    const chest = me.y + PLAYER.height * 0.55;
    const mx = at.x - Math.sin(yaw) * 1.1;
    const mz = at.z - Math.cos(yaw) * 1.1;
    this.pos.set([mx, at.y + 0.84, mz, me.x, chest, me.z]);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.mat.opacity = e.s?.a === 1 ? 0.95 : 0.45 + 0.4 * Math.abs(Math.sin(m.time * 14));
    this.line.visible = true;
  }

  dispose(): void {
    this.line.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** The enemy sentry tracking us right now (snapshot entity), if any. */
function trackingMe(m: Match): EntitySnap | null {
  if (!m.alive) return null;
  for (const e of m.net.lastSnap?.ents ?? []) if (e.kind === KS_ENTITY.sentry && e.s?.t === m.myId && e.s?.c !== 1) return e;
  return null;
}

/** Our own placed turret we could pick up from where we stand (mirrors the server's reach). */
function ownTurretNear(m: Match): EntitySnap | null {
  if (!m.alive) return null;
  const st = m.net.predictor.state;
  for (const e of m.net.lastSnap?.ents ?? []) {
    if ((e.kind !== KS_ENTITY.sentry && e.kind !== KS_ENTITY.sam) || e.owner !== m.myId || e.s?.c === 1 || e.s?.h === 1) continue;
    if (Math.hypot(st.x - e.x, st.z - e.z) <= TURRET_PLACE.pickupReach && Math.abs(st.y - e.y) <= TURRET_PLACE.pickupDy) return e;
  }
  return null;
}

let ghost: Ghost | null = null;
let laser: Laser | null = null;

registerMatchHook('killstreaks.turret', {
  start() {
    local = null;
    prev = { streak: false, fire: false, use: false, slot: 0 };
    turretClient.held = null;
    turretClient.preview = null;
    ghost = new Ghost();
    laser = new Laser();
    return () => {
      ghost?.dispose();
      laser?.dispose();
      ghost = laser = null;
      turretClient.held = null;
      turretClient.preview = null;
    };
  },
  frame(m) {
    const c = m.controls;
    const st = ksClient.state;
    const ok = m.alive && m.phase === 'playing' && c.locked;
    const server = m.alive ? (st?.carry ?? null) : null;
    const shown = turretClient.held;
    const streak = c.isHeld('streak');
    const fire = c.triggerHeld;
    const use = c.isHeld('use');
    if (ok && streak && !prev.streak) {
      const sel = st?.ready[st.selected];
      if (shown) local = { phase: 'away', id: shown, at: m.time };
      else if (isTurret(sel) && !st?.map && !st?.control && !st?.marker && !st?.launcher && !st?.armed) local = { phase: 'raise', id: sel!, at: m.time };
    }
    // FIRE / USE: down it goes when the spot is good (the server checks the same rule).
    if (ok && shown && ((fire && !prev.fire) || (use && !prev.use)) && turretClient.preview?.valid) local = { phase: 'away', id: shown, at: m.time };
    if (shown && (m.slot !== prev.slot || c.isHeld('lethal') || c.isHeld('tactical') || c.isHeld('melee'))) local = { phase: 'away', id: shown, at: m.time };
    prev = { streak, fire, use, slot: m.slot };
    if (local) {
      const agreed = local.phase === 'raise' ? !!server : !server;
      if (agreed || m.time - local.at > Math.max(0.4, m.netRtt * 2 + 0.3)) local = null;
    }
    const held = !m.alive ? null : local ? (local.phase === 'raise' ? local.id : null) : (server?.id ?? null);
    turretClient.held = held;
    turretClient.moved = !!server?.moved;
    turretClient.preview = held ? previewSpot(m) : null;
    if (held) m.viewmodel.visible = false;
    ghost?.show(m, held, turretClient.preview);
    laser?.show(m, trackingMe(m));
  },
});

// ---------------------------------------------------------------------------------------------
// HUD: prompts, the reason a spot is no good, pickup prompt, tracking marker
// ---------------------------------------------------------------------------------------------

registerHudWidget(
  'killstreaks.turret',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.alive) return;
    const u = unit(H);
    const placed: WaypointSlot[] = [];
    const tracker = trackingMe(m);
    if (tracker) drawWaypoint(m, g, W, H, { x: tracker.x, y: tracker.y + 1.5, z: tracker.z, label: 'SENTRY', color: C.enemy, blink: tracker.s?.a !== 1, small: true }, placed);
    const id = turretClient.held;
    const spot = turretClient.preview;
    if (id) {
      const name = streakName(id).toUpperCase();
      if (spot && !spot.valid) drawWaypoint(m, g, W, H, { x: spot.x, y: spot.y + 1.4, z: spot.z, label: `CAN'T PLACE: ${PLACE_REASON_TEXT[spot.reason]}`, color: C.warn, small: true }, placed);
      const y = H - 52 * u;
      const away = turretClient.moved ? 'PUT BACK' : 'CANCEL';
      txt(g, `${promptKey('fire', { brackets: true })} PLACE ${name}   ${promptKey('streak', { brackets: true })} ${away}`, W / 2, y, 8, spot?.valid ? (blink(m.time, 1.2, 0.9) ? C.hi : C.paper) : C.dim, 'center', u);
      return;
    }
    const mine = ownTurretNear(m);
    if (mine && !ksClient.crate) {
      const name = mine.kind === KS_ENTITY.sam ? 'SAM TURRET' : 'SENTRY';
      txt(g, `PRESS ${useKey()} TO MOVE ${name}`, W / 2, H / 2 + 26 * u, 8, C.paper, 'center', u);
    }
  },
  63,
);
