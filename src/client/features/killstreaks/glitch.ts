/**
 * Glitch killstreak, client side (rules in the server's streaks/glitch.ts, numbers in
 * shared/defs/glitch.ts). Driven by the `killstreaks.glitch` push (the glitches running now):
 *
 * - Glitched (I'm an enemy of a running Glitch's owner): the screen degrades into corrupted
 *   Full-PS1 static through the renderer (`glitch`: torn rows, half resolution, banding to a few
 *   levels with a Bayer dither, grain; `glitchBurst`: channel split and noise lines; heavy vertex
 *   snap and affine warp; `holdFrame`: dropped / held frames), the HUD tears and flickers with
 *   corrupted characters, the minimap reads NO SIGNAL (the server jams it and hides every blip),
 *   and radio static crackles in the bursts.
 * - The caller's side: glitched enemy soldiers jitter, flicker and trail colour-shifted ghosts,
 *   and their knocked-out hardware (entities with `s.st = 1`) jitters and blinks.
 * - Everyone: the synthesized call-in (`ks_glitch`) and the banner, "GLITCH DEPLOYED" for the
 *   caller's side, "ENEMY GLITCH — SYSTEMS CORRUPTED" for the glitched side.
 */
import * as THREE from 'three';
import { GLITCH, glitchHits, glitchStrength } from '../../../shared/defs/glitch';
import { KS_ENTITY } from '../../../shared/defs/killstreaks';
import type { EntitySnap } from '../../../shared/protocol';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import type { RemoteView } from '../../game/remotes';
import { blink, txt, unit, HUD_COLORS as C } from '../../hud/draw';
import { entityRenderers, onFeature, registerEntityRenderer, registerHudWidget, registerMatchHook, type EntityView } from '../../registry';
import { currentMatch } from '../../state';
import { glitchClient, hitting } from './glitch-state';
import { announce } from './store';

export { glitchClient, iAmGlitched } from './glitch-state';

/** Is this remote player shown glitched to me (glitched by a Glitch that doesn't hit me)? */
function shownGlitched(m: Match, v: RemoteView): boolean {
  return glitchClient.active.some((g) => g.until > m.serverTime && glitchHits(g, v.id, v.team) && !glitchHits(g, m.myId, m.myTeam));
}

onFeature('killstreaks.glitch', (d) => {
  const m = currentMatch();
  const before = new Set(glitchClient.active.map((g) => `${g.owner}|${g.until}`));
  glitchClient.active = Array.isArray(d?.active) ? d.active : [];
  if (!m) return;
  for (const g of glitchClient.active) {
    if (before.has(`${g.owner}|${g.until}`) || g.until <= m.serverTime) continue;
    // A new one: the call-in for everyone, the banner by side.
    const hitsMe = glitchHits(g, m.myId, m.myTeam);
    const text = hitsMe ? 'ENEMY GLITCH — SYSTEMS CORRUPTED' : 'GLITCH DEPLOYED';
    glitchClient.banner = { t: m.time, text, mine: !hitsMe };
    announce(hitsMe ? 'Enemy Glitch: systems corrupted' : g.owner === m.myId ? 'Glitch deployed' : 'Friendly Glitch deployed', hitsMe ? 'enemy' : 'friend');
    sfx.play('ks_glitch', { volume: hitsMe ? 0.8 : 0.6 });
  }
});

// ---------------------------------------------------------------------------------------------
// My screen
// ---------------------------------------------------------------------------------------------

const fx = { burstUntil: 0, burstLen: 1, holdUntil: 0, snapAt: 0, snap: 0, set: false };

function screen(m: Match, dt: number): void {
  const r = m.renderer;
  let s = 0;
  if (m.alive) for (const g of hitting(m, m.myId, m.myTeam)) s = Math.max(s, glitchStrength(m.serverTime, g.until));
  glitchClient.strength = s;
  if (s <= 0) {
    if (fx.set) {
      r.glitch = r.glitchBurst = r.snapBoost = r.warpBoost = 0;
      r.holdFrame = false;
      fx.set = false;
    }
    return;
  }
  fx.set = true;
  const now = m.time;
  const F = GLITCH.fx;
  // Bursts (channel split, noise lines, a crackle of static) and held frames, at random.
  if (now >= fx.burstUntil && Math.random() < dt / F.burstGap) {
    fx.burstLen = F.burstLen * (0.6 + Math.random() * 0.8);
    fx.burstUntil = now + fx.burstLen;
    if (Math.random() < 0.6) sfx.play('ks_static', { volume: 0.18 + 0.2 * s });
  }
  const burst = now < fx.burstUntil ? (fx.burstUntil - now) / fx.burstLen : 0;
  if (now >= fx.holdUntil + 0.15 && Math.random() < dt / F.holdGap) fx.holdUntil = now + F.holdMin + Math.random() * (F.holdMax - F.holdMin);
  // The vertex grid jumps a few times a second so vertices hop even when standing still.
  if (now >= fx.snapAt) {
    fx.snapAt = now + 0.06 + Math.random() * 0.12;
    fx.snap = F.vertexSnap * (0.6 + Math.random() * 0.8);
  }
  r.glitch = s;
  r.glitchBurst = Math.min(1, burst * s);
  r.snapBoost = fx.snap * s;
  r.warpBoost = s;
  r.holdFrame = now < fx.holdUntil;
}

