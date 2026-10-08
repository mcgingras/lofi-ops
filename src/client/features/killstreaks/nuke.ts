/**
 * Tactical Nuke on the client: the caller's laptop in first person, the countdown HUD for everyone
 * (friendly / enemy lines), the siren, then the white flash through the post pass
 * (`renderer.white`), slow motion (mouse look slows with the server's movement), camera shake, the
 * low-poly mushroom cloud on the horizon with its shockwave ring, and the boom. The match summary
 * that follows shows "TACTICAL NUKE" as the reason (modes summary). Maths: nuke-logic.ts.
 *
 * Sounds reuse existing ids (no new files while the sound rework is in flight): `ks_alarm` slowed
 * down as a low siren once per countdown second, `ks_bigboom` slowed right down for the detonation
 * and again, a little higher, when the shockwave reaches you.
 */
import * as THREE from 'three';
import { KS_ENTITY } from '../../../shared/defs/killstreaks';
import { NUKE, nukeWhite } from '../../../shared/defs/nuke';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { blink, txt, unit, HUD_COLORS as C } from '../../hud/draw';
import { registerEntityRenderer, registerHudWidget, registerMatchHook } from '../../registry';
import { makeLookMaterial, setDynLight, type LookMaterial } from '../../render/shader';
import { getTexture, unbindTexture } from '../../render/textures';
import { currentMatch } from '../../state';
import { findNuke, laptopPose, nukeFrame, nukeLines, nukeSide, sirenTick, type NukeFrame, type NukeInfo, type NukeSide } from './nuke-logic';

/** What the HUD and the cloud read this frame. */
export const nukeClient = {
  info: null as NukeInfo | null,
  frame: null as NukeFrame | null,
  side: 'enemy' as NukeSide,
  prevT: -1,
  boomed: false,
  hit: false,
  /** Room time the blast killed me (the white-out follows my real death, not just my distance). */
  diedAt: null as number | null,
};

function reset(): void {
  nukeClient.info = null;
  nukeClient.frame = null;
  nukeClient.prevT = -1;
  nukeClient.boomed = false;
  nukeClient.hit = false;
  nukeClient.diedAt = null;
}

// ---------------------------------------------------------------------------------------------
// The caller's laptop (first person, drawn over the world like the radio)
// ---------------------------------------------------------------------------------------------

