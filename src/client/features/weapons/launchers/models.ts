/**
 * Lo-fi models of the secondary launchers in the gun kit's style (boxes and 6-8 sided cylinders,
 * viewmodel units, muzzle along -z, receiver at the origin). Added to `GUNS`, so first person,
 * third person, dropped guns, the killcam viewmodel and the Create-a-Class preview all use them.
 *
 * - China Lake: a long barrel over the magazine tube, the pump fore-end that racks after each shot
 *   (`parts.pump`, the shell-by-shell feed animates the left hand), a ladder sight, a wooden stock.
 * - RPG-7: the steel tube with its wooden heat guard, flared venturi at the back, two grips, the
 *   PGO-7 optic box on the left, and the warhead on the front (`parts.mag`: it comes off for a
 *   reload and a fresh one goes on).
 * - M72 LAW: a short olive tube with end caps, pop-up sight frames, a trigger housing on top.
 * - Strela-3: a long olive tube, a ring sight, the thermal battery and grip unit underneath and the
 *   lock-on seeker's glass nose.
 * - Stinger: a tan tube with the big IFF antenna grid on the left, the sight box with its flip-up
 *   frame, the grip / battery coolant unit underneath.
 */
import * as THREE from 'three';
import { registerViewmodel } from '../../../render/models/viewmodels';
import { FURNITURE, GUNS, type GunBuild, type Kit } from '../gunkit';
import { buildWeaponViewmodel } from '../viewmodels';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function chinaLake(k: Kit): GunBuild {
  const { M } = k;
  k.box(0.07, 0.095, 0.26, M.body, 0, 0, 0.02); // receiver
  const tip = k.barrel(-0.11, 0.52, 0.026, 0.025); // the big bore
  k.cyl(0.032, 0.03, M.metal, 0, 0.025, tip + 0.015, 8); // muzzle ring
  k.cyl(0.022, 0.42, M.metal, 0, -0.035, -0.32, 6); // magazine tube
  k.cyl(0.024, 0.02, M.poly, 0, -0.035, -0.53, 6);
  const pump = k.group(0, -0.035, -0.27);
  k.cyl(0.038, 0.18, M.furn, 0, 0, 0, 8, pump);
  for (let i = 0; i < 4; i++) k.cyl(0.04, 0.008, M.poly, 0, 0, -0.06 + i * 0.04, 8, pump);
  // Ladder sight flipped up and a front post.
  k.box(0.006, 0.07, 0.03, M.metal, 0.03, 0.08, -0.04);
  k.box(0.03, 0.006, 0.006, M.metal, 0.03, 0.105, -0.04);
  k.frontPost(tip + 0.06, 0.09, 0.05);
  k.rearSight(0.06, 0.08);
  k.pistolGrip(0.13, -0.047, M.furn);
  k.stock(0.15, 0.32, 0.0, 0.1, M.furn, 0.035);
  return { muzzle: V(0, 0.025, tip - 0.02), sightY: 0.075, adsZ: -0.44, grip: V(0.005, -0.11, 0.15), fore: V(-0.012, -0.06, -0.27), parts: { pump }, pistol: false };
}

function rpg(k: Kit): GunBuild {
  const { M } = k;
  const y = 0.03;
  k.cyl(0.034, 0.82, M.body, 0, y, -0.02, 8); // the tube
  k.cyl(0.046, 0.26, M.furn, 0, y, -0.02, 8); // heat guard
  for (const z of [-0.14, 0.1]) k.cyl(0.048, 0.012, M.metal, 0, y, z, 8);
  k.cyl(0.034, 0.12, M.metal, 0, y, 0.44, 8, k.root, 'z', 0.06); // flared venturi
  k.cyl(0.05, 0.006, M.poly, 0, y, 0.5, 8);
  // Two grips and the trigger.
  k.pistolGrip(0.06, y - 0.035, M.wood, -0.2);
  k.box(0.035, 0.1, 0.04, M.wood, 0, y - 0.09, -0.22, -0.1);
  // PGO-7 optic on the left, iron sights on top.
  k.box(0.03, 0.06, 0.14, M.olive, -0.065, y + 0.04, 0.02);
  k.cyl(0.018, 0.04, M.poly, -0.065, y + 0.05, 0.11, 6);
  k.cyl(0.016, 0.006, M.lens, -0.065, y + 0.05, -0.052, 6);
  k.box(0.012, 0.05, 0.012, M.metal, 0, y + 0.06, -0.36);
  k.box(0.03, 0.03, 0.02, M.metal, 0, y + 0.05, -0.02);
  // The warhead: booster, body and the nose cone (comes off on a reload).
  const mag = k.group(0, y, -0.43);
  k.cyl(0.026, 0.12, M.olive, 0, 0, -0.04, 6, mag);
  k.cyl(0.07, 0.07, M.olive, 0, 0, -0.13, 8, mag);
  k.cyl(0.024, 0.18, M.olive, 0, 0, -0.25, 8, mag, 'z', 0.07);
  k.cyl(0.012, 0.03, M.metal, 0, 0, -0.35, 6, mag);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = k.box(0.004, 0.035, 0.05, M.metal, Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0.01, 0, 0, 0, mag);
    fin.rotation.z = a - Math.PI / 2;
  }
  return { muzzle: V(0, y, -0.8), sightY: y + 0.085, adsZ: -0.46, grip: V(0.005, -0.08, 0.08), fore: V(-0.012, -0.07, -0.22), parts: { mag }, pistol: false };
}

