/**
 * Attack Dogs: a pack runs out from the owner's side of the map and hunts the nearest enemy (dogs
 * know where everyone is; Ghost does not fool them). They move with the shared player movement
 * (faster, no sprint), jump when stuck, and bite at close range. Up to `alive` dogs at once, `total`
 * in all, for the streak's duration. Each dog can be shot.
 */
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { Buttons } from '../../../../shared/input';
import type { Vec3 } from '../../../../shared/math';
import { createMoveState, DEFAULT_MOVE_PARAMS, stepMove, type MoveState } from '../../../../shared/movement';
import type { Entity } from '../../../entities';
import type { PlayerState } from '../../../player';
import type { Active, KsRoom } from '../world';
import type { CallArgs } from './types';

export const DOGS = { total: 8, alive: 3, hp: 80, speed: 1.45, bite: 55, biteEvery: 0.75, reach: 1.5, respawn: 2.5 };

interface Dog {
  ent: Entity;
  move: MoveState;
  target: PlayerState | null;
  nextBite: number;
  stuck: number;
  roam: Vec3 | null;
  roamUntil: number;
  lastPos: Vec3;
}

export function callDogs(ctx: KsRoom, p: PlayerState, _args: CallArgs): string | null {
  const room = ctx.room;
  const def = KILLSTREAK_BY_ID.get('attack_dogs')!;
  const until = room.time + (def.durationSec ?? 60);
  const dogs: Dog[] = [];
  let released = 0;
  let nextRelease = room.time;
  const params = { ...DEFAULT_MOVE_PARAMS, speed: DOGS.speed, canSprint: false, canMantle: false, canProne: false };
  const act: Active = { streak: 'attack_dogs', owner: p, entities: [], update: () => false };

  const spawnPoints = (): Vec3[] => {
    const m = room.map.spawns;
    const own = p.team !== null ? m.teams[p.team] : m.ffa;
    return own.length ? own : [{ x: p.move.x, y: p.move.y, z: p.move.z }];
  };

  const release = () => {
    const pts = spawnPoints();
    // The spawn point farthest from the owner's enemies (dogs come from home).
    const enemies = [...room.players.values()].filter((q) => q.alive && room.isEnemy(p, q));
    let best = pts[0]!;
    let bestD = -1;
    for (const pt of pts) {
      const d = enemies.length ? Math.min(...enemies.map((e) => Math.hypot(e.move.x - pt.x, e.move.z - pt.z))) : Math.random();
      if (d > bestD && room.world.free(pt.x, pt.y + 0.05, pt.z)) {
        best = pt;
        bestD = d;
      }
    }
    const move = createMoveState(best.x + (Math.random() - 0.5), best.y, best.z + (Math.random() - 0.5));
    if (!room.world.free(move.x, move.y + 0.05, move.z)) {
      move.x = best.x;
      move.z = best.z;
    }
    const ent = room.entities.add({ kind: KS_ENTITY.dog, x: move.x, y: move.y, z: move.z, yaw: 0, owner: p.id, team: p.team, s: { b: 0 } });
    act.entities.push(ent.id);
    const dog: Dog = { ent, move, target: null, nextBite: 0, stuck: 0, roam: null, roamUntil: 0, lastPos: { x: move.x, y: move.y, z: move.z } };
    dogs.push(dog);
    released++;
    if (released === 1 || Math.random() < 0.3) ctx.fx({ kind: 'bark', x: move.x, y: move.y + 0.6, z: move.z });
    ctx.damageable(ent, {
      hp: DOGS.hp,
      air: false,
      radius: 0.55,
      yOff: 0.45,
      active: act,
      score: 50,
      onDestroyed() {
        const i = dogs.indexOf(dog);
        if (i >= 0) dogs.splice(i, 1);
        ctx.removeEntity(ent.id);
        nextRelease = Math.max(nextRelease, room.time + DOGS.respawn);
      },
    });
  };

  act.update = (dt) => {
    if (room.players.get(p.id) !== p) return false;
    const over = room.time >= until;
    if (!over && dogs.length < DOGS.alive && released < DOGS.total && room.time >= nextRelease) {
      release();
      nextRelease = room.time + 0.6;
    }
    for (const dog of [...dogs]) {
      if (!room.entities.get(dog.ent.id)) {
        dogs.splice(dogs.indexOf(dog), 1);
        continue;
      }
      if (over) {
        ctx.removeEntity(dog.ent.id);
        dogs.splice(dogs.indexOf(dog), 1);
        continue;
      }
      stepDog(ctx, p, dog, dt, params);
    }
    return !over || dogs.length > 0;
  };
  ctx.add(act);
  return null;
}

