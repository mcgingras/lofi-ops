/**
 * Care Package: the caller throws a smoke canister (BO1's marker); where it settles a helicopter
 * flies in and drops a crate. Anyone can take it
 * by holding USE next to it (owner fast, teammates slower, enemies slowest); it holds a random
 * killstreak or an ammo refill. Hardline Pro: the owner's first USE press rerolls the contents.
 * Hacker Pro: an enemy hacker booby-traps it instead of taking it; the next of the owner's side to
 * take it blows up (credited to the hacker). Landing on someone crushes them.
 *
 * The Valkyrie Rockets drop (`callValkyrieDrop`, BO1 `m220_tow_drop_mp`) is the same delivery with
 * fixed contents: the crate holds the launcher (no Hardline reroll). Crate contents `valkyrie`
 * always mean the launcher, as in BO1 (a Care Package rolls `m220_tow_mp`, the launcher itself), so
 * taking one puts `VALKYRIE_LAUNCHER` in the ready list. A bot's Valkyrie crate is taken by the bot
 * as soon as it lands (bots don't walk to crates).
 */
import { MARKER, markerBody, markerStep, resolveDrop } from '../../../../shared/defs/care-marker';
import { CARE_PACKAGE_WEIGHTS, CRATE_REACH, KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { VALKYRIE_LAUNCHER } from '../../../../shared/defs/valkyrie';
import type { Body } from '../../../../shared/projectile';
import { Buttons } from '../../../../shared/input';
import type { Vec3 } from '../../../../shared/math';
import type { Entity } from '../../../entities';
import type { PlayerState } from '../../../player';
import { isPro } from '../../perks/common';
import { grant } from '../state';
import type { Active, KsRoom } from '../world';
import type { CallArgs } from './types';

export const PACKAGE = { heliSpeed: 24, heliHp: 1000, hover: 1.2, fall: 12, life: 60, radius: CRATE_REACH.r, owner: 0.5, friend: 1.25, enemy: 3, hacker: 1.25, crush: 1.2, trap: { r: 5, max: 300, min: 80 } };

export interface Crate {
  ent: Entity;
  owner: PlayerState;
  contents: string;
  landed: boolean;
  vy: number;
  groundY: number;
  expires: number;
  takers: Map<string, number>;
  rerolled: boolean;
  trap: PlayerState | null;
  /** Contents set by the streak (the Valkyrie launcher): no reroll; a bot owner takes it on landing. */
  fixed: boolean;
}

const crates = new WeakMap<KsRoom, Crate[]>();
export const cratesOf = (ctx: KsRoom): Crate[] => {
  let c = crates.get(ctx);
  if (!c) crates.set(ctx, (c = []));
  return c;
};

export function rollContents(rand = Math.random, exclude?: string): string {
  const entries = Object.entries(CARE_PACKAGE_WEIGHTS).filter(([id]) => id !== exclude);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [id, w] of entries) {
    r -= w;
    if (r < 0) return id;
  }
  return entries[0]![0];
}

/** Spawn a crate falling from `from` onto x,z (also used by tests). */
export function dropCrate(ctx: KsRoom, act: Active, owner: PlayerState, from: Vec3, contents = rollContents(), fixed = false): Crate {
  const ent = ctx.room.entities.add({ kind: KS_ENTITY.crate, x: from.x, y: from.y, z: from.z, yaw: Math.random() * Math.PI * 2, owner: owner.id, team: owner.team, s: { l: false } });
  act.entities.push(ent.id);
  const c: Crate = { ent, owner, contents, landed: false, vy: 0, groundY: ctx.groundAt(from.x, from.z), expires: Infinity, takers: new Map(), rerolled: false, trap: null, fixed };
  cratesOf(ctx).push(c);
  return c;
}

/** The smoke canister of one Care Package: flying (`body`), then lying where the drop goes. */
interface Canister {
  ent: Entity;
  body: Body | null;
  flown: number;
  from: Vec3;
  /** Room time it goes away (set when the crate lands). */
  until: number;
}

