/**
 * Tactical Nuke (MW2, 25 kills): the caller works a laptop, then a ten-second countdown runs on
 * every screen, then the blast. Timeline and maths in `shared/defs/nuke.ts`.
 *
 * - Calling it locks the match end (`room.endLock = 'nuke'`): scores freeze and no score, time or
 *   round limit can end the match before the bomb does.
 * - It can't be shot down or stopped: no hit points, and it keeps going if the caller dies or
 *   leaves (`keepOnLeave`; the entity carries the owner in `s.o` so core doesn't remove it with them).
 * - Detonation: every other killstreak blows up, nobody respawns, movement goes slow motion and
 *   the shockwave kills every player from the blast outwards, credited to the caller (`weapon`
 *   'nuke', `means` 'nuke': no killcams). Then `room.endMatch('nuke')` with the caller's team
 *   (FFA: the caller) as the winner, through the normal match-end flow (XP, CoD Points, challenges).
 */
import { KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { NUKE, blastPoint, nukeEndAt, nukeTimeScale, shockAt, type NukeTimes } from '../../../../shared/defs/nuke';
import type { MatchResults } from '../../../../shared/events';
import { standardResults } from '../../../modes/index';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import type { Active, KsRoom } from '../world';
import type { CallArgs } from './types';

/** A running nuke (one per room at a time). */
export interface NukeActive extends Active {
  times: NukeTimes;
  blast: { x: number; y: number; z: number };
  entity: number;
  detonated: boolean;
}

export const nukeOf = (ctx: KsRoom): NukeActive | null => (ctx.actives.find((a) => !a.done && a.streak === NUKE.id) as NukeActive | undefined) ?? null;

/** Nearest and farthest distance from `blast` to the map's playable rectangle (2D). */
export function shockRange(room: Room, blast: { x: number; z: number }): { n: number; f: number } {
  const b = room.map.bounds;
  const dx = Math.max(b.min.x - blast.x, 0, blast.x - b.max.x);
  const dz = Math.max(b.min.z - blast.z, 0, blast.z - b.max.z);
  const fx = Math.max(Math.abs(blast.x - b.min.x), Math.abs(blast.x - b.max.x));
  const fz = Math.max(Math.abs(blast.z - b.min.z), Math.abs(blast.z - b.max.z));
  return { n: Math.hypot(dx, dz), f: Math.hypot(fx, fz) };
}

export function callNuke(ctx: KsRoom, p: PlayerState, _args: CallArgs): string | null {
  const room = ctx.room;
  if (nukeOf(ctx)) return 'nuke_active';
  const a = room.time + NUKE.laptopSec;
  const d = a + NUKE.countdownSec;
  const yaw = Math.random() * Math.PI * 2;
  const blast = blastPoint(ctx.center, ctx.radius, yaw);
  const times: NukeTimes = { a, d, ...shockRange(room, blast) };
  room.endLock = 'nuke';
  // Weapon down while the caller works the laptop.
  p.swapEnd = Math.max(p.swapEnd, a);
  const ent = room.entities.add({ kind: KS_ENTITY.nuke, x: blast.x, y: blast.y, z: blast.z, yaw, team: p.team, s: { a: r3(a), d: r3(d), n: r3(times.n), f: r3(times.f), o: p.id } });
  const owner = p;
  const act: NukeActive = {
    streak: NUKE.id,
    owner,
    // The entity is not listed: it outlives the active so clients keep the cloud through the results (core clears it at the next match start).
    entities: [],
    keepOnLeave: true,
    times,
    blast,
    entity: ent.id,
    detonated: false,
    update() {
      if (!act.detonated && room.time >= d) detonate(ctx, act);
      if (!act.detonated) return true;
      shockwave(room, act);
      if (room.time < nukeEndAt(times)) return true;
      endWithNuke(room, act);
      return false;
    },
  };
  ctx.add(act);
  room.bus.emit('progression.xp', { player: p, amount: NUKE.xp, label: 'TACTICAL NUKE', key: 'nuke' });
  return null;
}

function detonate(ctx: KsRoom, act: NukeActive): void {
  const room = ctx.room;
  act.detonated = true;
  // Every other killstreak blows up (no "destroyed" announcements: the screen is white anyway).
  for (const other of [...ctx.actives]) {
    if (other === act || other.done) continue;
    for (const id of other.entities) {
      const e = room.entities.get(id);
      if (e && ctx.hp.has(id)) ctx.fx({ kind: 'destroyed', x: e.x, y: e.y, z: e.z, r: ctx.hp.get(id)!.air ? 6 : 3 });
    }
    ctx.finish(other, false);
  }
  for (const p of room.players.values()) p.respawnAt = null;
  room.bus.emit('killstreaks.nuke', { player: act.owner, phase: 'detonated' });
}

/** Kill everyone the shockwave has reached by now (nearest to the blast first), credited to the caller. */
export function shockwave(room: Room, act: NukeActive): void {
  const hit: { p: PlayerState; dist: number }[] = [];
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    const dist = Math.hypot(p.move.x - act.blast.x, p.move.z - act.blast.z);
    if (room.time >= shockAt(dist, act.times)) hit.push({ p, dist });
  }
  hit.sort((x, y) => x.dist - y.dist);
  for (const { p, dist } of hit) {
    room.kill(p, act.owner, { weapon: NUKE.id, means: 'nuke', part: 'torso', distance: Math.round(dist) });
    p.respawnAt = null;
  }
}

function endWithNuke(room: Room, act: NukeActive): void {
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    room.kill(p, act.owner, { weapon: NUKE.id, means: 'nuke', part: 'torso' });
    p.respawnAt = null;
  }
  room.endMatch('nuke', nukeResults(room, act.owner));
}

/** The mode's own results with the caller's side as the winner (FFA: the caller, placed first). */
export function nukeResults(room: Room, owner: PlayerState): MatchResults {
  const res = room.rules.results?.(room, 'nuke') ?? standardResults(room, 'nuke');
  if (room.mode.teams && owner.team !== null) {
    res.winnerTeam = owner.team;
    res.winners = res.players.filter((r) => r.team === owner.team).map((r) => r.id);
  } else {
    res.winnerTeam = null;
    res.winners = [owner.id];
    const mine = res.players.find((r) => r.id === owner.id);
    if (mine) {
      res.players = [mine, ...res.players.filter((r) => r !== mine).sort((x, y) => x.place - y.place)];
      res.players.forEach((r, i) => (r.place = i + 1));
    }
  }
  for (const r of res.players) r.won = res.winners.includes(r.id);
  return res;
}

/** Slow motion after the blast (movement), and no sprinting meanwhile. */
export function registerNukeModifiers(room: Room, ctx: KsRoom): void {
  const since = () => {
    const n = nukeOf(ctx);
    return n?.detonated ? room.time - n.times.d : -1;
  };
  room.modifiers.add('speedMultiplier', () => {
    const s = since();
    return s >= 0 && s < NUKE.slowmoSec ? nukeTimeScale(s) : undefined;
  }, 'killstreaks.nuke_slowmo');
  room.modifiers.add('canSprint', () => (since() >= 0 ? false : undefined), 'killstreaks.nuke_sprint');
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
