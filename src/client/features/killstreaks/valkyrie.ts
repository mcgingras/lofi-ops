/**
 * Valkyrie Rockets on the client (BO1's TV-guided missile; rules in shared/defs/valkyrie.ts):
 *
 * - The launcher in hand: STREAK with the launcher selected raises it (predicted on the press,
 *   confirmed by `killstreaks.state.launcher`); it sits on the right shoulder in first person in
 *   place of the gun, drawn over the world. The HUD shows the rockets left, a reload bar and the
 *   prompts ("[LMB] FIRE  [4] PUT AWAY", `promptKey`, so "[RT] ... [↑]" on a pad). FIRE launches.
 * - The rocket cam: while `control.id === 'valkyrie'` the camera rides our rocket. It follows a
 *   prediction of the server's flight (`rocketcam-logic.ts`: the snapshot stepped forward with our
 *   current aim at the same turn rate), and our look is kept within `VALKYRIE.lead` of its nose, so
 *   mouse and stick input steer it without winding up. The picture gets the camera-feed treatment
 *   (`renderer.feed`: monochrome, scanlines, grain) under BO1's `tow_overlay`-style reticle, with
 *   the fuel left, the boost state and the prompts; out of bounds it says LOSING SIGNAL and fades
 *   to white (`s.w` from the server); after the blast the camera holds on it, white, for a second.
 * - Others see the launcher on the holder's shoulder (`ks_launcher` entity).
 */
import * as THREE from 'three';
import { KS_ENTITY } from '../../../shared/defs/killstreaks';
import { clampLead, VALKYRIE, VALKYRIE_LAUNCHER } from '../../../shared/defs/valkyrie';
import { viewDir } from '../../../shared/math';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { promptKey } from '../../game/prompts';
import { blink, rect, txt, unit, HUD_COLORS as C } from '../../hud/draw';
import { registerAimAssistGate, registerEntityRenderer, registerHudWidget, registerMatchHook } from '../../registry';
import type { Soldier } from '../../render/models/soldier';
import { setDynLight, type LookMaterial } from '../../render/shader';
import { currentMatch } from '../../state';
import { buildValkyrieLauncher, Kit, type LauncherParts } from './models';
import { followRocket, holdView, launcherPhase, poseAngles, predictAhead, predictRocket, rocketHudInfo, rocketStateOf, type CamPose } from './rocketcam-logic';
import { ksClient } from './store';

// ---------------------------------------------------------------------------------------------
// State: the launcher (predicted over the server's) and the rocket cam
// ---------------------------------------------------------------------------------------------

export const valkyrieClient = {
  /** Launcher up in first person right now (predicted). */
  held: false,
  /** Local time it came up / last fired (animations). */
  raisedAt: -99,
  firedAt: -99,
  /** The rocket cam is on (steering, or holding on the blast). */
  cam: false,
  /** This frame's camera pose while it is on. */
  pose: null as CamPose | null,
};

let local: { phase: 'raise' | 'away'; at: number } | null = null;
let prev = { streak: false, fire: false, slot: 0 };
let follow: CamPose | null = null;
let followEnt = -1;
let setFeed = false;

const launcherSelected = () => {
  const st = ksClient.state;
  return st?.ready[st.selected] === VALKYRIE_LAUNCHER;
};

/** Steering our rocket (or holding on its blast): the server's `control` for the Valkyrie. */
function rocketControl() {
  const ctl = ksClient.state?.control;
  return ctl && ctl.id === 'valkyrie' ? ctl : null;
}

// No controller aim assist while the stick flies a rocket.
registerAimAssistGate('killstreaks.valkyrie', () => !rocketControl());

// ---------------------------------------------------------------------------------------------
// First person: the launcher on the right shoulder
// ---------------------------------------------------------------------------------------------

