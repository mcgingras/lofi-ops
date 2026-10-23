/**
 * The MW2 camo painters (src/client/features/economy/paint.ts) against a recording 2D context:
 * every MW2 recipe paints its own pattern (not the blotch fallback), uses its whole palette, stays
 * inside the tile's wrap and is deterministic for a seed.
 */
import { describe, expect, it } from 'vitest';
import { css, paintCamo } from '../src/client/features/economy/paint';
import { makeRand } from '../src/client/render/developer';
import { MW2_CAMOS, type CamoRecipe } from '../src/shared/defs/camos';

interface Op {
  op: string;
  style: string;
  args: number[];
}

function recorder() {
  const ops: Op[] = [];
  const g = {
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 1,
    lineCap: 'butt',
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo(...a: number[]) { ops.push({ op: 'moveTo', style: String(g.fillStyle), args: a }); },
    lineTo(...a: number[]) { ops.push({ op: 'lineTo', style: String(g.fillStyle), args: a }); },
    quadraticCurveTo(...a: number[]) { ops.push({ op: 'quad', style: String(g.fillStyle), args: a }); },
    arc(...a: number[]) { ops.push({ op: 'arc', style: String(g.fillStyle), args: a }); },
    ellipse(...a: number[]) { ops.push({ op: 'ellipse', style: String(g.fillStyle), args: a }); },
    fill() { ops.push({ op: 'fill', style: String(g.fillStyle), args: [] }); },
    stroke() { ops.push({ op: 'stroke', style: String(g.strokeStyle), args: [] }); },
    fillRect(...a: number[]) { ops.push({ op: 'fillRect', style: String(g.fillStyle), args: a }); },
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  return { g: g as unknown as CanvasRenderingContext2D, ops };
}

const paint = (recipe: CamoRecipe, seed = 1, size = 64) => {
  const r = recorder();
  paintCamo(r.g, size, size, recipe, makeRand(seed));
  return r.ops;
};

describe('MW2 camo painters', () => {
  for (const def of MW2_CAMOS) {
    it(`${def.id}: paints its ${def.recipe!.pattern} pattern with its whole palette`, () => {
      const recipe = def.recipe!;
      const ops = paint(recipe);
      // Opaque base first.
      expect(ops[0]).toEqual({ op: 'fillRect', style: css(recipe.colors![0]!), args: [0, 0, 64, 64] });
      const used = new Set(ops.filter((o) => o.op === 'fill' || o.op === 'fillRect' || o.op === 'stroke').map((o) => o.style));
      for (const c of recipe.colors!) expect(used, `${def.id} uses ${c.toString(16)}`).toContain(css(c));
      // Plenty of shapes, and not the blotch fallback's shapes.
      expect(ops.filter((o) => o.op === 'fill' || o.op === 'fillRect').length).toBeGreaterThan(100);
      expect(JSON.stringify(ops)).not.toBe(JSON.stringify(paint({ ...recipe, pattern: 'blotch' })));
      // Deterministic for a seed; another seed differs.
      expect(paint(recipe, 7)).toEqual(paint(recipe, 7));
      expect(paint(recipe, 7)).not.toEqual(paint(recipe, 8));
      // Shapes are drawn at the wrapped offsets: nothing lands beyond one tile outside.
      for (const o of ops) if (o.op === 'lineTo' || o.op === 'moveTo') for (const v of o.args) expect(Math.abs(v)).toBeLessThan(64 * 2.5);
    });
  }

  it('marpat stays on its pixel grid and tiles exactly (no wrap overdraw past the edge)', () => {
    const ops = paint(MW2_CAMOS.find((c) => c.id === 'mw2_digital')!.recipe!);
    const cells = ops.filter((o) => o.op === 'fillRect').slice(1);
    for (const o of cells) {
      const [x, y, w, h] = o.args as [number, number, number, number];
      expect([x % 2, y % 2, w, h]).toEqual([0, 0, 2, 2]);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(64);
      expect(y).toBeLessThan(64);
    }
  });

  it('scales with the texture: the 256 px developed tile paints the same layout 4x larger', () => {
    const r = MW2_CAMOS.find((c) => c.id === 'mw2_red_tiger')!.recipe!;
    const small = paint(r, 3, 64).filter((o) => o.op === 'moveTo');
    const big = paint(r, 3, 256).filter((o) => o.op === 'moveTo');
    expect(big.length).toBe(small.length);
    expect(big[5]!.args[0]! / small[5]!.args[0]!).toBeCloseTo(4, 0);
  });
});
