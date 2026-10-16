/**
 * Infected: the first-person viewmodel follows the class the mode forces. A real Room with the
 * Infected rules sends snapshots to a human (captured off a stand-in socket); the client's own
 * pick of what to show (`heldWeapon`, the function Match feeds the viewmodel) gets the SPAS-12 and
 * the M1911 as a Survivor, the RPK as the last one standing, the knife once infected (even when
 * the client still asks for the pistol slot), and the guns back as the First Infected.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { heldWeapon } from '../src/client/game/slots';
import modesFeature, { registerModeRules } from '../src/server/features/modes/index';
import { controllerOf } from '../src/server/features/modes/common';
import type { InfectedRules } from '../src/server/features/modes/infected';
import perksFeature from '../src/server/features/perks/index';
import progressionFeature from '../src/server/features/progression/index';
import weaponsFeature from '../src/server/features/weapons/index';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { RESPAWN_DELAY, TICK_DT } from '../src/shared/constants';
import { WEAPON_BY_ID } from '../src/shared/defs/weapons';
import { newProfile } from '../src/shared/profile';
import type { MeSnap, ServerMsg } from '../src/shared/protocol';

let store: Store | undefined;
let lobby: Lobby | undefined;
beforeAll(() => registerModeRules());
afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = store = undefined;
});

const steps = (room: Room, s: number) => {
  for (let i = 0; i < Math.round(s / TICK_DT); i++) room.step();
};
const idle = (p: PlayerState) => {
  p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: self.slot }) };
  return p;
};

/** A human whose socket keeps every message the server sends. */
function human(room: Room): { p: PlayerState; me: () => MeSnap } {
  const msgs: ServerMsg[] = [];
  const ws = { readyState: 1, bufferedAmount: 0, send: (d: string) => msgs.push(JSON.parse(d) as ServerMsg), close() {} };
  const s = new Session('s-viewer', ws as never, newProfile('p-viewer', 'Viewer'), 'tok');
  const p = room.addHuman(s);
  return {
    p,
    me: () => {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]!;
        if (m.t === 'snap' && m.me) return m.me;
      }
      throw new Error('no snapshot yet');
    },
  };
}
const model = (id: string) => WEAPON_BY_ID.get(id)?.model;
/** What the viewmodel shows when the client asks for `slot`. */
const shown = (me: MeSnap, slot: number) => heldWeapon(me.weapons, slot, model)?.model;

describe('Infected viewmodel follows the forced class', () => {
  it('Survivor guns, then the knife once infected', () => {
    store = new Store(':memory:');
    lobby = new Lobby({ store, features: [weaponsFeature, perksFeature, progressionFeature, modesFeature], log: () => {}, autoTick: false });
    const room = lobby.createRoom({ mode: 'infected', map: 'yard', closeWhenEmpty: false });
    const rules = controllerOf(room) as unknown as InfectedRules;
    const { p: h, me } = human(room);
    const bots = Array.from({ length: 3 }, (_, i) => idle(room.addBot({ name: `B${i}` })));
    room.modifiers.add('damageTaken', (v) => (v === h ? 0 : undefined), 'test.god');
    room.startMatch();
    steps(room, 0.5);

    // Survivor: SPAS-12 in slot 0, the M1911 in slot 1 (whatever class the profile has).
    expect(me().weapons.map((w) => w.id)).toEqual(['spas12', 'm1911']);
    expect(shown(me(), 0)).toBe('spas12');
    expect(shown(me(), 1)).toBe('m1911');

    // Infected: the knife alone, even if the client still asks for its old pistol slot.
    rules.makeFirst(bots[0]!);
    steps(room, 0.2);
    room.modifiers.add('damageTaken', () => undefined, 'test.god');
    room.kill(h, bots[0]!, { weapon: 'knife', means: 'melee', part: 'torso' });
    steps(room, RESPAWN_DELAY + 0.5);
    expect(h.alive).toBe(true);
    expect(rules.roleOf(h)).toBe('infected');
    expect(me().weapons.map((w) => w.id)).toEqual(['knife']);
    expect(shown(me(), 0)).toBe('knife');
    expect(shown(me(), 1)).toBe('knife');
    expect(heldWeapon(me().weapons, 1, model)!.slot).toBe(0);
  });

  it('the last one standing sees the RPK in place of the pistol', () => {
    store = new Store(':memory:');
    lobby = new Lobby({ store, features: [weaponsFeature, perksFeature, progressionFeature, modesFeature], log: () => {}, autoTick: false });
    const room = lobby.createRoom({ mode: 'infected', map: 'yard', closeWhenEmpty: false });
    const rules = controllerOf(room) as unknown as InfectedRules;
    const { p: h, me } = human(room);
    const bots = Array.from({ length: 3 }, (_, i) => idle(room.addBot({ name: `B${i}` })));
    room.startMatch();
    steps(room, 0.5);
    const first = bots[0]!;
    rules.makeFirst(first);
    for (const b of bots) if (rules.roleOf(b) === 'survivor') room.kill(b, first, { weapon: 'knife', means: 'melee', part: 'torso' });
    steps(room, 0.2);
    expect(rules.lastId).toBe(h.id);
    expect(shown(me(), 0)).toBe('spas12');
    expect(shown(me(), 1)).toBe('rpk');
    expect(me().weapons[1]!.attachments).toContain('extmag');
  });

  it('the First Infected keeps the Survivor guns until the next infection, then the knife', () => {
    store = new Store(':memory:');
    lobby = new Lobby({ store, features: [weaponsFeature, perksFeature, progressionFeature, modesFeature], log: () => {}, autoTick: false });
    const room = lobby.createRoom({ mode: 'infected', map: 'yard', closeWhenEmpty: false });
    const rules = controllerOf(room) as unknown as InfectedRules;
    const { p: h, me } = human(room);
    const bots = Array.from({ length: 3 }, (_, i) => idle(room.addBot({ name: `B${i}` })));
    room.startMatch();
    steps(room, 0.5);
    rules.makeFirst(h);
    steps(room, 0.2);
    expect(shown(me(), 0)).toBe('spas12');
    expect(shown(me(), 1)).toBe('m1911');
    room.kill(bots[0]!, h, { weapon: 'spas12', means: 'bullet', part: 'torso' });
    steps(room, 0.2);
    expect(shown(me(), 0)).toBe('knife');
  });

  it('heldWeapon: nothing held, a slot past the end, an unknown model', () => {
    expect(heldWeapon([], 0, model)).toBeNull();
    expect(heldWeapon(undefined, 0, model)).toBeNull();
    const ws = [{ id: 'spas12', attachments: [], camo: 'none' }];
    expect(heldWeapon(ws, 5, model)).toMatchObject({ slot: 0, model: 'spas12' });
    expect(heldWeapon([{ id: 'mystery', attachments: [], camo: 'none' }], 0, model)!.model).toBe('mystery');
  });
});
