/**
 * Wave Gun (dual Zap Guns). From the hip each pull fires a zap bolt from alternate pistols: an
 * instant beam (`lineStrike`) out to WAVE_GUN.zap.range for `damage`, and a small arc for
 * `arcDamage` to the nearest other enemy within `arcR` of the victim. Aimed down sights (the guns
 * snapped together, `move.ads >= adsAt`) the same trigger fires the Wave Gun at x`wave.fireRate`
 * the rate (the `fireRateMultiplier` modifier, so the client's trigger follows): out to
 * `wave.range` a body on (or beside) the line swells for `swellSec` (a `weapons.swell` entity:
 * `s.p` id, `s.t` pop time; slowed, hands taken) and pops for `damage` (a kill).
 */
import { shotSeed, spreadDegrees, spreadDirection, stanceSpread } from '../../../../shared/ballistics';
import { papWonder } from '../../../../shared/defs/pack-a-punch';
import { WAVE_GUN, WONDER_ENTITY } from '../../../../shared/defs/wonder';
import type { HitPart } from '../../../../shared/collision';
import type { WeaponBehavior } from '../../../combat';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import { chest, emitFire, isSwelling, lineStrike, targetsOf, v3, wonderFx, wonderOf } from './common';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Is `p` aiming the Wave Gun (pistols together)? */
export const waveAimed = (p: PlayerState): boolean => p.weapons[p.slot]?.def.base.id === 'wavegun' && p.move.ads >= WAVE_GUN.adsAt;

export const wavegunBehavior: WeaponBehavior = {
  fire(room, player, weapon, shot) {
    const moving = Math.hypot(player.move.vx, player.move.vz) > 0.5;
    const spread = spreadDegrees(weapon.def, player.move.ads, moving, room.modifiers.mul('spreadMultiplier', player) * stanceSpread(player.move));
    const dir = spreadDirection(shot.dir, spread, shotSeed(player.seed, shot.shot, 0));
    const o = shot.origin;
    const hits: { victim: PlayerState; part: HitPart; damage: number }[] = [];

    if (waveAimed(player)) {
      const W = WAVE_GUN.wave;
      const strike = lineStrike(room, player, o, dir, W);
      wonderFx(room, { k: 'wave', p: player.id, o: v3(o), e: v3(strike.end), hit: !!strike.victim });
      if (strike.victim) {
        swell(room, strike.victim, player);
        hits.push({ victim: strike.victim, part: strike.part, damage: 0 });
      }
      emitFire(room, player, 'wavegun', o, dir, strike.end, hits);
      return;
    }

    const Z = WAVE_GUN.zap;
    const w = wonderOf(player);
    const side = w.zapSide;
    w.zapSide = side ? 0 : 1;
    const strike = lineStrike(room, player, o, dir, Z);
    wonderFx(room, { k: 'zap', p: player.id, o: v3(o), e: v3(strike.end), hit: !!strike.victim, s: side });
    const v = strike.victim;
    if (v) {
      const dist = Math.hypot(player.move.x - v.move.x, player.move.z - v.move.z);
      hits.push({ victim: v, part: strike.part, damage: room.damage({ victim: v, attacker: player, amount: Z.damage, weapon: 'wavegun', part: strike.part, means: 'wonder', from: o, distance: dist }) });
      // A small arc off the victim to the nearest other enemy beside them (packed, the Max Wave
      // Gun: it keeps arcing, each from the last one hit, up to `arcs`).
      const arcs = weapon.pap ? (papWonder('wavegun').arcs ?? 1) : 1;
      const struck = new Set<PlayerState>([v]);
      let from = chest(v);
      for (let i = 0; i < arcs; i++) {
        let best: PlayerState | null = null;
        let bd: number = Z.arcR;
        for (const q of targetsOf(room, player)) {
          if (struck.has(q)) continue;
          const c = chest(q);
          const d = Math.hypot(c.x - from.x, c.y - from.y, c.z - from.z);
          if (d <= bd && room.world.lineOfSight(from, c, 'bullets')) {
            bd = d;
            best = q;
          }
        }
        if (!best) break;
        struck.add(best);
        const to = chest(best);
        wonderFx(room, { k: 'arc', p: player.id, o: v3(from), e: v3(to), hop: i + 1, hit: true });
        hits.push({ victim: best, part: 'torso', damage: room.damage({ victim: best, attacker: player, amount: Z.arcDamage, weapon: 'wavegun', part: 'torso', means: 'wonder', from, distance: dist + bd }) });
        from = to;
      }
    }
    emitFire(room, player, 'wavegun', o, dir, strike.end, hits);
  },
};