class FirstPersonLauncher {
  private kit: Kit | null = null;
  private parts: LauncherParts | null = null;
  private readonly off = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.03, 0.06, 0));

  /** `raise` 0..1, `reload` 0..1 through a reload (0 = none), `kick` 0..1 just after a shot, `loaded` shows the nose. */
  update(m: Match, show: boolean, raise: number, reload: number, kick: number, loaded: boolean): void {
    if (!show) {
      if (this.kit) this.kit.root.visible = false;
      return;
    }
    if (!this.kit) {
      const kit = new Kit();
      this.parts = buildValkyrieLauncher(kit);
      const glove = kit.mat('glove', { rep: 0.25 });
      const sleeve = kit.mat('camo', { rep: 0.4 });
      // Right hand on the grip, the sleeve running back off screen; left hand under the battery unit.
      kit.box(kit.root, 0.07, 0.06, 0.08, glove, 0, -0.19, 0.04);
      kit.box(kit.root, 0.08, 0.08, 0.26, sleeve, 0.02, -0.24, 0.2);
      kit.box(kit.root, 0.07, 0.05, 0.08, glove, -0.01, -0.13, -0.26);
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
    this.parts!.nose.visible = loaded;
    this.parts!.screen.visible = Math.floor(m.time * 3) % 2 === 0 || !loaded;
    const cam = m.renderer.cam;
    cam.updateMatrixWorld();
    const k = 1 - Math.pow(1 - Math.min(1, raise), 3);
    // Reload: dips down and rolls in toward the chest, then back up.
    const r = reload > 0 ? Math.sin(Math.min(1, reload) * Math.PI) : 0;
    this.off.set(0.17 - 0.05 * r, -0.13 - 0.34 * (1 - k) - 0.16 * r, 0.04 + 0.09 * kick);
    root.position.copy(this.off).applyMatrix4(cam.matrixWorld);
    root.quaternion.copy(cam.getWorldQuaternion(this.q)).multiply(this.tilt);
    if (r > 0) root.rotateZ(0.5 * r);
    if (kick > 0) root.rotateX(0.12 * kick);
    if (m.map) setDynLight(this.kit.mats as LookMaterial[], m.map.lightAt(cam.position.x, cam.position.y, cam.position.z));
  }

  dispose(): void {
    if (!this.kit) return;
    this.kit.root.removeFromParent();
    this.kit.dispose();
    this.kit = null;
    this.parts = null;
  }
}

let fp: FirstPersonLauncher | null = null;

registerMatchHook('killstreaks.valkyrie', {
  start() {
    local = null;
    prev = { streak: false, fire: false, slot: 0 };
    follow = null;
    followEnt = -1;
    valkyrieClient.held = false;
    valkyrieClient.cam = false;
    valkyrieClient.pose = null;
    fp = new FirstPersonLauncher();
    return () => {
      fp?.dispose();
      fp = null;
      valkyrieClient.held = false;
      valkyrieClient.cam = false;
      const m = currentMatch();
      if (m && setFeed) {
        m.renderer.feed = 0;
        m.renderer.white = 0;
      }
      setFeed = false;
    };
  },
  frame(m, dt) {
    const c = m.controls;
    const st = ksClient.state;
    const ctl = rocketControl();
    const ok = m.alive && m.phase === 'playing' && c.locked;
    const serverHeld = !!st?.launcher && m.alive;
    const shownBefore = valkyrieClient.held;
    const streak = c.isHeld('streak');
    const fire = c.triggerHeld;
    if (ok && !ctl && streak && !prev.streak) {
      if (shownBefore) local = { phase: 'away', at: m.time };
      else if (launcherSelected() && !st?.map && !st?.control && !st?.armed && !st?.marker) local = { phase: 'raise', at: m.time };
    }
    if (ok && !ctl && shownBefore && (m.slot !== prev.slot || c.isHeld('lethal') || c.isHeld('tactical') || c.isHeld('melee'))) local = { phase: 'away', at: m.time };
    // FIRE with a loaded launcher: the kick and the roar now; the camera follows the rocket once the server has it.
    const l = st?.launcher;
    if (ok && !ctl && shownBefore && l && fire && !prev.fire && launcherPhase(l, m.serverTime, false).phase === 'ready') {
      valkyrieClient.firedAt = m.time;
      sfx.play('ks_launch', { volume: 1.2 });
    }
    prev = { streak, fire, slot: m.slot };
    if (local) {
      const agreed = local.phase === 'raise' ? serverHeld : !serverHeld;
      if (agreed || m.time - local.at > Math.max(0.4, m.netRtt * 2 + 0.3)) local = null;
    }
    const held = m.alive && (local ? local.phase === 'raise' : serverHeld);
    if (held && !shownBefore) valkyrieClient.raisedAt = m.time;
    valkyrieClient.held = held;

    // The rocket cam.
    const cam = updateRocketCam(m, dt, ctl);
    valkyrieClient.cam = cam;
    const showLauncher = held && !cam;
    if (showLauncher || cam) m.viewmodel.visible = false;
    let reload = 0;
    let loaded = true;
    if (l) {
      const ph = launcherPhase(l, m.serverTime, !!ctl);
      if (ph.phase === 'reloading') reload = ph.k;
      loaded = ph.phase === 'ready' || ph.phase === 'raising';
    }
    const kick = Math.max(0, 1 - (m.time - valkyrieClient.firedAt) / 0.35);
    if (kick > 0) loaded = false;
    fp?.update(m, showLauncher, Math.min(1, (m.time - valkyrieClient.raisedAt) / VALKYRIE.raiseSec), reload, kick, loaded);
  },
});

