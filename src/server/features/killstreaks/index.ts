/**
 * Server side of the 'killstreaks' feature area (owner: perks-streaks). BO1 killstreaks:
 *
 *   Spy Plane 3, RC-XD 3, Counter-Spy Plane 4, SAM Turret 4, Care Package 5, Napalm Strike 5,
 *   Sentry Gun 6, Mortar Team 6, Attack Helicopter 7, Valkyrie Rockets 7, Blackbird 8,
 *   Rolling Thunder 8, Chopper Gunner 9, Attack Dogs 11.
 *
 * Kills toward streaks reset on death; kills made by killstreaks don't count; Hardline makes each a
 * kill cheaper (`streakCostOffset` modifier). Earned streaks wait in a list until called with the
 * STREAK button or the `killstreaks.call` RPC. The Care Package arms a designator (press STREAK
 * again where you aim); Napalm, Mortar Team, Rolling Thunder and the Attack Helicopter raise the
 * radio and open the tactical map (`mapmode.ts`, answered by `killstreaks.mapTarget`). Bots call
 * theirs automatically (skill `streakUse`) or through `api.ts`, picking targets server-side.
 * Everything a streak shoots at comes from `room.players`, so bots and humans are targeted alike,
 * and every `fire` event (bots' too) can damage enemy hardware.
 */
import { KILLSTREAK_BY_ID } from '../../../shared/defs/killstreaks';
import { Buttons } from '../../../shared/input';
import type { Feature } from '../../feature';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { RpcError } from '../../rpc';
import { botAutoStreaks, botCallDelay, callKillstreak } from './api';
import { botStreakSkill } from './skill';
import { closeMap, openMap, submitMapTarget, tickMap } from './mapmode';
import { flushState, grant, ksOf, markDirty, onKill, resetPlayer, stateMsg } from './state';
import { onUsePressed } from './streaks/package';
import { registerRadarModifiers } from './streaks/radar';
import { ksRoom } from './world';

export { callKillstreak, readyKillstreaks, enemyStreakTargets, suggestTarget, isDrivingStreak, isDesignating, killstreakState, botAutoStreaks } from './api';

/** Seconds a designator stays up waiting for marks. */
const ARM_SEC = 15;

const REASONS: Record<string, string> = {
  no_target: 'Invalid target',
  airspace_full: 'Airspace too crowded',
  busy: 'Already controlling a killstreak',
  dead: 'Not while dead',
  phase: 'Not now',
  not_ready: 'Not ready',
};

function notify(room: Room, p: PlayerState, reason: string) {
  room.sendFeature(p, 'perks.notice', { text: REASONS[reason] ?? reason.replace(/_/g, ' ') });
}

/** STREAK pressed: designate, or call the selected streak. */
export function onStreakPressed(room: Room, p: PlayerState): void {
  if (!p.alive || room.phase !== 'playing') return;
  const ks = ksOf(p);
  if (ks.control) return; // vehicles read the press themselves (RC-XD detonates)
  if (ks.map) return closeMap(room, p); // STREAK again puts the radio away
  const ctx = ksRoom(room);
  if (ks.armed) {
    const at = ctx.aimPoint(p);
    if (!at) return notify(room, p, 'no_target');
    ks.armed.marks.push(at);
    markDirty(room, p);
    if (ks.armed.marks.length >= ks.armed.need) {
      const { id, marks } = ks.armed;
      ks.armed = null;
      const res = callKillstreak(room, p, id, { target: marks[0], targets: marks });
      if (!res.ok) notify(room, p, res.reason);
    }
    return;
  }
  const id = ks.ready[ks.selected];
  const def = id ? KILLSTREAK_BY_ID.get(id) : undefined;
  if (!id || !def) return;
  if (def.targeting === 'map') {
    const why = openMap(room, p, id);
    if (why) notify(room, p, why);
    return;
  }
  if (def.targeting === 'point' || def.targeting === 'line' || def.targeting === 'points') {
    ks.armed = { id, marks: [], need: def.marks ?? 1, until: room.time + ARM_SEC };
    markDirty(room, p);
    return;
  }
  const res = callKillstreak(room, p, id);
  if (!res.ok) notify(room, p, res.reason);
}

