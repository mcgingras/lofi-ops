/**
 * Bots in Infected, through the bots feature's public hooks (no brain rewrite):
 *
 *   - Infected bots hunt: a goal (priority 0.95, sprint) to the nearest Survivor the Infected
 *     know about. Knowledge (`InfectedIntel`) is what the team could call out: a Survivor any
 *     Infected sees (bots' sight rules: collision plus drawn cover), unsuppressed gunfire (the
 *     default radar ping), and the last Survivor's radar sweep. A spot reached with nobody there
 *     is forgotten. Out of tomahawks, they go and pick theirs back up when it lies close. With
 *     no lead they search: the places the team has not looked at for longest, nearer first.
 *   - Their style (`registerBotStyle`): melee-happy rushers that lob the tomahawk at a Survivor
 *     in sight 6-18 m away, knife-lunging when close, and never back off to "reload" a knife.
 *   - Survivor bots group up and hold a rally point: a reachable spot with walls around it (few
 *     ways in), near the other Survivors and away from the Infected, re-picked when the Infected
 *     close in. Holding it they watch the angles (the brain's hold behaviour); in a fight they
 *     kite (never close in, back away inside ~7 m).
 */
import { TOMAHAWK_ENTITY } from '../../../shared/defs/equipment';
import { hashString, type Vec3 } from '../../../shared/math';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { registerBotGoal, registerBotStyle, type BotGoal } from '../bots/hooks';
import { navFor } from '../bots/nav';
import { visiblePart } from '../bots/sight';
import { canRetrieveTomahawk } from '../weapons/tomahawk';
import { controllerOf } from './common';
import type { InfectedRules } from './infected';

/** How long the Infected remember where a Survivor was. */
export const INTEL_SEC = 30;
/** Infected see Survivors within this range for the team's knowledge. */
const INTEL_SIGHT = 55;
/**
 * Survivors keep their rally point until an Infected comes within RALLY_DANGER of it (then they
 * fall back to another, at most every RALLY_MIN_SEC), and score candidates under 10 m from one low.
 */
const RALLY_DANGER = 8;
const RALLY_MIN_SEC = 10;

const rulesOf = (room: Room): InfectedRules | null => {
  const c = controllerOf(room);
  return c && c.rules.id === 'infected' ? (c as unknown as InfectedRules) : null;
};

const eye = (p: PlayerState): Vec3 => ({ x: p.move.x, y: p.move.y + 1.5, z: p.move.z });
const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

/** Where the Infected (as a team) last knew each Survivor to be. */
export class InfectedIntel {
  readonly known = new Map<string, { at: Vec3; t: number }>();

  clear(): void {
    this.known.clear();
  }

  forget(id: string): void {
    this.known.delete(id);
  }

  /** Refresh from sight, gunfire and radar (called every quarter second by the rules). */
  update(room: Room, rules: InfectedRules): void {
    if (!rules.started) return;
    const infected = [...room.players.values()].filter((p) => p.alive && rules.roleOf(p) === 'infected');
    for (const s of room.players.values()) {
      if (!s.alive || rules.roleOf(s) !== 'survivor') continue;
      let known = room.time - s.lastFireTime < 1.5 && !s.lastFireSuppressed;
      for (const i of infected) {
        if (known) break;
        if (room.modifiers.any('radarVisible', s, i) === true) known = true;
        else if (flat(i.move, s.move) < INTEL_SIGHT && visiblePart(room.world, room.map, eye(i), s)) known = true;
      }
      if (known) this.known.set(s.id, { at: { x: s.move.x, y: s.move.y, z: s.move.z }, t: room.time });
    }
  }
}

