/**
 * Per-death killcam playback (BO1/MW2 "KILLCAM"). After you are killed by an enemy the server
 * sends you `modes.deathcam`: the last few seconds before the kill (20 Hz poses of nearby players,
 * their shots) and a killer card. After a short death view (DEATHCAM.beatSec) the replay plays at
 * 1x from the killer's eyes with their gun as the viewmodel (kick, flash, tracers and gunshots on
 * the recorded shots, their health as the damage tint), or from the killstreak that did it, then
 * hands back to the death screen / respawn. The timeline is anchored to room time, so it always
 * ends by the respawn (the server cut the clip to fit; the server still respawns you on time, which
 * ends the replay); F (or the gamepad's X / Square) skips back to the death screen.
 * Card only (no replay) when there was no room before the respawn.
 */
import * as THREE from 'three';
import { ATTACHMENT_BY_ID, effectiveWeapon } from '../../../shared/defs/attachments';
import { unpackClip, type DeathcamPayload, type DeathcamShot } from '../../../shared/defs/deathcam';
import { EQUIPMENT_BY_ID } from '../../../shared/defs/equipment';
import { KILLSTREAK_BY_ID } from '../../../shared/defs/killstreaks';
import type { KillcamFrame } from '../../../shared/defs/modestate';
import { rankFor } from '../../../shared/defs/progression';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { viewDir } from '../../../shared/math';
import { PlayerFlags } from '../../../shared/protocol';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { ViewmodelRig } from '../../game/viewmodel';
import { HUD_COLORS as C, rect, textWidth, txt, unit } from '../../hud/draw';
import { PAD, PadEdges } from '../../game/gamepad';
import { promptKey } from '../../game/prompts';
import { net } from '../../net';
import { onFeature, registerHudWidget, registerMatchHook, shotFxs } from '../../registry';
import { currentMatch } from '../../state';
import { badgePixels, drawPixels } from '../progression/emblems';
import { aimAt, cardLines, deathcamClock, eyeOf, killcamTimer, trackPose } from './deathcam-math';
import { posesAt, type Pose } from './killcam-math';
import { ReplayActors } from './replay';

const S = {
  d: null as DeathcamPayload | null,
  frames: [] as KillcamFrame[],
  shots: [] as DeathcamShot[],
  from: 0,
  to: 0,
  /** Skipped or finished: back to the death screen until the next death. */
  over: false,
  playing: false,
  /** Last clip time whose shots were played. */
  lastT: -Infinity,
  left: 0,
  ads: 0,
  lastK: null as Pose | null,
  /** Streak views: where the victim was last seen alive. */
  target: null as { x: number; y: number; z: number } | null,
  melee: false,
  /** Skip key must be released after the clip arrives before a press counts. */
  useWas: true,
};
/** The controller's X (shared gamepad module), primed when a clip arrives. */
const padEdges = new PadEdges();

const actors = new ReplayActors();
let rig: ViewmodelRig | null = null;
let hiddenVm: { root: THREE.Object3D; parent: THREE.Object3D } | null = null;

/** True while the per-death killcam is on screen. */
export const deathcamPlaying = () => S.playing;

function clear(): void {
  S.d = null;
  S.frames = [];
  S.shots = [];
  S.over = false;
}

onFeature('modes.deathcam', (d) => {
  const m = currentMatch();
  if (!m || d.victim !== m.myId) return;
  clear();
  S.d = d;
  if (d.clip) {
    const c = unpackClip(d.clip);
    S.frames = c.frames;
    S.shots = c.shots;
    S.from = c.frames[0]?.t ?? d.at;
    S.to = c.frames.at(-1)?.t ?? d.at;
  }
  S.useWas = true;
  padEdges.prime();
});
net.on('spawned', () => clear());
net.on('joined', () => clear());
net.on('phase', (p) => {
  if (p.phase !== 'playing') clear();
});

/**
 * Edge-triggered skip: USE (F) or the controller's X, as in BO1. The pad is read here directly
 * (not through `controls.isHeld('use')`, which also carries the pad's X) so one press is one skip.
 */
function skipPressed(m: Match): boolean {
  const use = m.controls.isHeld('use');
  const pad = padEdges.update().has(PAD.X);
  const hit = (use && !S.useWas) || pad;
  S.useWas = use;
  return hit;
}

