/**
 * Lo-fi models of the four wonder weapons in the gun kit's style (boxes and 6-8 sided cylinders,
 * viewmodel units, muzzle along -z, receiver at the origin). Added to `GUNS`, so first person,
 * third person, dropped guns, the killcam viewmodel and the Mystery Box's cycle all use them.
 *
 * - Ray Gun: brick-red pistol body, two glowing green tubes along the top, a chrome barrel ending
 *   in the flared emitter dish with fins and a green core, a round dial at the back.
 * - Thundergun: a fat dark-steel barrel ending in a turbine (stacked fan discs that spin a notch
 *   each blast, and a copper flare), coil housing at the back, copper pipes, two wooden grips; fired
 *   from the hip (no sights).
 * - Wunderwaffe DG-2: wooden stock and grip, copper receiver wound with coils, three glass bulbs
 *   glowing on top (they drop out on a reload like BO1's tubes), twin prongs with insulators.
 * - Winter's Howl: chrome body, a glowing coolant canister underneath, a frosted barrel that flares
 *   into an icy nozzle ringed with frost.
 * - Scavenger: a long olive-black bolt-action rifle with a fat scope, a bolt handle that cycles, a
 *   finned launcher muzzle holding a glowing red-tipped bolt, and a red sensor light.
 * - 31-79 JGb215 (Baby Gun): a stubby cream-and-copper toy-like blaster with a bulbous glass
 *   chamber of pink glow, a ringed dish emitter and a little crank on the side.
 * - Wave Gun: two blue-steel Zap pistols with glowing blue coils and forked emitters; aiming snaps
 *   the left one in against the right, joining them into the Wave Gun.
 */
import * as THREE from 'three';
import { registerViewmodel, type ViewmodelAnimState } from '../../../render/models/viewmodels';
import { FURNITURE, GUNS, type GunBuild, type Kit } from '../gunkit';
import { buildWeaponViewmodel } from '../viewmodels';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Glowing material (unlit, full bright). */
const glow = (k: Kit, tex: string) => k.mat(tex, { emissive: 1 });

function raygun(k: Kit): GunBuild {
  const red = k.mat('wonder.ray', { rep: 0.3 });
  const chrome = k.mat('wonder.chrome', { rep: 0.25 });
  const green = glow(k, 'wonder.green');
  const { M } = k;
  // Body: a rounded receiver with a hump over it.
  k.box(0.055, 0.075, 0.2, red, 0, 0, -0.02);
  k.cyl(0.03, 0.2, red, 0, 0.025, -0.02, 8);
  k.box(0.04, 0.02, 0.16, M.metal, 0, -0.045, -0.03);
  // The two glowing energy tubes on top, held by chrome bands.
  for (const x of [-0.017, 0.017]) k.cyl(0.011, 0.17, green, x, 0.064, -0.03, 6);
  for (const z of [0.045, -0.1]) k.box(0.064, 0.026, 0.012, chrome, 0, 0.064, z);
  // Rear dial.
  k.cyl(0.03, 0.02, chrome, 0, 0.02, 0.09, 8);
  k.cyl(0.012, 0.012, green, 0, 0.02, 0.102, 6);
  // Barrel, collar and the flared emitter dish with three fins.
  k.cyl(0.016, 0.07, chrome, 0, 0.005, -0.15, 8);
  k.cyl(0.026, 0.02, red, 0, 0.005, -0.18, 8);
  k.cyl(0.062, 0.06, chrome, 0, 0.005, -0.215, 8, k.root, 'z', 0.024);
  k.cyl(0.05, 0.006, green, 0, 0.005, -0.243, 8);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const fin = k.box(0.006, 0.05, 0.07, red, Math.cos(a) * 0.04, 0.005 + Math.sin(a) * 0.04, -0.2);
    fin.rotation.z = a - Math.PI / 2;
  }
  // Grip and trigger guard (a pistol: one hand).
  k.box(0.042, 0.11, 0.055, red, 0, -0.09, 0.05, -0.3);
  k.box(0.01, 0.02, 0.06, M.metal, 0, -0.07, -0.005);
  // A notch sight.
  k.box(0.02, 0.012, 0.012, chrome, 0, 0.082, 0.05);
  return { muzzle: V(0, 0.005, -0.25), sightY: 0.085, adsZ: -0.36, grip: V(0, -0.09, 0.06), fore: V(0, -0.09, 0.06), parts: {}, pistol: true };
}