// ---------------------------------------------------------------------------------------------
// Glitched enemies, as the caller's side sees them: jitter, flicker, colour-shifted ghost trail
// ---------------------------------------------------------------------------------------------

const GHOSTS = 3;
const GHOST_LIFE = 0.3;
const GHOST_EVERY = 0.08;
const GHOST_COLOURS = [0xff2bd6, 0x2bfff0, 0xff2bd6];

interface GhostTrail {
  soldier: RemoteView['soldier'];
  slots: { obj: THREE.Object3D | null; born: number; mat: THREE.MeshBasicMaterial; side: number }[];
  next: number;
  slot: number;
  jitter: THREE.Vector3;
  jitterAt: number;
  hidden: boolean;
}

const trails = new Map<string, GhostTrail>();

function ghostOf(root: THREE.Object3D, mat: THREE.Material): THREE.Object3D {
  const g = root.clone(true);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = mat;
      o.castShadow = false;
    } else if (o instanceof THREE.Sprite || o instanceof THREE.Points || o instanceof THREE.Line) o.visible = false;
  });
  g.matrixAutoUpdate = false;
  g.updateMatrixWorld(true);
  return g;
}

function dropTrail(id: string): void {
  const t = trails.get(id);
  if (!t) return;
  t.soldier.lie.visible = true;
  for (const s of t.slots) {
    s.obj?.removeFromParent();
    s.mat.dispose();
  }
  trails.delete(id);
}

function soldiers(m: Match, dt: number): void {
  const scene = m.renderer.scene;
  const now = m.time;
  for (const v of m.remotes.views.values()) {
    const on = v.alive && shownGlitched(m, v);
    let t = trails.get(v.id);
    if (t && (!on || t.soldier !== v.soldier)) {
      dropTrail(v.id);
      t = undefined;
    }
    if (!on) continue;
    if (!t) {
      t = {
        soldier: v.soldier,
        slots: Array.from({ length: GHOSTS }, (_, i) => ({ obj: null, born: -9, mat: new THREE.MeshBasicMaterial({ color: GHOST_COLOURS[i]!, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), side: i % 2 ? 1 : -1 })),
        next: 0,
        slot: 0,
        jitter: new THREE.Vector3(),
        jitterAt: 0,
        hidden: false,
      };
      trails.set(v.id, t);
    }
    const root = v.soldier.root;
    // Jitter and flicker in short slots.
    if (now >= t.jitterAt) {
      t.jitterAt = now + 0.04 + Math.random() * 0.05;
      const big = Math.random() < 0.12 ? 3 : 1;
      t.jitter.set((Math.random() - 0.5) * 0.12 * big, (Math.random() - 0.5) * 0.05 * big, (Math.random() - 0.5) * 0.12 * big);
      t.hidden = Math.random() < 0.1;
    }
    root.position.add(t.jitter);
    // Flicker the body (its one child group, so a killcam hiding the root still wins).
    v.soldier.lie.visible = !t.hidden;
    // A new ghost every GHOST_EVERY s from the body as it is now, shifted sideways a little.
    if (now >= t.next && root.visible) {
      t.next = now + GHOST_EVERY;
      const s = t.slots[t.slot]!;
      t.slot = (t.slot + 1) % GHOSTS;
      s.obj?.removeFromParent();
      root.updateMatrixWorld(true);
      const g = ghostOf(root, s.mat);
      const body = g.children[0];
      if (body) body.visible = true; // cloned mid-flicker
      const right = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw)).multiplyScalar(0.14 * s.side);
      g.position.copy(root.position).sub(t.jitter).add(right);
      g.updateMatrix();
      g.updateMatrixWorld(true);
      scene.add(g);
      s.obj = g;
      s.born = now;
    }
    for (const s of t.slots) {
      if (!s.obj) continue;
      const age = now - s.born;
      s.mat.opacity = Math.max(0, 0.55 * (1 - age / GHOST_LIFE));
      s.obj.visible = age < GHOST_LIFE && root.visible;
    }
  }
  for (const id of [...trails.keys()]) if (!m.remotes.views.has(id)) dropTrail(id);
  void dt;
}

// ---------------------------------------------------------------------------------------------
// Knocked-out hardware (`s.st = 1`): helicopters, planes, RC-XDs, dogs, rockets jitter and blink.
// Sentries and SAMs already show their stun (sparks, no lamp).
// ---------------------------------------------------------------------------------------------