function begin(m: Match, t: number): void {
  S.playing = true;
  S.lastT = t - 0.05;
  S.ads = 0;
  S.lastK = null;
  S.target = null;
  S.melee = false;
  // The local player's gun leaves the viewmodel scene while the killer's is shown.
  const root = m.viewmodel.root;
  if (root.parent && !hiddenVm) {
    hiddenVm = { root, parent: root.parent };
    root.removeFromParent();
  }
  rig ??= new ViewmodelRig(m.renderer.vmScene);
}

function end(): void {
  S.playing = false;
  const m = currentMatch();
  if (m) m.renderer.feed = 0;
  actors.dispose();
  if (rig) rig.visible = false;
  if (hiddenVm) {
    hiddenVm.parent.add(hiddenVm.root);
    hiddenVm = null;
  }
}

function frame(m: Match, dt: number): void {
  const d = S.d;
  const death = m.death;
  if (!d || S.over || d.view === 'none' || !S.frames.length || m.alive || !death || m.phase !== 'playing' || !m.map) {
    if (S.playing) end();
    return;
  }
  const respawnAt = death.respawnAt ?? d.respawnAt;
  const c = deathcamClock(d.playAt, respawnAt, S.from, S.to, m.serverTime);
  if (c.state === 'beat') return;
  if (c.state === 'done' || (S.playing && skipPressed(m))) {
    S.over = true;
    end();
    return;
  }
  if (!S.playing) {
    begin(m, c.t);
    skipPressed(m);
  }
  S.left = c.left;
  const poses = posesAt(S.frames, c.t);
  const r = m.renderer;
  const cam = r.cam;
  actors.update(m, poses, d.view === 'eyes' ? d.killer : null, dt);

  const k = poses.get(d.killer);
  let killerGun = false;
  if (d.view === 'eyes' && k) {
    cam.position.set(k.x, k.y + eyeOf(k, PlayerFlags.CROUCH, PlayerFlags.PRONE), k.z);
    cam.rotation.set(k.pitch, k.yaw, 0, 'YXZ');
    const base = d.vm ? WEAPON_BY_ID.get(d.vm.weapon) : undefined;
    const eff = base && d.vm ? effectiveWeapon(base, d.vm.attachments) : null;
    S.ads += ((k.f & PlayerFlags.ADS ? 1 : 0) - S.ads) * Math.min(1, dt * 12);
    r.zoom = 1 + ((eff?.zoom ?? 1.15) - 1) * S.ads;
    const scoped = !!eff?.scope && S.ads > 0.85;
    const speed = S.lastK ? Math.hypot(k.x - S.lastK.x, k.z - S.lastK.z) / Math.max(1e-3, dt) : 0;
    S.lastK = k;
    if (rig && eff && d.vm) {
      killerGun = true;
      rig.setWeapon(base!.model ?? base!.id, d.vm.attachments, d.vm.camo);
      rig.visible = !scoped;
      if (d.means === 'melee' && !S.melee && c.t >= d.at - 0.25) {
        S.melee = true;
        rig.action('melee', 0.45);
      }
      rig.update({ dt, time: m.time, ads: S.ads, move: Math.min(1, speed / 5) * (k.f & PlayerFlags.GROUND ? 1 : 0.2), sprint: (k.f & PlayerFlags.SPRINT) !== 0, yaw: k.yaw, pitch: k.pitch, reload: -1, raise: -1, light: m.map.lightAt(k.x, k.y + 1.3, k.z) });
    }
    // The killer's injuries tint the screen, as in BO1's killcam.
    r.damage = Math.max(0, 0.85 - k.hp / 100) / 0.85;
  } else if (d.cam?.track) {
    // Valkyrie: ride the rocket's flight under the camera-feed look, then hold on the blast.
    const p = trackPose(d.cam.track, c.t);
    cam.position.set(p.x, p.y, p.z);
    cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    r.zoom = 1;
    r.damage = 0;
    r.feed = p.done ? 0.6 : 1;
  } else if (d.cam) {
    const pv = poses.get(d.victim);
    const v = pv && pv.f & PlayerFlags.ALIVE ? pv : null; // (a victim still dead from an earlier life isn't there yet)
    // Top-down (strikes): high over the victim, a little behind so the soldier reads as a figure.
    const from = d.cam.top ? { x: d.cam.x, y: d.cam.y, z: d.cam.z + d.cam.y * 0.35 } : d.cam;
    // Follow the victim while alive; once they fall, keep looking where they were.
    if (v) S.target = { x: v.x, y: v.y + 1.1, z: v.z };
    const spot = posesAt(S.frames, d.at).get(d.victim);
    const target = S.target ?? (spot ? { x: spot.x, y: spot.y + 1.1, z: spot.z } : { x: d.cam.x, y: 0, z: d.cam.z - 1 });
    const aim = aimAt(from, target);
    cam.position.set(from.x, from.y, from.z);
    cam.rotation.set(aim.pitch, aim.yaw, 0, 'YXZ');
    r.zoom = 1;
    r.damage = 0;
  }
  r.updateFov();
  if (rig && !killerGun) rig.visible = false;
  // Rendering the viewmodel pass needs the match rig's flag; its own model is out of the scene.
  m.viewmodel.visible = killerGun && !!rig?.visible;
  const fwd = viewDir(cam.rotation.y, cam.rotation.x);
  sfx.listener(cam.position.x, cam.position.y, cam.position.z, fwd.x, fwd.y, fwd.z);

  for (const s of S.shots) {
    if (s.t <= S.lastT || s.t > c.t) continue;
    const to = { x: s.end[0], y: s.end[1], z: s.end[2] };
    // A weapon with its own look (wonder weapons): its replay draws the bolt / blast / arc / frost.
    const fx = s.id === d.killer ? shotFxs.get(d.vm?.weapon ?? d.weapon)?.replay : undefined;
    if (fx) {
      const eyesView = d.view === 'eyes';
      const from = eyesView ? new THREE.Vector3(0.1, -0.12, -0.6).applyQuaternion(cam.quaternion).add(cam.position) : actors.muzzle(s.id);
      if (eyesView) rig?.shoot(m.time, 0.8);
      sfx.gunshot(d.vm?.weapon ?? d.weapon, eyesView ? undefined : to, false);
      if (from) fx(m, s.id, from, to, s.hit, s.t);
      continue;
    }
    if (s.id === d.killer && d.view === 'eyes') {
      rig?.shoot(m.time, 0.8);
      sfx.gunshot(d.vm?.weapon ?? d.weapon, undefined, d.vm?.suppressed ?? false);
      m.effects.tracer(new THREE.Vector3(0.1, -0.12, -0.6).applyQuaternion(cam.quaternion).add(cam.position), to);
    } else {
      const from = actors.muzzle(s.id);
      if (from) m.effects.tracer(from, to);
      const p = poses.get(s.id);
      sfx.gunshot(s.id === d.killer ? d.weapon : 'ak47', p ? { x: p.x, y: p.y + 1.5, z: p.z } : to);
    }
    if (s.hit) m.effects.puff('blood', to);
    else m.effects.puff('dust', to, undefined, 3);
    for (const p of s.pen ?? []) m.effects.puff('dust', { x: p[0], y: p[1], z: p[2] }, undefined, 3);
  }
  S.lastT = Math.max(S.lastT, c.t);
}