const feature: Feature = {
  id: 'killstreaks',
  setup(api) {
    api.rpc.handle('killstreaks.select', (ctx, data) => {
      const p = ctx.player;
      const index = (data as { index?: unknown } | null)?.index;
      if (typeof index !== 'number' || !Number.isFinite(index)) throw new RpcError('bad_request', 'index required');
      if (!p || !ctx.room) throw new RpcError('not_in_match');
      const ks = ksOf(p);
      if (ks.armed) ks.armed = null;
      closeMap(ctx.room, p);
      ks.selected = ks.ready.length ? ((Math.floor(index) % ks.ready.length) + ks.ready.length) % ks.ready.length : 0;
      markDirty(ctx.room, p);
      return { selected: ks.selected };
    });
    api.rpc.handle('killstreaks.call', (ctx, data) => {
      const p = ctx.player;
      const room = ctx.room;
      if (!p || !room) throw new RpcError('not_in_match');
      const d = (data ?? {}) as { id?: unknown; target?: unknown; targets?: unknown };
      if (typeof d.id !== 'string' || !KILLSTREAK_BY_ID.has(d.id)) throw new RpcError('bad_request', 'id required');
      const vec = (v: unknown) => (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? { x: v[0] as number, y: v[1] as number, z: v[2] as number } : null);
      const target = vec(d.target);
      const targets = Array.isArray(d.targets) ? d.targets.slice(0, 3).map(vec).filter((v): v is NonNullable<typeof v> => !!v) : undefined;
      // Map-targeted streaks are chosen on the tactical map (killstreaks.mapTarget), never by crosshair.
      if (KILLSTREAK_BY_ID.get(d.id)?.targeting === 'map') return { ok: false, reason: ksOf(p).ready.includes(d.id) ? 'use_map' : 'not_ready' };
      const res = callKillstreak(room, p, d.id, { target, targets });
      return res.ok ? { ok: true } : { ok: false, reason: res.reason };
    });
    api.rpc.handle('killstreaks.mapTarget', (ctx, data) => {
      const p = ctx.player;
      const room = ctx.room;
      if (!p || !room) throw new RpcError('not_in_match');
      const res = submitMapTarget(room, p, data);
      return res.ok ? { ok: true } : { ok: false, reason: res.reason };
    });
    api.rpc.handle('killstreaks.mapCancel', (ctx) => {
      if (ctx.player && ctx.room) closeMap(ctx.room, ctx.player);
      return { ok: true };
    });
    api.rpc.handle('killstreaks.state', (ctx) => (ctx.player && ctx.room ? stateMsg(ctx.room, ctx.player) : null));
    // Dev only: LOFI_CHEATS=1 lets a client grant itself streaks and add enemy bots (browser testing).
    if (process.env.LOFI_CHEATS === '1') {
      api.rpc.handle('killstreaks.cheat', (ctx, data) => {
        const p = ctx.player;
        const room = ctx.room;
        if (!p || !room) throw new RpcError('not_in_match');
        const d = (data ?? {}) as { id?: unknown; bots?: unknown };
        if (typeof d.id === 'string' && KILLSTREAK_BY_ID.has(d.id)) grant(room, p, d.id);
        const n = typeof d.bots === 'number' ? Math.min(8, Math.max(0, Math.floor(d.bots))) : 0;
        for (let i = 0; i < n; i++) room.addBot({ team: room.mode.teams ? (p.team === 0 ? 1 : 0) : null });
        return { ready: [...ksOf(p).ready] };
      });
    }
  },
  room(room) {
    const ctx = ksRoom(room);
    registerRadarModifiers(room, ctx);
    // Driving a streak or holding the radio (tactical map): the body stands still with its weapon
    // down; designating: no sprint.
    room.modifiers.add('speedMultiplier', (p) => (p.ext.killstreaks?.control || p.ext.killstreaks?.map ? 0 : undefined), 'killstreaks.control');
    room.modifiers.add('canSprint', (p) => (p.ext.killstreaks?.control || p.ext.killstreaks?.armed || p.ext.killstreaks?.map ? false : undefined), 'killstreaks.control_sprint');

    room.bus.on('death', (e) => {
      const ks = e.victim.ext.killstreaks;
      if (ks?.armed) ks.armed = null;
      closeMap(room, e.victim); // dying with the radio up keeps the streak
      const earned = onKill(room, e.attacker, e.victim, e.weapon);
      const a = e.attacker;
      if (!a) return;
      for (const id of earned) {
        room.bus.emit('killstreaks.earned', { player: a, id });
        room.sendFeature(a, 'killstreaks.earned', { id });
        if (a.isBot) {
          const aks = ksOf(a);
          aks.botNextCall = Math.max(aks.botNextCall ?? 0, room.time + botCallDelay(botStreakSkill(a)));
        }
      }
    });
    room.bus.on('fire', (e) => ctx.onFire(e.player, e.weapon, e.origin, e.dir, e.end));
    room.bus.on('buttons', ({ player, pressed }) => {
      if (pressed & Buttons.STREAK) onStreakPressed(room, player);
      if (pressed & Buttons.USE) onUsePressed(ctx, player);
    });
    room.bus.on('weaponSwitch', ({ player }) => {
      const ks = player.ext.killstreaks;
      if (ks?.armed) {
        ks.armed = null;
        markDirty(room, player);
      }
    });
    room.bus.on('spawn', ({ player }) => markDirty(room, player));
    room.bus.on('playerJoin', ({ player }) => markDirty(room, player));
    room.bus.on('playerLeave', ({ player }) => {
      closeMap(room, player);
      ctx.clearOwner(player);
    });
    room.bus.on('matchStart', () => {
      ctx.clear();
      for (const p of room.players.values()) resetPlayer(room, p);
    });
    room.bus.on('phase', ({ phase }) => {
      if (phase === 'ended' || phase === 'lobby') {
        ctx.clear();
        for (const p of room.players.values()) {
          const ks = ksOf(p);
          ks.control = null;
          ks.armed = null;
          closeMap(room, p);
          markDirty(room, p);
        }
      }
    });
    room.bus.on('tick', ({ dt, tick }) => {
      if (room.phase === 'playing') ctx.update(dt);
      for (const p of room.players.values()) {
        const ks = p.ext.killstreaks;
        if (!ks) continue;
        tickMap(room, p);
        if (ks.armed && (room.time >= ks.armed.until || !p.alive)) {
          ks.armed = null;
          markDirty(room, p);
        }
        // Weapon down while driving or holding the designator (core refuses fire while "switching").
        if ((ks.control || ks.armed) && p.alive) p.swapEnd = Math.max(p.swapEnd, room.time + 0.25);
        if (p.isBot && tick % 15 === 0 && room.phase === 'playing') botAutoStreaks(room, p);
      }
      flushState(room);
    });
  },
};

export default feature;
