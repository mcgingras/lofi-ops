/**
 * Care Package: a helicopter flies in and drops a crate on the designated spot. Anyone can take it
 * by holding USE next to it (owner fast, teammates slower, enemies slowest); it holds a random
 * killstreak or an ammo refill. Hardline Pro: the owner's first USE press rerolls the contents.
 * Hacker Pro: an enemy hacker booby-traps it instead of taking it; the next of the owner's side to
 * take it blows up (credited to the hacker). Landing on someone crushes them.
 */
import { CARE_PACKAGE_WEIGHTS, CRATE_REACH, KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { Buttons } from '../../../../shared/input';
import type { Vec3 } from '../../../../shared/math';
import type { Entity } from '../../../entities';
import type { PlayerState } from '../../../player';
import { isPro } from '../../perks/common';
import { grant } from '../state';
import type { Active, KsRoom } from '../world';
import type { CallArgs } from './types';

export const PACKAGE = { heliSpeed: 24, hover: 1.2, fall: 12, life: 60, radius: CRATE_REACH.r, owner: 0.5, friend: 1.25, enemy: 3, hacker: 1.25, crush: 1.2, trap: { r: 5, max: 300, min: 80 } };

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
export function dropCrate(ctx: KsRoom, act: Active, owner: PlayerState, from: Vec3, contents = rollContents()): Crate {
  const ent = ctx.room.entities.add({ kind: KS_ENTITY.crate, x: from.x, y: from.y, z: from.z, yaw: Math.random() * Math.PI * 2, owner: owner.id, team: owner.team, s: { l: false } });
  act.entities.push(ent.id);
  const c: Crate = { ent, owner, contents, landed: false, vy: 0, groundY: ctx.groundAt(from.x, from.z), expires: Infinity, takers: new Map(), rerolled: false, trap: null };
  cratesOf(ctx).push(c);
  return c;
}

export function callCarePackage(ctx: KsRoom, p: PlayerState, args: CallArgs): string | null {
  if (!args.target) return 'no_target';
  const room = ctx.room;
  const target = ctx.clampToMap(args.target);
  const inYaw = Math.atan2(-(target.x - ctx.center.x), -(target.z - ctx.center.z)) + Math.PI + (Math.random() - 0.5);
  const start = ctx.edgePoint(inYaw, 30, ctx.heliY());
  const heli = room.entities.add({ kind: KS_ENTITY.dropHeli, ...start, yaw: 0, owner: p.id, team: p.team });
  let phase: 'in' | 'hover' | 'out' = 'in';
  let hoverUntil = 0;
  let outDir = { x: 0, z: 0 };
  const act: Active = {
    streak: 'care_package',
    owner: p,
    entities: [heli.id],
    update(dt) {
      if (room.entities.get(heli.id)) {
        if (phase === 'in') {
          const dx = target.x - heli.x;
          const dz = target.z - heli.z;
          const d = Math.hypot(dx, dz);
          heli.yaw = Math.atan2(-dx, -dz);
          const step = PACKAGE.heliSpeed * dt;
          if (d <= step) {
            heli.x = target.x;
            heli.z = target.z;
            phase = 'hover';
            hoverUntil = room.time + PACKAGE.hover;
            dropCrate(ctx, act, p, { x: target.x, y: heli.y - 2, z: target.z });
            outDir = { x: dx / Math.max(d, 1e-6), z: dz / Math.max(d, 1e-6) };
          } else {
            heli.x += (dx / d) * step;
            heli.z += (dz / d) * step;
          }
        } else if (phase === 'hover') {
          if (room.time >= hoverUntil) phase = 'out';
        } else {
          heli.x += outDir.x * PACKAGE.heliSpeed * dt;
          heli.z += outDir.z * PACKAGE.heliSpeed * dt;
          heli.y += 3 * dt;
          if (Math.hypot(heli.x - ctx.center.x, heli.z - ctx.center.z) > ctx.radius + 40) ctx.removeEntity(heli.id);
        }
      }
      updateCrates(ctx, act, dt);
      return !!room.entities.get(heli.id) || cratesOf(ctx).some((c) => act.entities.includes(c.ent.id));
    },
    cleanup() {
      const list = cratesOf(ctx);
      for (let i = list.length - 1; i >= 0; i--) if (act.entities.includes(list[i]!.ent.id)) list.splice(i, 1);
    },
  };
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
  } else grant(room, q, c.contents);
}

/** USE pressed: Hardline Pro owners reroll a landed crate once. */
export function onUsePressed(ctx: KsRoom, p: PlayerState): void {
  if (!isPro(p, 'hardline')) return;
  for (const c of cratesOf(ctx)) {
    if (c.owner !== p || !c.landed || c.rerolled) continue;
    if (Math.hypot(p.move.x - c.ent.x, p.move.z - c.ent.z) > PACKAGE.radius) continue;
    c.rerolled = true;
    c.contents = rollContents(Math.random, c.contents);
    c.takers.set(p.id, -0.4);
    ctx.room.sendFeature(p, 'killstreaks.crate', { entity: c.ent.id, contents: c.contents, progress: 0 });
    return;
  }
}