/** The hunt goal of an Infected bot (nearest known Survivor), or a tomahawk to pick up. */
export function infectedGoal(room: Room, rules: InfectedRules, bot: PlayerState): BotGoal | null {
  let best: { at: Vec3; score: number } | null = null;
  for (const [id, k] of rules.intel.known) {
    const s = room.players.get(id);
    const age = room.time - k.t;
    if (!s?.alive || rules.roleOf(s) !== 'survivor' || age > INTEL_SEC) {
      rules.intel.known.delete(id);
      continue;
    }
    const d = flat(bot.move, k.at);
    if (d < 2.5 && age > 1) {
      // Looked here: nobody. Forget it (the bot picks the next lead or roams).
      rules.intel.known.delete(id);
      continue;
    }
    const score = d + age * 1.5;
    if (!best || score < best.score) best = { at: k.at, score };
  }
  if (best) return { at: { ...best.at }, radius: 1.5, priority: 0.95, sprint: true, label: 'infected hunt' };
  if (canRetrieveTomahawk(room, bot)) {
    let hawk: Vec3 | null = null;
    let hd = 20;
    for (const e of room.entities.byKind(TOMAHAWK_ENTITY)) {
      if (!e.s?.k) continue;
      const d = flat(bot.move, e);
      if (d < hd) {
        hd = d;
        hawk = { x: e.x, y: e.y - 0.5, z: e.z };
      }
    }
    if (hawk) return { at: hawk, radius: 0.6, priority: 0.6, sprint: true, label: 'retrieve tomahawk' };
  }
  return searchGoal(room, rules, bot);
}

/** Room-wide memory of where the Infected have already looked (4 m tiles -> room time). */
const searched = new WeakMap<Room, { map: string; at: Map<string, number> }>();
const SEARCH_TILE = 4;
const tileKey = (x: number, z: number) => `${Math.floor(x / SEARCH_TILE)},${Math.floor(z / SEARCH_TILE)}`;

/** Note that `p` has looked around where it stands (everything within ~8 m it can see). */
export function markSearched(room: Room, p: PlayerState): void {
  let m = searched.get(room);
  if (!m || m.map !== room.mapId) searched.set(room, (m = { map: room.mapId, at: new Map() }));
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) m.at.set(tileKey(p.move.x + dx * SEARCH_TILE, p.move.z + dz * SEARCH_TILE), room.time);
}

/**
 * No lead on anyone: search the map like a person would, going to the places (hotspots and
 * random reachable spots) the Infected have not looked at for longest, nearer ones first.
 */
export function searchGoal(room: Room, rules: InfectedRules, bot: PlayerState, rnd: () => number = Math.random): BotGoal | null {
  if (!rules.started) return null;
  const nav = navFor(room.map);
  const mem = searched.get(room);
  const seen = (x: number, z: number) => (mem && mem.map === room.mapId ? mem.at.get(tileKey(x, z)) : undefined);
  const cands: Vec3[] = [...(room.map.hotspots ?? []).map((h) => ({ ...h }))];
  for (let i = 0; i < 12; i++) {
    const c = nav.random(rnd);
    if (c) cands.push({ x: c.x, y: c.y, z: c.z });
  }
  let best: Vec3 | null = null;
  let bs = -Infinity;
  for (const c of cands) {
    const d = flat(bot.move, c);
    if (d < 6) continue;
    const t = seen(c.x, c.z);
    const stale = t === undefined ? 90 : Math.min(90, room.time - t);
    const s = stale - d * 0.5 + rnd() * 6;
    if (s > bs) {
      bs = s;
      best = c;
    }
  }
  return best ? { at: best, radius: 2, priority: 0.85, sprint: true, label: 'infected search' } : null;
}

interface Rally {
  at: Vec3;
  t: number;
  map: string;
}
const rallies = new WeakMap<Room, Rally>();

/** Walls around a spot: how many of 8 directions are blocked within 3 m at chest height. */
export function enclosure(room: Room, at: Vec3): number {
  let n = 0;
  const from = { x: at.x, y: at.y + 1.1, z: at.z };
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (!room.world.lineOfSight(from, { x: from.x + Math.cos(a) * 3, y: from.y, z: from.z + Math.sin(a) * 3 })) n++;
  }
  return n;
}

