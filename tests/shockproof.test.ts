/**
 * Flak Jacket Pro, "Shockproof": explosions don't rattle you. Each modifier only with Pro: no blast
 * shake / ringing (sent to the client as `weapons.equip.shock`), no explosive flinch on bots, no
 * Thundergun launch (the damage still lands), Winter's Howl frost and concussions at half; fire
 * immunity is kept. Base Flak Jacket changes none of them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import bots from '../src/server/features/bots/index';
import { perksOf } from '../src/server/features/perks/common';
import weapons, { explode, stunnedAmount } from '../src/server/features/weapons/index';
import { frostOf } from '../src/server/features/weapons/wonder/index';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { PLAYER } from '../src/shared/constants';
import { EQUIPMENT_BY_ID } from '../src/shared/defs/equipment';
import { PERK_BY_ID, PERK_TUNING as T } from '../src/shared/defs/perks';
import { bot, place, rig, type Rig } from './perks-streaks.helpers';

let r: Rig | undefined;
afterEach(() => {
  r?.close();
  r = undefined;
});
const setup = (extra = [weapons]) => (r = rig({}, extra)).room;

const pro = (p: PlayerState) => {
  perksOf(p).allPro = true;
  return p;
};
const eye = (p: PlayerState) => ({ x: p.move.x, y: p.move.y + PLAYER.eye, z: p.move.z });
function arm(p: PlayerState, id: string): void {
  const w = makeWeapon({ weapon: id, attachments: [], camo: 'none' }, id);
  w.credit = 1;
  p.weapons[0] = w;
  p.slot = 0;
  p.swapEnd = 0;
  p.reloadEnd = 0;
}
const still = (room: Room) => room.modifiers.add('regenDelayMultiplier', () => 1000, 'test.noregen');

describe('Flak Jacket Pro: Shockproof', () => {
  it('the description says what it does (no fuse reset)', () => {
    const pd = PERK_BY_ID.get('flak_jacket')!.pro.description;
    expect(pd).toMatch(/^Shockproof/);
    expect(pd).toMatch(/immune to fire/);
    expect(pd).toMatch(/concussions halved/);
    expect(pd).not.toMatch(/fuse/i);
  });

  it('every Shockproof modifier applies with Pro only', () => {
    const room = setup();
    const none = bot(room, 0);
    const base = bot(room, 0, ['flak_jacket']);
    const p = pro(bot(room, 0, ['flak_jacket']));
    const other = pro(bot(room, 0, ['hardened']));
    const keys = ['blastShakeMultiplier', 'explosiveFlinchMultiplier', 'knockbackMultiplier', 'concussionMultiplier', 'frostMultiplier'] as const;
    for (const k of keys) {
      expect(room.modifiers.mul(k, none), k).toBe(1);
      expect(room.modifiers.mul(k, base), k).toBe(1);
      expect(room.modifiers.mul(k, other), k).toBe(1);
    }
    expect(room.modifiers.mul('blastShakeMultiplier', p)).toBe(T.shockproofShake);
    expect(room.modifiers.mul('explosiveFlinchMultiplier', p)).toBe(T.shockproofFlinch);
    expect(room.modifiers.mul('knockbackMultiplier', p)).toBe(T.shockproofKnockback);
    expect(room.modifiers.mul('concussionMultiplier', p)).toBe(T.shockproofConcussion);
    expect(room.modifiers.mul('frostMultiplier', p)).toBe(T.shockproofFrost);
    expect([T.shockproofShake, T.shockproofFlinch, T.shockproofKnockback, T.shockproofConcussion, T.shockproofFrost]).toEqual([0, 0, 0, 0.5, 0.5]);
  });

  it('keeps fire immunity and the base x0.65', () => {
    const room = setup();
    const a = pro(bot(room, 0, ['flak_jacket']));
    const hit = (means: string) => {
      a.health = 100;
      return room.damage({ victim: a, attacker: null, amount: 40, weapon: 'napalm', part: null, means, from: null, distance: 0 });
    };
    expect(hit('fire')).toBe(0);
    expect(hit('explosive')).toBeCloseTo(40 * T.flakExplosive);
  });

  it('a Thundergun blast hurts a Pro victim without launching them', () => {
    const room = setup();
    still(room);
    const a = bot(room, 0);
    const plain = bot(room, 1);
    const shock = pro(bot(room, 1, ['flak_jacket']));
    for (const p of [a, plain, shock]) p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: self.pitch, weaponSlot: self.slot }) };
    place(a, -12, 20);
    place(plain, -1.5, 19.6);
    place(shock, -1.5, 20.4);
    arm(a, 'thundergun');
    room.fire(a, { dir: { x: 1, y: 0, z: 0 }, origin: eye(a) });
    expect(plain.move.knock ?? 0).toBeGreaterThan(0.5);
    expect(plain.move.vx).toBeGreaterThan(8);
    expect(shock.alive).toBe(true);
    expect(shock.health).toBeLessThan(100);
    expect(shock.move.knock ?? 0).toBe(0);
    expect(Math.hypot(shock.move.vx, shock.move.vy, shock.move.vz)).toBe(0);
    expect(shock.move.onGround).toBe(true);
  });

  it("Winter's Howl frost builds at half the rate", () => {
    const room = setup();
    still(room);
    const a = bot(room, 0);
    const plain = bot(room, 1);
    const shock = pro(bot(room, 1, ['flak_jacket']));
    place(a, -10, 20);
    place(plain, 0, 19.7);
    place(shock, 0, 20.3);
    arm(a, 'wintershowl');
    room.fire(a, { dir: { x: 1, y: 0, z: 0 }, origin: eye(a) });
    expect(frostOf(plain)).toBeGreaterThan(0.2);
    expect(frostOf(shock)).toBeCloseTo(frostOf(plain) * T.shockproofFrost, 5);
  });

  it('a concussion grenade hits a Pro victim at half strength', () => {
    const room = setup();
    const thrower = bot(room, 0);
    const plain = bot(room, 1);
    const shock = pro(bot(room, 1, ['flak_jacket']));
    place(thrower, -20, 0);
    place(plain, 0, -0.5);
    place(shock, 0, 0.5);
    for (const p of [plain, shock]) p.yaw = Math.PI / 2; // facing -x, toward the blast
    explode(room, { x: -3, y: 1.2, z: 0 }, EQUIPMENT_BY_ID.get('concussion')!, thrower.id);
    expect(stunnedAmount(room, plain)).toBeGreaterThan(0.2);
    expect(stunnedAmount(room, shock)).toBeCloseTo(stunnedAmount(room, plain) * T.shockproofConcussion, 5);
  });

  it('explosive damage makes a Pro bot flinch not at all; bullets still do', () => {
    const room = setup([weapons, bots]);
    const shock = pro(bot(room, 1, ['flak_jacket']));
    const plain = bot(room, 1);
    const kicks = new Map<string, number[]>();
    for (const p of [shock, plain]) {
      const brain = p.brain as unknown as { onHurt: (by: PlayerState | null, now: number, deg?: number) => void };
      const orig = brain.onHurt.bind(brain);
      brain.onHurt = (by, now, deg = 0) => {
        kicks.set(p.id, [...(kicks.get(p.id) ?? []), deg]);
        orig(by, now, deg);
      };
    }
    const hit = (v: PlayerState, means: string) => {
      v.health = 100;
      room.damage({ victim: v, attacker: null, amount: 10, weapon: means === 'explosive' ? 'frag' : 'ak47', part: 'torso', means, from: null, distance: 3 });
    };
    hit(shock, 'explosive');
    hit(plain, 'explosive');
    hit(shock, 'bullet');
    expect(kicks.get(shock.id)![0]).toBe(0);
    expect(kicks.get(plain.id)![0]).toBeGreaterThan(0);
    expect(kicks.get(shock.id)![1]).toBeGreaterThan(0);
  });
});
