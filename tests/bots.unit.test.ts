import { describe, expect, it } from 'vitest';
import { engage, newAimState, offDeg, stepAim, toleranceDeg } from '../src/server/features/bots/aim';
import { BOT_NAMES, chooseBotLoadout, pickBotName } from '../src/server/features/bots/loadout';
import { freeAt, NavGrid } from '../src/server/features/bots/nav';
import { applyVariance, defaultSettings, rollBot, sanitizeSettings, SKILL_KEYS, skillRating } from '../src/server/features/bots/skill';
import { PLAYER } from '../src/shared/constants';
import { BOT_DIFFICULTY_BY_ID, BOT_SKILL_RANGES, DEFAULT_LOBBY_BOTS, skillFor, type BotSkill } from '../src/shared/defs/bots';
import { getMapData } from '../src/shared/defs/maps';
import { sanitizeLoadout } from '../src/shared/loadout';
import { rng } from '../src/shared/math';
import { stairsMap } from './bots-fixtures';

const preset = (id: string): BotSkill => ({ ...BOT_DIFFICULTY_BY_ID.get(id as 'regular')!.skill });

describe('bots: settings and skill', () => {
  it('defaults per mode, capped at the room size', () => {
    expect(defaultSettings('tdm', 12)).toMatchObject({ fill: true, targetPlayers: 12, difficulty: 'regular' });
    expect(defaultSettings('ffa', 8).targetPlayers).toBe(8);
    expect(defaultSettings('tdm', 6).targetPlayers).toBe(6);
    expect(defaultSettings('unknown_mode', 10).targetPlayers).toBe(10);
  });

  it('sanitizes untrusted settings: clamps, ignores junk, completes a custom skill', () => {
    const base = { ...DEFAULT_LOBBY_BOTS };
    const s = sanitizeSettings({ fill: 'yes', targetPlayers: 99.6, difficulty: 'godlike', variance: -3, extra: 1 }, base, 12);
    expect(s).toMatchObject({ fill: true, targetPlayers: 12, difficulty: 'regular', variance: 0 });
    expect(s).not.toHaveProperty('extra');
    const c = sanitizeSettings({ difficulty: 'custom', custom: { reactionMs: 5, aimErrorDeg: 99, headshotBias: 0.5, bogus: 3 } }, base, 12);
    expect(c.difficulty).toBe('custom');
    expect(c.custom).toBeDefined();
    expect(c.custom!.reactionMs).toBe(BOT_SKILL_RANGES.reactionMs[0]);
    expect(c.custom!.aimErrorDeg).toBe(BOT_SKILL_RANGES.aimErrorDeg[1]);
    expect(c.custom!.headshotBias).toBe(0.5);
    // Knobs not given come from the current preset.
    expect(c.custom!.turnSpeedDeg).toBe(preset('regular').turnSpeedDeg);
    for (const k of SKILL_KEYS) expect(typeof c.custom![k]).toBe('number');
    expect(skillFor(c)).toEqual(c.custom);
    // Picking 'custom' without values starts from regular.
    expect(sanitizeSettings({ difficulty: 'custom' }, base, 12).custom).toEqual(preset('regular'));
  });

  it('variance 0 is the preset exactly; variance keeps every knob in range and differs per bot', () => {
    const vet = preset('veteran');
    expect(applyVariance(vet, 0, rollBot())).toEqual(vet);
    const r = rng(7);
    const skills = Array.from({ length: 40 }, () => applyVariance(preset('regular'), 1, rollBot(r)));
    for (const s of skills)
      for (const k of SKILL_KEYS) {
        const [lo, hi] = BOT_SKILL_RANGES[k];
        expect(s[k]).toBeGreaterThanOrEqual(lo);
        expect(s[k]).toBeLessThanOrEqual(hi);
      }
    const reactions = new Set(skills.map((s) => Math.round(s.reactionMs)));
    expect(reactions.size).toBeGreaterThan(10);
    // Same rolls, same personality: a bot keeps its relative form across presets.
    const rolls = rollBot(rng(3));
    const a = applyVariance(preset('recruit'), 0.5, rolls);
    const b = applyVariance(preset('recruit'), 0.5, rolls);
    expect(a).toEqual(b);
  });

  it('skill rating orders the presets', () => {
    const r = ['recruit', 'regular', 'hardened', 'veteran'].map((id) => skillRating(preset(id)));
    for (let i = 1; i < r.length; i++) expect(r[i]!).toBeGreaterThan(r[i - 1]!);
  });
});

describe('bots: aim model', () => {
  it('waits out the reaction time before moving the aim, then turns no faster than turnSpeedDeg', () => {
    const skill = { ...preset('regular'), reactionMs: 500, turnSpeedDeg: 180 };
    const s = newAimState(0, 0);
    engage(s, skill, () => 0.5);
    const react = s.react;
    expect(react).toBeGreaterThanOrEqual(0.45);
    const target = Math.PI / 2; // 90 degrees to the left
    let t = 0;
    while (t < react - 0.02) {
      stepAim(s, skill, target, 0, 1 / 60);
      t += 1 / 60;
    }
    expect(s.yaw).toBe(0);
    for (let i = 0; i < 30; i++) stepAim(s, skill, target, 0, 1 / 60);
    // At most 180 deg/s for ~0.5 s (+ a tick of slack).
    expect((s.yaw * 180) / Math.PI).toBeLessThanOrEqual(180 * (31 / 60) + 0.01);
    expect(s.yaw).toBeGreaterThan(0);
  });

  it('engagement error settles while tracking down to a residual wobble that scales with aimErrorDeg', () => {
    const run = (aimErrorDeg: number) => {
      const skill = { ...preset('regular'), aimErrorDeg, reactionMs: 100, turnSpeedDeg: 720 };
      const s = newAimState(0, 0);
      engage(s, skill, rng(11));
      const first = Math.hypot(s.errYaw, s.errPitch);
      let late = 0;
      for (let i = 0; i < 60 * 4; i++) {
        stepAim(s, skill, 0, 0, 1 / 60, 10, 1);
        if (i >= 60 * 3) late = Math.max(late, offDeg(s, 0, 0));
      }
      return { first, residual: Math.hypot(s.errYaw, s.errPitch), late };
    };
    const bad = run(9);
    const good = run(1.2);
    expect(bad.residual).toBeLessThan(bad.first * 0.2);
    expect(good.late).toBeLessThan(bad.late);
    expect(bad.late).toBeGreaterThan(toleranceDeg(20) * 0.5);
  });
});

