/**
 * Tactical map mode on the server (BO1's radio): STREAK with a map-targeted streak selected raises
 * the radio and opens the overhead map on the client. While it is up the caller stands still with
 * the weapon down (core refuses fire), can be killed (which puts the radio away and keeps the
 * streak), and everyone else sees a `ks_radio` entity next to them (the client poses the soldier).
 * The client answers with `killstreaks.mapTarget` (points + yaw), validated here before the strike
 * logic runs; `killstreaks.mapCancel`, STREAK again, death, a selection change or the timeout put it
 * away. Bots never open it: they pick targets server-side (`suggestTarget`).
 */
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../../../shared/defs/killstreaks';
import { MAP_MODE, takeToken, validateMapTarget } from '../../../shared/defs/tactical-map';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { callKillstreak, type CallResult } from './api';
import { airspaceFull } from './streaks/heli';
import { ksOf, markDirty } from './state';
import { ksRoom } from './world';

/** Raise the radio for `id`. Returns a reason when it can't open. */
export function openMap(room: Room, p: PlayerState, id: string): string | null {
  const def = KILLSTREAK_BY_ID.get(id);
  if (!def || def.targeting !== 'map') return 'unknown';
  if (!p.alive) return 'dead';
  if (room.phase !== 'playing') return 'phase';
  const ks = ksOf(p);
  if (!ks.ready.includes(id)) return 'not_ready';
  if (ks.control) return 'busy';
  if (id === 'attack_helicopter' && airspaceFull(ksRoom(room))) return 'airspace_full';
  closeMap(room, p);
  ks.armed = null;
  const ent = room.entities.add({ kind: KS_ENTITY.radio, x: p.move.x, y: p.move.y, z: p.move.z, yaw: p.yaw, owner: p.id, team: p.team });
  ks.map = { id, until: room.time + MAP_MODE.maxSec, entity: ent.id };
  markDirty(room, p);
  return null;
}

/** Put the radio away (the streak stays ready). */
export function closeMap(room: Room, p: PlayerState): void {
  const ks = p.ext.killstreaks;
  if (!ks?.map) return;
  room.entities.remove(ks.map.entity);
  ks.map = null;
  markDirty(room, p);
}

/** Per tick: the radio follows its holder; it goes away on death or timeout. */
export function tickMap(room: Room, p: PlayerState): void {
  const m = p.ext.killstreaks?.map;
  if (!m) return;
  if (!p.alive || room.time >= m.until || room.phase !== 'playing' || !p.ext.killstreaks?.ready.includes(m.id)) return closeMap(room, p);
  const e = room.entities.get(m.entity);
  if (e) {
    e.x = p.move.x;
    e.y = p.move.y;
    e.z = p.move.z;
    e.yaw = p.yaw;
  }
  // Weapon down (core refuses fire while "switching").
  p.swapEnd = Math.max(p.swapEnd, room.time + 0.25);
}

/**
 * The client's choice from the tactical map. Validates everything (map open for that streak,
 * ready, rate limit, point count, inside the bounds, finite yaw) before calling the strike.
 */
export function submitMapTarget(room: Room, p: PlayerState, data: unknown): CallResult {
  const ks = ksOf(p);
  if (!takeToken((ks.mapRpc ??= { tokens: MAP_MODE.rpcBurst, at: room.time }), room.time)) return { ok: false, reason: 'rate_limited' };
  const id = (data as { id?: unknown } | null)?.id;
  if (typeof id !== 'string') return { ok: false, reason: 'bad_request' };
  const def = KILLSTREAK_BY_ID.get(id);
  if (!def || def.targeting !== 'map') return { ok: false, reason: 'not_map_streak' };
  if (!p.alive) return { ok: false, reason: 'dead' };
  if (!ks.ready.includes(id)) return { ok: false, reason: 'not_ready' };
  if (!ks.map || ks.map.id !== id) return { ok: false, reason: 'map_closed' };
  const check = validateMapTarget(def, room.map.bounds, data);
  if (!check.ok) return { ok: false, reason: check.reason };
  const ctx = ksRoom(room);
  const targets = check.points.map((q) => ({ x: q.x, y: ctx.groundAt(q.x, q.z), z: q.z }));
  const res = callKillstreak(room, p, id, { target: targets[0]!, targets, yaw: check.yaw ?? p.yaw });
  if (res.ok) closeMap(room, p);
  return res;
}
