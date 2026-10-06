/**
 * Camos / gun skins (owner: economy feature). A camo is a texture recipe run through the client's
 * developer and applied to the weapon's camo-able materials.
 */
import { indexById } from './registry';

/** Recipe for the texture developer: a source photo id, a CSS filter, and an optional pattern. */
export interface CamoRecipe {
  /** Photo id from assets/textures (without extension). */
  photo?: string;
  /** CSS canvas filter, e.g. 'hue-rotate(-140deg) saturate(.45)'. */
  filter?: string;
  /** Pattern overlay id the client knows (blotches, tiger, digital...). */
  pattern?: string;
  /** Palette tint colours (0xRRGGBB) for the pattern. */
  colors?: number[];
}

export interface CamoDef {
  id: string;
  name: string;
  /** CoD Points price (buy), or an unlock rule. */
  price?: number;
  unlock?: { level?: number; prestige?: number; challenge?: string };
  /** null = the weapon's own finish. */
  recipe: CamoRecipe | null;
}

export const CAMOS: CamoDef[] = [{ id: 'none', name: 'None', price: 0, recipe: null }];

export const CAMO_BY_ID = indexById(CAMOS);