/** Ride our rocket (or hold on its blast). Returns true while the rocket cam is on. */
function updateRocketCam(m: Match, dt: number, ctl: ReturnType<typeof rocketControl>): boolean {
  const r = m.renderer;
  if (!ctl || !m.alive) {
    follow = null;
    followEnt = -1;
    valkyrieClient.pose = null;
    if (setFeed) {
      r.feed = 0;
      r.white = 0;
      setFeed = false;
    }
    return false;
  }
  const snap = m.net.lastSnap;
  const ent = snap?.ents.find((e) => e.id === ctl.entity && e.kind === KS_ENTITY.rocket);
  let white = 0;
  if (ctl.hold || !ent) {
    // The rocket is gone: hold on the blast (or where we last were), white "no signal".
    const at = ctl.hold ? { x: ctl.hold.x, y: ctl.hold.y, z: ctl.hold.z } : (follow?.pos ?? null);
    if (!at) return false;
    if (ctl.hold) follow = holdView(at, follow?.dir ?? viewDir(m.yaw, m.pitch));
    white = ctl.hold ? 1 : 0;
  } else {
    const base = rocketStateOf(ent);
    // Keep the aim inside the cone round the nose, then fly the prediction with it.
    const aim = clampLead(base.dir, m.controls.yaw, m.controls.pitch);
    m.controls.yaw = aim.yaw;
    m.controls.pitch = aim.pitch;
    const boost = m.controls.adsHeld;
    const pred = predictRocket(base, viewDir(aim.yaw, aim.pitch), boost, predictAhead(m.serverTime, snap!.time, m.netRtt));
    if (followEnt !== ent.id) {
      follow = null;
      followEnt = ent.id;
    }
    follow = followRocket(follow, { pos: pred.pos, dir: pred.dir }, dt);
    white = rocketHudInfo(ent.s, null).white;
  }
  const pose = follow!;
  valkyrieClient.pose = pose;
  const a = poseAngles(pose);
  r.cam.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
  r.cam.rotation.set(a.pitch, a.yaw, 0, 'YXZ');
  // The rocket cam ignores ADS (that button boosts) and ADS sensitivity.
  r.zoom = 1;
  r.updateFov();
  m.controls.lookScale = 1;
  r.feed = 1;
  r.white = white;
  setFeed = true;
  const fwd = viewDir(a.yaw, a.pitch);
  sfx.listener(pose.pos.x, pose.pos.y, pose.pos.z, fwd.x, fwd.y, fwd.z);
  return true;
}

// ---------------------------------------------------------------------------------------------
// HUD: the launcher (rockets, reload, prompts) and the rocket overlay
// ---------------------------------------------------------------------------------------------

/** Clear what core widgets drew in a box (the gun's crosshair and ammo don't apply to the launcher). */
function clearBox(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.clearRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
}