class FirstPersonLaptop {
  private group: THREE.Group | null = null;
  private lid: THREE.Group | null = null;
  private base: THREE.Object3D[] = [];
  private lidParts: THREE.Object3D[] = [];
  private hand: THREE.Object3D | null = null;
  private screen: LookMaterial | null = null;
  private mats: LookMaterial[] = [];
  private readonly off = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.62, 0.18, 0));

  private build(): THREE.Group {
    const mk = (texture: string, o: { rep?: number; tint?: number; emissive?: number } = {}) => {
      const m = makeLookMaterial({ texture, dyn: true, ...o });
      m.depthTest = false; // never clips into a wall you stand against
      this.mats.push(m);
      return m;
    };
    const olive = mk('ks_olive', { rep: 0.2 });
    const dark = mk('rubber', { rep: 0.1, tint: 0x4a4c44 });
    const keys = mk('ks_dark', { rep: 0.05 });
    this.screen = mk('ks_laptop', { emissive: 1 });
    const glove = mk('glove', { rep: 0.25, tint: 0xb8aa90 });
    const sleeve = mk('ks_olive', { rep: 0.2, tint: 0x9aa080 });
    const g = new THREE.Group();
    const box = (parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.frustumCulled = false;
      parent.add(mesh);
      return mesh;
    };
    // Rugged case: base with a keyboard and a red arming key, rubber corner bumpers.
    this.base.push(box(g, 0.3, 0.028, 0.21, olive, 0, 0, 0));
    this.base.push(box(g, 0.26, 0.004, 0.12, keys, 0, 0.016, 0.02));
    this.base.push(box(g, 0.03, 0.008, 0.02, mk('ks_glass', { emissive: 1, tint: 0xff4a3a }), 0.09, 0.019, 0.075));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.base.push(box(g, 0.03, 0.034, 0.03, dark, sx * 0.145, 0, sz * 0.1));
    // Lid on a hinge at the back edge; the screen is its inner face.
    const lid = new THREE.Group();
    lid.position.set(0, 0.014, -0.105);
    g.add(lid);
    this.lidParts.push(box(lid, 0.3, 0.018, 0.21, olive, 0, 0.009, 0.105));
    this.lidParts.push(box(lid, 0.25, 0.002, 0.16, this.screen, 0, -0.001, 0.105));
    this.lid = lid;
    // Gloved right hand reaching for the key.
    const hand = new THREE.Group();
    box(hand, 0.07, 0.04, 0.09, glove, 0, 0, 0);
    box(hand, 0.08, 0.07, 0.22, sleeve, 0.02, 0.0, 0.15);
    hand.position.set(0.1, 0.045, 0.1);
    hand.rotation.set(0.15, -0.3, 0);
    g.add(hand);
    this.hand = hand;
    g.frustumCulled = false;
    return g;
  }

  update(m: Match, pose: { raise: number; lid: number; press: number } | null): boolean {
    if (!pose || pose.raise <= 0.001) {
      if (this.group) this.group.visible = false;
      return false;
    }
    if (!this.group) this.group = this.build();
    if (this.group.parent !== m.renderer.scene) m.renderer.scene.add(this.group);
    this.group.visible = true;
    const open = pose.lid * 1.85;
    this.lid!.rotation.x = -open;
    // Without depth testing, draw order is the occlusion: a closed lid lies on the base, an open one stands behind it.
    const lidFirst = open > Math.PI / 2;
    this.base.forEach((o, i) => (o.renderOrder = 910 + i + (lidFirst ? 10 : 0)));
    this.lidParts.forEach((o, i) => (o.renderOrder = 910 + i + (lidFirst ? 0 : 20)));
    this.hand!.traverse((o) => (o.renderOrder = 940));
    this.hand!.position.y = 0.045 - 0.02 * pose.press;
    if (this.screen) this.screen.uniforms.uTint.value.setHex(pose.press > 0.2 ? 0xff9a8a : 0xffffff);
    const cam = m.renderer.cam;
    cam.updateMatrixWorld();
    this.off.set(0.02, -0.5 + 0.2 * pose.raise, -0.42);
    this.group.position.copy(this.off).applyMatrix4(cam.matrixWorld);
    this.group.quaternion.copy(cam.getWorldQuaternion(this.q)).multiply(this.tilt);
    if (m.map) setDynLight(this.mats, m.map.lightAt(cam.position.x, cam.position.y, cam.position.z));
    return true;
  }

  dispose(): void {
    if (!this.group) return;
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const mat of this.mats) {
      unbindTexture(mat);
      mat.dispose();
    }
    this.mats = [];
    this.base = [];
    this.lidParts = [];
    this.group = null;
  }
}

const laptop = new FirstPersonLaptop();

// ---------------------------------------------------------------------------------------------
// Per frame: flash, slow motion, shake, sounds, laptop
// ---------------------------------------------------------------------------------------------

registerMatchHook('killstreaks.nuke', {
  start(m) {
    reset();
    return () => {
      m.renderer.white = 0;
      laptop.dispose();
      reset();
    };
  },
  frame(m) {
    const snap = m.net.lastSnap;
    if (snap) nukeClient.info = findNuke(snap.ents);
    const info = nukeClient.info;
    if (!info) {
      nukeClient.frame = null;
      m.renderer.white = 0;
      laptop.update(m, null);
      return;
    }
    const t = m.serverTime;
    const cam = m.renderer.cam;
    const f = nukeFrame(t, info, Math.hypot(cam.position.x - info.blast.x, cam.position.z - info.blast.z));
    nukeClient.frame = f;
    nukeClient.side = nukeSide(info, m.myId, m.myTeam);
    // Killed by the blast: no "killed by / respawn in" card (nobody respawns), just the white-out.
    if (m.death?.weapon === NUKE.id) {
      nukeClient.diedAt ??= t;
      m.death = null;
    }
    if (nukeClient.diedAt !== null && f.since >= 0 && f.over <= 0) {
      f.hitSince = Math.max(f.hitSince, t - nukeClient.diedAt);
      f.white = Math.max(f.white, nukeWhite(f.since, f.hitSince));
    }
    m.renderer.white = f.white;
    if (f.shake > 0) {
      cam.rotation.x += (Math.random() - 0.5) * 2 * f.shake;
      cam.rotation.z += (Math.random() - 0.5) * 2 * f.shake;
    }
    m.controls.lookScale *= f.timeScale;
    if (sirenTick(nukeClient.prevT, t, info.times) !== null) sfx.play('modes.beep', { volume: 0.7 });
    if (f.since >= 0 && !nukeClient.boomed) {
      nukeClient.boomed = true;
      if (f.since < 1.5) sfx.play('ks_bigboom', { volume: 2.2, rate: 0.9, lowpass: 900 });
    }
    if (f.since >= 0 && f.hitSince >= 0 && !nukeClient.hit) {
      nukeClient.hit = true;
      if (f.hitSince < 1) sfx.play('ks_bigboom', { volume: 2, rate: 0.94, lowpass: 2200 });
    }
    nukeClient.prevT = t;
    if (laptop.update(m, f.laptop >= 0 && nukeClient.side === 'mine' && m.alive ? laptopPose(f.laptop) : null)) m.viewmodel.visible = false;
  },
});