describe('bots: navigation grid', () => {
  it('builds the Yard: ground everywhere players can walk, links, reachable core', () => {
    const g = new NavGrid(getMapData('yard'));
    expect(g.size).toBeGreaterThan(8000);
    expect(g.coreCells.length).toBeGreaterThan(g.size * 0.7);
    for (const c of g.coreCells) expect(freeAt(g.world, c.x, c.y + 0.01, c.z, PLAYER.radius, PLAYER.height)).toBe(true);
    // The hut (x -5.5..-2.5, z -3.25..-0.75) is not walkable at ground level.
    expect(g.cellAt({ x: -4, y: 0, z: -2 })?.y ?? 0).toBeGreaterThan(2);
  });

  it('paths across the Yard between the team spawns around containers, every step a real link', () => {
    const g = new NavGrid(getMapData('yard'));
    const from = { x: -14, y: 0, z: -22 };
    const to = { x: 9, y: 0, z: 25 };
    const path = g.path(from, to)!;
    expect(path).not.toBeNull();
    expect(path.at(-1)!.x).toBeCloseTo(9.25, 0);
    let prev = g.cellAt(from)!;
    let len = 0;
    for (const c of path) {
      expect(g.edgeKind(prev, c)).not.toBeNull();
      len += Math.hypot(c.x - prev.x, c.z - prev.z);
      prev = c;
    }
    expect(len).toBeGreaterThan(Math.hypot(23, 47) - 1);
    expect(len).toBeLessThan(Math.hypot(23, 47) * 1.6);
  });

  it('climbs stairs and ramps by walking, jumps onto low ledges, never walks up walls', () => {
    const g = new NavGrid(stairsMap());
    // Platform top (2.4 m) reached only via the stairs, by walk links.
    const top = g.path({ x: 0, y: 0, z: -12 }, { x: 12, y: 2.4, z: -11 })!;
    expect(top).not.toBeNull();
    expect(top.at(-1)!.y).toBeCloseTo(2.4, 2);
    const kinds = new Set<string>();
    let prev = g.cellAt({ x: 0, y: 0, z: -12 })!;
    let climbed = false;
    for (const c of top) {
      const k = g.edgeKind(prev, c)!;
      kinds.add(k);
      if (k === 'walk' && c.y > prev.y + 0.2) climbed = true;
      expect(c.y - prev.y).toBeLessThanOrEqual(1);
      prev = c;
    }
    expect(climbed).toBe(true);
    // The path goes over the stairs (x 5.5..8, z -12..-10).
    expect(top.some((c) => c.x > 5.5 && c.x < 8 && c.z > -12 && c.z < -10 && c.y > 0.3 && c.y < 2.3)).toBe(true);
    // Ramp deck (1.5 m) by walking up the ramp.
    const deck = g.path({ x: -10.5, y: 0, z: 10 }, { x: -10, y: 1.5, z: -5 })!;
    expect(deck.at(-1)!.y).toBeCloseTo(1.5, 1);
    expect(deck.every((c, i) => i === 0 || Math.abs(c.y - deck[i - 1]!.y) < 0.46 || g.edgeKind(deck[i - 1]!, c) !== 'walk')).toBe(true);
    // The crate (0.9 m) needs a jump link.
    const crate = g.path({ x: 6, y: 0, z: 10 }, { x: 10, y: 0.9, z: 10 })!;
    let jumped = false;
    prev = g.cellAt({ x: 6, y: 0, z: 10 })!;
    for (const c of crate) {
      if (g.edgeKind(prev, c) === 'jump') jumped = true;
      prev = c;
    }
    expect(jumped).toBe(true);
    // Through the barrier gap or over the barrier (0.8 m: a jump), around the pillar.
    expect(g.path({ x: 0, y: 0, z: -12 }, { x: 0, y: 0, z: 12 })).not.toBeNull();
    // Nothing stands inside the pillar.
    expect(g.column(0, 0).every((c) => c.y >= 4)).toBe(true);
  });
});

describe('bots: loadouts and names', () => {
  it('picks a structurally valid loadout from the defs', () => {
    const r = rng(5);
    for (let i = 0; i < 20; i++) {
      const l = chooseBotLoadout(r(), r);
      const clean = sanitizeLoadout(l);
      expect(clean.primary.weapon).toBe(l.primary.weapon);
      expect(clean.secondary.weapon).toBe(l.secondary.weapon);
      expect(l.killstreaks.length).toBeGreaterThan(0);
    }
  });

  it('names are unique within a room', () => {
    const taken: string[] = [];
    for (let i = 0; i < BOT_NAMES.length + 5; i++) taken.push(pickBotName(taken));
    expect(new Set(taken).size).toBe(taken.length);
  });
});