function wrapStunned(kind: string): void {
  const orig = entityRenderers.get(kind);
  if (!orig) return;
  registerEntityRenderer(kind, (e: EntitySnap, match: Match): EntityView | null => {
    const view = orig(e, match);
    if (!view) return null;
    const outer = new THREE.Group();
    const mid = new THREE.Group();
    outer.add(mid);
    mid.add(view.object);
    let at = 0;
    return {
      object: outer,
      update(snap, dt, m) {
        const r = view.update?.(snap, dt, m);
        const now = m.time;
        if (snap.s?.st === 1) {
          if (now >= at) {
            at = now + 0.05 + Math.random() * 0.08;
            mid.position.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.5);
            mid.visible = Math.random() > 0.15;
          }
        } else if (at) {
          at = 0;
          mid.position.set(0, 0, 0);
          mid.visible = true;
        }
        if (r === false) {
          // The view placed itself in world space: keep the wrapper at the origin.
          outer.position.set(0, 0, 0);
          outer.rotation.set(0, 0, 0);
          return false;
        }
        return r;
      },
      dispose: () => view.dispose?.(),
    };
  });
}

for (const kind of [KS_ENTITY.heli, KS_ENTITY.gunner, KS_ENTITY.rcxd, KS_ENTITY.dog, KS_ENTITY.rocket, KS_ENTITY.uav, KS_ENTITY.counterUav, KS_ENTITY.blackbird]) wrapStunned(kind);

registerMatchHook('killstreaks.glitch', {
  start() {
    glitchClient.active = [];
    glitchClient.banner = null;
    glitchClient.strength = 0;
    for (const id of [...trails.keys()]) dropTrail(id);
    return () => {
      for (const id of [...trails.keys()]) dropTrail(id);
      const m = currentMatch();
      if (m && fx.set) {
        m.renderer.glitch = m.renderer.glitchBurst = m.renderer.snapBoost = m.renderer.warpBoost = 0;
        m.renderer.holdFrame = false;
      }
      fx.set = false;
    };
  },
  frame(m, dt) {
    glitchClient.active = glitchClient.active.filter((g) => g.until > m.serverTime - 1);
    screen(m, dt);
    soldiers(m, dt);
  },
});

// ---------------------------------------------------------------------------------------------
// HUD: the banner, and the corruption of everything drawn before it (tearing, flicker, garbage)
// ---------------------------------------------------------------------------------------------

const JUNK = '#%&@$!?*/\\<>=+';

function corrupt(s: string, k: number): string {
  let out = '';
  for (const ch of s) out += ch !== ' ' && Math.random() < k ? JUNK[Math.floor(Math.random() * JUNK.length)]! : ch;
  return out;
}

registerHudWidget(
  'killstreaks.glitchBanner',
  (g, W, H) => {
    const m = currentMatch();
    const b = glitchClient.banner;
    if (!m || !b) return;
    const age = m.time - b.t;
    if (age > 3.2) {
      glitchClient.banner = null;
      return;
    }
    const u = unit(H);
    const y = Math.round(H * 0.24);
    if (b.mine) {
      txt(g, b.text, W / 2, y, 16, blink(m.time, 0.5, 0.35) || age > 1.5 ? C.hi : C.paper, 'center', u);
    } else {
      // The glitched side's banner corrupts itself.
      const jx = (Math.random() - 0.5) * 6 * u;
      txt(g, corrupt(b.text, 0.12), W / 2 + jx, y, 12, Math.random() < 0.5 ? C.warn : '#ff2bd6', 'center', u);
    }
  },
  88,
);

registerHudWidget(
  'killstreaks.glitchHud',
  (g, W, H) => {
    const s = glitchClient.strength;
    const m = currentMatch();
    if (!m || s <= 0) return;
    const u = unit(H);
    const cv = g.canvas;
    // Flicker: now and then the whole HUD drops out for a frame.
    if (Math.random() < 0.06 * s) {
      g.clearRect(0, 0, W, H);
      return;
    }
    // Tearing: slices of the HUD jump sideways.
    const n = 2 + Math.floor(Math.random() * 5 * s);
    for (let i = 0; i < n; i++) {
      const y = Math.floor(Math.random() * H);
      const h = Math.max(u, Math.floor((2 + Math.random() * 10) * u));
      const dx = Math.round((Math.random() - 0.5) * 24 * u * s);
      g.drawImage(cv, 0, y, W, h, dx, y, W, h);
      if (Math.random() < 0.3) g.clearRect(dx > 0 ? 0 : W + dx, y, Math.abs(dx), h);
    }
    // Garbage glyphs scattered over where the HUD lives (corners and the middle band).
    const junk = Math.floor(Math.random() * 4 * s);
    for (let i = 0; i < junk; i++) {
      const x = Math.random() < 0.5 ? Math.random() * W * 0.3 : W * 0.7 + Math.random() * W * 0.3;
      const y = Math.random() < 0.5 ? Math.random() * H * 0.25 : H * 0.75 + Math.random() * H * 0.25;
      txt(g, corrupt('########', 0.8).slice(0, 2 + Math.floor(Math.random() * 6)), x, y, 8, Math.random() < 0.5 ? '#ff2bd6' : '#2bfff0', 'left', u);
    }
    if (blink(m.time, 0.9, 0.5)) txt(g, corrupt('SYSTEMS CORRUPTED', 0.15 * s), W / 2, H - 22 * u, 8, C.warn, 'center', u);
  },
  97,
);
