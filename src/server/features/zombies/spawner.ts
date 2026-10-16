/**
 * Where zombies climb out: the map's Zombies layer spawns (edges, backyards, side yards), else the
 * map's own spawns. A spawn is never next to a survivor or in a survivor's sight when a hidden one
 * exists (BO1 spawns them out of view in zones near the players), prefers 10-40 m from the
 * nearest survivor, and does not repeat the last one (BO1 `old_spawn`).
 */
import { PLAYER } from '../../../shared/constants';
import type { MapData } from '../../../shared/maps/types';
import type { ZombiesLayer } from '../../../shared/maps/zombies/index';
import type { Vec3 } from '../../../shared/math';
import type { CollisionWorld } from '../../../shared/collision';
import type { PlayerState } from '../../player';

export const SPAWN_RULES = { minDist: 9, sightRange: 50, likeNear: 10, likeFar: 40, top: 4 } as const;

export function spawnCandidates(map: MapData, layer: ZombiesLayer | null): Vec3[] {
  if (layer?.zombieSpawns.length) return layer.zombieSpawns.map((s) => ({ x: s.x, y: s.y, z: s.z }));
  const all = [...map.spawns.ffa, ...map.spawns.teams[0], ...map.spawns.teams[1]];
  return all.map((s) => ({ x: s.x, y: s.y, z: s.z }));
}

/** Can any survivor see a body standing at `p`? */
export function seenBy(world: CollisionWorld, p: Vec3, survivors: readonly PlayerState[]): boolean {
  for (const s of survivors) {
    const d = Math.hypot(s.move.x - p.x, s.move.z - p.z);
    if (d > SPAWN_RULES.sightRange) continue;
    const eye = { x: s.move.x, y: s.move.y + PLAYER.eye, z: s.move.z };
    if (world.lineOfSight(eye, { x: p.x, y: p.y + 1.2, z: p.z }, 'sight') || world.lineOfSight(eye, { x: p.x, y: p.y + 0.3, z: p.z }, 'sight')) return true;
  }
  return false;
}

/**
 * Pick a spawn for the next zombie. `survivors` are the living survivors (downed included: they
 * still see). Random among the best few so the horde comes from several sides.
 */
export function pickZombieSpawn(world: CollisionWorld, candidates: readonly Vec3[], survivors: readonly PlayerState[], last: Vec3 | null, rnd: () => number): Vec3 | null {
  if (!candidates.length) return null;
  const scored = candidates.map((c) => {
    let near = Infinity;
    for (const s of survivors) near = Math.min(near, Math.hypot(s.move.x - c.x, s.move.z - c.z));
    let score = rnd() * 6;
    if (near < SPAWN_RULES.minDist) score -= 200;
    else if (seenBy(world, c, survivors)) score -= 100;
    if (near !== Infinity) score -= near < SPAWN_RULES.likeNear ? (SPAWN_RULES.likeNear - near) * 2 : near > SPAWN_RULES.likeFar ? (near - SPAWN_RULES.likeFar) * 0.5 : 0;
    if (last && Math.hypot(last.x - c.x, last.z - c.z) < 1) score -= 15;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!.score;
  const top = scored.slice(0, SPAWN_RULES.top).filter((s) => s.score > best - 12);
  return top[Math.floor(rnd() * top.length)]!.c;
}