registerHudWidget(
  'killstreaks.launcher',
  (g, W, H) => {
    const m = currentMatch();
    const st = ksClient.state;
    if (!m || !m.alive || !valkyrieClient.held || valkyrieClient.cam) return;
    const u = unit(H);
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);
    // Launcher sight: a square with a centre dot, in place of the gun's crosshair.
    clearBox(g, cx - 20 * u, cy - 20 * u, 40 * u, 40 * u);
    const s = 6 * u;
    for (const [x, y, w, h] of [[cx - s, cy - s, 3 * u, u], [cx - s, cy - s, u, 3 * u], [cx + s - 2 * u, cy - s, 3 * u, u], [cx + s, cy - s, u, 3 * u], [cx - s, cy + s, 3 * u, u], [cx - s, cy + s - 2 * u, u, 3 * u], [cx + s - 2 * u, cy + s, 3 * u, u], [cx + s, cy + s - 2 * u, u, 3 * u]] as const) rect(g, x, y, w, h, C.paper);
    rect(g, cx, cy, u, u, C.warn);
    // Rockets left, where the ammo goes.
    clearBox(g, W - 90 * u, H - 40 * u, 90 * u, 40 * u);
    const l = st?.launcher ?? { left: VALKYRIE.rockets, ready: m.serverTime + VALKYRIE.raiseSec, fired: false };
    const ph = launcherPhase(l, m.serverTime, false);
    const loaded = ph.phase === 'ready' || ph.phase === 'raising' ? 1 : 0;
    const spare = Math.max(0, l.left - loaded);
    txt(g, String(loaded), W - 30 * u, H - 24 * u, 16, loaded ? C.hi : C.warn, 'right', u);
    txt(g, '/' + spare, W - 8 * u, H - 18 * u, 8, '#d8d0c0', 'right', u);
    txt(g, 'VALKYRIE', W - 8 * u, H - 9 * u, 8, C.dim, 'right', u);
    for (let i = 0; i < VALKYRIE.rockets; i++) {
      const x = W - 10 * u - i * 6 * u;
      const y = H - 33 * u;
      rect(g, x - u, y - u, 4 * u, 7 * u, C.ink);
      rect(g, x, y, 2 * u, 5 * u, i < l.left ? C.ammo : C.empty);
    }
    // Reload bar.
    if (ph.phase === 'reloading') {
      const bw = 60 * u;
      txt(g, 'RELOADING', cx, cy + 24 * u, 8, C.paper, 'center', u);
      rect(g, cx - bw / 2, cy + 34 * u, bw, 3 * u, C.ink);
      rect(g, cx - bw / 2, cy + 34 * u, bw * ph.k, 3 * u, C.hi);
    }
    const fire = `${promptKey('fire', { brackets: true })} FIRE ROCKET`;
    const away = l.fired ? '' : `   ${promptKey('streak', { brackets: true })} PUT AWAY`;
    txt(g, fire + away, cx, H - 52 * u, 8, blink(m.time, 1.2, 0.9) ? C.hi : C.paper, 'center', u);
  },
  63,
);

