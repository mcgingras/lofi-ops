/**
 * Second Chance: a lethal bullet or knife hit puts you down in last stand with your pistol instead
 * of killing you. You crawl (slow, no sprint, no regen) with `lastStandHealth` health; any further
 * damage finishes you, and when the timer runs out the player who put you down gets the kill.
 * Pro: a longer timer, and a teammate holding USE next to you for `reviveSec` gets you back up.
 *
 * Weapons, as in BO1 (`maps/mp/_laststand.gsc`): going down remembers the weapon in hand
 * (`self.previousPrimary = self GetCurrentWeapon()`) and switches to the pistol; a revive gives the
 * weapons back and switches to that remembered weapon (`takePlayerOutOfLastStand`), so whoever went
 * down on the primary gets the primary back and whoever was already on the secondary stays on it.
 * Both switches are server-forced (`forceSlot`), and the revive push carries the slot so the
 * client follows it.
 *
 * Other modes reuse the machinery: `enterLastStand(room, p, opts)` downs a player with the mode's
 * own timer, revive rule (`revivable`, `reviveSecFor`, `reviveScore`) and bleed-out (`onBleedOut`),
 * and `reviveFromLastStand(room, p, by)` gets them up (Zombies: teammates and solo Quick Revive).
 *
 * Bots: while `player.ext.perks.lastStand` is set, return weaponSlot 1 from your brain.
 */
import { PERK_TUNING as T } from '../../../shared/defs/perks';
import { Buttons } from '../../../shared/input';
import { forceSlot } from '../../combat';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { hasPerk, isPro, perksOf, type LastStand } from './common';

const TRIGGERS = new Set(['bullet', 'melee']);
const PISTOL_SLOT = 1;

export interface EnterLastStandOpts {
  attacker: PlayerState | null;
  weapon: string;
  means: string;
  /** Seconds until bleed-out. */
  durationSec: number;
  /** Health while down (default Second Chance's). */
  health?: number;
  revivable?: boolean;
  reviveSecFor?: (reviver: PlayerState) => number;
  reviveScore?: number;
  onBleedOut?: () => void;
  /** Switch to slot 1 (the pistol) as Second Chance does (default true). */
  pistol?: boolean;
}

/** Push the downed state to the player (timer, revive progress, the slot a revive put back). */
function sendState(room: Room, p: PlayerState, until: number | null, revive: number, slot?: number): void {
  room.sendFeature(p, 'perks.lastStand', slot === undefined ? { until, revive } : { until, revive, slot });
}

/** Put a living player into last stand now (no damage involved). Returns the state, or null if not possible. */
export function enterLastStand(room: Room, v: PlayerState, opts: EnterLastStandOpts): LastStand | null {
  if (!v.alive) return null;
  const st = perksOf(v);
  if (st.lastStand) return st.lastStand;
  st.lastStand = {
    until: room.time + opts.durationSec,
    attacker: opts.attacker,
    weapon: opts.weapon,
    means: opts.means,
    reviveBy: null,
    revive: 0,
    prevSlot: v.slot,
    ...(opts.revivable !== undefined ? { revivable: opts.revivable } : {}),
    ...(opts.reviveSecFor ? { reviveSecFor: opts.reviveSecFor } : {}),
    ...(opts.reviveScore !== undefined ? { reviveScore: opts.reviveScore } : {}),
    ...(opts.onBleedOut ? { onBleedOut: opts.onBleedOut } : {}),
  };
  v.health = Math.min(v.maxHealth, opts.health ?? T.lastStandHealth);
  v.lastDamageTime = room.time;
  if (opts.pistol !== false && v.weapons.length > PISTOL_SLOT && v.slot !== PISTOL_SLOT) forceSlot(room, v, PISTOL_SLOT);
  sendState(room, v, st.lastStand.until, 0);
  room.bus.emit('perks.lastStand', { player: v, attacker: opts.attacker });
  return st.lastStand;
}

/**
 * Get a downed player back up: back to the weapon they went down with (BO1), half health, the
 * reviver's score, `perks.revived`. `by` is the reviver (the player themself for a self-revive).
 */