function thundergun(k: Kit): GunBuild {
  const steel = k.mat('wonder.thunder', { rep: 0.3 });
  const copper = k.mat('wonder.copper', { rep: 0.3 });
  const wood = k.M.wood;
  const dark = k.M.metal;
  // The big barrel.
  k.cyl(0.07, 0.52, steel, 0, 0.02, -0.12, 8);
  k.cyl(0.075, 0.03, copper, 0, 0.02, 0.1, 8);
  k.cyl(0.075, 0.03, copper, 0, 0.02, -0.08, 8);
  // Coil housing at the back.
  k.box(0.12, 0.12, 0.16, steel, 0, 0.02, 0.2);
  for (let i = 0; i < 4; i++) k.cyl(0.05, 0.012, copper, 0, 0.02, 0.15 + i * 0.03, 8);
  // The turbine: stacked fan discs, then the flare.
  const fan = new THREE.Group();
  fan.position.set(0, 0.02, -0.4);
  k.root.add(fan);
  for (let i = 0; i < 4; i++) {
    k.cyl(0.095, 0.012, steel, 0, 0, -i * 0.035, 8, fan);
    k.cyl(0.04, 0.014, dark, 0, 0, -i * 0.035, 6, fan);
    for (let b = 0; b < 4; b++) {
      k.box(0.16, 0.012, 0.01, copper, 0, 0, -i * 0.035 - 0.012, 0, 0, (b / 4) * Math.PI + i * 0.3, fan);
    }
  }
  k.cyl(0.12, 0.06, copper, 0, 0.02, -0.55, 8, k.root, 'z', 0.085);
  // Pipes along the sides, a carry handle on top.
  for (const x of [-0.075, 0.075]) k.cyl(0.01, 0.42, copper, x, -0.03, -0.1, 6);
  k.box(0.02, 0.07, 0.02, dark, 0, 0.11, 0.05);
  k.box(0.02, 0.07, 0.02, dark, 0, 0.11, -0.15);
  k.box(0.02, 0.02, 0.22, dark, 0, 0.145, -0.05);
  // Two wooden grips.
  k.box(0.045, 0.13, 0.06, wood, 0, -0.1, 0.17, -0.25);
  k.box(0.04, 0.12, 0.05, wood, 0, -0.1, -0.22, 0.1);
  return { muzzle: V(0, 0.02, -0.58), sightY: 0.15, adsZ: -0.5, grip: V(0.005, -0.13, 0.17), fore: V(-0.012, -0.12, -0.22), parts: { cylinder: fan }, pistol: false, noAds: true };
}

