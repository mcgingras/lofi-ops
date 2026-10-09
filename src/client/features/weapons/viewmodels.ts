/**
 * First-person viewmodels for every weapon (replacing core's two prototype builders): the gun from
 * the kit, gloved hands and sleeves, a knife hand and a throwing hand for the melee / throw / hold
 * actions (`actionHands`, also used by the wager weapons),
 * and per-family animation: magazine swaps, bolt cycling (L96A1), pump racks (Stakeout, SPAS-12),
 * shell-by-shell loading, break-action (Olympia), revolver cylinder, pistol slides.
 */
import * as THREE from 'three';
import { WEAPONS, type WeaponDef } from '../../../shared/defs/weapons';
import { registerViewmodel, type ViewmodelAnimState, type ViewmodelCtx, type ViewmodelSpec } from '../../render/models/viewmodels';
import { FURNITURE, GUNS, grenadeMesh, Kit, knifeMesh, tomahawkMesh, type GunBuild } from './gunkit';

const UP = new THREE.Vector3(0, 1, 0);
const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI));
const ramp = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));

const defForModel = (model: string): WeaponDef | undefined => WEAPONS.find((w) => w.model === model);

/** A box stretched between two points (sleeves). */
function bar(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, mat: THREE.Material): THREE.Mesh {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, h), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  parent.add(m);
  return m;
}

function hand(parent: THREE.Object3D, at: THREE.Vector3, shoulder: THREE.Vector3, glove: THREE.Material, sleeve: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(at);
  parent.add(g);
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.12), glove);
  g.add(m);
  bar(g, new THREE.Vector3(0, -0.02, 0.05), shoulder.clone().sub(at), 0.11, 0.11, sleeve);
  return g;
}

/**
 * Knife hand and throwing hand for the viewmodel actions, shared by every weapon viewmodel (the
 * wager crossbow / ballistic knife use it too). Returns the per-frame animator; `gunRoot` is the
 * group that holds the gun (lowered while an action plays).
 *
 * Actions: 'melee'; 'throw' (a quick grenade toss); 'ready:<equipment>' (raise and hold it up:
 * played with `hold`, so it stays cocked while the button is down); 'release:<equipment>' (the
 * throw itself, from the cocked pose). A tomahawk shows a hatchet in the hand, anything else a
 * grenade.
 */
export function actionHands(c: ViewmodelCtx, gunRoot: THREE.Object3D, hip: THREE.Vector3, glove = c.mat('glove'), sleeve = c.mat('camo', { rep: 0.4 })): (s: ViewmodelAnimState) => void {
  const knifeRig = new THREE.Group();
  c.group.add(knifeRig);
  const kk = new Kit(knifeRig, (t, o) => c.mat(t, o), null);
  const knife = new THREE.Group();
  knife.position.set(0, 0.03, -0.02);
  knifeRig.add(knife);
  knifeMesh(kk, knife);
  hand(knifeRig, new THREE.Vector3(0, 0, 0.04), new THREE.Vector3(0.1, -0.25, 0.6), glove, sleeve);
  knifeRig.visible = false;
  const nadeRig = new THREE.Group();
  c.group.add(nadeRig);
  const nade = new THREE.Group();
  nade.position.set(0, 0.06, -0.02);
  nadeRig.add(nade);
  grenadeMesh(kk, nade, c.mat('weapons.nadegreen', { rep: 0.1 }));
  const hawk = new THREE.Group();
  hawk.position.set(0, 0.02, -0.01);
  nadeRig.add(hawk);
  tomahawkMesh(kk, hawk);
  hand(nadeRig, new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.2, -0.3, 0.6), glove, sleeve);
  nadeRig.visible = false;
  const base = { pos: gunRoot.position.clone(), rot: gunRoot.rotation.clone() };

  return (s: ViewmodelAnimState) => {
    const act = s.action ?? '';
    const [kind, item] = act.split(':') as [string, string | undefined];
    const throwing = kind === 'throw' || kind === 'ready' || kind === 'release';
    knifeRig.visible = kind === 'melee';
    nadeRig.visible = throwing;
    gunRoot.position.copy(base.pos);
    gunRoot.rotation.copy(base.rot);
    if (kind === 'melee') {
      const t = s.actionT;
      const out = Math.min(ramp(t, 0, 0.15), 1 - ramp(t, 0.75, 1));
      gunRoot.position.set(base.pos.x + 0.1 * out, base.pos.y - 0.35 * out, base.pos.z);
      gunRoot.rotation.z = base.rot.z - 0.4 * out;
      // Knife: in from the right, slash across to the left.
      const sw = ramp(t, 0.15, 0.5);
      knifeRig.position.set(0.25 - 0.45 * sw - hip.x * (1 - s.ads), -0.05 - 0.1 * (1 - out) + 0.06 * Math.sin(sw * Math.PI), -0.12 - 0.15 * Math.sin(sw * Math.PI));
      knifeRig.rotation.set(-0.3, 0.9 - 1.6 * sw, -0.9 + 1.2 * sw);
      knifeRig.position.y -= (1 - out) * 0.3;
    } else if (throwing) {
      // One timeline for all three: 0-0.4 raise and cock, 0.42-0.62 toss, then drop away.
      const t = kind === 'ready' ? 0.4 * s.actionT : kind === 'release' ? 0.42 + 0.58 * s.actionT : s.actionT;
      const isHawk = item === 'tomahawk';
      hawk.visible = isHawk && t < 0.55;
      nade.visible = !isHawk && t < 0.55;
      const out = Math.min(ramp(t, 0, 0.15), 1 - ramp(t, 0.8, 1));
      gunRoot.position.set(base.pos.x + 0.05 * out, base.pos.y - 0.32 * out, base.pos.z + 0.05 * out);
      gunRoot.rotation.x = base.rot.x - 0.3 * out;
      const cock = ramp(t, 0.1, 0.4);
      const toss = ramp(t, 0.42, 0.62);
      // Held up: a slow breathing sway so it reads as "waiting to throw".
      const idle = kind === 'ready' && s.actionT >= 1 ? Math.sin(s.time * 2.2) * 0.008 : 0;
      if (isHawk) {
        // Hatchet raised beside the head, blade forward, then a whip forward.
        nadeRig.position.set(0.02 - hip.x * (1 - s.ads) * 0.5, -0.32 + 0.38 * cock - 0.12 * toss - 0.4 * ramp(t, 0.7, 1) + idle, -0.22 + 0.2 * cock - 0.4 * toss);
        nadeRig.rotation.set(-1.1 * cock + 2.2 * toss, -0.15, 0.25 - 0.2 * cock);
      } else {
        nadeRig.position.set(-0.12 - hip.x * (1 - s.ads) * 0.5, -0.32 + 0.3 * cock - 0.1 * toss - 0.4 * ramp(t, 0.7, 1) + idle, -0.25 + 0.15 * cock - 0.35 * toss);
        nadeRig.rotation.set(-0.6 * cock + 1.4 * toss, 0.2, 0.2);
      }
    }
  };
}

