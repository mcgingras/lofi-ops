/**
 * Power-ups (BO1 `_zombiemode_powerups.gsc`): a killed zombie drops one when the drop flag is up
 * (the team's total score crossed the next threshold) or on a 3% random chance, at most 4 a round,
 * picked from a shuffled cycle. Max Ammo, Insta-Kill (30 s), Double Points (30 s), the Nuke (every
 * zombie dies, +400 each), Carpenter (only with barriers). Each lies there glowing and spinning for
 * 15 s, blinks for 11 more, and is gone; a survivor walks over it to grab it. The last hellhound of
 * a dog round always drops a Max Ammo.
 */
import { POWERUP_BY_ID, POWERUP_RULES, POINTS, PowerupCycle, rollDrop, updateDropTracker, ZM_ENTITY, type PowerupId } from '../../../shared/defs/zombies';
import type { Vec3 } from '../../../shared/math';
import type { Entity } from '../../entities';
import type { PlayerState } from '../../player';
import type { ZombiesGame } from './game';
import { survivorOf, undeadOf, type UndeadExt } from './state';

export class Powerups {
  cycle: PowerupCycle;
  private nextScoreCheck = 0;

  constructor(private game: ZombiesGame) {
    this.cycle = new PowerupCycle(this.ids());
  }

  private ids(): PowerupId[] {
    const ids: PowerupId[] = ['full_ammo', 'insta_kill', 'double_points', 'nuke'];
    if (this.game.layer?.barriers?.length) ids.push('carpenter');
    return ids;
  }

  reset(): void {
    this.cycle = new PowerupCycle(this.ids());
    this.nextScoreCheck = 0;
  }

  active(): Entity[] {
    return this.game.room.entities.byKind(ZM_ENTITY.powerup);
  }

  /** A zombie died at its spot: maybe a drop. */
  onKill(victim: PlayerState, z: UndeadExt): void {
    const g = this.game;
    if (z.nuked) return;
    const at = { x: victim.move.x, y: victim.move.y, z: victim.move.z };
    if (z.kind === 'dog' && g.dogRound && g.queue <= 0 && g.aliveUndead().length === 0) {
      this.drop('full_ammo', at);
      return;
    }
    if (rollDrop(g.drops, Math.random())) this.drop(this.cycle.pick({ brokenWindows: g.brokenWindows() }), at);
  }

  drop(id: PowerupId, at: Vec3): Entity {
    const room = this.game.room;
    const ground = room.world.groundBelow(at.x, at.z, at.y + 1, 4) ?? at.y;
    const t0 = room.time;
    return room.entities.add({ kind: ZM_ENTITY.powerup, x: at.x, y: ground, z: at.z, yaw: 0, s: { k: id, t0, te: t0 + POWERUP_RULES.solidSec + POWERUP_RULES.blinkSec } });
  }

  tick(_dt: number): void {
    const g = this.game;
    const room = g.room;
    const now = room.time;
    if (now >= this.nextScoreCheck) {
      this.nextScoreCheck = now + 0.5;
      let total = 0;
      for (const p of g.survivors()) total += survivorOf(p)!.total;
      updateDropTracker(g.drops, total);
    }
    if (room.tick % 3 !== 0) return;
    for (const e of this.active()) {
      const te = Number(e.s?.te ?? 0);
      if (now >= te) {
        room.entities.remove(e.id);
        continue;
      }
      for (const p of g.survivors()) {
        if (!g.isUp(p)) continue;
        if (Math.hypot(p.move.x - e.x, p.move.z - e.z) > POWERUP_RULES.grabRadius || Math.abs(p.move.y - e.y) > 1.6) continue;
        room.entities.remove(e.id);
        this.grab(String(e.s?.k) as PowerupId, p, e);
        break;
      }
    }
  }

  grab(id: PowerupId, p: PlayerState, at: { x: number; y: number; z: number }): void {
    const g = this.game;
    const room = g.room;
    const now = room.time;
    const def = POWERUP_BY_ID.get(id);
    switch (id) {
      case 'full_ammo':
        for (const q of g.survivors()) {
          const s = survivorOf(q)!;
          for (const w of [...q.weapons, ...(s.downedWeapons ?? [])]) w.reserve = Math.max(w.reserve, w.def.reserve);
          const x = q.ext.weapons;
          if (x?.lethal) room.bus.emit('perks.resupply', { player: q, lethal: 4, tactical: 0 });
        }
        break;
      case 'insta_kill':
        g.instaUntil = now + (def?.durationSec ?? 30);
        break;
      case 'double_points':
        g.doubleUntil = now + (def?.durationSec ?? 30);
        break;
      case 'nuke':
        this.nuke(at);
        break;
      case 'carpenter':
        g.carpenter();
        break;
    }
    g.event({ kind: 'powerup', id, player: p.id, text: def?.name ?? id, at: { x: at.x, y: at.y, z: at.z } });
    room.bus.emit('zombies.powerup', { player: p, id });
    g.dirty = true;
  }

  /** Every zombie on the map dies (staggered, after the flash); +400 to everyone up; no kill points or drops. */
  nuke(_at: Vec3): void {
    const g = this.game;
    const room = g.room;
    for (const b of g.aliveUndead()) {
      const z = undeadOf(b)!;
      z.nuked = true;
      const delay = POWERUP_RULES.nukeDelay + POWERUP_RULES.nukeStaggerMin + Math.random() * (POWERUP_RULES.nukeStaggerMax - POWERUP_RULES.nukeStaggerMin);
      room.schedule(delay, () => {
        if (b.alive && undeadOf(b)?.nuked) room.kill(b, null, { weapon: 'nuke', means: 'explosive', part: 'head' });
      });
    }
    for (const q of g.survivors()) g.award(q, POINTS.nuke, 'nuke');
  }
}
