/**
 * Second Chance weapons, BO1 (`maps/mp/_laststand.gsc`): going down remembers the weapon in hand
 * (`previousPrimary = GetCurrentWeapon()`) and pulls the pistol; a revive gives the weapons back
 * and switches to the remembered one (`takePlayerOutOfLastStand`). Both switches are forced by the
 * server and survive the client's commands that were already on their way (`slotLock`), and the
 * revive push names the slot so the client follows.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { perksOf } from '../src/server/features/perks/common';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { PERK_TUNING as T } from '../src/shared/defs/perks';
import { Buttons } from '../src/shared/input';
import { bot, input, place, rig, steps, type Rig } from './perks-streaks.helpers';

let r: Rig | undefined;
afterEach(() => {
  r?.close();
  r = undefined;
});

function scene(opts: { human?: boolean } = {}) {
  r = rig();
  const room = r.room;
  const a = bot(room, 0);
  const v = bot(room, 1, ['second_chance']);
  const mate = bot(room, 1);
  perksOf(v).allPro = true; // Pro: teammates can revive
  place(a, -1, 10);
  place(v, -1, 0);
  place(mate, -1, 1);
  if (opts.human) {
    v.isBot = false;
    v.brain = null;
  }
  const pushes: { until: number | null; revive: number; slot?: number }[] = [];
  const send = room.sendFeature.bind(room);
  room.sendFeature = ((p, id, data) => {
    if (p === v && id === 'perks.lastStand') pushes.push(data as (typeof pushes)[number]);
    return send(p, id, data);
  }) as Room['sendFeature'];
  steps(room, 0.3);
  const down = () => room.damage({ victim: v, attacker: a, amount: 150, weapon: 'ak47', part: 'torso', means: 'bullet', from: null, distance: 10 });
  const revive = () => {
    mate.brain = { think: () => ({ buttons: Buttons.USE, yaw: 0, pitch: 0, weaponSlot: 0 }) };
  };
  return { room, a, v, mate, pushes, down, revive };
}

/** Feed `p` one command per tick asking for `slot` (a human client's stream). */
function feed(room: Room, p: PlayerState, slot: number, sec: number) {
  for (let i = 0; i < Math.round(sec * 60); i++) {
    input(room, p, 0, p.yaw, p.pitch, slot);
    room.step();
  }
}

describe('Second Chance revive weapon (BO1)', () => {
  it('down on the primary: the pistol comes out, and the revive gives the primary back', () => {
    const { room, v, pushes, down, revive } = scene();
    expect(v.slot).toBe(0);
    down();
    expect(perksOf(v).lastStand).not.toBeNull();
    expect(v.slot).toBe(1);
    revive();
    steps(room, T.reviveSec + 0.2);
    expect(perksOf(v).lastStand).toBeNull();
    expect(v.alive).toBe(true);
    expect(v.slot).toBe(0);
    expect(v.swapEnd).toBeGreaterThan(room.time - 0.2); // raised again
    expect(pushes[pushes.length - 1]).toEqual({ until: null, revive: 0, slot: 0 });
  });

  it('down while already on the secondary: revived still on it', () => {
    const { room, v, pushes, down, revive } = scene();
    v.slot = 1;
    down();
    expect(v.slot).toBe(1);
    revive();
    steps(room, T.reviveSec + 0.2);
    expect(perksOf(v).lastStand).toBeNull();
    expect(v.slot).toBe(1);
    expect(pushes[pushes.length - 1]).toMatchObject({ until: null, slot: 1 });
  });

  it('bleeding out (no revive) sends no slot: the next life starts on the primary', () => {
    const { room, v, pushes, down } = scene();
    down();
    steps(room, T.lastStandProSec + 0.2);
    expect(v.alive).toBe(false);
    expect(pushes[pushes.length - 1]).toEqual({ until: null, revive: 0 });
  });

  it("a human's commands already on the way don't undo either forced switch", () => {
    const { room, v, down, revive } = scene({ human: true });
    feed(room, v, 0, 0.3);
    down();
    expect(v.slot).toBe(1);
    // The client hasn't heard yet: its next commands still ask for the primary.
    feed(room, v, 0, 0.25);
    expect(v.slot).toBe(1);
    // It catches up (perks client: pistol in last stand).
    feed(room, v, 1, 0.2);
    expect(v.slot).toBe(1);
    expect(v.slotLock).toBeNull();
    revive();
    for (let i = 0; i < 300 && perksOf(v).lastStand; i++) {
      input(room, v, 0, v.yaw, v.pitch, 1);
      room.step();
    }
    expect(perksOf(v).lastStand).toBeNull();
    expect(v.slot).toBe(0);
    // Still asking for the pistol for a round trip: ignored; then the client follows the push.
    feed(room, v, 1, 0.25);
    expect(v.slot).toBe(0);
    feed(room, v, 0, 0.2);
    expect(v.slot).toBe(0);
    expect(v.slotLock).toBeNull();
  });
});