registerMatchHook('modes.deathcam', {
  start: () => () => {
    end();
    clear();
    rig?.dispose();
    rig = null;
  },
  frame,
});

// ---------------------------------------------------------------------------------------------
// HUD: KILLCAM banner + timer, killer card, skip prompt
// ---------------------------------------------------------------------------------------------

let pattern: { g: CanvasRenderingContext2D; p: CanvasPattern | null } | null = null;
/** A checkerboard of red pixels: reads as BO1's translucent red bands through the pixel HUD. */
function band(g: CanvasRenderingContext2D, y: number, w: number, h: number): void {
  if (!pattern || pattern.g !== g) {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const pg = c.getContext('2d')!;
    pg.fillStyle = '#7a1410';
    pg.fillRect(0, 0, 1, 1);
    pg.fillRect(1, 1, 1, 1);
    pattern = { g, p: g.createPattern(c, 'repeat') };
  }
  if (!pattern.p) return rect(g, 0, y, w, h, '#7a1410');
  g.fillStyle = pattern.p;
  g.fillRect(0, Math.round(y), Math.round(w), Math.round(h));
}

const weaponName = (id: string) => WEAPON_BY_ID.get(id)?.name ?? EQUIPMENT_BY_ID.get(id)?.name ?? KILLSTREAK_BY_ID.get(id)?.name ?? id.replace(/_/g, ' ');
const attachmentName = (id: string) => ATTACHMENT_BY_ID.get(id)?.name ?? id.replace(/_/g, ' ');

