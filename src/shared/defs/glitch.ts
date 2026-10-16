/**
 * Glitch killstreak (owner: perks-streaks). An original EMP-like streak: for `durationSec` the
 * caller's enemies are "corrupted".
 *
 * - Humans on the glitched side: their screen degrades into Full-PS1 static (the client's post pass
 *   and vertex wobble, `GLITCH.fx`), their minimap shows static with no blips (the server votes
 *   `radarVisible` false and `radarJammed` true for them, so a Spy Plane or Blackbird stops helping
 *   them), and HUD text flickers and tears.
 * - Bots on the glitched side: their skill is degraded through the bots feature's skill modifiers
 *   (`GLITCH.bot`: slower reactions and noticing, big aim error and sway, slower turns, tunnel
 *   vision, poor hearing) and they freeze in place for a moment now and then (`GLITCH.freeze`).
 * - Their killstreak hardware is knocked out: sentries and SAMs are stunned, helicopters hold fire,
 *   RC-XDs and dogs stall, Valkyrie rockets lose guidance, Counter-Spy Planes stop jamming; and they
 *   can't call new streaks until it ends.
 * - The caller's side sees glitched enemies flicker, jitter and trail a colour-shifted ghost.
 *
 * Pure data and maths (no DOM / Node), shared by the server rules, the client effects and the tests.
 */
import type { Team } from '../constants';
import type { BotSkill } from './bots';

export const GLITCH = {
  /** Seconds it lasts. */
  durationSec: 20,
  /**
   * Bot skill while glitched: knob x mul + add, then clamped to the slider range (BOT_SKILL_RANGES).
   * Regular (550 ms, 6.5 deg) becomes about 1240 ms and 15 deg; Veteran (180 ms, 1.2 deg) about
   * 575 ms and 6.9 deg, so even the best bots miss a lot and react late.
   */
  bot: {
    reactionMs: { mul: 1.8, add: 250 },
    aimErrorDeg: { mul: 1.6, add: 5 },
    turnSpeedDeg: { mul: 0.55, add: 0 },
    fovDeg: { mul: 0.7, add: 0 },
    hearingRange: { mul: 0.4, add: 0 },
    headshotBias: { mul: 0.3, add: 0 },
    burstControl: { mul: 0.5, add: 0 },
  } satisfies Partial<Record<keyof BotSkill, { mul: number; add: number }>>,
  /** Bots stutter: frozen in place (no movement, no fire, aim held) for `min..max` s every `gapMin..gapMax` s. */
  freeze: { min: 0.35, max: 0.8, gapMin: 1.6, gapMax: 3.6 },
  /** Client screen effects for a glitched human (post pass strength 0..1 and its envelope). */
  fx: {
    /** Seconds to ramp in / out. */
    rampIn: 0.6,
    rampOut: 1.2,
    /** Vertex snap grid (internal pixels) at full strength, on top of the player's own setting. */
    vertexSnap: 2.6,
    /** Held frames: one every `holdGap` s on average, for `holdMin..holdMax` s. */
    holdGap: 1.4,
    holdMin: 0.06,
    holdMax: 0.22,
    /** Chromatic / noise bursts: one every `burstGap` s on average, `burstLen` s long. */
    burstGap: 1.1,
    burstLen: 0.25,
  },
} as const;

/** Push `killstreaks.glitch` (to everyone, on every change and on join): the glitches running now. */
export interface GlitchStateMsg {
  /** One per running Glitch: whose it is (`owner`, `team`) and when it ends (room time). Everyone the owner's enemies is glitched. */
  active: { owner: string; team: Team | null; until: number }[];
}

declare module '../protocol' {
  interface FeatureMessages {
    'killstreaks.glitch': GlitchStateMsg;
  }
}

/** Is a player (`id`, `team`) glitched by a Glitch owned by `owner` / `team`? FFA: everyone but the owner. */
export function glitchHits(g: { owner: string; team: Team | null }, id: string, team: Team | null): boolean {
  if (id === g.owner) return false;
  if (g.team === null || team === null) return true;
  return team !== g.team;
}

/**
 * Screen strength 0..1 at room time `now` for a glitch ending at `until` (ramps in over `rampIn`
 * from its start `until - durationSec`, out over `rampOut` before it ends).
 */
export function glitchStrength(now: number, until: number, durationSec: number = GLITCH.durationSec): number {
  const left = until - now;
  if (left <= 0) return 0;
  const since = durationSec - left;
  const inK = Math.min(1, Math.max(0, since / GLITCH.fx.rampIn));
  const outK = Math.min(1, left / GLITCH.fx.rampOut);
  return Math.min(inK, outK);
}

/** A bot skill with the Glitch applied (clamped to `ranges`). */
export function glitchSkill(s: BotSkill, ranges: Record<keyof BotSkill, readonly [number, number, number]>): BotSkill {
  const out = { ...s };
  for (const [k, m] of Object.entries(GLITCH.bot) as [keyof BotSkill, { mul: number; add: number }][]) {
    const [lo, hi] = ranges[k];
    out[k] = Math.min(hi, Math.max(lo, s[k] * m.mul + m.add));
  }
  return out;
}

/** Deterministic hash in 0..1 (for the client's burst / hold schedules). */
export function glitchHash(a: number, b = 0): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
