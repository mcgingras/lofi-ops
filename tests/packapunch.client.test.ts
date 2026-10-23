/**
 * Pack-a-Punch on the client (pure parts): the animated camo (only its purple / blue palette,
 * tiling, stepped animation) and the killcam / deathcam card naming the upgraded gun.
 */
import { describe, expect, it } from 'vitest';
import { PAP_CAMO_FPS, PAP_CAMO_SIZE, PAP_PALETTE, papCamoIndex, papCamoPixels } from '../src/client/features/killstreaks/packapunch-camo';
import { cardLines } from '../src/client/features/modes/deathcam-math';

describe('Pack-a-Punch camo', () => {
  it('is purple and blue (blue never below red by much, never green-dominant), fully opaque', () => {
    for (const [r, g, b] of PAP_PALETTE) {
      expect(b).toBeGreaterThan(g);
      expect(b).toBeGreaterThanOrEqual(r * 0.9);
    }
    const px = papCamoPixels(1.3);
    const used = new Set<number>();
    for (let i = 0; i < px.length; i += 4) {
      expect(px[i + 3]).toBe(255);
      used.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
    }
    // A real pattern: several bands on one frame.
    expect(used.size).toBeGreaterThanOrEqual(4);
  });

  it('animates in steps and tiles seamlessly', () => {
    const a = papCamoPixels(0);
    const b = papCamoPixels(1 / PAP_CAMO_FPS);
    const same = papCamoPixels(0.4 / PAP_CAMO_FPS); // inside the first step
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(false);
    expect(Buffer.from(same).equals(Buffer.from(a))).toBe(true);
    // The plasma is periodic over the tile (dither and sparkles aside, edges continue each other).
    let diff = 0;
    for (let y = 0; y < PAP_CAMO_SIZE; y++) diff += Math.abs(papCamoIndex(0, y, 0.5) - papCamoIndex(PAP_CAMO_SIZE, y, 0.5));
    expect(diff).toBeLessThanOrEqual(PAP_CAMO_SIZE * 0.1);
  });
});

describe('killer card', () => {
  const names = { weapon: (id: string) => (id === 'm16' ? 'M16' : id), attachment: (id: string) => id, rank: () => 'Sergeant' };
  const card = { name: 'Rex', bot: false, level: 23, prestige: 0, weapon: 'm16', attachments: [], health: 50, maxHealth: 100, streak: 6 };
  it('shows the upgraded name of a Pack-a-Punched gun', () => {
    expect(cardLines(card, names).weapon).toBe('M16');
    expect(cardLines({ ...card, pap: true }, names).weapon).toBe('SKULLPIERCER');
  });
});