// ---------------------------------------------------------------------------------------------
// HUD: the countdown everyone sees
// ---------------------------------------------------------------------------------------------

registerHudWidget(
  'killstreaks.nuke',
  (g, W, H) => {
    const m = currentMatch();
    const f = nukeClient.frame;
    const info = nukeClient.info;
    if (!m || !f || !info || m.phase === 'ended') return;
    const u = unit(H);
    const cx = W / 2;
    if (f.phase === 'arming') {
      if (nukeClient.side === 'mine') txt(g, 'ARMING TACTICAL NUKE...', cx, H * 0.3, 8, C.hi, 'center', u);
      return;
    }
    if (f.phase !== 'countdown') return;
    const side = nukeClient.side;
    const col = side === 'enemy' ? C.enemy : C.friend;
    const { head, line } = nukeLines(side, f.number, m.nameOf(info.owner));
    const y = H * 0.3;
    txt(g, head, cx, y, 16, blink(m.time, 0.5, 0.32) ? C.warn : C.paper, 'center', u);
    txt(g, String(f.number), cx, y + 20 * u, 32, C.paper, 'center', u);
    if (line) txt(g, line, cx, y + 58 * u, 8, col, 'center', u);
  },
  86,
);

// ---------------------------------------------------------------------------------------------
// The mushroom cloud (entity at the blast point off the map edge)
// ---------------------------------------------------------------------------------------------

const HOT = new THREE.Color(0xfff8e0);
const FIRE = new THREE.Color(0xffa050);
const ASH = new THREE.Color(0xd8ccc0);
const SOOT = new THREE.Color(0x8a7c70);
const tmp = new THREE.Color();
/** Tints above 1 brighten the (mid-grey) smoke texture: the cloud glows against the sky. */
const GLOW = 1.45;

/** Tint for a part `since` seconds after the blast: white-hot, then fire, then ash (`hot` keeps more fire, `soot` darkens). */
function cloudTint(target: THREE.Color, since: number, hot: number, soot = 0): void {
  const k1 = Math.min(1, since / 1.4);
  const k2 = Math.min(1, Math.max(0, (since - 1.0) / (3 + hot * 4)));
  target.copy(HOT).lerp(FIRE, k1);
  target.lerp(tmp.copy(ASH).lerp(SOOT, soot).lerp(FIRE, hot * 0.5), k2).multiplyScalar(GLOW);
}