function wunderwaffe(k: Kit): GunBuild {
  const copper = k.mat('wonder.copper', { rep: 0.3 });
  const bulbGlow = glow(k, 'wonder.bulb');
  const glass = k.mat('wonder.glass', { rep: 0.1 });
  const wood = k.M.wood;
  const dark = k.M.metal;
  // Receiver, coils, stock and grip.
  k.box(0.07, 0.085, 0.3, copper, 0, 0, -0.02);
  for (let i = 0; i < 6; i++) k.cyl(0.05, 0.012, copper, 0, 0, -0.12 - i * 0.025, 8);
  k.box(0.05, 0.04, 0.2, dark, 0, -0.05, -0.05);
  k.stock(0.13, 0.3, -0.01, 0.11, wood, 0.03);
  k.box(0.045, 0.12, 0.06, wood, 0, -0.09, 0.1, -0.3);
  k.box(0.012, 0.02, 0.07, dark, 0, -0.055, 0.04);
  // Twin prongs with dark insulator discs, glowing tips.
  for (const x of [-0.022, 0.022]) {
    k.cyl(0.009, 0.44, copper, x, 0.005, -0.38, 6);
    for (const z of [-0.26, -0.36, -0.46]) k.cyl(0.02, 0.014, dark, x, 0.005, z, 6);
    k.cyl(0.012, 0.02, bulbGlow, x, 0.005, -0.6, 6);
  }
  // Lever on the right.
  k.box(0.012, 0.012, 0.09, dark, 0.045, 0.02, 0.02);
  // The three bulbs (a group: they drop out and back in on a reload).
  const bulbs = new THREE.Group();
  bulbs.position.set(0, 0.045, -0.06);
  k.root.add(bulbs);
  for (const z of [0.07, 0, -0.07]) {
    k.cyl(0.02, 0.015, copper, 0, 0.008, z, 8, bulbs);
    k.cyl(0.023, 0.012, glass, 0, 0.02, z, 8, bulbs, 'y');
    k.cyl(0.021, 0.05, bulbGlow, 0, 0.05, z, 8, bulbs, 'y', 0.015);
    k.cyl(0.008, 0.012, copper, 0, 0.081, z, 6, bulbs, 'y');
  }
  // Sights over the bulbs.
  k.box(0.012, 0.03, 0.012, dark, 0, 0.11, 0.08);
  k.box(0.012, 0.03, 0.012, dark, 0, 0.11, -0.2);
  return { muzzle: V(0, 0.005, -0.62), sightY: 0.13, adsZ: -0.5, grip: V(0.005, -0.1, 0.1), fore: V(-0.012, -0.05, -0.18), parts: { mag: bulbs }, pistol: false };
}

function wintershowl(k: Kit): GunBuild {
  const chrome = k.mat('wonder.chrome', { rep: 0.25 });
  const frost = k.mat('wonder.frost', { rep: 0.3 });
  const ice = glow(k, 'wonder.ice');
  const dark = k.M.metal;
  // Body and grip.
  k.box(0.06, 0.08, 0.24, chrome, 0, 0, 0);
  k.cyl(0.032, 0.22, chrome, 0, 0.03, 0, 8);
  k.box(0.045, 0.12, 0.06, dark, 0, -0.09, 0.08, -0.3);
  k.box(0.012, 0.02, 0.07, dark, 0, -0.055, 0.02);
  // Coolant canister underneath, glowing through a window.
  k.cyl(0.028, 0.16, frost, 0, -0.055, -0.1, 8);
  k.cyl(0.02, 0.1, ice, 0, -0.055, -0.1, 6);
  // Coolant lines to the barrel.
  for (const x of [-0.035, 0.035]) k.cyl(0.007, 0.24, frost, x, 0.02, -0.16, 6);
  // The frosted barrel flaring into the nozzle, frost rings, an icy core.
  k.cyl(0.025, 0.16, frost, 0, 0.01, -0.2, 8);
  k.cyl(0.07, 0.12, frost, 0, 0.01, -0.33, 8, k.root, 'z', 0.03);
  for (const z of [-0.29, -0.36]) k.cyl(0.06, 0.012, chrome, 0, 0.01, z, 8);
  k.cyl(0.055, 0.008, ice, 0, 0.01, -0.39, 8);
  // Icicles hanging off the nozzle lip.
  for (const x of [-0.035, 0, 0.03]) k.cyl(0.001, 0.035, ice, x, -0.05, -0.37, 4, k.root, 'y', 0.006);
  // Rear sight and a frosty fin.
  k.box(0.02, 0.014, 0.014, dark, 0, 0.07, 0.08);
  k.box(0.008, 0.03, 0.08, frost, 0, 0.075, -0.05);
  return { muzzle: V(0, 0.01, -0.4), sightY: 0.085, adsZ: -0.42, grip: V(0.005, -0.1, 0.08), fore: V(-0.012, -0.06, -0.12), parts: {}, pistol: false };
}

