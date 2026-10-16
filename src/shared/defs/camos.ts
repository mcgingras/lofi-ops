/**
 * Camos / gun skins (owner: economy feature). A camo is a texture recipe run through the client's
 * developer and applied to the weapon's camo-able materials (viewmodel and third-person gun).
 * The client registers each as texture `camo.<id>` (src/client/features/economy/camos.ts) and
 * exports `camoPreview(id)` for pickers. Per-weapon selection lives in `WeaponLoadout.camo`.
 *
 * Two collections:
 * - the global camos (no `collection`): bought once with CoD Points, usable on every weapon
 *   (simplified from BO1's per-weapon purchase);
 * - the MW2 collection (`collection: 'mw2'`, ids `mw2_*`): Modern Warfare 2's eight camos, never
 *   sold. Each one unlocks per weapon through MW2's own challenge (`weaponChallenge`: headshots
 *   with that gun, the Expert I-VI ladder; Desert and Arctic are open from the start) and only fits
 *   primary weapons, as in MW2. Rules: `src/shared/defs/camo-unlocks.ts`.
 */
import { indexById } from './registry';

/** Pattern ids the client's camo painter knows. */
export type CamoPattern =
  | 'blotch'
  | 'tiger'
  | 'digital'
  | 'urban'
  | 'snow'
  | 'blossom'
  | 'flora'
  | 'metal'
  | 'ice'
  | 'dragon'
  // MW2 collection
  | 'erdl'
  | 'splinter'
  | 'marpat'
  | 'tigerstripe'
  | 'fall';

/** Recipe for the texture developer: a source photo id, a CSS filter, and an optional pattern. */
export interface CamoRecipe {
  /** Photo id from assets/textures (without extension). */
  photo?: string;
  /** CSS canvas filter, e.g. 'hue-rotate(-140deg) saturate(.45)'. */
  filter?: string;
  /** Pattern overlay id the client knows (blotches, tiger, digital...). */
  pattern?: CamoPattern | (string & {});
  /** Palette (0xRRGGBB): base colour first, then pattern layers. */
  colors?: number[];
  /** Pattern scale (1 = default). */
  scale?: number;
}

/** Which collection a camo belongs to: the global CoD Points camos, or MW2's per-weapon set. */
export type CamoCollection = 'mw2';

/**
 * A per-weapon challenge (MW2 collection): the camo opens on a gun once the player has this many
 * kills and/or headshots with that gun (career record, `stats['weapon.<id>.kills|headshots']`).
 * An empty challenge means open from the start.
 */
export interface WeaponCamoChallenge {
  kills?: number;
  headshots?: number;
  /** The MW2 challenge name ("Expert I"), shown next to the progress. */
  title?: string;
}

export interface CamoDef {
  id: string;
  name: string;
  /** Set for the MW2 collection (shown under its own heading; unlocked per weapon, never sold). */
  collection?: CamoCollection;
  /** MW2 collection: what unlocks it on a weapon. */
  weaponChallenge?: WeaponCamoChallenge;
  /** CoD Points price (buy), or an unlock rule. */
  price?: number;
  unlock?: { level?: number; prestige?: number; challenge?: string };
  /** Shown in pickers: 'standard', or 'special' for the prestige/gold tier. */
  tier?: 'standard' | 'special';
  /** null = the weapon's own finish. */
  recipe: CamoRecipe | null;
}

const LINEN = 'rough_linen';
const JERSEY = 'cotton_jersey';
const METAL = 'blue_metal_plate';

