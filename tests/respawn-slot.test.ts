/**
 * Every respawn starts on the primary (CoD), whatever was in hand at death: after dying on the
 * secondary, after a weapon pickup put a gun in the secondary slot, and after a class change. The
 * client's slot rule (`frameSlot` in client/game/slots.ts, what Match sends each frame) runs
 * against a Room through a link with latency both ways: snapshots and `spawned` reach the client
 * late, and its commands reach the server late, so commands made before the client saw the spawn
 * arrive after it. The old rule (follow the dead body's slot) is run too, to show the test catches
 * the bug it fixed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import pickupsFeature from '../src/server/features/pickups/index';
import { spawnDrop, swapFor } from '../src/server/features/pickups/drops';
import weaponsFeature from '../src/server/features/weapons/index';
import { Lobby } from '../src/server/lobby';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import type { InputCmd } from '../src/shared/input';
import { cloneLoadout, DEFAULT_LOADOUTS, type Loadout } from '../src/shared/loadout';
import { createMoveState } from '../src/shared/movement';
import { frameSlot, SPAWN_SLOT } from '../src/client/game/slots';

let lobby: Lobby | undefined;
let store: Store | undefined;
afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = store = undefined;
});

const klass = (primary: string): Loadout => ({ ...cloneLoadout(DEFAULT_LOADOUTS[0]!), primary: { weapon: primary, attachments: [], camo: 'none' } });

type Rule = 'frameSlot' | 'legacy';

/**
 * A human `h` whose client runs `rule` over a link of `lag` ticks each way. `want` is the slot the
 * player is asking for (a key press); the client's own slot follows the rule.
 */
function linked(rule: Rule, lag = 6) {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [weaponsFeature, pickupsFeature], log: () => {}, autoTick: false });
  const room: Room = lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
  const h: PlayerState = room.addBot({ name: 'H', team: 0, loadout: klass('ak47') });
  h.isBot = false;
  h.brain = null;
  for (let i = 0; i < 4; i++) room.step();
  if (!h.alive) room.spawn(h);
  h.move = { ...createMoveState(-1, 0, 8), onGround: true };
  // What the server says, as the client will see it `lag` ticks later.
  const down: { alive: boolean; slot: number; spawned: boolean }[] = [];
  const up: InputCmd[][] = [];
  let spawnedFlag = false;
  room.bus.on('spawn', ({ player }) => {
    if (player === h) spawnedFlag = true;
  });
  const switches: { t: number; slot: number }[] = [];
  room.bus.on('weaponSwitch', ({ player, slot }) => {
    if (player === h) switches.push({ t: room.time, slot });
  });
  let seq = h.lastSeq;
  let cur = 0;
  let want = 0;
  let view = { alive: true, slot: 0 };
  const tick = () => {
    // Downlink: the client sees the server state from `lag` ticks ago (`spawned` included).
    down.push({ alive: h.alive, slot: h.slot, spawned: spawnedFlag });
    spawnedFlag = false;
    if (down.length > lag) {
      const d = down.shift()!;
      if (d.spawned) cur = SPAWN_SLOT; // Match's 'spawned' handler
      view = { alive: d.alive, slot: d.slot };
    }
    // The client's frame.
    if (rule === 'frameSlot') cur = frameSlot({ slot: cur, want, alive: view.alive, playing: true, weapons: 2 }).slot;
    else if (!view.alive) cur = view.slot;
    else if (want !== cur) cur = want;
    want = cur;
    up.push([{ seq: ++seq, dt: TICK_DT, buttons: 0, yaw: 0, pitch: 0, weaponSlot: cur }]);
    // Uplink: the server gets the command `lag` ticks later.
    if (up.length > lag) room.queueInputs(h, up.shift()!);
    room.step();
  };
  const run = (sec: number) => {
    for (let i = 0; i < Math.round(sec / TICK_DT); i++) tick();
  };
  return {
    room,
    h,
    switches,
    run,
    press: (slot: number) => (want = slot),
    die() {
      room.kill(h, null, { weapon: 'world', means: 'world' });
    },
    /** Step until the respawn, then on for `after` seconds; returns the spawn time. */
    respawn(after = 1.5): number {
      for (let i = 0; i < 600 && !h.alive; i++) tick();
      expect(h.alive).toBe(true);
      const at = room.time;
      run(after);
      return at;
    },
  };
}

describe('respawn on the primary', () => {
  it('after dying on the secondary', () => {
    const r = linked('frameSlot');
    r.press(1);
    r.run(1);
    expect(r.h.slot).toBe(1);
    r.die();
    const at = r.respawn();
    expect(r.h.slot).toBe(0);
    expect(r.h.weapons[0]!.def.base.id).toBe('ak47');
    expect(r.switches.filter((s) => s.t >= at)).toEqual([]);
  });

  it('the old rule (follow the dead body) switched straight back to the secondary', () => {
    const r = linked('legacy');
    r.press(1);
    r.run(1);
    r.die();
    const at = r.respawn();
    expect(r.switches.some((s) => s.t >= at && s.slot === 1)).toBe(true);
    expect(r.h.slot).toBe(1);
  });

  it('after a weapon pickup put a gun in the secondary slot', () => {
    const r = linked('frameSlot');
    r.press(1);
    r.run(1);
    const famas = makeWeapon({ weapon: 'famas', attachments: [], camo: 'none' }, 'famas');
    const drop = spawnDrop(r.room, famas, { x: r.h.move.x, y: 0, z: r.h.move.z }, { x: 0, y: 0, z: 0 }, null, null, 'death')!;
    swapFor(r.room, r.h, drop, 1);
    expect(r.h.weapons.map((w) => w.def.base.id)).toEqual(['ak47', 'famas']);
    expect(r.h.slot).toBe(1);
    r.run(0.3);
    r.die();
    const at = r.respawn();
    expect(r.h.slot).toBe(0);
    expect(r.h.weapons.map((w) => w.def.base.id)).toEqual(['ak47', 'm1911']); // back to the class
    expect(r.switches.filter((s) => s.t >= at)).toEqual([]);
  });

  it('after a class change while dead (the new class primary in hand)', () => {
    const r = linked('frameSlot');
    r.press(1);
    r.run(1);
    r.die();
    r.h.nextLoadout = klass('mp5k');
    const at = r.respawn();
    expect(r.h.weapons[0]!.def.base.id).toBe('mp5k');
    expect(r.h.slot).toBe(0);
    expect(r.switches.filter((s) => s.t >= at)).toEqual([]);
  });

  it('the client rule: the primary while dead, keys only while alive', () => {
    expect(frameSlot({ slot: 1, want: 1, alive: false, playing: true, weapons: 2 })).toEqual({ slot: SPAWN_SLOT, switched: false });
    expect(frameSlot({ slot: 0, want: 1, alive: true, playing: true, weapons: 2 })).toEqual({ slot: 1, switched: true });
    expect(frameSlot({ slot: 0, want: 2, alive: true, playing: true, weapons: 2 })).toEqual({ slot: 0, switched: false });
    expect(frameSlot({ slot: 0, want: 2, alive: true, playing: true, weapons: 3 })).toEqual({ slot: 2, switched: true });
    expect(frameSlot({ slot: 0, want: 1, alive: true, playing: false, weapons: 2 })).toEqual({ slot: 0, switched: false });
  });
});