function law(k: Kit): GunBuild {
  const { M } = k;
  const y = 0.02;
  k.cyl(0.036, 0.66, M.furn, 0, y, -0.06, 8); // tube
  k.cyl(0.042, 0.04, M.poly, 0, y, -0.39, 8); // front cap
  k.cyl(0.042, 0.04, M.poly, 0, y, 0.27, 8); // rear cap
  for (const z of [-0.2, 0.08]) k.cyl(0.039, 0.01, M.tan, 0, y, z, 8); // bands
  // Pop-up sight frames and the trigger housing on top.
  k.box(0.004, 0.05, 0.004, M.metal, -0.018, y + 0.06, -0.3);
  k.box(0.004, 0.05, 0.004, M.metal, 0.018, y + 0.06, -0.3);
  k.box(0.04, 0.004, 0.004, M.metal, 0, y + 0.085, -0.3);
  k.box(0.035, 0.035, 0.012, M.metal, 0, y + 0.055, 0.12);
  k.box(0.026, 0.024, 0.11, M.olive, 0, y + 0.048, -0.02);
  k.box(0.012, 0.025, 0.02, M.red, 0, y + 0.066, -0.05);
  k.box(0.03, 0.06, 0.05, M.olive, 0, y - 0.065, 0.05, -0.15); // hand stop
  return { muzzle: V(0, y, -0.42), sightY: y + 0.072, adsZ: -0.42, grip: V(0.005, -0.08, 0.06), fore: V(-0.012, -0.05, -0.2), parts: {}, pistol: false };
}

function strela(k: Kit): GunBuild {
  const { M } = k;
  const y = 0.03;
  k.cyl(0.038, 0.98, M.furn, 0, y, -0.07, 8);
  k.cyl(0.044, 0.05, M.poly, 0, y, 0.42, 8);
  k.cyl(0.03, 0.04, M.lens, 0, y, -0.58, 8, k.root, 'z', 0.038); // seeker nose
  // Ring sight on posts at the front, a peep at the back.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 4, 10), M.metal);
  ring.position.set(0, y + 0.08, -0.34);
  k.root.add(ring);
  k.box(0.006, 0.05, 0.006, M.metal, 0, y + 0.05, -0.34);
  k.box(0.02, 0.03, 0.02, M.metal, 0, y + 0.06, 0.02);
  // Grip unit with the thermal battery hanging in front.
  k.box(0.05, 0.05, 0.16, M.poly, 0, y - 0.06, -0.02);
  k.pistolGrip(0.04, y - 0.08, M.poly, -0.25);
  k.cyl(0.022, 0.12, M.metal, 0, y - 0.1, -0.13, 6, k.root, 'y');
  k.box(0.012, 0.012, 0.012, M.red, 0.03, y - 0.05, -0.06);
  return { muzzle: V(0, y, -0.62), sightY: y + 0.08, adsZ: -0.44, grip: V(0.005, -0.1, 0.06), fore: V(-0.012, -0.08, -0.13), parts: {}, pistol: false };
}

function stinger(k: Kit): GunBuild {
  const { M } = k;
  const y = 0.03;
  k.cyl(0.04, 0.92, M.furn, 0, y, -0.06, 8);
  k.cyl(0.046, 0.05, M.poly, 0, y, 0.4, 8);
  k.cyl(0.046, 0.04, M.poly, 0, y, -0.5, 8);
  // IFF antenna: a grid of thin bars on a stalk, out to the left.
  k.box(0.08, 0.012, 0.012, M.metal, -0.06, y + 0.02, -0.2);
  for (let i = 0; i < 4; i++) k.box(0.004, 0.11, 0.004, M.poly, -0.1 - i * 0.012, y + 0.02, -0.2);
  for (let j = 0; j < 4; j++) k.box(0.05, 0.004, 0.004, M.poly, -0.118, y - 0.03 + j * 0.033, -0.2);
  // Sight box with a flip-up frame, the gripstock and battery coolant unit.
  k.box(0.035, 0.04, 0.1, M.poly, 0, y + 0.055, -0.08);
  k.box(0.04, 0.004, 0.004, M.metal, 0, y + 0.11, -0.14);
  k.box(0.004, 0.035, 0.004, M.metal, -0.018, y + 0.093, -0.14);
  k.box(0.004, 0.035, 0.004, M.metal, 0.018, y + 0.093, -0.14);
  k.box(0.05, 0.05, 0.2, M.poly, 0, y - 0.065, -0.04);
  k.pistolGrip(0.05, y - 0.085, M.poly, -0.25);
  k.cyl(0.025, 0.1, M.metal, 0, y - 0.1, -0.16, 6, k.root, 'y');
  return { muzzle: V(0, y, -0.54), sightY: y + 0.11, adsZ: -0.44, grip: V(0.005, -0.1, 0.07), fore: V(-0.012, -0.085, -0.16), parts: {}, pistol: false };
}

export const LAUNCHER_GUNS = { china_lake: chinaLake, rpg, m72law: law, strela, stinger } as const;

for (const [id, build] of Object.entries(LAUNCHER_GUNS)) {
  GUNS[id] = (k) => build(k);
  FURNITURE[id] = id === 'china_lake' || id === 'rpg' ? 'wood' : id === 'stinger' ? 'tan' : 'olive';
  registerViewmodel(id, (c) => buildWeaponViewmodel(c, id));
}