/**
 * A Care Package. Humans throw the marker canister (`args.launch`, from the STREAK + FIRE flow):
 * it flies with the shared marker physics, and where it settles (`resolveDrop`: on it, or the
 * clamped fallback for out-of-map, covered, roof or in-wall spots) the Chinook drops the crate
 * while the canister smokes. Bots (and tests) pass a `target`: the canister appears there,
 * smoking, and the helicopter comes at once.
 */
export function callCarePackage(ctx: KsRoom, p: PlayerState, args: CallArgs, opts: { contents?: string } = {}): string | null {
  const room = ctx.room;
  let canister: Canister;
  let target: Vec3 | null = null;
  if (args.launch) {
    const l = args.launch.throw;
    const ent = room.entities.add({ kind: KS_ENTITY.marker, x: l.pos.x, y: l.pos.y, z: l.pos.z, yaw: Math.atan2(-l.vel.x, -l.vel.z), owner: p.id, team: p.team, s: { k: 0 } });
    canister = { ent, body: markerBody(l), flown: 0, from: { ...args.launch.from }, until: room.time + MARKER.smokeMaxSec };
  } else {
    if (!args.target) return 'no_target';
    const t = ctx.clampToMap(args.target);
    target = { x: t.x, y: ctx.groundAt(t.x, t.z), z: t.z };
    const ent = room.entities.add({ kind: KS_ENTITY.marker, ...target, yaw: Math.random() * Math.PI * 2, owner: p.id, team: p.team, s: { k: 1, sm: room.time, v: 1 } });
    canister = { ent, body: null, flown: 0, from: target, until: room.time + MARKER.smokeMaxSec };
  }
  let heli: Entity | null = null;
  let phase: 'in' | 'hover' | 'out' = 'in';
  let hoverUntil = 0;
  let outDir = { x: 0, z: 0 };
  const deliver = (to: Vec3) => {
    target = to;
    const inYaw = Math.atan2(-(to.x - ctx.center.x), -(to.z - ctx.center.z)) + Math.PI + (Math.random() - 0.5);
    const h = room.entities.add({ kind: KS_ENTITY.dropHeli, ...ctx.edgePoint(inYaw, 30, ctx.heliY()), yaw: 0, owner: p.id, team: p.team });
    heli = h;
    act.entities.push(h.id);
    // BO1: the supply chopper can be shot down (bullets, launchers, a SAM). Brought down on its way
    // in, the crate falls from where it was; on its way out, it just goes.
    ctx.damageable(h, {
      hp: PACKAGE.heliHp,
      air: true,
      radius: 3.5,
      yOff: 0,
      active: act,
      score: 100,
      onDestroyed: () => {
        if (phase === 'in') {
          if (opts.contents) dropCrate(ctx, act, p, { x: h.x, y: h.y - 2, z: h.z }, opts.contents, true);
          else dropCrate(ctx, act, p, { x: h.x, y: h.y - 2, z: h.z });
          phase = 'out';
        }
        ctx.removeEntity(h.id);
      },
    });
  };
  const act: Active = {
    streak: 'care_package',
    owner: p,
    entities: [canister.ent.id],
    update(dt) {
      // The canister in flight: the same per-tick steps as the thrower's preview.
      const b = canister.body;
      if (b && room.entities.get(canister.ent.id)) {
        markerStep(room.world, b, dt);
        canister.flown += dt;
        const e = canister.ent;
        if (Math.hypot(b.pos.x - e.x, b.pos.z - e.z) > 1e-3) e.yaw = Math.atan2(-(b.pos.x - e.x), -(b.pos.z - e.z));
        e.x = b.pos.x;
        e.y = b.pos.y;
        e.z = b.pos.z;
        const lost = b.pos.y < room.map.bounds.min.y - 20;
        if (b.resting || lost || canister.flown >= MARKER.maxFlightSec - 1e-6) {
          canister.body = null;
          const drop = resolveDrop(room.world, room.map, b.pos, canister.from, b.resting);
          // A canister that left the map (or fell through it) lies at the drop instead.
          if (lost || drop.reason === 'bounds') {
            e.x = drop.x;
            e.y = drop.y;
            e.z = drop.z;
          }
          e.s = { k: 1, sm: room.time + MARKER.smokeDelaySec, v: drop.valid ? 1 : 0 };
          room.bus.emit('killstreaks.marker', { player: p, x: drop.x, y: drop.y, z: drop.z, valid: drop.valid, reason: drop.reason });
          deliver({ x: drop.x, y: drop.y, z: drop.z });
        }
      }
      const h = heli as Entity | null;
      if (h && target && room.entities.get(h.id)) {
        if (phase === 'in') {
          const dx = target.x - h.x;
          const dz = target.z - h.z;
          const d = Math.hypot(dx, dz);
          h.yaw = Math.atan2(-dx, -dz);
          const step = PACKAGE.heliSpeed * dt;
          if (d <= step) {
            h.x = target.x;
            h.z = target.z;
            phase = 'hover';
            hoverUntil = room.time + PACKAGE.hover;
            if (opts.contents) dropCrate(ctx, act, p, { x: target.x, y: h.y - 2, z: target.z }, opts.contents, true);
            else dropCrate(ctx, act, p, { x: target.x, y: h.y - 2, z: target.z });
            outDir = { x: dx / Math.max(d, 1e-6), z: dz / Math.max(d, 1e-6) };
          } else {
            h.x += (dx / d) * step;
            h.z += (dz / d) * step;
          }
        } else if (phase === 'hover') {
          if (room.time >= hoverUntil) phase = 'out';
        } else {
          h.x += outDir.x * PACKAGE.heliSpeed * dt;
          h.z += outDir.z * PACKAGE.heliSpeed * dt;
          h.y += 3 * dt;
          if (Math.hypot(h.x - ctx.center.x, h.z - ctx.center.z) > ctx.radius + 40) ctx.removeEntity(h.id);
        }
      }
      updateCrates(ctx, act, dt);
      // The smoke keeps going a little after the crate is down.
      const mine = cratesOf(ctx).filter((c) => act.entities.includes(c.ent.id));
      if (mine.some((c) => c.landed)) canister.until = Math.min(canister.until, room.time + MARKER.smokeAfterLandSec);
      if (room.entities.get(canister.ent.id) && !canister.body && room.time >= canister.until) ctx.removeEntity(canister.ent.id);
      return !!canister.body || !!(heli && room.entities.get((heli as Entity).id)) || mine.length > 0 || (!heli && !!room.entities.get(canister.ent.id));
    },
    cleanup() {
      const list = cratesOf(ctx);
      for (let i = list.length - 1; i >= 0; i--) if (act.entities.includes(list[i]!.ent.id)) list.splice(i, 1);
    },
  };
  // A target (bots): the helicopter is on its way at once.
  if (target) deliver(target);
  ctx.add(act);
  return null;
}