function scavenger(k: Kit): GunBuild {
  const body = k.mat('wonder.scav', { rep: 0.3 });
  const red = glow(k, 'wonder.red');
  const dark = k.M.metal;
  // Receiver, long fluted barrel, thumbhole stock.
  k.box(0.07, 0.085, 0.34, body, 0, 0, 0);
  k.box(0.085, 0.07, 0.36, body, 0, -0.03, -0.3);
  k.cyl(0.02, 0.4, dark, 0, 0.01, -0.58, 8);
  for (let i = 0; i < 3; i++) k.box(0.044, 0.006, 0.3, dark, 0, 0.01 + (i - 1) * 0.012, -0.58);
  k.box(0.08, 0.07, 0.28, body, 0, -0.035, 0.27);
  k.box(0.08, 0.16, 0.08, body, 0, -0.07, 0.44);
  k.box(0.05, 0.12, 0.06, body, 0, -0.1, 0.12, -0.3);
  k.box(0.08, 0.02, 0.18, body, 0, -0.14, 0.22);
  // The launcher muzzle: a fat finned can with the next bolt's glowing red tip poking out.
  k.cyl(0.042, 0.12, dark, 0, 0.01, -0.82, 8);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    k.box(0.006, 0.05, 0.1, body, Math.cos(a) * 0.05, 0.01 + Math.sin(a) * 0.05, -0.82, 0, 0, a);
  }
  k.cyl(0.012, 0.03, red, 0, 0.01, -0.89, 6);
  // Big scope, a red sensor light under it, a box magazine.
  const sightY = k.scope(-0.05, 0.045, 0.36, 0.036, true);
  k.box(0.02, 0.016, 0.02, red, 0.04, 0.05, -0.2);
  k.box(0.05, 0.1, 0.07, dark, 0, -0.09, -0.04);
  // The bolt handle (cycles after each shot).
  const bolt = k.group(0.04, 0.02, 0.08);
  k.box(0.06, 0.012, 0.012, dark, 0.03, 0, 0, 0, 0, 0, bolt);
  k.cyl(0.014, 0.022, red, 0.065, 0, 0, 6, bolt, 'x');
  return { muzzle: V(0, 0.01, -0.9), sightY, adsZ: -0.42, grip: V(0.005, -0.11, 0.13), fore: V(-0.012, -0.08, -0.32), parts: { bolt }, pistol: false };
}

function babygun(k: Kit): GunBuild {
  const cream = k.mat('wonder.cream', { rep: 0.3 });
  const copper = k.mat('wonder.copper', { rep: 0.3 });
  const glass = k.mat('wonder.glass', { rep: 0.1 });
  const pink = glow(k, 'wonder.pink');
  const dark = k.M.metal;
  // A stubby rounded body.
  k.box(0.075, 0.09, 0.24, cream, 0, 0, 0);
  k.cyl(0.05, 0.24, cream, 0, 0.02, 0, 8);
  k.box(0.08, 0.02, 0.24, copper, 0, -0.045, 0);
  // The glass chamber on top glowing pink, copper caps.
  k.cyl(0.045, 0.14, glass, 0, 0.09, -0.02, 8);
  k.cyl(0.036, 0.13, pink, 0, 0.09, -0.02, 8);
  for (const z of [0.055, -0.095]) k.cyl(0.05, 0.02, copper, 0, 0.09, z, 8);
  // Short barrel and the ringed dish emitter.
  k.cyl(0.026, 0.12, copper, 0, 0.01, -0.17, 8);
  for (const [z, r] of [[-0.2, 0.034], [-0.23, 0.04], [-0.26, 0.046]] as const) k.cyl(r, 0.008, cream, 0, 0.01, z, 8);
  k.cyl(0.07, 0.04, copper, 0, 0.01, -0.29, 8, k.root, 'z', 0.03);
  k.cyl(0.055, 0.006, pink, 0, 0.01, -0.31, 8);
  // A crank on the right, grip and trigger guard.
  k.cyl(0.03, 0.012, copper, 0.05, 0.0, 0.03, 8, k.root, 'x');
  k.box(0.01, 0.05, 0.01, dark, 0.06, -0.02, 0.03);
  k.box(0.045, 0.12, 0.06, cream, 0, -0.1, 0.07, -0.3);
  k.box(0.012, 0.02, 0.07, dark, 0, -0.06, 0.0);
  // A front handle and a notch sight.
  k.box(0.035, 0.08, 0.04, copper, 0, -0.08, -0.12, 0.2);
  k.box(0.02, 0.014, 0.014, dark, 0, 0.145, 0.04);
  return { muzzle: V(0, 0.01, -0.32), sightY: 0.15, adsZ: -0.38, grip: V(0.005, -0.1, 0.07), fore: V(-0.012, -0.1, -0.12), parts: {}, pistol: false };
}

