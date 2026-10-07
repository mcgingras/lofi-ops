/**
 * Camo texture recipes: every CAMOS def becomes texture `camo.<id>` (the id the viewmodel builders
 * receive as `ctx.camo`). The lo-fi version is the painted pattern; the developed version paints
 * the pattern over the def's Poly Haven photo (fabric/metal grain shows through) and runs it
 * through the developer like every other photo texture.
 *
 * `camoPreview(id, size)` gives a canvas for pickers (frontend create-a-class, the store).
 */
import { CAMO_BY_ID, CAMOS, type CamoDef } from '../../../shared/defs/camos';
import { hashString } from '../../../shared/math';
import { cnv, ctx2d, makeRand, posterize } from '../../render/developer';
import { registerTexture } from '../../render/textures';
import { paintCamo } from './paint';

export const camoTextureId = (camoId: string) => `camo.${camoId}`;

function register(def: CamoDef) {
  const recipe = def.recipe;
  if (!recipe) return;
  registerTexture(camoTextureId(def.id), {
    w: 64,
    h: 64,
    draw(g, w, h, R) {
      paintCamo(g, w, h, recipe, R);
    },
    photos: recipe.photo ? [recipe.photo] : [],
    photo: recipe.photo
      ? (c) =>
          c.fromPhoto(recipe.photo!, {
            w: 256,
            h: 256,
            tile: 256,
            filter: recipe.filter ?? 'none',
            over: (g, w, h) => {
              g.globalAlpha = recipe.pattern === 'metal' ? 0.55 : 0.8;
              paintCamo(g, w, h, recipe, c);
              g.globalAlpha = 1;
            },
          })
      : 'auto',
    fallback: 'auto',
  });
}

for (const def of CAMOS) register(def);

/**
 * A preview swatch for a camo (the painted lo-fi pattern, posterised like the in-game base),
 * `size` px square. 'none' (or an unknown id) gives a plain gunmetal swatch.
 */
export function camoPreview(camoId: string, size = 64): HTMLCanvasElement {
  const c = cnv(size, size);
  const g = ctx2d(c);
  const def = CAMO_BY_ID.get(camoId);
  if (!def?.recipe) {
    g.fillStyle = '#3a3c40';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#4c4f55';
    for (let y = 0; y < size; y += 4) g.fillRect(0, y, size, 1);
    return c;
  }
  // Paint at the in-game texel density, then scale up with nearest so it reads like the gun.
  const base = cnv(64, 64);
  paintCamo(ctx2d(base), 64, 64, def.recipe, makeRand(hashString(camoTextureId(camoId))));
  posterize(base);
  g.imageSmoothingEnabled = false;
  g.drawImage(base, 0, 0, size, size);
  return c;
}