const captureTime = (ctx: KsRoom, c: Crate, p: PlayerState) => {
  if (p === c.owner) return PACKAGE.owner;
  if (ctx.sameSide(p, c.owner)) return PACKAGE.friend;
  return isPro(p, 'hacker') && !c.trap ? PACKAGE.hacker : PACKAGE.enemy;
};

function updateCrates(ctx: KsRoom, act: Active, dt: number): void {
  const room = ctx.room;
  const list = cratesOf(ctx);
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]!;
    if (!act.entities.includes(c.ent.id)) continue;
    if (!room.entities.get(c.ent.id)) {
      list.splice(i, 1);
      continue;
    }
    if (!c.landed) {
      c.vy = Math.min(PACKAGE.fall, c.vy + 20 * dt);
      c.ent.y -= c.vy * dt;
      if (c.ent.y <= c.groundY) {
        c.ent.y = c.groundY;
        c.landed = true;
        c.expires = room.time + PACKAGE.life;
        c.ent.s = { ...c.ent.s, l: true };
        ctx.fx({ kind: 'crate_land', x: c.ent.x, y: c.ent.y, z: c.ent.z });
        for (const q of room.players.values()) {
          if (q.alive && Math.hypot(q.move.x - c.ent.x, q.move.z - c.ent.z) < PACKAGE.crush && Math.abs(q.move.y - c.ent.y) < 1.8)
            room.damage({ victim: q, attacker: c.owner, amount: 1000, weapon: 'care_package', part: null, means: 'killstreak', from: { x: c.ent.x, y: c.ent.y + 2, z: c.ent.z }, distance: 0 });
        }
        if (c.fixed && c.owner.isBot && room.players.get(c.owner.id) === c.owner) {
          take(ctx, c, c.owner);
          list.splice(i, 1);
        }
      }
      continue;
    }
    if (room.time >= c.expires) {
      ctx.removeEntity(c.ent.id);
      list.splice(i, 1);
      continue;
    }
    for (const q of room.players.values()) {
      const near = q.alive && Math.hypot(q.move.x - c.ent.x, q.move.z - c.ent.z) <= PACKAGE.radius && Math.abs(q.move.y - c.ent.y) < CRATE_REACH.dy;
      if (!near || !(q.buttons & Buttons.USE)) {
        if (c.takers.delete(q.id) && q.session) room.sendFeature(q, 'killstreaks.crate', null);
        continue;
      }
      const t = (c.takers.get(q.id) ?? 0) + dt;
      c.takers.set(q.id, t);
      const need = captureTime(ctx, c, q);
      if (q.session && Math.floor((t - dt) * 5) !== Math.floor(t * 5)) room.sendFeature(q, 'killstreaks.crate', { entity: c.ent.id, contents: ctx.sameSide(q, c.owner) || isPro(q, 'hacker') ? c.contents : '?', progress: Math.min(1, t / need) });
      if (t >= need) {
        take(ctx, c, q);
        list.splice(i, 1);
        break;
      }
    }
  }
}

