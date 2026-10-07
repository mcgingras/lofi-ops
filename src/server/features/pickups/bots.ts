/**
 * Bots and dropped guns, kept simple: a bot that is dry (or nearly, with nothing better in hand)
 * looks for a gun on the ground within a range that grows with its `weaponPickup` skill
 * (src/shared/defs/bots.ts), walks to it through a bots goal (registerBotGoal) and, once in reach,
 * "holds USE" for `PICKUP.botHoldSec` and swaps its emptiest gun for it. A copy of a gun it carries
 * is fine too: walking over it takes the ammo. Unless both its guns are empty it only goes when no
 * enemy has eyes on it.
 */
import { DEFAULT_LOBBY_BOTS, skillFor } from '../../../shared/defs/bots';
import { PICKUP } from '../../../shared/defs/pickups';
import { hashString } from '../../../shared/math';
import { eyeOf } from '../../combat';
import type { PlayerState, WeaponState } from '../../player';
import type { Room } from '../../room';
import { registerBotGoal } from '../bots/hooks';
import { carriesWeapon, dropsEnabled, dropsOf, GL_SLOT, isDrop, onTopOf, swapBlocker, swapFor, takeAmmo, type DropEntity } from './drops';
import { pickupsOf } from './state';

const DEFAULT_SKILL = skillFor(DEFAULT_LOBBY_BOTS).weaponPickup;
/** Re-think every this many ticks (staggered per bot). */
const THINK_TICKS = 30;
/** Search range: base + skill x extra (m). */
const RANGE = { base: 4, extra: 22 };
/** Enemies closer than this with line of sight make it unsafe (m). */
const DANGER_M = 30;

export function botPickupSkill(p: PlayerState): number {
  const v = p.ext.bots?.skill?.weaponPickup;
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_SKILL;
}

const total = (w: WeaponState | undefined) => (w ? w.mag + w.reserve : 0);
const frac = (w: WeaponState | undefined) => (w ? total(w) / Math.max(1, w.def.magazine + w.def.reserve) : 0);

/** 0 = fine, 1 = low (primary under a magazine, sidearm low too), 2 = both guns empty. */
export function ammoNeed(p: PlayerState): 0 | 1 | 2 {
  const [a, b] = p.weapons;
  if (total(a) === 0 && total(b) === 0) return 2;
  if (a && total(a) < a.def.magazine && frac(b) < 0.5) return 1;
  return 0;
}

function safe(room: Room, p: PlayerState): boolean {
  const eye = eyeOf(p);
  for (const q of room.players.values()) {
    if (!q.alive || !room.isEnemy(p, q)) continue;
    if (Math.hypot(q.move.x - p.move.x, q.move.z - p.move.z) > DANGER_M) continue;
    if (room.world.lineOfSight(eyeOf(q), eye)) return false;
  }
  return true;
}

/** The emptiest of the two guns (the one to give up). */
export function slotToReplace(p: PlayerState): number {
  return frac(p.weapons[0]) <= frac(p.weapons[1]) ? 0 : 1;
}

/** A gun worth walking to, or null. */
export function chooseDrop(room: Room, p: PlayerState, need: 1 | 2, range: number): DropEntity | null {
  let best: DropEntity | null = null;
  let bestD = Infinity;
  for (const e of dropsOf(room)) {
    if (!e.data.landed || e.data.mag + e.data.reserve <= 0) continue;
    if (Math.abs(e.y - p.move.y) > 3) continue;
    const d = Math.hypot(e.x - p.move.x, e.z - p.move.z);
    if (d > range || d >= bestD) continue;
    const same = carriesWeapon(p, e.data.weapon);
    // A copy only helps if that gun of ours is short; a different gun needs a decent load.
    if (same) {
      const mine = p.weapons.slice(0, GL_SLOT).find((w) => w.def.base.id === e.data.weapon)!;
      if (mine.reserve >= mine.def.reserve) continue;
    } else if (need < 2 && e.data.mag + e.data.reserve < 2 * (p.weapons[slotToReplace(p)]?.def.magazine ?? 10)) continue;
    best = e;
    bestD = d;
  }
  return best;
}

/** Per tick for every bot: pick a target now and then, take it once in reach. */
export function updateBotPickups(room: Room, dt: number): void {
  if (!dropsEnabled(room)) return;
  for (const p of room.players.values()) {
    if (!p.isBot) continue;
    const st = pickupsOf(p);
    if (!p.alive) {
      st.botTarget = null;
      st.botHold = 0;
      continue;
    }
    if ((room.tick + (hashString(p.id) % THINK_TICKS)) % THINK_TICKS === 0) {
      const k = botPickupSkill(p);
      const need = ammoNeed(p);
      st.botTarget = null;
      if (k > 0 && need !== 0 && (need === 2 || safe(room, p))) st.botTarget = chooseDrop(room, p, need, RANGE.base + RANGE.extra * k)?.id ?? null;
    }
    const target = st.botTarget === null ? undefined : room.entities.get(st.botTarget);
    if (!isDrop(target)) {
      st.botTarget = null;
      st.botHold = 0;
      continue;
    }
    if (carriesWeapon(p, target.data.weapon)) {
      // Walking over it takes the ammo (the regular walk-over check also does this).
      if (onTopOf(p, target)) {
        takeAmmo(room, p, target);
        st.botTarget = null;
      }
      continue;
    }
    const slot = slotToReplace(p);
    if (swapBlocker(room, p, target, { slot }) !== null) {
      st.botHold = 0;
      continue;
    }
    st.botHold += dt;
    if (st.botHold >= PICKUP.botHoldSec) {
      swapFor(room, p, target, slot);
      st.botTarget = null;
      st.botHold = 0;
    }
  }
}

let wired = false;

/** Bots walk to their chosen gun (a bots goal; priority beats most objectives when bone dry). Idempotent. */
export function wireBotGoal(): void {
  if (wired) return;
  wired = true;
  registerBotGoal('*', (room, bot) => {
    const id = bot.ext.pickups?.botTarget;
    if (id === null || id === undefined || !dropsEnabled(room)) return null;
    const e = room.entities.get(id);
    if (!isDrop(e)) return null;
    return { at: { x: e.x, y: e.y, z: e.z }, radius: 0.8, priority: ammoNeed(bot) === 2 ? 0.95 : 0.7, sprint: true, label: `pickup ${e.data.weapon}` };
  });
}
