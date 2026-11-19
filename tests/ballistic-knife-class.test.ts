/**
 * The Ballistic Knife as a Create-a-Class secondary (it was wager-only): offered in the class
 * editor's list, the unlock table (level 20) and the store, while the crossbow stays wager-only;
 * a level-20 player who bought it spawns with it in a normal TDM match and its blade kills there.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { registerWeaponBehavior } from '../src/server/combat';
import economy from '../src/server/features/economy/index';
import weapons from '../src/server/features/weapons/index';
import type { Feature, ServerApi } from '../src/server/feature';
import { Lobby } from '../src/server/lobby';
import { registerMode } from '../src/server/modes/index';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { RpcRegistry } from '../src/server/rpc';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { PLAYER, TICK_DT } from '../src/shared/constants';
import { BLADE_ENTITY } from '../src/shared/defs/economy';
import { keyOf, purchase, storeItem } from '../src/shared/defs/store';
import { unlockTable } from '../src/shared/defs/unlocks';
import { ECONOMY_WEAPONS, WAGER_ONLY_WEAPONS } from '../src/shared/defs/wager-weapons';
import { WEAPON_BY_ID } from '../src/shared/defs/weapons';
import { cloneLoadout, DEFAULT_LOADOUTS } from '../src/shared/loadout';
import { createMoveState } from '../src/shared/movement';

const worlds: { lobby: Lobby; store: Store }[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) {
    w.lobby.shutdown();
    w.store.close();
  }
});

function world(features: Feature[] = [weapons, economy]) {
  const store = new Store(':memory:');
  const lobby = new Lobby({ store, features, log: () => {}, autoTick: false });
  const api: ServerApi = { lobby, store, rpc: new RpcRegistry(), registerMode, registerWeaponBehavior, sessions: () => [].values(), log: () => {} };
  for (const f of features) f.setup?.(api);
  worlds.push({ lobby, store });
  const human = (name: string, level: number) => {
    const prof = store.authenticate(null, name).profile;
    prof.name = name;
    prof.level = level;
    const ws = { readyState: 1, bufferedAmount: 0, send() {}, close() {} } as unknown as WebSocket;
    return new Session(`h-${name}`, ws, prof, `token-${name}`);
  };
  return { lobby, human };
}

const steps = (room: Room, s: number) => {
  for (let i = 0; i < Math.round(s / TICK_DT); i++) room.step();
};
const place = (p: PlayerState, x: number, z: number) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
};

describe('Ballistic Knife in Create-a-Class', () => {
  it('is a classable secondary unlocked at level 20 and sold; the crossbow stays wager-only', () => {
    expect(ECONOMY_WEAPONS.has('ballistic_knife')).toBe(true);
    expect(WAGER_ONLY_WEAPONS.has('ballistic_knife')).toBe(false);
    expect(WAGER_ONLY_WEAPONS.has('crossbow')).toBe(true);
    expect(WEAPON_BY_ID.get('ballistic_knife')).toMatchObject({ slot: 'secondary', unlockLevel: 20 });
    const row = unlockTable().find((u) => u.id === 'ballistic_knife');
    expect(row).toMatchObject({ level: 20, kind: 'weapon' });
    expect(unlockTable().find((u) => u.id === 'crossbow')).toBeUndefined();
    expect(storeItem(keyOf.weapon('ballistic_knife'))).toBeTruthy();
    expect(storeItem(keyOf.weapon('crossbow'))).toBeUndefined();
  });

  it('a level-20 player who bought it spawns with it in TDM and a blade kills in one hit', () => {
    const w = world();
    const s = w.human('Knifer', 20);
    s.profile.codPoints = 5000;
    expect(purchase(s.profile, keyOf.weapon('ballistic_knife'))).toMatchObject({ ok: true, codPoints: 1000 });
    s.profile.loadouts[0] = { ...cloneLoadout(DEFAULT_LOADOUTS[0]!), secondary: { weapon: 'ballistic_knife', attachments: [], camo: 'none' } };
    const room = w.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
    w.lobby.join(s, room.id);
    const a = room.players.get(s.id)!;
    const b = room.addBot({ name: 'Target' });
    b.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: self.slot }) };
    steps(room, 0.7);
    if (!a.alive) steps(room, 6);
    expect(a.weapons.map((x) => x.def.base.id)).toContain('ballistic_knife');
    a.slot = 1;
    steps(room, 0.6);
    place(a, -1, 8);
    place(b, -1, 0);
    if (!b.alive) steps(room, 6);
    place(b, -1, 0);
    const d = { x: b.move.x - a.move.x, y: b.move.y + 1.6 - (a.move.y + PLAYER.eye), z: b.move.z - a.move.z };
    const l = Math.hypot(d.x, d.y, d.z);
    expect(room.fire(a, { dir: { x: d.x / l, y: d.y / l, z: d.z / l } }).ok).toBe(true);
    expect(room.entities.byKind(BLADE_ENTITY)).toHaveLength(1);
    steps(room, 0.6);
    expect(b.alive).toBe(false);
    expect(a.stats.kills).toBe(1);
  });

  it("below level 20 it can't be bought, and the class falls back to an unlocked secondary", () => {
    const w = world();
    const s = w.human('Rookie', 5);
    s.profile.codPoints = 5000;
    expect(purchase(s.profile, keyOf.weapon('ballistic_knife')).ok).toBe(false);
    s.profile.loadouts[0] = { ...cloneLoadout(DEFAULT_LOADOUTS[0]!), secondary: { weapon: 'ballistic_knife', attachments: [], camo: 'none' } };
    const room = w.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
    w.lobby.join(s, room.id);
    steps(room, 0.7);
    expect(room.players.get(s.id)!.weapons.map((x) => x.def.base.id)).not.toContain('ballistic_knife');
  });
});