/** One Zap pistol into `parent`: blue-steel body, glowing coils, a forked emitter. */
function zapPistol(k: Kit, parent: THREE.Object3D, body: THREE.Material, zap: THREE.Material): void {
  const dark = k.M.metal;
  k.box(0.042, 0.06, 0.2, body, 0, 0.01, -0.04, 0, 0, 0, parent);
  for (let i = 0; i < 4; i++) k.cyl(0.03, 0.01, zap, 0, 0.012, -0.08 - i * 0.022, 8, parent);
  k.cyl(0.014, 0.08, dark, 0, 0.012, -0.17, 6, parent);
  for (const x of [-0.016, 0.016]) k.box(0.008, 0.03, 0.05, body, x, 0.012, -0.22, 0, 0, 0, parent);
  k.cyl(0.008, 0.01, zap, 0, 0.012, -0.24, 6, parent);
  k.box(0.036, 0.1, 0.05, body, 0, -0.065, 0.04, 0.22, 0, 0, parent);
  k.box(0.01, 0.02, 0.05, dark, 0, -0.035, -0.02, 0, 0, 0, parent);
  k.box(0.02, 0.012, 0.012, dark, 0, 0.048, 0.04, 0, 0, 0, parent);
}

function wavegun(k: Kit): GunBuild {
  const body = k.mat('wonder.zapbody', { rep: 0.3 });
  const zap = glow(k, 'wonder.zap');
  zapPistol(k, k.root, body, zap);
  const offhand = k.group(-0.3, 0, 0);
  zapPistol(k, offhand, body, zap);
  // Aiming snaps the left pistol in against the right, side by side: the joined Wave Gun.
  const home = offhand.position.clone();
  const joined = V(-0.046, 0, 0);
  let t = 0;
  const animate = (s: ViewmodelAnimState) => {
    t += (s.ads - t) * Math.min(1, s.dt * 14);
    offhand.position.lerpVectors(home, joined, t);
    if (s.sinceShot < 0.12 && t < 0.5 && Math.floor(s.time * 20) % 2 === 0) offhand.position.y += 0.01;
  };
  return { muzzle: V(0, 0.012, -0.25), sightY: 0.055, adsZ: -0.34, grip: V(0, -0.085, 0.06), fore: V(-0.03, -0.075, 0.02), parts: { offhand }, pistol: true, animate };
}

export const WONDER_GUNS = { raygun, thundergun, wunderwaffe, wintershowl, scavenger, babygun, wavegun } as const;

for (const [id, build] of Object.entries(WONDER_GUNS)) {
  GUNS[id] = (k) => build(k);
  FURNITURE[id] = id === 'thundergun' || id === 'wunderwaffe' ? 'wood' : 'poly';
  registerViewmodel(id, (c) => buildWeaponViewmodel(c, id));
}
