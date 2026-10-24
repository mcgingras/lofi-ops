/**
 * Pack-a-Punch signature effects on the server (kinds and numbers in shared/defs/pap-effects.ts,
 * the per-weapon rows in shared/defs/pack-a-punch.ts). Every effect keys on the weapon id the
 * shot / damage / kill is credited to and only works while the attacker carries that gun packed,
 * so bots and humans get them alike (bots fire through the same `room.fire`).
 *
 * - `fire` event: pierce / collateral (re-trace the first pellet past the bodies it hit, at the
 *   shooter's view time), ricochet (a bullet stopped by a wall bounces once), knockback (close
 *   shotgun hits shove).
 * - `damage` event (bullet hits; priority 50 so the bots' flinch reads a fresh stagger): burn,
 *   venom, mark, stagger, zap, frost, shatter.
 * - `death` event: headblast (a head kill bursts), shockwave (a kill shoves and slows around the
 *   body).
 * - Modifiers: `damageTaken` (shatter), `speedMultiplier` (shockwave slow), `radarVisible` (marked
 *   targets show on the marker's radar, and bots perceive them), `flinchMultiplier` and
 *   `botSkillOffset` (stagger on bots), `canAds` (dual wield).
 * - The underbarrel extras (`launcher`): `syncPapExtras` puts the grenade launcher / Masterkey in
 *   slot 2 while the gun is packed (the buff code calls it) and takes it back after.
 *
 * Effect damage (burn and venom ticks, zaps, head blasts) goes through `fxDamage`, which tells the packed
 * damage multiplier to stay out (`inPapFx`): those numbers are final.
 */
import { damageAtRange, isLowerTorso, partMultiplier } from '../../../../shared/ballistics';
import { poseHitboxes, poseStance, rayHitboxes, type HitPart } from '../../../../shared/collision';
import { PLAYER } from '../../../../shared/constants';
import type { DamageInfo } from '../../../../shared/events';
import { PAP_CAMO, papEffect, papEffectOf } from '../../../../shared/defs/pack-a-punch';
import { burnPerTick, knockImpulse, PAP_FX, papRoller, papV3, pierceOf, pulseImpulse, reflect, venomPerTick, type PapEffectOf, type PapFx } from '../../../../shared/defs/pap-effects';
import { WINTERS_HOWL } from '../../../../shared/defs/wonder';
import { hashString, normalize, type Vec3 } from '../../../../shared/math';
import { bodyHeight, movePose } from '../../../../shared/movement';
import { effectiveDistance, keepAt, penetrationMaterial, penetrationType, traceBullet } from '../../../../shared/penetration';
import { forceSlot } from '../../../combat';
import type { Pose } from '../../../lagcomp';
import { makeWeapon, type PlayerState, type WeaponState } from '../../../player';
import type { Room } from '../../../room';
import { launch, syncFrostEntity, wonderOf } from '../../weapons/wonder/index';

/** Per-player effect state (as a victim, and the marks a shooter placed). */
export interface PapFxExt {
  burn: { by: string; weapon: string; until: number; next: number; per: number } | null;
  /** Poison from venom rounds: `stacks` doses, ticking like a burn (kept apart, so both can run). */
  venom: { by: string; weapon: string; until: number; next: number; per: number; stacks: number } | null;
  shatterUntil: number;
  shatter: number;
  slowUntil: number;
  slow: number;
  staggerUntil: number;
  stagger: PapEffectOf<'stagger'> | null;
  /** Marks this player placed: target id -> until (room time) and the target's life (spawn time). */
  marks: Map<string, { until: number; life: number }>;
}

declare module '../../../player' {
  interface PlayerExt {
    pap?: PapFxExt;
  }
  interface WeaponState {
    /** An underbarrel weapon a Pack-a-Punch effect put in slot 2 (taken back when the gun reverts). */
    papExtra?: boolean;
    /** A class launcher in slot 2 topped up to a `launcher` effect's rounds for this pack. */
    papTopped?: boolean;
  }
}