/** Start `q` swelling (no-op if they already are): they pop WAVE_GUN.wave.swellSec later. */
export function swell(room: Room, q: PlayerState, by: PlayerState | null): void {
  const w = wonderOf(q);
  if (isSwelling(q)) return;
  w.popAt = room.time + WAVE_GUN.wave.swellSec;
  w.popBy = by?.id ?? null;
  w.swellEntity = room.entities.add({ kind: WONDER_ENTITY.swell, x: q.move.x, y: q.move.y, z: q.move.z, yaw: q.yaw, s: { p: q.id, t: Math.round(w.popAt * 1000) / 1000 } }).id;
}

/** Clear a swell (pop, death, respawn) and its entity. */
export function clearSwell(room: Room, q: PlayerState): void {
  const w = q.ext.wonder;
  if (!w) return;
  if (w.swellEntity !== null) room.entities.remove(w.swellEntity);
  w.swellEntity = null;
  w.popAt = 0;
  w.popBy = null;
}

/** Per tick: swelling bodies carry their entity and pop on time. */
export function updateSwell(room: Room): void {
  for (const q of room.players.values()) {
    const w = q.ext.wonder;
    if (!w || (w.popAt <= 0 && w.swellEntity === null)) continue;
    if (!q.alive) {
      clearSwell(room, q);
      continue;
    }
    const e = w.swellEntity !== null ? room.entities.get(w.swellEntity) : undefined;
    if (e) {
      e.x = q.move.x;
      e.y = q.move.y;
      e.z = q.move.z;
      e.yaw = q.yaw;
    }
    if (w.popAt > 0 && room.time >= w.popAt) {
      const by = w.popBy ? (room.players.get(w.popBy) ?? null) : null;
      const c = chest(q);
      clearSwell(room, q);
      wonderFx(room, { k: 'pop', p: by?.id ?? null, v: q.id, x: r2(c.x), y: r2(c.y), z: r2(c.z) });
      room.damage({ victim: q, attacker: by, amount: WAVE_GUN.wave.damage, weapon: 'wavegun', part: 'torso', means: 'wonder', from: c, distance: by ? Math.hypot(by.move.x - q.move.x, by.move.z - q.move.z) : 0 });
      if (by) popBurst(room, by, q, c);
    }
  }
}

/** A pop bursts over the shooter's enemies near the body: `popMax` at the body to `popMin` at `popR`. */
function popBurst(room: Room, by: PlayerState, popped: PlayerState, c: { x: number; y: number; z: number }): void {
  const W = WAVE_GUN.wave;
  for (const q of targetsOf(room, by)) {
    if (q === popped) continue;
    const at = chest(q);
    const d = Math.hypot(at.x - c.x, at.y - c.y, at.z - c.z);
    if (d > W.popR || !room.world.lineOfSight(c, at, 'bullets')) continue;
    const amount = W.popMax + (W.popMin - W.popMax) * (d / W.popR);
    room.damage({ victim: q, attacker: by, amount, weapon: 'wavegun', part: 'torso', means: 'wonder', from: c, distance: Math.hypot(by.move.x - q.move.x, by.move.z - q.move.z) });
  }
}

/** The Wave Gun's rules for a room: the aimed shot's slow trigger, and a swelling body's state. */
export function wireWave(room: Room): void {
  room.modifiers.add('fireRateMultiplier', (p) => (waveAimed(p) ? WAVE_GUN.wave.fireRate : undefined), 'weapons.wavegun');
  room.modifiers.add('speedMultiplier', (p) => (isSwelling(p) ? WAVE_GUN.wave.slow : undefined), 'weapons.swell');
  room.modifiers.add('canFire', (p) => (isSwelling(p) ? false : undefined), 'weapons.swell');
  room.modifiers.add('canSprint', (p) => (isSwelling(p) ? false : undefined), 'weapons.swell');
  room.modifiers.add('botFrozen', (bot) => (isSwelling(bot) ? true : undefined), 'weapons.swell');
}
