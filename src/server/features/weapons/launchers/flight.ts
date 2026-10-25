/**
 * Launcher projectiles in flight (defs/launchers.ts): China Lake grenades, RPG-7 / M72 LAW rockets,
 * Strela-3 / Stinger missiles, and China Beach bomblets. Room entities of kind `LAUNCHER_ENTITY`
 * (`weapons.rocket`), stepped every tick:
 *
 * - grenades step through the shared `stepBody` (gravity, bounce): the first touch of the world
 *   bounces (or, before arming, makes it a dud), the next touch, the fuse or a player sets it off;
 * - rockets fly the launch line turned by their seeded drift, with a slight drop;
 * - missiles home on their lock (lead pursuit at `lock.turnRate`), else fly dumb like a rocket;
 * - each step is swept against the world, players and enemy aircraft (the killstreaks feature's
 *   air hardware): an aircraft takes `airDamage` (x `killstreakDamageDealt`), the rest explodes
 *   through core `radiusDamage` (self damage on) and `weapons.detonated` (ground hardware);
 * - nothing explodes before `armDistance`: a dud does `impactDamage` to a player it meets and drops.
 *
 * Pack-a-Punch effects (defs/pap-effects.ts): China Beach `cluster` bomblets, Rocket Propelled
 * Grievance `napalm` ground fire, M72 Anarchy `proximity` fuse, Strela-3 Upgraded `swarm` (two
 * missiles, launch side), Killer Bee `flak` (a hit hurts every enemy aircraft near it).
 */