/** Rocket overlay: BO1's `tow_overlay` (a reticle over the feed) in our pixel style, plus readouts and prompts. */
registerHudWidget(
  'killstreaks.rocket',
  (g, W, H) => {
    const m = currentMatch();
    const ctl = rocketControl();
    if (!m || !m.alive || !ctl || !valkyrieClient.cam) return;
    const u = unit(H);
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);
    // The gun's crosshair and ammo have no place here.
    clearBox(g, cx - 24 * u, cy - 24 * u, 48 * u, 48 * u);
    clearBox(g, W - 90 * u, H - 40 * u, 90 * u, 40 * u);
    if (ctl.hold) {
      if (blink(m.time, 0.5, 0.3)) txt(g, 'NO SIGNAL', cx, cy - 4 * u, 16, C.ink, 'center', u);
      return;
    }
    const ent = m.net.lastSnap?.ents.find((e) => e.id === ctl.entity);
    const info = rocketHudInfo(ent?.s, ksClient.state?.launcher?.left ?? null);
    // Dithered vignette outside a circle: every other pixel black (the screen-door of the lo-fi look).
    const R = Math.min(W, H) * 0.47;
    g.fillStyle = C.ink;
    const step = Math.max(1, Math.round(u));
    for (let y = 0; y < H; y += step * 2) {
      const dy = y - cy;
      const half = dy * dy < R * R ? Math.sqrt(R * R - dy * dy) : 0;
      for (let x = (y / step) % 2 ? step : 0; x < W; x += step * 2) {
        const dx = x - cx;
        if (Math.abs(dx) > half) g.fillRect(x, y, step, step);
      }
    }
    // Reticle: a cross with a gap, corner brackets, and range ticks down the vertical.
    const col = C.paper;
    const gap = 5 * u;
    const arm = 14 * u;
    rect(g, cx - gap - arm, cy, arm, u, col);
    rect(g, cx + gap + u, cy, arm, u, col);
    rect(g, cx, cy - gap - arm, u, arm, col);
    rect(g, cx, cy + gap + u, u, arm, col);
    rect(g, cx, cy, u, u, C.warn);
    const b = 34 * u;
    const bl = 9 * u;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const x = cx + sx * b;
      const y = cy + sy * b;
      rect(g, sx < 0 ? x : x - bl + u, y, bl, u, col);
      rect(g, x, sy < 0 ? y : y - bl + u, u, bl, col);
    }
    for (let i = 1; i <= 3; i++) rect(g, cx - 3 * u, cy + gap + arm + 4 * u + i * 6 * u, 7 * u, u, C.dim);
    // Header: name, rocket, fuel.
    txt(g, 'VALKYRIE', cx, 18 * u, 8, C.hi, 'center', u);
    txt(g, `ROCKET ${info.rocket}/${VALKYRIE.rockets}`, cx, 28 * u, 8, C.paper, 'center', u);
    const fw = 70 * u;
    rect(g, cx - fw / 2 - u, 38 * u - u, fw + 2 * u, 5 * u, C.ink);
    rect(g, cx - fw / 2, 38 * u, fw * info.fuel, 3 * u, info.fuel < 0.25 ? C.warn : C.hi);
    txt(g, 'FUEL', cx - fw / 2 - 4 * u, 36 * u, 8, C.dim, 'right', u);
    // Boost: the button, then lit once it burns (it can't be turned off).
    const bx = cx + R * 0.72;
    const by = cy + R * 0.55;
    if (info.boost) {
      if (blink(m.time, 0.3, 0.2)) txt(g, 'BOOST', bx, by, 16, C.warn, 'center', u);
    } else txt(g, `${promptKey('ads', { brackets: true })} BOOST`, bx, by, 8, C.paper, 'center', u);
    txt(g, `${promptKey('fire', { brackets: true })} DETONATE`, cx - R * 0.72, by, 8, C.paper, 'center', u);
    if (info.white > 0 && blink(m.time, 0.5, 0.3)) txt(g, 'LOSING SIGNAL', cx, cy - 30 * u, 16, C.warn, 'center', u);
  },
  64,
);

// ---------------------------------------------------------------------------------------------
// Third person: the launcher on the holder's shoulder
// ---------------------------------------------------------------------------------------------

const worn = new WeakMap<Soldier, { kit: Kit; mats: LookMaterial[] }>();

function wear(s: Soldier): void {
  if (worn.has(s)) return;
  const kit = new Kit();
  const parts = buildValkyrieLauncher(kit);
  // Soldier space faces +z with the aim pivot at the shoulders: tube on the shoulder (the rifle's
  // stock side), pointing forward, a little larger than life so it reads at range.
  parts.root.rotation.y = Math.PI;
  parts.root.position.set(0.14, 0.12, 0.1);
  parts.root.scale.setScalar(1.15);
  s.aim.add(kit.root);
  s.mats.push(...kit.mats);
  worn.set(s, { kit, mats: kit.mats });
  s.gun.visible = false;
}

function unwear(s: Soldier): void {
  const w = worn.get(s);
  if (!w) return;
  w.kit.root.removeFromParent();
  for (const m of w.mats) {
    const i = s.mats.indexOf(m);
    if (i >= 0) s.mats.splice(i, 1);
  }
  w.kit.dispose();
  worn.delete(s);
  s.gun.visible = true;
}

registerEntityRenderer(KS_ENTITY.launcher, () => {
  let soldier: Soldier | null = null;
  return {
    object: new THREE.Group(),
    update(ent, _dt, m) {
      if (ent.owner === m.myId) return false;
      const v = ent.owner ? m.remotes.views.get(ent.owner) : undefined;
      if (!v || !v.alive) {
        if (soldier) unwear(soldier);
        soldier = null;
        return false;
      }
      if (soldier && soldier !== v.soldier) unwear(soldier);
      soldier = v.soldier;
      wear(soldier);
      // Steering a rocket: stands aiming up the way it went (no lean); otherwise the normal aim pose.
      if (ent.s?.f === 1) soldier.aim.rotation.x = -0.25;
      return false;
    },
    dispose() {
      if (soldier) unwear(soldier);
      soldier = null;
    },
  };
});
