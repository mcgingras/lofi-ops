/**
 * Second Chance: a lethal bullet or knife hit puts you down in last stand with your pistol instead
 * of killing you. You crawl (slow, no sprint, no regen) with `lastStandHealth` health; any further
 * damage finishes you, and when the timer runs out the player who put you down gets the kill.
 * Pro: a longer timer, and a teammate holding USE next to you for `reviveSec` gets you back up.
 *
 * Bots: while `player.ext.perks.lastStand` is set, return weaponSlot 1 from your brain.
 */
import { PERK_TUNING as T } from '../../../shared/defs/perks';
import { Buttons } from '../../../shared/input';
import { switchWeapon } from '../../combat';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { hasPerk, isPro, perksOf } from './common';

const TRIGGERS = new Set(['bullet', 'melee']);
const PISTOL_SLOT = 1;

export function setupLastStand(room: Room): void {
  const down = (p: PlayerState) => p.ext.perks?.lastStand ?? null;

  const end = (p: PlayerState) => {
    const st = p.ext.perks;
    if (!st?.lastStand) return;
    st.lastStand = null;
    room.sendFeature(p, 'perks.lastStand', { until: null, revive: 0 });
  };

  room.bus.on(
    'beforeDamage',
    (ev) => {
      const v = ev.victim;
      if (ev.cancel || !v.alive || ev.amount < v.health || down(v) || !hasPerk(v, 'second_chance')) return;
      if (!TRIGGERS.has(ev.means) || ev.part === 'head') return;
      if (!ev.attacker || ev.attacker === v) return;
      ev.cancel = true;
      const st = perksOf(v);
      const dur = isPro(v, 'second_chance') ? T.lastStandProSec : T.lastStandSec;
      st.lastStand = { until: room.time + dur, attacker: ev.attacker, weapon: ev.weapon, means: ev.means, reviveBy: null, revive: 0 };
      v.health = Math.min(v.maxHealth, T.lastStandHealth);
      v.lastDamageTime = room.time;
      v.damageLog.push({ attacker: ev.attacker, amount: ev.amount, time: room.time });
      if (v.weapons.length > PISTOL_SLOT && v.slot !== PISTOL_SLOT) switchWeapon(room, v, PISTOL_SLOT);
      room.send(ev.attacker, { t: 'hit', victim: v.id, part: ev.part ?? 'torso', damage: Math.round(ev.amount), kill: false });
      v.session?.send({ t: 'hurt', attacker: ev.attacker.id, amount: Math.round(ev.amount), from: ev.from ? [ev.from.x, ev.from.y, ev.from.z] : null, health: Math.ceil(v.health) });
      room.sendFeature(v, 'perks.lastStand', { until: st.lastStand.until, revive: 0 });
      room.bus.emit('perks.lastStand', { player: v, attacker: ev.attacker });
    },
    { priority: -100 },
  );

  room.modifiers.add('speedMultiplier', (p) => (down(p) ? T.lastStandSpeed : undefined), 'perks.second_chance_speed');
  room.modifiers.add('canSprint', (p) => (down(p) ? false : undefined), 'perks.second_chance_sprint');
  room.modifiers.add('regenDelayMultiplier', (p) => (down(p) ? 1e6 : undefined), 'perks.second_chance_regen');
  // USE belongs to last stand while down, and to reviving next to a downed (Pro) teammate.
  room.modifiers.add(
    'useClaimed',
    (q) => {
      if (down(q)) return true;
      for (const p of room.players.values()) {
        if (p === q || !p.alive || !down(p) || !isPro(p, 'second_chance') || room.isEnemy(p, q)) continue;
        if (Math.hypot(q.move.x - p.move.x, q.move.z - p.move.z) <= T.reviveRadius && Math.abs(q.move.y - p.move.y) < 1.5) return true;
      }
      return undefined;
    },
    'perks.second_chance_use',
  );

  room.bus.on('death', ({ victim }) => end(victim));
  room.bus.on('spawn', ({ player }) => end(player));
  room.bus.on('matchStart', () => {
    for (const p of room.players.values()) end(p);
  });

  room.bus.on('tick', ({ dt }) => {
    for (const p of room.players.values()) {
      const ls = down(p);
      if (!ls) continue;
      if (!p.alive) {
        end(p);
        continue;
      }
      if (room.time >= ls.until) {
        const killer = ls.attacker && room.players.has(ls.attacker.id) ? ls.attacker : null;
        end(p);
        room.kill(p, killer, { weapon: ls.weapon, means: ls.means, part: 'torso' });
        continue;
      }
      // Pro: revive by a teammate holding USE close by.
      if (!isPro(p, 'second_chance')) continue;
      let reviver: PlayerState | null = null;
      for (const q of room.players.values()) {
        if (q === p || !q.alive || down(q) || room.isEnemy(p, q) || !(q.buttons & Buttons.USE)) continue;
        if (Math.hypot(q.move.x - p.move.x, q.move.z - p.move.z) <= T.reviveRadius && Math.abs(q.move.y - p.move.y) < 1.5) {
          reviver = q;
          break;
        }
      }
      if (!reviver || (ls.reviveBy && ls.reviveBy !== reviver.id)) {
        if (ls.revive > 0) room.sendFeature(p, 'perks.lastStand', { until: ls.until, revive: 0 });
        ls.revive = 0;
        ls.reviveBy = null;
        continue;
      }
      ls.reviveBy = reviver.id;
      ls.revive += dt;
      if (ls.revive >= T.reviveSec) {
        end(p);
        p.health = p.maxHealth * 0.5;
        p.lastDamageTime = room.time;
        room.addPlayerScore(reviver, 50, 'revive');
        room.bus.emit('perks.revived', { player: p, by: reviver });
      } else if (Math.floor((ls.revive - dt) * 4) !== Math.floor(ls.revive * 4)) {
        room.sendFeature(p, 'perks.lastStand', { until: ls.until, revive: ls.revive / T.reviveSec });
      }
    }
  });
}