/** The Survivors' rally point (shared; re-picked when the Infected close in on it). */
export function rallyPoint(room: Room, rules: InfectedRules, rnd: () => number = Math.random): Vec3 | null {
  let cur = rallies.get(room);
  if (cur && (cur.map !== room.mapId || cur.t < room.matchStartTime)) cur = undefined;
  const infected = [...room.players.values()].filter((p) => p.alive && rules.roleOf(p) === 'infected');
  const survivors = [...room.players.values()].filter((p) => p.alive && rules.roleOf(p) === 'survivor');
  const nearInfected = (at: Vec3) => infected.reduce((m, q) => Math.min(m, flat(q.move, at)), Infinity);
  if (cur && (nearInfected(cur.at) > RALLY_DANGER || room.time - cur.t < RALLY_MIN_SEC)) return cur.at;
  const nav = navFor(room.map);
  const cands: Vec3[] = [...(room.map.hotspots ?? []).map((h) => ({ ...h }))];
  for (let i = 0; i < 24; i++) {
    const c = nav.random(rnd);
    if (c) cands.push({ x: c.x, y: c.y, z: c.z });
  }
  if (cur) cands.push(cur.at);
  if (!cands.length) return null;
  let cx = 0;
  let cz = 0;
  for (const s of survivors) {
    cx += s.move.x;
    cz += s.move.z;
  }
  const centre = survivors.length ? { x: cx / survivors.length, y: 0, z: cz / survivors.length } : null;
  let best: Vec3 | null = null;
  let bs = -Infinity;
  for (const c of cands) {
    const cell = nav.cellAt(c, true);
    if (!cell || !cell.core) continue;
    const at = { x: cell.x, y: cell.y, z: cell.z };
    let s = rnd() * 2;
    if (infected.length) {
      const dI = nearInfected(at);
      s += Math.min(dI, 35) * 0.6;
      if (dI < 10) s -= 20;
    }
    if (centre) s -= flat(at, centre) * 0.25;
    const k = enclosure(room, at);
    s += Math.min(k, 5) * 1.5 - (k >= 8 ? 4 : 0);
    if (cur && flat(at, cur.at) < 1) s += 5;
    if (s > bs) {
      bs = s;
      best = at;
    }
  }
  if (best) rallies.set(room, { at: best, t: room.time, map: room.mapId });
  return best;
}

/** A Survivor bot's goal: hold its place at the rally point (spread a little per bot). */
export function survivorGoal(room: Room, rules: InfectedRules, bot: PlayerState): BotGoal | null {
  const r = rallyPoint(room, rules);
  if (!r) return null;
  const h = hashString(bot.id);
  const a = ((h % 360) * Math.PI) / 180;
  const off = 1 + (h % 7) * 0.25;
  const nav = navFor(room.map);
  const cell = nav.cellAt({ x: r.x + Math.cos(a) * off, y: r.y, z: r.z + Math.sin(a) * off }, true);
  const at = cell && cell.core && Math.abs(cell.y - r.y) < 1 ? { x: cell.x, y: cell.y, z: cell.z } : r;
  const threatened = [...room.players.values()].some((p) => p.alive && rules.roleOf(p) === 'infected' && flat(p.move, bot.move) < 20);
  return { at, radius: 2.5, hold: true, priority: 0.9, sprint: threatened || flat(bot.move, at) > 12, label: 'survivor rally' };
}

let registered = false;

/** Register the Infected bot goal and style sources once (idempotent). */
export function registerInfectedBots(): void {
  if (registered) return;
  registered = true;
  registerBotGoal('infected', (room, bot) => {
    const rules = rulesOf(room);
    if (!rules || room.phase !== 'playing' || !bot.alive) return null;
    if (rules.roleOf(bot) === 'infected') return infectedGoal(room, rules, bot);
    // Before the first infection Survivors spread out and roam (as from MW3's spawns); a pack at
    // one spot would hand the First Infected a crowd to start in.
    return rules.started ? survivorGoal(room, rules, bot) : null;
  });
  registerBotStyle('infected', (room, bot) => {
    const rules = rulesOf(room);
    if (!rules) return null;
    return rules.roleOf(bot) === 'infected' ? { meleeHappy: true, rush: true, throwAtRange: true, conserveAmmo: false } : { kite: true, meleeHappy: false, rush: false };
  });
}

