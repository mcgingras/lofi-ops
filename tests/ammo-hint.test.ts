/**
 * The HUD's ammo hint (src/client/hud/ammo-hint.ts): never "RELOAD" without reserve to load from,
 * "NO AMMO" when dry, single-load weapons (crossbow, ballistic knife) never nag, plus the server
 * refusing a reload with nothing in reserve (no reload event, so no animation or sound).
 */
import { describe, expect, it } from 'vitest';
import { ammoHint, ammoWarn, canReload } from '../src/client/hud/ammo-hint';
import { startReload } from '../src/server/combat';
import { Lobby } from '../src/server/lobby';
import { Store } from '../src/server/store';
import { WEAPON_BY_ID } from '../src/shared/defs/weapons';
import '../src/shared/defs/wager-weapons';

const h = (magazine: number, mag: number, reserve: number, reloading = false) => ammoHint({ magazine, mag, reserve, reloading });

describe('ammo hint', () => {
  it('prompts a reload only when there is reserve and room in the mag', () => {
    expect(h(30, 5, 90)).toBe('reload');
    expect(h(30, 0, 90)).toBe('reload');
    expect(h(30, 20, 90)).toBe(null);
    expect(h(30, 5, 0)).toBe('low');
    expect(h(30, 0, 0)).toBe('no-ammo');
    expect(h(30, 0, 0, true)).toBe('reloading');
  });

  it('single-load weapons: a loaded bolt is full, a spare is a reload, nothing left is NO AMMO', () => {
    expect(h(1, 1, 5)).toBe(null);
    expect(h(1, 1, 0)).toBe(null);
    expect(h(1, 0, 1)).toBe('reload');
    expect(h(1, 0, 0)).toBe('no-ammo');
    expect(h(2, 1, 0)).toBe(null); // Olympia with a shell left and none spare
    expect(ammoWarn({ magazine: 1, mag: 1, reserve: 0, reloading: false })).toBe(false);
    expect(ammoWarn({ magazine: 1, mag: 0, reserve: 0, reloading: false })).toBe(true);
    expect(canReload({ magazine: 1, mag: 0, reserve: 0 })).toBe(false);
  });

  it('the server ignores a reload with nothing in reserve (no reload event)', () => {
    const store = new Store(':memory:');
    const lobby = new Lobby({ store, features: [], log: () => {}, autoTick: false });
    const room = lobby.createRoom({ mode: 'ffa', map: 'yard', closeWhenEmpty: false });
    const p = room.addBot({ name: 'A' });
    p.brain = { think: () => null };
    for (let i = 0; i < 120; i++) room.step();
    expect(room.phase).toBe('playing');
    const events: string[] = [];
    room.bus.on('reload', (e) => events.push(e.weapon));
    const w = p.weapons[p.slot]!;
    w.mag = 3;
    w.reserve = 0;
    expect(startReload(room, p)).toBe(false);
    expect(p.reloadEnd).toBe(0);
    expect(events).toEqual([]);
    w.reserve = 10;
    expect(startReload(room, p)).toBe(true);
    expect(events.length).toBe(1);
    expect(WEAPON_BY_ID.get('crossbow')?.ammoNoun).toBe('BOLTS');
    lobby.shutdown();
    store.close();
  });
});
