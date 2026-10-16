/**
 * Every modifier key a feature registers must be read somewhere, under the same name. A key added
 * under a name nobody reads compiles fine (both sides declare their own `ModifierMap` entry) and
 * silently does nothing: Warlord registered `attachmentSlots` while the weapons feature read
 * `attachmentSlotsOffset`, so nobody ever spawned with two attachments.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURES } from '../src/server/features/index';
import { registerPerkModifiers } from '../src/server/features/perks/index';
import { Lobby } from '../src/server/lobby';
import { Store } from '../src/server/store';

const ROOT = join(import.meta.dirname, '..');
const SERVER = join(ROOT, 'src/server');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Keys read anywhere in the server: `modifiers.mul('key', ...)`, `.sum(...)`, `.any(...)`. */
function readKeys(): Map<string, string[]> {
  const reads = new Map<string, string[]>();
  for (const f of tsFiles(SERVER)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\.(?:mul|sum|any)\(\s*'([A-Za-z]+)'/g)) {
      const at = reads.get(m[1]!) ?? [];
      at.push(relative(ROOT, f));
      reads.set(m[1]!, at);
    }
  }
  return reads;
}

/** Keys added in source with a literal: `m.add('key', ...)` / `room.modifiers.add(\n 'key', ...)`. */
function addedKeys(dir: string): Set<string> {
  const keys = new Set<string>();
  for (const f of tsFiles(dir)) for (const m of readFileSync(f, 'utf8').matchAll(/\b(?:m|modifiers)\.add\(\s*'([A-Za-z]+)'/g)) keys.add(m[1]!);
  return keys;
}

function roomWithEveryFeature() {
  const store = new Store(':memory:');
  const lobby = new Lobby({ store, features: FEATURES, log: () => {}, autoTick: false });
  const room = lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
  return { room, close: () => (lobby.shutdown(), store.close()) };
}

describe('modifier keys', () => {
  const reads = readKeys();
  const unread = (keys: Iterable<string>) => [...new Set(keys)].filter((k) => !reads.has(k)).sort();

  it('every key the perks feature adds (in source) is read by some feature', () => {
    const keys = addedKeys(join(SERVER, 'features/perks'));
    expect(keys.size).toBeGreaterThan(15);
    expect(unread(keys)).toEqual([]);
  });

  it('every key the perks feature registers on a room is read by some feature', () => {
    const { room, close } = roomWithEveryFeature();
    try {
      registerPerkModifiers(room); // idempotent (same ids): makes sure the list is complete
      const perks = room.modifiers.registered().filter((e) => e.id.startsWith('perks.'));
      expect(perks.map((e) => e.key)).toContain('attachmentSlotsOffset');
      expect(unread(perks.map((e) => e.key))).toEqual([]);
    } finally {
      close();
    }
  });

  it('every key any feature registers on a room is read by some feature', () => {
    const { room, close } = roomWithEveryFeature();
    try {
      const all = room.modifiers.registered();
      expect(unread(all.map((e) => e.key)).map((k) => `${k} (${all.filter((e) => e.key === k).map((e) => e.id).join(', ')})`)).toEqual([]);
    } finally {
      close();
    }
  });

  it('the Warlord keys are the ones the weapons feature reads', () => {
    expect(reads.get('attachmentSlotsOffset')).toContain('src/server/features/weapons/index.ts');
    expect(reads.get('equipmentCountOffset')).toContain('src/server/features/weapons/equipment.ts');
  });
});