export const papFxOf = (p: PlayerState): PapFxExt =>
  (p.ext.pap ??= { burn: null, venom: null, shatterUntil: 0, shatter: 1, slowUntil: 0, slow: 1, staggerUntil: 0, stagger: null, marks: new Map() });

/** The underbarrel slot (weapons feature). */
const GL_SLOT = 2;

let fxDepth = 0;
/** True while effect damage is being dealt (the packed damage multiplier stays out of it). */
export const inPapFx = (): boolean => fxDepth > 0;
/** Deal effect damage: final numbers, never scaled by the packed multiplier. */
function fxDamage<T>(fn: () => T): T {
  fxDepth++;
  try {
    return fn();
  } finally {
    fxDepth--;
  }
}

const rolls = new WeakMap<Room, () => number>();
/** Replace a room's roll source for chance effects (tests force a zap or a miss). */
export function setPapRng(room: Room, roll: () => number): void {
  rolls.set(room, roll);
}
/** The room's roll source: seeded from the room id, so a replay of the same shots rolls the same. */
function roll(room: Room): number {
  let r = rolls.get(room);
  if (!r) rolls.set(room, (r = papRoller(hashString(`pap:${room.id}`))));
  return r();
}

/** The packed weapon `p` carries with this id (effects are credited by weapon id). */
export const packedGun = (p: PlayerState, id: string): WeaponState | undefined => p.weapons.find((w) => w.pap && w.def.base.id === id);

const push = (room: Room, to: PlayerState | null, fx: PapFx) => room.sendFeature(to, 'killstreaks.papFx', fx);
const chestOf = (q: PlayerState): Vec3 => ({ x: q.move.x, y: q.move.y + Math.min(PLAYER.height, bodyHeight(q.move)) * 0.62, z: q.move.z });
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Is `target` marked for `viewer` right now (outlined through walls, on their radar)? */
export function papMarked(room: Room, viewer: PlayerState, target: PlayerState): boolean {
  const m = viewer.ext.pap?.marks.get(target.id);
  return !!m && target.alive && m.until > room.time && m.life === target.spawnTime;
}
/** Is `p` burning right now? */
export const papBurning = (room: Room, p: PlayerState): boolean => p.alive && !!p.ext.pap?.burn && p.ext.pap.burn.until > room.time;
/** The damage-taken multiplier on `p` from shatter rounds (1 when none). */
export const papShatter = (room: Room, p: PlayerState): number => (p.ext.pap && p.ext.pap.shatterUntil > room.time ? p.ext.pap.shatter : 1);

// --------------------------------------------------------------------------- the underbarrel extras

/**
 * Keep slot 2 in line with the packed primary: a `launcher` effect puts its weapon there (the
 * grenade launcher with `rounds` grenades, the Masterkey with `rounds` shells), a gun without one
 * takes back what an effect put there. A real underbarrel launcher already in slot 2 is topped up
 * to the effect's rounds instead (and keeps its own after). Call it after packing or unpacking.
 */
export function syncPapExtras(room: Room, p: PlayerState): void {
  const primary = p.weapons[0];
  const spec = primary?.pap ? papEffectOf(primary.def.base.id, 'launcher') : null;
  const extra = p.weapons[GL_SLOT];
  if (extra?.papExtra && (!spec || extra.def.base.id !== spec.weapon)) {
    if (p.slot >= GL_SLOT) forceSlot(room, p, 0);
    p.weapons.splice(GL_SLOT, 1);
  }
  if (!spec || p.weapons.length > GL_SLOT) {
    // A launcher from the class already there: top it up once per pack.
    const gl = p.weapons[GL_SLOT];
    if (spec && gl && !gl.papExtra && gl.def.base.id === spec.weapon && !gl.papTopped) {
      gl.papTopped = true;
      gl.mag = gl.def.magazine;
      gl.reserve = Math.max(gl.reserve, spec.rounds - gl.def.magazine);
    }
    return;
  }
  if (p.weapons.length < GL_SLOT) return;
  const w = makeWeapon({ weapon: spec.weapon, attachments: [], camo: PAP_CAMO }, spec.weapon);
  w.mag = Math.min(w.def.magazine, spec.rounds);
  w.reserve = Math.max(0, spec.rounds - w.mag);
  w.papExtra = true;
  p.weapons.push(w);
}