import { shotSeed, spreadDegrees, spreadDirection, stanceSpread } from '../../../../shared/ballistics';
import { KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { clusterDirs, driftAngles, isArmed, LAUNCHER_ENTITY, LAUNCHERS, leadPoint, steerToward, turnDir, type LauncherTuning } from '../../../../shared/defs/launchers';
import { papEffectOf } from '../../../../shared/defs/pack-a-punch';
import type { BlastProfile } from '../../../../shared/defs/equipment';
import { normalize, rng, type Vec3 } from '../../../../shared/math';
import { stepBody, type Body } from '../../../../shared/projectile';
import type { Entity } from '../../../entities';
import type { PlayerState, WeaponState } from '../../../player';
import type { Room } from '../../../room';
import { ksRoom, raySphere } from '../../killstreaks/world';
import { playerOnPath } from '../equipment';
import { takeLock } from './lock';

/** Server-only state of one projectile (`entity.data`). */
export interface Proj {
  w: string;
  t: LauncherTuning;
  owner: string | null;
  packed: boolean;
  /** Launch point and direction (rockets drift off this line). */
  from: Vec3;
  d0: Vec3;
  pos: Vec3;
  vel: Vec3;
  /** Rockets: the drop gathered so far (m/s, downward). */
  drop: number;
  born: number;
  traveled: number;
  /** Seeded 0..1 values for the drift. */
  a: number;
  b: number;
  /** Missiles: the locked air killstreak entity (null: dumb). */
  target: number | null;
  /** Its position last tick (for the lead). */
  tLast: Vec3 | null;
  /** A dud (touched something before arming): falls, never explodes. */
  dud: boolean;
  /** Grenades: the stepped body, whether the one bounce is used, the fuse. */
  body: Body | null;
  bounced: boolean;
  fuseAt: number | null;
  /** China Beach bomblet: its own small blast, goes off on its fuse. */
  bomblet: BlastProfile | null;
  diesAt: number;
}

const ownerOf = (room: Room, n: Proj): PlayerState | null => (n.owner ? (room.players.get(n.owner) ?? null) : null);
const pitchOf = (v: Vec3) => Math.atan2(v.y, Math.hypot(v.x, v.z) || 1e-6);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Put a projectile in the world. */
export function spawnProj(room: Room, owner: PlayerState | null, w: string, pos: Vec3, dir: Vec3, o: { packed?: boolean; target?: number | null; seed?: number; bomblet?: BlastProfile | null; speed?: number; fuse?: number } = {}): Entity {
  const t = LAUNCHERS[w]!;
  const d = normalize(dir);
  const speed = o.speed ?? t.speed;
  const r = rng(o.seed ?? Math.floor(Math.random() * 1e9));
  const grenade = t.kind === 'grenade' || !!o.bomblet;
  const vel = { x: d.x * speed, y: d.y * speed, z: d.z * speed };
  const n: Proj = {
    w,
    t,
    owner: owner?.id ?? null,
    packed: !!o.packed,
    from: { ...pos },
    d0: d,
    pos: { ...pos },
    vel,
    drop: 0,
    born: room.time,
    traveled: 0,
    a: r(),
    b: r(),
    target: o.target ?? null,
    tLast: null,
    dud: false,
    body: grenade ? { pos: { ...pos }, vel: { ...vel }, stuck: false, resting: false, traveled: 0 } : null,
    bounced: false,
    fuseAt: grenade ? room.time + (o.fuse ?? t.fuse ?? 2.5) : null,
    bomblet: o.bomblet ?? null,
    diesAt: room.time + t.life,
  };
  const s: Record<string, number | string | boolean> = { w, p: r2(pitchOf(d)) };
  if (n.packed) s.u = 1;
  if (n.target != null) s.h = 1;
  if (n.bomblet) s.c = 1;
  return room.entities.add({ kind: LAUNCHER_ENTITY, x: pos.x, y: pos.y, z: pos.z, yaw: Math.atan2(-d.x, -d.z), owner: owner?.id, team: owner?.team ?? null, s, data: n });
}

/**
 * A launcher's trigger pull (the `WeaponBehavior`): spread by the weapon's cone (hip fire is
 * loose), the lock if there is one, one projectile (two for a packed Strela) out of the tube.
 */
export function launch(room: Room, p: PlayerState, w: WeaponState, shot: { origin: Vec3; dir: Vec3; shot: number }): Entity[] {
  const id = w.def.base.id;
  const t = LAUNCHERS[id];
  if (!t) return [];
  const moving = Math.hypot(p.move.vx, p.move.vz) > 0.5;
  const spread = spreadDegrees(w.def, p.move.ads, moving, room.modifiers.mul('spreadMultiplier', p) * stanceSpread(p.move));
  const seed = shotSeed(p.seed, shot.shot, 0);
  const dir = spreadDirection(shot.dir, spread, seed);
  const target = t.lock ? takeLock(room, p) : null;
  // Out of the tube a little ahead of the eye, unless that is inside a wall.
  const ahead = 0.6;
  const wall = room.world.raycast(shot.origin, dir, ahead + 0.1, 'bullets');
  const start = wall ? { ...shot.origin } : { x: shot.origin.x + dir.x * ahead, y: shot.origin.y + dir.y * ahead - 0.05, z: shot.origin.z + dir.z * ahead };
  const swarm = w.pap ? papEffectOf(id, 'swarm') : null;
  const n = swarm ? swarm.missiles : 1;
  const out: Entity[] = [];
  for (let i = 0; i < n; i++) {
    // A swarm fans out a few degrees, then each missile homes on its own.
    const fan = n > 1 ? (i - (n - 1) / 2) * 0.07 : 0;
    const d = fan ? turnDir(dir, fan, 0.02) : dir;
    out.push(spawnProj(room, p, id, start, d, { packed: !!w.pap, target, seed: seed + i * 7919 }));
  }
  room.bus.emit('weapons.thrown', { player: p, equipment: id });
  return out;
}

/** Per tick: every launcher projectile. */
export function updateProjs(room: Room, dt: number): void {
  for (const e of room.entities.byKind(LAUNCHER_ENTITY)) {
    const n = e.data as Proj | undefined;
    if (!n) {
      room.entities.remove(e.id);
      continue;
    }
    if (n.body) stepGrenade(room, e, n, dt);
    else stepRocket(room, e, n, dt);
  }
}

function sync(e: Entity, n: Proj): void {
  e.x = n.pos.x;
  e.y = n.pos.y;
  e.z = n.pos.z;
  const v = n.body ? n.body.vel : n.vel;
  if (Math.hypot(v.x, v.z) > 0.5) e.yaw = Math.atan2(-v.x, -v.z);
  const p = r2(pitchOf(v));
  if (e.s?.p !== p && !n.dud) e.s = { ...e.s, p };
}

/** Turn a projectile into a dud that drops where it is and goes away. */
function makeDud(room: Room, e: Entity, n: Proj, vel: Vec3): void {
  n.dud = true;
  n.target = null;
  n.body = { pos: { ...n.pos }, vel: { x: vel.x * 0.15, y: Math.max(0, vel.y * 0.1) + 1, z: vel.z * 0.15 }, stuck: false, resting: false, traveled: n.traveled };
  n.fuseAt = room.time + 1.5;
  n.bomblet = null;
  e.s = { ...e.s, d: 1, h: 0 };
}

function stepGrenade(room: Room, e: Entity, n: Proj, dt: number): void {
  const b = n.body!;
  const prev = { ...b.pos };
  const r = stepBody(room.world, b, dt, { gravity: n.t.gravity || 12, restitution: n.t.restitution ?? 0.4 });
  n.pos = { ...b.pos };
  n.traveled = b.traveled;
  const owner = ownerOf(room, n);
  const armed = !n.dud && (!!n.bomblet || isArmed(n.w, n.traveled));
  // Players: a live grenade bursts on them; a dud (or one not armed yet) knocks them.
  if (!n.bomblet && !n.dud) {
    const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
    const hitP = playerOnPath(room, prev, b.pos, n.traveled < 2 ? n.owner : null, 0.05);
    if (hitP && speed > 4) {
      if (armed) {
        sync(e, n);
        explode(room, e, n, hitP.at);
        return;
      }
      room.damage({ victim: hitP.p, attacker: owner, amount: n.t.impactDamage, weapon: n.w, part: hitP.part, means: 'impact', from: n.from, distance: n.traveled });
      makeDud(room, e, n, b.vel);
    }
  }
  if (r.hit && !n.dud && !n.bomblet) {
    if (!n.bounced && !armed) makeDud(room, e, n, b.vel);
    else if (!n.bounced) n.bounced = true;
    else {
      sync(e, n);
      explode(room, e, n, b.pos);
      return;
    }
  }
  sync(e, n);
  if (n.fuseAt !== null && room.time >= n.fuseAt) {
    if (armed) explode(room, e, n, b.pos);
    else room.entities.remove(e.id);
    return;
  }
  if (b.pos.y < room.map.bounds.min.y - 20) room.entities.remove(e.id);
}

function stepRocket(room: Room, e: Entity, n: Proj, dt: number): void {
  const ctx = ksRoom(room);
  const owner = ownerOf(room, n);
  const t = n.t;
  const age = room.time - n.born;
  // Steering: a lock homes, otherwise the drift turns the launch line.
  const tEnt = n.target != null ? room.entities.get(n.target) : undefined;
  const tHp = n.target != null ? ctx.hp.get(n.target) : undefined;
  let tPos: Vec3 | null = null;
  if (tEnt && tHp && t.lock) {
    tPos = { x: tEnt.x, y: tEnt.y + tHp.yOff, z: tEnt.z };
    const tv = n.tLast ? { x: (tPos.x - n.tLast.x) / dt, y: (tPos.y - n.tLast.y) / dt, z: (tPos.z - n.tLast.z) / dt } : { x: 0, y: 0, z: 0 };
    n.tLast = tPos;
    // A short boost straight out of the tube before it turns.
    if (age > 0.15) n.vel = steerToward(n.vel, n.pos, leadPoint(n.pos, t.speed, tPos, tv), t.lock.turnRate * dt);
    n.drop = 0;
  } else {
    if (n.target != null) {
      // The target is gone: fly on straight from here.
      n.target = null;
      n.d0 = normalize(n.vel);
      n.born = room.time - 0.5;
      e.s = { ...e.s, h: 0 };
    }
    const off = driftAngles(t.drift, age, n.a, n.b);
    const d = turnDir(n.d0, off.yaw, off.pitch);
    n.drop += t.gravity * dt;
    n.vel = { x: d.x * t.speed, y: d.y * t.speed - n.drop, z: d.z * t.speed };
  }
  const prev = { ...n.pos };
  const step = { x: n.vel.x * dt, y: n.vel.y * dt, z: n.vel.z * dt };
  const len = Math.hypot(step.x, step.y, step.z);
  if (len < 1e-6) return;
  const dir = { x: step.x / len, y: step.y / len, z: step.z / len };
  const next = { x: prev.x + step.x, y: prev.y + step.y, z: prev.z + step.z };
  const armedAt = (dAlong: number) => isArmed(n.w, n.traveled + dAlong);

  // The nearest thing on this step: the world, a player, an enemy aircraft.
  let best: { t: number; kind: 'world' | 'player' | 'air'; p?: PlayerState; part?: 'head' | 'torso' | 'legs'; air?: number; normal?: Vec3 } | null = null;
  const wall = room.world.raycast(prev, dir, len + 0.05, 'bullets');
  if (wall) best = { t: Math.max(0, wall.t - 0.05), kind: 'world', normal: wall.normal };
  const hitP = playerOnPath(room, prev, next, n.owner, 0.05);
  if (hitP) {
    const tp = Math.hypot(hitP.at.x - prev.x, hitP.at.y - prev.y, hitP.at.z - prev.z);
    if (!best || tp < best.t) best = { t: tp, kind: 'player', p: hitP.p, part: hitP.part };
  }
  for (const [id, d] of ctx.hp) {
    if (!d.air || (owner && ctx.sameSide(owner, d.active.owner))) continue;
    const a = room.entities.get(id);
    if (!a) continue;
    const c = { x: a.x, y: a.y + d.yOff, z: a.z };
    // A homing missile's own target counts a near miss as a hit (its proximity fuse).
    const radius = id === n.target ? d.radius + 1.2 : d.radius;
    const ta = raySphere(prev, dir, c, radius);
    if (ta !== null && ta <= len && (!best || ta < best.t)) best = { t: ta, kind: 'air', air: id };
  }
  // M72 Anarchy: an armed rocket bursts beside any enemy it passes.
  if (!best && n.packed && armedAt(len)) {
    const prox = papEffectOf(n.w, 'proximity');
    if (prox) {
      const q = enemyNear(room, owner, prev, dir, len, prox.radius);
      if (q) best = { t: q.t, kind: 'world' };
    }
  }

  if (best) {
    const at = { x: prev.x + dir.x * best.t, y: prev.y + dir.y * best.t, z: prev.z + dir.z * best.t };
    n.pos = at;
    const armed = armedAt(best.t);
    n.traveled += best.t;
    sync(e, n);
    if (best.kind === 'air') {
      hitAircraft(room, e, n, best.air!, at, armed);
      return;
    }
    if (armed) {
      const stand = best.normal ? { x: at.x + best.normal.x * 0.15, y: at.y + best.normal.y * 0.15, z: at.z + best.normal.z * 0.15 } : at;
      explode(room, e, n, stand);
      return;
    }
    if (best.kind === 'player' && best.p) room.damage({ victim: best.p, attacker: owner, amount: t.impactDamage, weapon: n.w, part: best.part ?? 'torso', means: 'impact', from: n.from, distance: n.traveled });
    makeDud(room, e, n, best.normal ? reflectOff(n.vel, best.normal) : { x: -n.vel.x, y: n.vel.y, z: -n.vel.z });
    return;
  }
  n.pos = next;
  n.traveled += len;
  sync(e, n);
  const b = room.map.bounds;
  const out = n.pos.y < b.min.y - 20 || n.pos.x < b.min.x - 60 || n.pos.x > b.max.x + 60 || n.pos.z < b.min.z - 60 || n.pos.z > b.max.z + 60 || n.pos.y > b.max.y + 150;
  if (room.time >= n.diesAt || out) {
    // Self-destruct: an armed one bursts where it is.
    if (!out && isArmed(n.w, n.traveled)) explode(room, e, n, n.pos);
    else room.entities.remove(e.id);
  }
}

/** Duds in flight after they have become bodies (they step as grenades do, see `makeDud`). */
const reflectOff = (v: Vec3, nrm: Vec3): Vec3 => {
  const k = 2 * (v.x * nrm.x + v.y * nrm.y + v.z * nrm.z);
  return { x: v.x - k * nrm.x, y: v.y - k * nrm.y, z: v.z - k * nrm.z };
};

/** The first enemy (of `owner`) whose chest passes within `radius` of the step, in sight of it. */
function enemyNear(room: Room, owner: PlayerState | null, o: Vec3, dir: Vec3, len: number, radius: number): { p: PlayerState; t: number } | null {
  let best: { p: PlayerState; t: number } | null = null;
  for (const q of room.players.values()) {
    if (!q.alive || q === owner || (owner && !room.canDamage(owner, q))) continue;
    const c = { x: q.move.x, y: q.move.y + 1.1, z: q.move.z };
    const dx = c.x - o.x;
    const dy = c.y - o.y;
    const dz = c.z - o.z;
    const along = Math.max(0, Math.min(len, dx * dir.x + dy * dir.y + dz * dir.z));
    const off = Math.hypot(dx - dir.x * along, dy - dir.y * along, dz - dir.z * along);
    if (off > radius) continue;
    const at = { x: o.x + dir.x * along, y: o.y + dir.y * along, z: o.z + dir.z * along };
    if (!room.world.lineOfSight(at, c, 'bullets')) continue;
    if (!best || along < best.t) best = { p: q, t: along };
  }
  return best;
}

/** A rocket or missile meets an aircraft: hardware damage, a burst in the air (Killer Bee: flak). */
function hitAircraft(room: Room, e: Entity, n: Proj, id: number, at: Vec3, armed: boolean): void {
  const ctx = ksRoom(room);
  const owner = ownerOf(room, n);
  const a = room.entities.get(id);
  const mul = owner && a ? room.modifiers.mul('killstreakDamageDealt', owner, a.kind) : 1;
  ctx.hurtEntity(id, (armed ? n.t.airDamage : n.t.impactDamage) * mul, owner);
  if (armed && n.packed) {
    const flak = papEffectOf(n.w, 'flak');
    if (flak) {
      for (const [other, d] of [...ctx.hp]) {
        if (other === id || !d.air || (owner && ctx.sameSide(owner, d.active.owner))) continue;
        const o = room.entities.get(other);
        if (o && Math.hypot(o.x - at.x, o.y + d.yOff - at.y, o.z - at.z) <= flak.radius) ctx.hurtEntity(other, flak.damage * mul, owner);
      }
      room.sendFeature(null, 'weapons.boom', { x: r2(at.x), y: r2(at.y), z: r2(at.z), e: `${n.w}.flak`, owner: n.owner });
    }
  }
  if (armed) explode(room, e, n, at);
  else room.entities.remove(e.id);
}

/**
 * The blast: core `radiusDamage` (BO1 rules, self damage on), the look for everyone
 * (`weapons.boom`), ground hardware (`weapons.detonated`), then the packed effect.
 */
export function explode(room: Room, e: Entity, n: Proj, at: Vec3): void {
  room.entities.remove(e.id);
  const owner = ownerOf(room, n);
  const b = n.bomblet ?? n.t.blast;
  const c = { x: at.x, y: at.y + 0.1, z: at.z };
  room.radiusDamage(c, b.radius, b.max, b.min, { attacker: owner, weapon: n.w, means: 'explosive', hitSelf: true });
  room.sendFeature(null, 'weapons.boom', { x: r2(c.x), y: r2(c.y), z: r2(c.z), e: n.bomblet ? `${n.w}.bomblet` : n.w, owner: n.owner });
  room.bus.emit('weapons.detonated', { player: owner, equipment: n.w, effect: 'launcher', ...c, radius: b.radius, max: b.max, min: b.min });
  if (!n.packed || n.bomblet) return;
  const cluster = papEffectOf(n.w, 'cluster');
  if (cluster) {
    const spin = rng(Math.floor(n.a * 1e9))();
    for (const [i, d] of clusterDirs(cluster.bomblets, spin).entries()) {
      spawnProj(room, owner, n.w, { x: c.x, y: c.y + 0.3, z: c.z }, d, { packed: true, bomblet: { radius: cluster.radius, max: cluster.max, min: cluster.min }, speed: 6 + (i % 2) * 2, fuse: cluster.fuse + i * 0.08, seed: i });
    }
  }
  const fire = papEffectOf(n.w, 'napalm');
  if (fire) igniteGround(room, owner, n.w, c, fire);
}

// ---------------------------------------------------------------------------------------------
// Rocket Propelled Grievance: burning ground
// ---------------------------------------------------------------------------------------------

interface GroundFire {
  ent: number;
  at: Vec3;
  owner: string | null;
  weapon: string;
  until: number;
  next: number;
  radius: number;
  dps: number;
}
const fires = new WeakMap<Room, GroundFire[]>();
const FIRE_TICK = 0.25;

function igniteGround(room: Room, owner: PlayerState | null, weapon: string, at: Vec3, f: { radius: number; dps: number; sec: number }): void {
  // On the floor under the blast (a wall hit burns at its foot).
  const g = room.world.groundBelow(at.x, at.z, at.y + 0.5, 6, 0.2);
  const y = g ?? at.y;
  const ent = room.entities.add({ kind: KS_ENTITY.fire, x: at.x, y, z: at.z, yaw: 0, owner: owner?.id, team: owner?.team ?? null, s: { r: f.radius } });
  let list = fires.get(room);
  if (!list) fires.set(room, (list = []));
  list.push({ ent: ent.id, at: { x: at.x, y, z: at.z }, owner: owner?.id ?? null, weapon, until: room.time + f.sec, next: room.time + FIRE_TICK, radius: f.radius, dps: f.dps });
}

/** Per tick: burning ground hurts whoever stands in it (`fire`: Flak Jacket Pro is immune). */
export function updateFires(room: Room): void {
  const list = fires.get(room);
  if (!list?.length) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i]!;
    if (room.time >= f.until) {
      room.entities.remove(f.ent);
      list.splice(i, 1);
      continue;
    }
    while (room.time >= f.next) {
      f.next += FIRE_TICK;
      const owner = f.owner ? (room.players.get(f.owner) ?? null) : null;
      const amt = f.dps * FIRE_TICK;
      room.radiusDamage({ x: f.at.x, y: f.at.y + 0.5, z: f.at.z }, f.radius, amt, amt, { attacker: owner, weapon: f.weapon, means: 'fire' });
    }
  }
}

/** End every burning patch (match start). */
export function clearFires(room: Room): void {
  for (const f of fires.get(room) ?? []) room.entities.remove(f.ent);
  fires.delete(room);
}