export const CAMOS: CamoDef[] = [
  { id: 'none', name: 'None', price: 0, recipe: null },
  { id: 'woodland', name: 'Woodland', price: 500, unlock: { level: 2 }, recipe: { photo: LINEN, filter: 'hue-rotate(-150deg) saturate(.5) brightness(.8)', pattern: 'blotch', colors: [0x56653a, 0x2f3b22, 0x6e5a3a, 0x1e1c16] } },
  { id: 'dusty', name: 'Dusty', price: 500, unlock: { level: 4 }, recipe: { photo: LINEN, filter: 'sepia(.6) saturate(.6) brightness(1.05)', pattern: 'blotch', colors: [0xb3a184, 0x8f7c5f, 0xcdbd9d, 0x6d5f49], scale: 1.3 } },
  { id: 'desert', name: 'Desert', price: 500, unlock: { level: 6 }, recipe: { photo: JERSEY, filter: 'sepia(.8) saturate(.9) brightness(1.1)', pattern: 'blotch', colors: [0xc8aa78, 0xa47e4f, 0xe0cba0, 0x7b5d3b], scale: 0.8 } },
  { id: 'digital', name: 'Digital', price: 750, unlock: { level: 9 }, recipe: { photo: JERSEY, filter: 'grayscale(.6) brightness(.9)', pattern: 'digital', colors: [0x6c7468, 0x434a42, 0x8f978a, 0x2a2e29] } },
  { id: 'tiger', name: 'Tiger', price: 1000, unlock: { level: 12 }, recipe: { photo: LINEN, filter: 'hue-rotate(-150deg) saturate(.4) brightness(.8)', pattern: 'tiger', colors: [0x5f6a40, 0x1c1f14, 0x7d7650] } },
  { id: 'berlin', name: 'Berlin', price: 1000, unlock: { level: 15 }, recipe: { photo: JERSEY, filter: 'grayscale(1) brightness(.85)', pattern: 'urban', colors: [0x707070, 0x4a4a4a, 0x9a9a9a, 0x2c2c2c] } },
  { id: 'warsaw', name: 'Warsaw', price: 1000, unlock: { level: 18 }, recipe: { photo: JERSEY, filter: 'grayscale(.8) sepia(.3) brightness(.9)', pattern: 'urban', colors: [0x8a8070, 0x5c5548, 0xb0a690, 0x3a352e], scale: 1.4 } },
  { id: 'siberia', name: 'Siberia', price: 1250, unlock: { level: 21 }, recipe: { photo: LINEN, filter: 'grayscale(.9) brightness(1.3)', pattern: 'snow', colors: [0xd8dcdc, 0x9aa2a4, 0x5d666a] } },
  { id: 'yukon', name: 'Yukon', price: 1250, unlock: { level: 24 }, recipe: { photo: LINEN, filter: 'grayscale(.7) sepia(.2) brightness(1.15)', pattern: 'snow', colors: [0xc7c3b6, 0x7f7a6c, 0x4c4a40], scale: 1.4 } },
  { id: 'flora', name: 'Flora', price: 1500, unlock: { level: 27 }, recipe: { photo: LINEN, filter: 'hue-rotate(-120deg) saturate(.7) brightness(.85)', pattern: 'flora', colors: [0x4f6b34, 0x8ca050, 0x2c3d1d, 0xb7b06a] } },
  { id: 'blossom', name: 'Blossom', price: 2000, unlock: { level: 31 }, recipe: { photo: JERSEY, filter: 'grayscale(.6) brightness(.7)', pattern: 'blossom', colors: [0x3a3438, 0xe8a8c0, 0xf6e0ea, 0x9a4a68] } },
  { id: 'red_tiger', name: 'Red Tiger', price: 3000, unlock: { level: 36 }, recipe: { photo: LINEN, filter: 'hue-rotate(-30deg) saturate(1.4) brightness(.8)', pattern: 'tiger', colors: [0xa8321e, 0x1a0d0a, 0xd2643a] } },
  { id: 'gold', name: 'Gold', price: 50000, unlock: { level: 44 }, tier: 'special', recipe: { photo: METAL, filter: 'sepia(1) saturate(3.2) hue-rotate(-12deg) brightness(1.15)', pattern: 'metal', colors: [0xd8a838, 0xffe58a, 0x8a6418] } },
  { id: 'ice', name: 'Ice', price: 7500, unlock: { prestige: 1 }, tier: 'special', recipe: { photo: METAL, filter: 'grayscale(.5) hue-rotate(10deg) brightness(1.35)', pattern: 'ice', colors: [0xa8d8f0, 0xeafaff, 0x4a8cc0] } },
  { id: 'dragon', name: 'Dragon', price: 15000, unlock: { prestige: 3 }, tier: 'special', recipe: { photo: METAL, filter: 'grayscale(.4) brightness(.6)', pattern: 'dragon', colors: [0x2a1414, 0xc83a1c, 0xf0a030, 0x0e0808] } },
];