/** Take back every extra and clear the top-up mark (the buff ended). */
export function dropPapExtras(room: Room, p: PlayerState): void {
  const extra = p.weapons[GL_SLOT];
  if (extra?.papExtra) {
    if (p.slot >= GL_SLOT) forceSlot(room, p, 0);
    p.weapons.splice(GL_SLOT, 1);
  } else if (extra?.papTopped) {
    delete extra.papTopped;
    extra.mag = Math.min(extra.mag, extra.def.magazine);
    extra.reserve = Math.min(extra.reserve, extra.def.reserve);
  }
}

// --------------------------------------------------------------------------- path effects (fire)

type FireEv = { player: PlayerState; weapon: string; origin: Vec3; dir: Vec3; hits: { victim: PlayerState; part: HitPart; damage: number; penetrated?: boolean }[]; end: Vec3; time?: number };

const posesAt = (room: Room, time: number | undefined): Map<string, Pose> | null => (time !== undefined && time < room.time ? room.history.rewind(time) : null);

/** A body along a ray (rewound when `poses`), nearest first, beyond `minT` and before `maxT`. */
function bodiesOnRay(room: Room, p: PlayerState, o: Vec3, d: Vec3, minT: number, maxT: number, poses: Map<string, Pose> | null, skip: Set<PlayerState>): { q: PlayerState; t: number; part: HitPart; lower: boolean }[] {
  const out: { q: PlayerState; t: number; part: HitPart; lower: boolean }[] = [];
  for (const q of room.players.values()) {
    if (q === p || skip.has(q) || !q.alive || !room.canDamage(p, q)) continue;
    const pose = poses?.get(q.id) ?? { ...movePose(q.move, q.yaw), alive: true };
    if (!pose.alive) continue;
    const hit = rayHitboxes(o, d, poseHitboxes(pose), maxT);
    if (!hit || hit.t < minT) continue;
    out.push({ q, t: hit.t, part: hit.part, lower: hit.part === 'torso' && isLowerTorso(pose, poseStance(pose), o.y + d.y * hit.t) });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Pierce / collateral: the first pellet goes on through the body it hit into the next ones. */
export function pierceShot(room: Room, e: FireEv, w: WeaponState, spec: { bodies: number; keep: number }): PlayerState[] {
  if (!e.hits.length || spec.bodies <= 0) return [];
  const p = e.player;
  const def = w.def;
  const len = Math.hypot(e.end.x - e.origin.x, e.end.y - e.origin.y, e.end.z - e.origin.z);
  if (len < 1e-3) return [];
  const d = { x: (e.end.x - e.origin.x) / len, y: (e.end.y - e.origin.y) / len, z: (e.end.z - e.origin.z) / len };
  const type = p.isBot ? 'none' : penetrationType(def);
  const depthMultiplier = type === 'none' ? 1 : room.modifiers.mul('penetrationMultiplier', p);
  const path = traceBullet(room.world, (s) => penetrationMaterial(room.map, s.mat), e.origin, d, { range: def.range ?? 200, type, depthMultiplier });
  const poses = posesAt(room, e.time);
  const next = bodiesOnRay(room, p, e.origin, d, len - 0.05, path.t, poses, new Set(e.hits.map((h) => h.victim))).slice(0, spec.bodies);
  const pts: number[] = [];
  const hit: PlayerState[] = [];
  for (const c of next) {
    const walls = path.walls.filter((x) => x.tIn < c.t);
    const amount = damageAtRange(def, effectiveDistance(walls, c.t)) * partMultiplier(def, c.part, c.lower) * keepAt(walls, c.t) * spec.keep;
    room.damage({ victim: c.q, attacker: p, amount, weapon: e.weapon, part: c.part, means: 'bullet', from: e.origin, distance: c.t, ...(walls.length ? { penetrated: true } : {}) });
    pts.push(r2(e.origin.x + d.x * c.t), r2(e.origin.y + d.y * c.t), r2(e.origin.z + d.z * c.t));
    hit.push(c.q);
  }
  if (pts.length) push(room, null, { k: 'pierce', p: p.id, pts });
  return hit;
}

/** Ricochet: a bullet that stopped on a wall (no body hit) bounces once and can hit someone for `keep` of its damage. */
export function ricochetShot(room: Room, e: FireEv, w: WeaponState, spec: PapEffectOf<'ricochet'>): { victim: PlayerState | null; from: Vec3; to: Vec3 } | null {
  if (e.hits.length) return null;
  const p = e.player;
  const def = w.def;
  const range = def.range ?? 200;
  const len = Math.hypot(e.end.x - e.origin.x, e.end.y - e.origin.y, e.end.z - e.origin.z);
  if (len < 0.05 || len >= range - 0.5) return null;
  const d = { x: (e.end.x - e.origin.x) / len, y: (e.end.y - e.origin.y) / len, z: (e.end.z - e.origin.z) / len };
  const back = Math.min(0.3, len);
  const probe = room.world.raycast({ x: e.end.x - d.x * back, y: e.end.y - d.y * back, z: e.end.z - d.z * back }, d, back + 0.3, 'bullets');
  if (!probe) return null;
  const n = probe.normal;
  if (d.x * n.x + d.y * n.y + d.z * n.z >= 0) return null;
  const r = normalize(reflect(d, n));
  const lift = PAP_FX.ricochetLift;
  const from = { x: probe.point.x + n.x * lift, y: probe.point.y + n.y * lift, z: probe.point.z + n.z * lift };
  const wall = room.world.raycast(from, r, spec.range, 'bullets');
  const maxT = wall ? wall.t : spec.range;
  const c = bodiesOnRay(room, p, from, r, 0, maxT, posesAt(room, e.time), new Set())[0];
  const t = c ? c.t : maxT;
  const to = { x: from.x + r.x * t, y: from.y + r.y * t, z: from.z + r.z * t };
  if (c) room.damage({ victim: c.q, attacker: p, amount: damageAtRange(def, len + c.t) * partMultiplier(def, c.part, c.lower) * spec.keep, weapon: e.weapon, part: c.part, means: 'bullet', from, distance: len + c.t });
  push(room, null, { k: 'rico', p: p.id, a: papV3(from), b: papV3(to), hit: !!c });
  return { victim: c?.q ?? null, from, to };
}

/** Knockback: close hits shove the target back along the shot (less for fewer pellets and further away). */
export function knockShot(room: Room, e: FireEv, spec: PapEffectOf<'knockback'>): void {
  for (const h of e.hits) {
    const q = h.victim;
    if (!q.alive) continue;
    const d = Math.hypot(q.move.x - e.origin.x, q.move.z - e.origin.z);
    const imp = knockImpulse(spec, e.dir, d);
    if (!imp) continue;
    const k = Math.min(1, h.damage / 45);
    if (!(k > 0)) continue;
    launch(room, q, e.player, { x: imp.x * k, y: imp.y * k, z: imp.z * k }, spec.sec);
    push(room, null, { k: 'knock', v: q.id, x: r2(q.move.x), y: r2(q.move.y), z: r2(q.move.z) });
  }
}

// --------------------------------------------------------------------------- hit effects (damage)

/** Set (or refresh) a burn: `damage` over `sec`, credited to `by` with `weapon`. Repeat hits refresh the clock, never stack. */
export function igniteBurn(room: Room, q: PlayerState, by: PlayerState, weapon: string, spec: PapEffectOf<'burn'>): void {
  const x = papFxOf(q);
  const fresh = !x.burn || x.burn.until <= room.time;
  x.burn = { by: by.id, weapon, until: room.time + spec.sec, next: fresh ? room.time + PAP_FX.burnTick : (x.burn?.next ?? room.time + PAP_FX.burnTick), per: burnPerTick(spec) };
  push(room, null, { k: 'burn', v: q.id, by: by.id, until: r3(x.burn.until) });
}

/**
 * Add a dose of venom: one more stack (up to `maxStacks`; a different shooter's venom starts over
 * at one), the clock restarts at `sec`, and the poison ticks `perHit` x stacks over it.
 */
export function poisonTarget(room: Room, q: PlayerState, by: PlayerState, weapon: string, spec: PapEffectOf<'venom'>): number {
  const x = papFxOf(q);
  const live = !!x.venom && x.venom.until > room.time && x.venom.by === by.id;
  const stacks = Math.min(spec.maxStacks, live ? x.venom!.stacks + 1 : 1);
  x.venom = { by: by.id, weapon, until: room.time + spec.sec, next: live ? x.venom!.next : room.time + PAP_FX.burnTick, per: venomPerTick(spec, stacks), stacks };
  push(room, null, { k: 'venom', v: q.id, by: by.id, until: r3(x.venom.until), n: stacks });
  return stacks;
}

/** Is `p` poisoned right now (venom rounds), and how many doses? 0 when not. */
export const papVenom = (room: Room, p: PlayerState): number => (p.alive && p.ext.pap?.venom && p.ext.pap.venom.until > room.time ? p.ext.pap.venom.stacks : 0);

/** Burn and venom ticks for everyone on fire or poisoned (per room tick). */
export function tickBurns(room: Room): void {
  for (const q of room.players.values()) {
    for (const kind of ['burn', 'venom'] as const) {
      const b = q.ext.pap?.[kind];
      if (!b) continue;
      if (!q.alive || room.phase !== 'playing') {
        q.ext.pap![kind] = null;
        continue;
      }
      const means = kind === 'burn' ? 'fire' : 'poison';
      while (q.alive && b.next <= room.time + 1e-9 && b.next <= b.until + 1e-9) {
        b.next += PAP_FX.burnTick;
        const by = room.players.get(b.by) ?? null;
        fxDamage(() => room.damage({ victim: q, attacker: by, amount: b.per, weapon: b.weapon, part: 'torso', means, from: null, distance: by ? Math.hypot(by.move.x - q.move.x, by.move.z - q.move.z) : 0 }));
      }
      if (q.ext.pap?.[kind] === b && b.next > b.until + 1e-9) q.ext.pap[kind] = null;
    }
  }
}

/** Mark `q` for `by`: outlined through walls (their client) and on their radar for `sec`. */
export function markTarget(room: Room, q: PlayerState, by: PlayerState, spec: PapEffectOf<'mark'>): void {
  const until = room.time + spec.sec;
  papFxOf(by).marks.set(q.id, { until, life: q.spawnTime });
  push(room, by, { k: 'mark', v: q.id, until: r3(until) });
}

/** Stagger `q`: a heavy flinch (their aim kicks; bots flinch harder and aim worse for `sec`). */
export function staggerTarget(room: Room, q: PlayerState, spec: PapEffectOf<'stagger'>): void {
  const x = papFxOf(q);
  x.staggerUntil = room.time + spec.sec;
  x.stagger = spec;
  const side = roll(room) < 0.5 ? -1 : 1;
  push(room, q, { k: 'stagger', v: q.id, p: spec.kickDeg, y: r2(side * spec.kickDeg * 0.6) });
}

/** Chain zap: with `chance`, arc `damage` from `victim` to the nearest other enemy of `by` within `range` (clear line). */
export function zapFrom(room: Room, victim: PlayerState, by: PlayerState, weapon: string, spec: PapEffectOf<'zap'>): PlayerState | null {
  if (roll(room) >= spec.chance) return null;
  const from = chestOf(victim);
  let best: PlayerState | null = null;
  let bd: number = spec.range;
  for (const q of room.players.values()) {
    if (q === victim || q === by || !q.alive || !room.canDamage(by, q)) continue;
    const c = chestOf(q);
    const d = Math.hypot(c.x - from.x, c.y - from.y, c.z - from.z);
    if (d <= bd && room.world.lineOfSight(from, c, 'bullets')) {
      bd = d;
      best = q;
    }
  }
  if (!best) return null;
  const to = chestOf(best);
  room.sendFeature(null, 'weapons.wonderFx', { k: 'arc', p: by.id, o: papV3(from), e: papV3(to), hop: 1, hit: true });
  const target = best;
  fxDamage(() => room.damage({ victim: target, attacker: by, amount: spec.damage, weapon, part: 'torso', means: 'shock', from, distance: Math.hypot(by.move.x - target.move.x, by.move.z - target.move.z) }));
  return best;
}

/** Frost round: freeze `q` solid (Winter's Howl's frost) for `frozenSec` (x the frostMultiplier modifier), then it thaws as usual. */
export function freezeTarget(room: Room, q: PlayerState, spec: PapEffectOf<'frost'>): void {
  const k = room.modifiers.mul('frostMultiplier', q);
  if (!(k > 0)) return;
  const w = wonderOf(q);
  const sec = spec.frozenSec * k;
  w.frost = 1;
  w.frozenUntil = Math.max(w.frozenUntil, room.time + sec);
  // Thawing starts `thawDelay` after the last frost: date it so the thaw begins when the freeze ends.
  w.frostAt = room.time + sec - WINTERS_HOWL.thawDelay;
  syncFrostEntity(room, q);
  push(room, null, { k: 'freeze', v: q.id, x: r2(q.move.x), y: r2(q.move.y), z: r2(q.move.z) });
}

/** Shatter round: `q` takes `mult` damage from everyone for `sec`. */
export function shatterTarget(room: Room, q: PlayerState, by: PlayerState, spec: PapEffectOf<'shatter'>): void {
  const x = papFxOf(q);
  x.shatterUntil = room.time + spec.sec;
  x.shatter = spec.mult;
  push(room, null, { k: 'shatter', v: q.id, by: by.id, until: r3(x.shatterUntil) });
}

// --------------------------------------------------------------------------- kill effects (death)

/** Exploding headshot: a small blast at the victim's head that hurts those around them. */
export function headBlast(room: Room, victim: PlayerState, by: PlayerState, weapon: string, spec: PapEffectOf<'headblast'>): PlayerState[] {
  const at = { x: victim.move.x, y: victim.move.y + Math.min(PLAYER.height, bodyHeight(victim.move)) * 0.85, z: victim.move.z };
  push(room, null, { k: 'headblast', p: by.id, x: r2(at.x), y: r2(at.y), z: r2(at.z), r: spec.radius });
  return fxDamage(() => room.radiusDamage(at, spec.radius, spec.max, spec.min, { attacker: by, weapon, means: 'explosive' }));
}

/** Shockwave: a kill's pulse shoves enemies of `by` within the radius of the body and slows them. */
export function shockwave(room: Room, victim: PlayerState, by: PlayerState, spec: PapEffectOf<'shockwave'>): PlayerState[] {
  const c = { x: victim.move.x, y: victim.move.y, z: victim.move.z };
  push(room, null, { k: 'pulse', p: by.id, x: r2(c.x), y: r2(c.y + 0.1), z: r2(c.z), r: spec.radius });
  const out: PlayerState[] = [];
  for (const q of room.players.values()) {
    if (q === victim || q === by || !q.alive || !room.canDamage(by, q)) continue;
    if (Math.abs(q.move.y - c.y) > 2.5) continue;
    const imp = pulseImpulse(spec, c, q.move);
    if (!imp || !room.world.lineOfSight({ x: c.x, y: c.y + 1, z: c.z }, { x: q.move.x, y: q.move.y + 1, z: q.move.z }, 'bullets')) continue;
    launch(room, q, by, imp, 0.3);
    const x = papFxOf(q);
    x.slowUntil = room.time + spec.sec;
    x.slow = spec.slow;
    out.push(q);
  }
  return out;
}

// --------------------------------------------------------------------------- wiring

/** Per room: every effect's handlers and modifiers. */
export function wirePapEffects(room: Room): void {
  room.bus.on('fire', (e) => {
    const w = packedGun(e.player, e.weapon);
    const fx = w ? papEffect(e.weapon) : null;
    if (!w || !fx) return;
    if (fx.kind === 'pierce' || fx.kind === 'collateral') pierceShot(room, e, w, pierceOf(fx));
    else if (fx.kind === 'ricochet') ricochetShot(room, e, w, fx);
    else if (fx.kind === 'knockback') knockShot(room, e, fx);
  });

  room.bus.on(
    'damage',
    (ev: DamageInfo<PlayerState> & { health: number }) => {
      const by = ev.attacker;
      if (!by || by === ev.victim || ev.means !== 'bullet' || inPapFx() || !packedGun(by, ev.weapon)) return;
      const fx = papEffect(ev.weapon);
      if (!fx) return;
      const q = ev.victim;
      const alive = ev.health > 0;
      switch (fx.kind) {
        case 'burn':
          if (alive) igniteBurn(room, q, by, ev.weapon, fx);
          break;
        case 'venom':
          if (alive) poisonTarget(room, q, by, ev.weapon, fx);
          break;
        case 'mark':
          if (alive) markTarget(room, q, by, fx);
          break;
        case 'stagger':
          if (alive) staggerTarget(room, q, fx);
          break;
        case 'zap':
          zapFrom(room, q, by, ev.weapon, fx);
          break;
        case 'frost':
          if (alive) freezeTarget(room, q, fx);
          break;
        case 'shatter':
          if (alive) shatterTarget(room, q, by, fx);
          break;
      }
    },
    { priority: 50 },
  );

  room.bus.on('death', (e) => {
    const by = e.attacker;
    const v = e.victim;
    if (by && by !== v && e.means === 'bullet' && room.isEnemy(by, v) && packedGun(by, e.weapon)) {
      const head = papEffectOf(e.weapon, 'headblast');
      if (head && e.headshot) headBlast(room, v, by, e.weapon, head);
      const pulse = papEffectOf(e.weapon, 'shockwave');
      if (pulse) shockwave(room, v, by, pulse);
    }
    clearStatus(v);
  });
  room.bus.on('spawn', ({ player }) => clearStatus(player));
  room.bus.on('tick', () => tickBurns(room));

  room.modifiers.add('damageTaken', (victim) => {
    const k = papShatter(room, victim);
    return k !== 1 ? k : undefined;
  }, 'killstreaks.pap.shatter');
  room.modifiers.add('speedMultiplier', (p) => (p.ext.pap && p.ext.pap.slowUntil > room.time ? p.ext.pap.slow : undefined), 'killstreaks.pap.shockwave');
  room.modifiers.add('radarVisible', (target, viewer) => (papMarked(room, viewer, target) ? true : undefined), 'killstreaks.pap.mark');
  room.modifiers.add('flinchMultiplier', (p) => (p.ext.pap?.stagger && p.ext.pap.staggerUntil > room.time ? p.ext.pap.stagger.botFlinch : undefined), 'killstreaks.pap.stagger');
  room.modifiers.add('botSkillOffset', (bot, knob) => (knob === 'aimErrorDeg' && bot.ext.pap?.stagger && bot.ext.pap.staggerUntil > room.time ? bot.ext.pap.stagger.botAimDeg : undefined), 'killstreaks.pap.stagger');
  // Dual wield: a gun in each hand, no sights.
  room.modifiers.add('canAds', (p) => {
    const w = p.weapons[p.slot];
    return w?.pap && papEffectOf(w.def.base.id, 'akimbo') ? false : undefined;
  }, 'killstreaks.pap.akimbo');
}

function clearStatus(p: PlayerState): void {
  const x = p.ext.pap;
  if (!x) return;
  x.burn = null;
  x.venom = null;
  x.shatterUntil = 0;
  x.slowUntil = 0;
  x.staggerUntil = 0;
  x.stagger = null;
}
