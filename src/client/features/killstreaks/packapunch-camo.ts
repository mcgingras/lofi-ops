/**
 * The Pack-a-Punch camo, painted as pixels (pure, no DOM): a tiling purple and blue plasma that
 * swirls, quantised to a six-colour palette with a 4x4 ordered dither and stepped at a low frame
 * rate, like the PS1-era animated textures the other camos imitate. A few pale sparkles twinkle on
 * top. `packapunch.ts` paints it into texture `camo.pap` every step, so every gun wearing it
 * (viewmodel, third-person, dropped) animates together.
 */

export const PAP_CAMO_SIZE = 64;
/** Animation steps per second (stepped, not smooth: the PS1 look). */
export const PAP_CAMO_FPS = 12;

/** Dark to light: deep indigo, violet, purple, electric blue, sky blue, pale lilac (sparkles). */
export const PAP_PALETTE: readonly (readonly [number, number, number])[] = [
  [0x16, 0x06, 0x30],
  [0x3c, 0x10, 0x78],
  [0x7a, 0x22, 0xc8],
  [0x28, 0x50, 0xf0],
  [0x5a, 0xb8, 0xff],
  [0xf2, 0xd2, 0xff],
];

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const TAU = Math.PI * 2;

/** The palette index of pixel (x, y) at animation time `t` (seconds; quantise with `papCamoStep` first). */
export function papCamoIndex(x: number, y: number, t: number, n = PAP_CAMO_SIZE): number {
  const u = x / n;
  const v = y / n;
  // Whole periods across the tile in every term, so it tiles seamlessly.
  const a = Math.sin(TAU * (u * 2 + t * 0.35));
  const b = Math.sin(TAU * (v * 3 - t * 0.5) + a * 1.2);
  const c = Math.sin(TAU * (u + v * 2) + t * 2.1);
  const d = Math.sin(TAU * (u * 3 - v) - t * 1.4 + b);
  // -1..1 -> 0..1, then the dither nudges the threshold between bands.
  const k = (a + b + c + d) / 8 + 0.5;
  const dith = (BAYER[(y & 3) * 4 + (x & 3)]! / 16 - 0.5) * 0.18;
  const band = Math.max(0, Math.min(4, Math.floor((k + dith) * 5)));
  // Sparkles: a hashed pixel lights up for a step now and then.
  const step = Math.floor(t * PAP_CAMO_FPS);
  const h = Math.sin((x * 12.9898 + y * 78.233 + step * 37.719) * 1.0) * 43758.5453;
  if (h - Math.floor(h) > 0.992 && band >= 2) return 5;
  return band;
}

/** Quantise a time to the camo's animation step. */
export const papCamoStep = (t: number): number => Math.floor(t * PAP_CAMO_FPS) / PAP_CAMO_FPS;

/** RGBA pixels of the camo at time `t` (written into `out` when given). */
export function papCamoPixels(t: number, out: Uint8ClampedArray = new Uint8ClampedArray(PAP_CAMO_SIZE * PAP_CAMO_SIZE * 4), n = PAP_CAMO_SIZE): Uint8ClampedArray {
  const ts = papCamoStep(t);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const c = PAP_PALETTE[papCamoIndex(x, y, ts, n)]!;
      const i = (y * n + x) * 4;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = 255;
    }
  return out;
}