export function buildWeaponViewmodel(c: ViewmodelCtx, model: string): ViewmodelSpec {
  const def = defForModel(model);
  const gunRoot = new THREE.Group();
  c.group.add(gunRoot);
  const kit = new Kit(gunRoot, (t, o) => c.mat(t, o), c.camo, FURNITURE[model] ?? 'poly');
  const build: GunBuild = (GUNS[model] ?? GUNS.ak47!)(kit, c.attachments);
  const glove = c.mat('glove');
  const sleeve = c.mat('camo', { rep: 0.4 });

  // Hands. Shoulders sit behind and below the camera (group space).
  const rShoulder = new THREE.Vector3(0.12, -0.3, 0.6);
  const lShoulder = new THREE.Vector3(-0.3, -0.32, 0.55);
  const right = hand(gunRoot, build.grip, rShoulder, glove, sleeve);
  const left = build.parts.offhand ? null : hand(gunRoot, build.fore, lShoulder, glove, sleeve);
  if (build.parts.offhand) hand(build.parts.offhand, build.grip, rShoulder.clone().setX(-0.12), glove, sleeve);
  const leftHome = left?.position.clone() ?? new THREE.Vector3();
  const rightHome = right.position.clone();

  const pistol = build.pistol;
  const hip = pistol ? new THREE.Vector3(build.parts.offhand ? 0.16 : 0.14, -0.17, -0.34) : new THREE.Vector3(0.17, -0.21, -0.4);
  const actions = actionHands(c, gunRoot, hip, glove, sleeve);
  const ads = build.noAds ? hip.clone() : new THREE.Vector3(0, -build.sightY, build.adsZ);

  const p = build.parts;
  const magHome = p.mag?.position.clone();
  const pumpHome = p.pump?.position.clone();
  const slideHome = p.slide?.position.clone();
  const boltHome = p.bolt?.position.clone();
  const cylHome = p.cylinder?.position.clone();
  const cycle = def ? 60 / def.rpm : 0.5;
  const shell = def?.shellReload;
  let reloadStart = -1;
  let lastSince = 99;
  let cylTurn = 0;

  const animate = (s: ViewmodelAnimState) => {
    // Undo the rig's raise dip while an action runs: the action poses the gun itself.
    if (s.action && s.raise >= 0) {
      const raise = 1 - s.raise;
      c.group.position.y += raise * 0.25;
      c.group.rotation.x += raise * 0.6;
    }
    if (s.reload >= 0 && reloadStart < 0) reloadStart = s.time;
    if (s.reload < 0) reloadStart = -1;
    const r = s.reload;
    const shot = s.sinceShot < lastSince; // a new shot since last frame
    lastSince = s.sinceShot;

    // Magazine out and back in, the left hand following it.
    if (p.mag && magHome) {
      const d = r >= 0 ? bump(r, 0.12, 0.7) : 0;
      p.mag.position.set(magHome.x - d * 0.04, magHome.y - d * 0.32, magHome.z + d * 0.05);
      p.mag.rotation.x = d * 0.4;
      if (left) left.position.lerpVectors(leftHome, p.mag.position.clone().add(new THREE.Vector3(-0.02, -0.12, 0.02)), r >= 0 ? bump(r, 0.05, 0.85) : 0);
    }
    // Bolt action: lift, pull, push, drop after every shot and around a reload.
    if (p.bolt && boltHome) {
      let u = -1;
      if (s.sinceShot > 0.1 && s.sinceShot < Math.min(cycle, 1.3)) u = (s.sinceShot - 0.1) / (Math.min(cycle, 1.3) - 0.2);
      if (r >= 0) u = r < 0.2 ? r / 0.4 : r > 0.8 ? 0.5 + (r - 0.8) / 0.4 : 0.5;
      const lift = u < 0 ? 0 : Math.min(ramp(u, 0, 0.2), 1 - ramp(u, 0.8, 1));
      const pull = u < 0 ? 0 : Math.min(ramp(u, 0.2, 0.45), 1 - ramp(u, 0.55, 0.8));
      p.bolt.rotation.z = lift * 1.2;
      p.bolt.position.set(boltHome.x, boltHome.y, boltHome.z + pull * 0.09);
      const hk = u < 0 ? 0 : Math.min(ramp(u, 0, 0.12), 1 - ramp(u, 0.88, 1));
      right.position.lerpVectors(rightHome, p.bolt.position.clone().add(new THREE.Vector3(0.07, -0.02, 0.02)), hk);
    }
    // Pump: rack after each shot; during a shell reload the left hand feeds the loading port.
    if (p.pump && pumpHome) {
      const pumpT = def?.mode === 'pump' ? bump(s.sinceShot, 0.1, 0.1 + Math.min(0.6, cycle * 0.8)) : 0;
      const endPump = r >= 0 && shell ? bump(r, 0.86, 1) : 0;
      const k = Math.max(pumpT, endPump);
      p.pump.position.set(pumpHome.x, pumpHome.y, pumpHome.z + k * 0.09);
      if (left) {
        left.position.set(leftHome.x, leftHome.y, leftHome.z + k * 0.09);
        if (r >= 0 && shell && reloadStart >= 0) {
          const el = s.time - reloadStart - shell.startMs / 1000;
          const per = shell.perShellMs / 1000;
          const fed = el > 0 && r < 0.86 ? (el % per) / per : -1;
          if (fed >= 0) {
            const port = new THREE.Vector3(0.0, -0.08, 0.02);
            const reach = Math.sin(fed * Math.PI);
            left.position.lerpVectors(port.clone().add(new THREE.Vector3(-0.05, -0.08, 0.06)), port, reach);
          } else if (r < 0.86) left.position.lerpVectors(leftHome, new THREE.Vector3(-0.05, -0.16, 0.08), ramp(r, 0, 0.1));
        }
      }
    }
    // Break action.
    if (p.barrels) p.barrels.rotation.x = r >= 0 ? 0.55 * Math.min(ramp(r, 0.05, 0.25), 1 - ramp(r, 0.8, 0.95)) : 0;
    if (p.barrels && left && r >= 0) left.position.lerpVectors(leftHome, new THREE.Vector3(-0.03, -0.02, 0.05), bump(r, 0.3, 0.75));
    // Revolver: cylinder turns each shot, swings out to reload.
    if (p.cylinder && cylHome) {
      if (shot) cylTurn += Math.PI / 3;
      p.cylinder.rotation.z += (cylTurn - p.cylinder.rotation.z) * Math.min(1, s.dt * 30);
      const out = r >= 0 ? Math.min(ramp(r, 0.05, 0.2), 1 - ramp(r, 0.85, 0.95)) : 0;
      p.cylinder.position.set(cylHome.x - out * 0.05, cylHome.y - out * 0.01, cylHome.z);
    }
    // Pistol slide blowback.
    if (p.slide && slideHome) p.slide.position.z = slideHome.z + (s.sinceShot < 0.09 ? 0.035 * (1 - s.sinceShot / 0.09) : 0);
    if (p.offhand) p.offhand.position.y = s.sinceShot < 0.12 && Math.floor(s.time * 20) % 2 === 0 ? 0.01 : 0;

    actions(s);
  };

  return { muzzle: build.muzzle, hip, ads, reload: p.barrels || p.cylinder || p.pump ? 'none' : pistol ? 'drop' : 'tilt', animate };
}

for (const model of Object.keys(GUNS)) registerViewmodel(model, (c) => buildWeaponViewmodel(c, model));