export function reviveFromLastStand(room: Room, p: PlayerState, by: PlayerState): boolean {
  const ls = p.ext.perks?.lastStand;
  if (!ls || !p.alive) return false;
  const back = ls.prevSlot >= 0 && ls.prevSlot < p.weapons.length ? ls.prevSlot : 0;
  forceSlot(room, p, back);
  p.ext.perks!.lastStand = null;
  sendState(room, p, null, 0, back);
  p.health = p.maxHealth * 0.5;
  p.lastDamageTime = room.time;
  const score = ls.reviveScore ?? 50;
  if (by !== p && score > 0) room.addPlayerScore(by, score, 'revive');
  room.bus.emit('perks.revived', { player: p, by });
  return true;
}

export function setupLastStand(room: Room): void {
  const down = (p: PlayerState) => p.ext.perks?.lastStand ?? null;
  const canRevive = (p: PlayerState, ls: LastStand) => ls.revivable === true || isPro(p, 'second_chance');

  const end = (p: PlayerState, slot?: number) => {
    const st = p.ext.perks;
    if (!st?.lastStand) return;
    st.lastStand = null;
    sendState(room, p, null, 0, slot);
  };

  room.bus.on(
    'beforeDamage',
    (ev) => {
      const v = ev.victim;
      if (ev.cancel || !v.alive || ev.amount < v.health || down(v) || !hasPerk(v, 'second_chance')) return;
      if (!TRIGGERS.has(ev.means) || ev.part === 'head') return;
      if (!ev.attacker || ev.attacker === v) return;
      ev.cancel = true;
      const dur = isPro(v, 'second_chance') ? T.lastStandProSec : T.lastStandSec;
      v.damageLog.push({ attacker: ev.attacker, amount: ev.amount, time: room.time });
      enterLastStand(room, v, { attacker: ev.attacker, weapon: ev.weapon, means: ev.means, durationSec: dur });
      room.send(ev.attacker, { t: 'hit', victim: v.id, part: ev.part ?? 'torso', damage: Math.round(ev.amount), kill: false });
      v.session?.send({ t: 'hurt', attacker: ev.attacker.id, amount: Math.round(ev.amount), from: ev.from ? [ev.from.x, ev.from.y, ev.from.z] : null, health: Math.ceil(v.health) });
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
        const ls = down(p);
        if (p === q || !p.alive || !ls || !canRevive(p, ls) || room.isEnemy(p, q)) continue;
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
        end(p);
        if (ls.onBleedOut) ls.onBleedOut();
        else {
          const killer = ls.attacker && room.players.has(ls.attacker.id) ? ls.attacker : null;
          room.kill(p, killer, { weapon: ls.weapon, means: ls.means, part: 'torso' });
        }
        continue;
      }
      // Pro (or a mode's revivable last stand): revive by a teammate holding USE close by.
      if (!canRevive(p, ls)) continue;
      let reviver: PlayerState | null = null;
      for (const q of room.players.values()) {
        if (q === p || !q.alive || down(q) || room.isEnemy(p, q) || !(q.buttons & Buttons.USE)) continue;
        if (Math.hypot(q.move.x - p.move.x, q.move.z - p.move.z) <= T.reviveRadius && Math.abs(q.move.y - p.move.y) < 1.5) {
          reviver = q;
          break;
        }
      }
      if (!reviver || (ls.reviveBy && ls.reviveBy !== reviver.id)) {
        if (ls.revive > 0) sendState(room, p, ls.until, 0);
        ls.revive = 0;
        ls.reviveBy = null;
        continue;
      }
      ls.reviveBy = reviver.id;
      ls.revive += dt;
      const need = ls.reviveSecFor ? ls.reviveSecFor(reviver) : T.reviveSec;
      if (ls.revive >= need) reviveFromLastStand(room, p, reviver);
      else if (Math.floor((ls.revive - dt) * 4) !== Math.floor(ls.revive * 4)) sendState(room, p, ls.until, ls.revive / need);
    }
  });
}