registerEntityRenderer(KS_ENTITY.nuke, (_e, m) => {
  const root = new THREE.Group();
  const mats: LookMaterial[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mat = (rep: number) => {
    const mm = makeLookMaterial({ texture: 'ks_cloud', dyn: true, fog: false, emissive: 1, rep, snap: false });
    mats.push(mm);
    return mm;
  };
  const mesh = (geo: THREE.BufferGeometry, mm: THREE.Material) => {
    geos.push(geo);
    const o = new THREE.Mesh(geo, mm);
    o.frustumCulled = false;
    root.add(o);
    return o;
  };
  // Unit-sized parts, scaled by growth each frame (`rep` < 1: the smoke texture repeats across each part).
  const capMat = mat(0.25);
  const crownMat = mat(0.3);
  const ringMat = mat(0.2);
  const stemMat = mat(0.34);
  const skirtMat = mat(0.25);
  const baseMat = mat(0.2);
  const waveMat = makeLookMaterial({ texture: 'ks_cloud', dyn: true, fog: false, emissive: 1, rep: [0.025, 0.5], snap: false });
  mats.push(waveMat);
  const cap = mesh(new THREE.IcosahedronGeometry(1, 1), capMat);
  const crown = mesh(new THREE.IcosahedronGeometry(1, 1), crownMat);
  const ring = mesh(new THREE.TorusGeometry(1, 0.32, 5, 12), ringMat);
  ring.rotation.x = Math.PI / 2;
  const stem = mesh(new THREE.CylinderGeometry(0.62, 1, 1, 8, 3, true), stemMat);
  stemMat.side = THREE.DoubleSide;
  const skirt = mesh(new THREE.TorusGeometry(1, 0.12, 4, 14), skirtMat);
  skirt.rotation.x = Math.PI / 2;
  const base = mesh(new THREE.IcosahedronGeometry(1, 1), baseMat);
  const wave = mesh(new THREE.CylinderGeometry(1, 1, 1, 32, 1, true), waveMat);
  waveMat.side = THREE.DoubleSide;
  const flashMat = new THREE.SpriteMaterial({ map: getTexture('flash'), color: 0xffffff, alphaTest: 0.5, depthWrite: false, depthTest: false, fog: false });
  const flash = new THREE.Sprite(flashMat);
  flash.frustumCulled = false;
  root.add(flash);
  root.visible = false;

  return {
    object: root,
    update(e) {
      const info = nukeClient.info;
      const f = nukeClient.frame;
      if (!info || info.entity !== e.id || !f || f.since < 0) {
        root.visible = false;
        return;
      }
      root.visible = true;
      const s = f.since;
      const g = f.cloud;
      // Proportions (metres) at full growth: cap ~125 m across at ~190 m up, base dust ~160 m across
      // (from the map, ~150-250 m away, it fills a good part of the sky as in MW2).
      const capY = 20 + 170 * g;
      const capR = 16 + 46 * g;
      cap.position.y = capY;
      cap.scale.set(capR, capR * (0.62 - 0.08 * g), capR);
      cap.rotation.y = s * 0.05;
      crown.position.y = capY + capR * 0.3;
      crown.scale.set(capR * 0.72, capR * 0.4, capR * 0.72);
      crown.rotation.y = -s * 0.04;
      ring.position.y = capY - capR * 0.32;
      ring.scale.setScalar(capR * 0.86);
      ring.rotation.z = s * 0.12;
      const stemH = Math.max(1, capY - capR * 0.35);
      stem.position.y = stemH / 2;
      stem.scale.set(8 + 9 * g, stemH, 8 + 9 * g);
      skirt.position.y = stemH * 0.58;
      skirt.scale.setScalar((16 + 14 * g) * Math.min(1, Math.max(0, (s - 0.8) / 2)) + 0.01);
      skirt.visible = s > 0.8;
      base.position.y = 0;
      base.scale.set(30 + 50 * g, 10 + 14 * g, 30 + 50 * g);
      // Shockwave: a dust wall rolling out from the blast, reaching each distance when shockAt says so.
      const t = info.times;
      const k = (s - NUKE.shockDelaySec) / NUKE.shockSpreadSec;
      const r = s < NUKE.shockDelaySec ? t.n * (s / NUKE.shockDelaySec) : t.n + (t.f - t.n) * k;
      wave.visible = k < 1.6;
      wave.scale.set(Math.max(1, r), 7 + 3 * Math.min(1, s), Math.max(1, r));
      wave.position.y = 3;
      // Colours: white-hot, fire, then ash; the cap's underside ring and the stem keep their glow longer.
      cloudTint(capMat.uniforms.uTint.value, s, 0.3, 0.15);
      cloudTint(crownMat.uniforms.uTint.value, s * 1.4, 0.05);
      cloudTint(ringMat.uniforms.uTint.value, s, 0.9);
      cloudTint(stemMat.uniforms.uTint.value, s, 0.6, 0.3);
      skirtMat.uniforms.uTint.value.setRGB(1.2, 1.18, 1.15);
      cloudTint(baseMat.uniforms.uTint.value, s, 0.15, 0.5);
      waveMat.uniforms.uTint.value.setRGB(1.0, 0.88, 0.72);
      // The flash: a huge white sprite for the first half second.
      flash.visible = s < 0.6;
      flash.position.y = 30;
      flash.scale.setScalar(160 + 240 * s);
      void m;
    },
    dispose() {
      for (const geo of geos) geo.dispose();
      for (const mm of mats) {
        unbindTexture(mm);
        mm.dispose();
      }
      flashMat.dispose();
    },
  };
});