/** The killer card (BO1 playercard + weapon): badge, name, rank, weapon + attachments, health. */
function drawCard(g: CanvasRenderingContext2D, m: Match, d: DeathcamPayload, W: number, y: number, u: number): void {
  const L = cardLines(d.card, { weapon: weaponName, attachment: attachmentName, rank: (l) => rankFor(l).title });
  const cw = Math.min(W - 16 * u, 230 * u);
  const ch = 40 * u;
  const x = Math.round(W / 2 - cw / 2);
  txt(g, 'KILLED BY', W / 2, y - 10 * u, 8, C.paper, 'center', u);
  rect(g, x - u, y - u, cw + 2 * u, ch + 2 * u, C.ink);
  rect(g, x, y, cw, ch, '#26221e');
  rect(g, x, y, cw, 2 * u, d.card.prestige > 0 ? C.hi : C.dim);
  const px = badgePixels(d.card.level, d.card.prestige);
  const n = Math.round(Math.sqrt(px.length));
  const scale = Math.max(1, Math.floor((28 * u) / n));
  drawPixels(g, px, x + 5 * u, y + 6 * u, scale);
  const tx = x + 5 * u + n * scale + 6 * u;
  const name = (d.card.name || m.nameOf(d.killer)).toUpperCase();
  txt(g, name, tx, y + 5 * u, 8, C.enemy, 'left', u);
  txt(g, L.rank, tx, y + 15 * u, 6, C.dim, 'left', u);
  // Health bar.
  const bw = Math.max(30 * u, Math.min(70 * u, cw * 0.3));
  rect(g, tx, y + 27 * u, bw, 4 * u, C.ink);
  rect(g, tx + u, y + 28 * u, Math.round((bw - 2 * u) * L.healthFrac), 2 * u, L.healthFrac > 0.5 ? '#6ad04a' : L.healthFrac > 0.25 ? C.hi : C.health);
  txt(g, L.health, tx + bw + 4 * u, y + 26 * u, 6, C.paper, 'left', u);
  // Weapon (right side).
  const rx = x + cw - 6 * u;
  txt(g, L.weapon + (d.headshot ? ' · HEADSHOT' : ''), rx, y + 5 * u, 8, C.hi, 'right', u);
  if (L.attachments) {
    let a = L.attachments;
    while (a.length > 4 && textWidth(g, a, 6, u) > cw * 0.45) a = `${a.slice(0, -2)}`;
    txt(g, a === L.attachments ? a : `${a}…`, rx, y + 15 * u, 6, C.paper, 'right', u);
  }
  if (d.card.streak > 1) txt(g, `${d.card.streak} KILL STREAK`, rx, y + 26 * u, 6, C.dim, 'right', u);
}

registerHudWidget(
  'modes.deathcam',
  (g, W, H) => {
    const m = currentMatch();
    const d = S.d;
    if (!m || !d || m.alive || !m.death || m.phase !== 'playing') return;
    const u = unit(H);
    if (!S.playing) {
      // No replay (no room before the respawn, or a kill with nothing to watch): the card only.
      if (d.view === 'none' || !S.frames.length) drawCard(g, m, d, W, H - 52 * u, u);
      return;
    }
    const top = Math.round(H * 0.13);
    band(g, 0, W, top);
    txt(g, 'KILLCAM', W / 2, Math.max(2 * u, top / 2 - 11 * u), 16, C.paper, 'center', u);
    txt(g, killcamTimer(S.left), W / 2, top / 2 + 7 * u, 8, C.paper, 'center', u);
    const bottom = 66 * u;
    band(g, H - bottom, W, bottom);
    drawCard(g, m, d, W, H - bottom + 18 * u, u);
    txt(g, `PRESS ${promptKey('skip', { brackets: true })} TO SKIP`, W / 2, H - bottom - 14 * u, 8, C.paper, 'center', u);
  },
  94,
);