function stepDog(ctx: KsRoom, owner: PlayerState, dog: Dog, dt: number, params: typeof DEFAULT_MOVE_PARAMS): void {
  const room = ctx.room;
  const m = dog.move;
  if (!dog.target || !dog.target.alive || !room.players.has(dog.target.id)) {
    dog.target = ctx.targetsFor(owner, KS_ENTITY.dog, { x: m.x, y: m.y + 0.5, z: m.z }, 500, false)[0] ?? null;
  }
  // Glitched: the dogs stand confused (no chasing, no biting).
  const dazed = ctx.hardwareStunned(owner);
  const t = dazed ? null : dog.target;
  let goal: Vec3 | null = t ? t.move : null;
  if (dog.roam && room.time < dog.roamUntil && !dazed) goal = dog.roam;
  let buttons = 0;
  let yaw = dog.ent.yaw;
  let biting = 0;
  if (goal) {
    const dx = goal.x - m.x;
    const dz = goal.z - m.z;
    const d = Math.hypot(dx, dz);
    yaw = Math.atan2(-dx, -dz);
    if (t && goal === t.move && d <= DOGS.reach && Math.abs(t.move.y - m.y) < 1.3) {
      biting = 1;
      if (room.time >= dog.nextBite && room.world.lineOfSight({ x: m.x, y: m.y + 0.5, z: m.z }, { x: t.move.x, y: t.move.y + 0.8, z: t.move.z }, 'bullets')) {
        dog.nextBite = room.time + DOGS.biteEvery;
        ctx.fx({ kind: 'bite', x: t.move.x, y: t.move.y + 0.9, z: t.move.z });
        room.damage({ victim: t, attacker: owner, amount: DOGS.bite, weapon: 'attack_dogs', part: 'torso', means: 'killstreak', from: { x: m.x, y: m.y + 0.5, z: m.z }, distance: d });
      }
    } else if (d > 0.4) buttons = Buttons.FORWARD;
  }
  // Stuck against something: hop, then wander to a nearby hotspot for a moment.
  const moved = Math.hypot(m.x - dog.lastPos.x, m.z - dog.lastPos.z);
  dog.lastPos = { x: m.x, y: m.y, z: m.z };
  if (buttons && moved < 0.5 * dt) {
    dog.stuck += dt;
    if (dog.stuck > 0.4) buttons |= Buttons.JUMP;
    if (dog.stuck > 1.2) {
      const spots = room.map.hotspots?.length ? room.map.hotspots : [ctx.center];
      dog.roam = spots[Math.floor(Math.random() * spots.length)]!;
      dog.roamUntil = room.time + 2;
      dog.stuck = 0;
    }
  } else dog.stuck = Math.max(0, dog.stuck - dt);
  stepMove(room.world, m, buttons, yaw, dt, params);
  dog.ent.x = m.x;
  dog.ent.y = m.y;
  dog.ent.z = m.z;
  dog.ent.yaw = yaw;
  if (dog.ent.s?.b !== biting) dog.ent.s = { ...dog.ent.s, b: biting };
  if (m.y < room.map.bounds.min.y - 5) ctx.removeEntity(dog.ent.id);
}