function take(ctx: KsRoom, c: Crate, q: PlayerState): void {
  const room = ctx.room;
  if (q.session) room.sendFeature(q, 'killstreaks.crate', null);
  // A booby trap goes off on the owner's side.
  if (c.trap && ctx.sameSide(q, c.owner)) {
    ctx.removeEntity(c.ent.id);
    ctx.blast({ x: c.ent.x, y: c.ent.y, z: c.ent.z }, PACKAGE.trap.r, PACKAGE.trap.max, PACKAGE.trap.min, room.players.get(c.trap.id) ?? null, 'care_package');
    return;
  }
  // An enemy hacker with Pro rigs it instead of taking it.
  if (!ctx.sameSide(q, c.owner) && isPro(q, 'hacker') && !c.trap) {
    c.trap = q;
    c.takers.clear();
    ctx.fx({ kind: 'hacked', x: c.ent.x, y: c.ent.y, z: c.ent.z });
    cratesOf(ctx).push(c); // still on the ground
    return;
  }
  ctx.removeEntity(c.ent.id);
  ctx.fx({ kind: 'crate_open', x: c.ent.x, y: c.ent.y, z: c.ent.z });
  if (c.contents === 'ammo') {
    for (const w of q.weapons) {
      w.mag = w.def.magazine;
      w.reserve = Math.max(w.reserve, w.def.reserve);
    }
    room.sendFeature(q, 'perks.notice', { text: 'Ammo refilled' });
  } else grant(room, q, c.contents === 'valkyrie' ? VALKYRIE_LAUNCHER : c.contents);
}

/** Is a landed crate within taking reach of `p`? (USE belongs to the crate then: weapon pickups stand aside.) */
export function crateInReach(ctx: KsRoom, p: PlayerState): boolean {
  return cratesOf(ctx).some((c) => c.landed && Math.hypot(p.move.x - c.ent.x, p.move.z - c.ent.z) <= PACKAGE.radius && Math.abs(p.move.y - c.ent.y) < CRATE_REACH.dy);
}

/** USE pressed: Hardline Pro owners reroll a landed crate once. */
export function onUsePressed(ctx: KsRoom, p: PlayerState): void {
  if (!isPro(p, 'hardline')) return;
  for (const c of cratesOf(ctx)) {
    if (c.owner !== p || !c.landed || c.rerolled || c.fixed) continue;
    if (Math.hypot(p.move.x - c.ent.x, p.move.z - c.ent.z) > PACKAGE.radius) continue;
    c.rerolled = true;
    c.contents = rollContents(Math.random, c.contents);
    c.takers.set(p.id, -0.4);
    ctx.room.sendFeature(p, 'killstreaks.crate', { entity: c.ent.id, contents: c.contents, progress: 0 });
    return;
  }
}