/**
 * Modern Warfare 2's camos, in MW2's menu order, with MW2's unlocks (CoD Wiki, "Weapon
 * Camouflage" MW2 section and "Call of Duty: Modern Warfare 2 Challenges"): Desert and Arctic
 * from the start, then the Expert challenges, headshots with that weapon: I 5 Woodland, II 15
 * Digital, III 30 Urban, IV 75 Blue Tiger, V 150 Red Tiger, VI 250 Fall. Primary weapons only.
 *
 * Looks (patterns painted in `src/client/features/economy/paint.ts`):
 * - Desert: tan three-colour brush-stroke desert.
 * - Arctic: white with light and mid grey splinter shards and a few dark flecks.
 * - Woodland: ERDL leaf pattern, light/dark green with tan strokes and black branches.
 * - Digital: MARPAT-style pixel clusters in dark greys (MW2's is darker than CoD4's).
 * - Urban: ERDL in faded red, white, grey and black.
 * - Blue Tiger: Vietnam tigerstripe in two blues (a light base, dark stripes).
 * - Red Tiger: tigerstripe, bold black stripes on a deep red.
 * - Fall: autumn foliage hunting camo: orange, yellow and red-brown leaves and black twigs on brown.
 */
export const MW2_CAMOS: CamoDef[] = [
  { id: 'mw2_desert', name: 'Desert', collection: 'mw2', price: 0, weaponChallenge: {}, recipe: { photo: JERSEY, filter: 'sepia(.7) saturate(.8) brightness(1.08)', pattern: 'erdl', colors: [0xcdb68a, 0xa98d5e, 0x7c6142, 0xe2d4b0], scale: 1.25 } },
  { id: 'mw2_arctic', name: 'Arctic', collection: 'mw2', price: 0, weaponChallenge: {}, recipe: { photo: LINEN, filter: 'grayscale(1) brightness(1.35)', pattern: 'splinter', colors: [0xe4e8ea, 0xb8bec2, 0x8a9296, 0x3a3f42] } },
  { id: 'mw2_woodland', name: 'Woodland', collection: 'mw2', price: 0, weaponChallenge: { headshots: 5, title: 'Expert I' }, recipe: { photo: LINEN, filter: 'hue-rotate(-150deg) saturate(.55) brightness(.85)', pattern: 'erdl', colors: [0x7d8a52, 0x3e5230, 0xa89468, 0x1c1d16] } },
  { id: 'mw2_digital', name: 'Digital', collection: 'mw2', price: 0, weaponChallenge: { headshots: 15, title: 'Expert II' }, recipe: { photo: JERSEY, filter: 'grayscale(.85) brightness(.8)', pattern: 'marpat', colors: [0x6a6f72, 0x8e9497, 0x41464a, 0x1e2124] } },
  { id: 'mw2_urban', name: 'Urban', collection: 'mw2', price: 0, weaponChallenge: { headshots: 30, title: 'Expert III' }, recipe: { photo: JERSEY, filter: 'grayscale(.7) brightness(.95)', pattern: 'erdl', colors: [0xa4a29e, 0x9a5a50, 0xdcd9d2, 0x262626] } },
  { id: 'mw2_blue_tiger', name: 'Blue Tiger', collection: 'mw2', price: 0, weaponChallenge: { headshots: 75, title: 'Expert IV' }, recipe: { photo: LINEN, filter: 'grayscale(.5) hue-rotate(190deg) saturate(1.3) brightness(.85)', pattern: 'tigerstripe', colors: [0x4f78b0, 0x16264a, 0x2f4f86] } },
  { id: 'mw2_red_tiger', name: 'Red Tiger', collection: 'mw2', price: 0, weaponChallenge: { headshots: 150, title: 'Expert V' }, recipe: { photo: LINEN, filter: 'grayscale(.4) sepia(.4) hue-rotate(-30deg) saturate(2) brightness(.8)', pattern: 'tigerstripe', colors: [0xb0221a, 0x120606, 0x6e120e] } },
  { id: 'mw2_fall', name: 'Fall', collection: 'mw2', price: 0, weaponChallenge: { headshots: 250, title: 'Expert VI' }, recipe: { photo: LINEN, filter: 'sepia(.6) saturate(1.2) brightness(.8)', pattern: 'fall', colors: [0x4a3018, 0xd4661c, 0xe0a82a, 0x8a3416, 0x120e0a] } },
];

CAMOS.push(...MW2_CAMOS);

export const CAMO_BY_ID = indexById(CAMOS);

/** The global CoD Points camos (everything outside a collection), in list order. */
export const GLOBAL_CAMOS: CamoDef[] = CAMOS.filter((c) => !c.collection);

/** Display name that can't be confused with a global camo of the same name ("Woodland (MW2)"). */
export const camoName = (def: CamoDef | undefined): string => (!def ? 'None' : def.collection === 'mw2' ? `${def.name} (MW2)` : def.name);
