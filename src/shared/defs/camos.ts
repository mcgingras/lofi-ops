/**
 * Camos / gun skins (owner: economy feature). A camo is a texture recipe run through the client's
 * developer and applied to the weapon's camo-able materials (viewmodel and third-person gun).
 * The client registers each as texture `camo.<id>` (src/client/features/economy/camos.ts) and
 * exports `camoPreview(id)` for pickers. Per-weapon selection lives in `WeaponLoadout.camo`.
 *
 * Bought once, usable on every weapon (simplified from BO1's per-weapon purchase).
 */
import { indexById } from './registry';

/** Pattern ids the client's camo painter knows. */
export type CamoPattern = 'blotch' | 'tiger' | 'digital' | 'urban' | 'snow' | 'blossom' | 'flora' | 'metal' | 'ice' | 'dragon';

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

export interface CamoDef {
  id: string;
  name: string;
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

export const CAMO_BY_ID = indexById(CAMOS);
