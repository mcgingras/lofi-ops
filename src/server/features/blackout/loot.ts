/**
 * Blackout loot: spots on the map's floors (indoors first, some outside), what lies on them at the
 * match start (`rollLoot`: weapons as `pickups_weapon` drops that never expire, everything else as
 * `blackout_loot` items), walking over items to take them, and what a dead player leaves behind.
 * Bounded: one item per spot, `BLACKOUT.maxLoot` entities at most (dropped loot past it pushes out
 * the oldest drops).
 */
import { AMMO_BOX, AMMO_OF_CLASS, BLACKOUT, LOOT_ENTITY, lootName, rollLoot, type LootItem } from '../../../shared/defs/blackout';
import { PICKUP, PICKUP_ENTITY } from '../../../shared/defs/pickups';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { CollisionWorld, topAt, type Solid } from '../../../shared/collision';
import { PLAYER } from '../../../shared/constants';
import { BLACKOUT_TOWNS, townRect, BLACKOUT_HALF, townAt } from '../../../shared/maps/blackout';
import type { MapData } from '../../../shared/maps/types';
import { rng, type Vec3 } from '../../../shared/math';
import type { Entity } from '../../entities';
import { makeWeapon, type PlayerState } from '../../player';
import type { Room } from '../../room';
import { dropsOf, spawnDrop, type DropEntity } from '../pickups/index';
import { sendEquip } from '../weapons/equipment';
import { wext } from '../weapons/state';
import { bx } from './state';

export interface LootSpot extends Vec3 {
  /** Under a roof. */
  indoor: boolean;
  /** Town index, -1 on open ground. */
  town: number;
}

const spotCache = new WeakMap<MapData, LootSpot[]>();

/** Walkable surface heights in a column at (x, z) with standing room (lowest first). */
function surfaces(w: CollisionWorld, x: number, z: number, near: Solid[]): number[] {
  const r = PLAYER.radius;
  const tops: number[] = [];
  for (const s of w.near(x - r, x + r, z - r, z + r, near)) {
    if (x + r <= s.min.x || x - r >= s.max.x || z + r <= s.min.z || z - r >= s.max.z) continue;
    if (s.clip) continue;
    tops.push(topAt(s, x - r, x + r, z - r, z + r));
  }
  tops.sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of tops) {
    if (out.length && t - out[out.length - 1]! < 0.3) continue;
    const g = w.groundBelow(x, z, t + 1e-3, 0.02);
    if (g === null || Math.abs(g - t) > 0.03) continue;
    if (!w.free(x, t + 0.01, z)) continue;
    out.push(t);
  }
  return out;
}

/**
 * Loot spots of a map (cached per MapData). Towns: a 3 m grid over each town's rectangle, every
 * floor with standing room, indoor ones (a roof within 7 m) preferred; at most one spot per 75 m²
 * of town, spaced 2.5 m apart. Open ground: a sparse scatter. Deterministic.
 */
export function lootSpots(map: MapData, world: CollisionWorld): LootSpot[] {
  const cached = spotCache.get(map);
  if (cached) return cached;
  const r = rng(0x10071);
  const out: LootSpot[] = [];
  const near: Solid[] = [];
  const up = { x: 0, y: 1, z: 0 };
  BLACKOUT_TOWNS.forEach((t, ti) => {
    const rect = townRect(t);
    const cand: LootSpot[] = [];
    for (let x = rect.x0 + 1.5; x < rect.x1 - 1; x += 3)
      for (let z = rect.z0 + 1.5; z < rect.z1 - 1; z += 3) {
        const jx = x + (r() - 0.5) * 1.2;
        const jz = z + (r() - 0.5) * 1.2;
        for (const y of surfaces(world, jx, jz, near)) {
          if (y < -3 || y > 30) continue;
          const roof = world.raycast({ x: jx, y: y + PLAYER.height + 0.05, z: jz }, up, 7, 'bullets');
          cand.push({ x: jx, y, z: jz, indoor: !!roof, town: ti });
        }
      }
    const area = (rect.x1 - rect.x0) * (rect.z1 - rect.z0);
    const want = Math.round(area / 75);
    // Indoor spots first (shuffled), then outdoor ones to fill up.
    const shuffle = (a: LootSpot[]) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    };
    const ordered = [...shuffle(cand.filter((c) => c.indoor)), ...shuffle(cand.filter((c) => !c.indoor))];
    const picked: LootSpot[] = [];
    for (const c of ordered) {
      if (picked.length >= want) break;
      if (picked.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 2.5 && Math.abs(p.y - c.y) < 2)) continue;
      picked.push(c);
    }
    out.push(...picked);
  });
  // Open ground: a few things lying around between towns.
  for (let i = 0, n = 0; i < 600 && n < 90; i++) {
    const x = (r() * 2 - 1) * (BLACKOUT_HALF - 20);
    const z = (r() * 2 - 1) * (BLACKOUT_HALF - 20);
    if (townAt(x, z, 6)) continue;
    const s = surfaces(world, x, z, near);
    const y = s[s.length - 1];
    if (y === undefined || y > 8) continue;
    out.push({ x, y, z, indoor: false, town: -1 });
    n++;
  }
  spotCache.set(map, out);
  return out;
}

/** Loot items (not weapons) in a room. */
export const lootItems = (room: Room): Entity[] => room.entities.byKind(LOOT_ENTITY);

export function addItem(room: Room, item: LootItem, at: Vec3): Entity {
  return room.entities.add({ kind: LOOT_ENTITY, x: at.x, y: at.y + 0.05, z: at.z, yaw: Math.random() * Math.PI * 2, s: { ...item }, data: { item } });
}

/** A loot weapon lying flat at `at` (a `pickups_weapon` drop that never expires). */
export function addWeapon(room: Room, weapon: string, attachments: string[], at: Vec3, reserveMags = 1): DropEntity | null {
  const w = makeWeapon({ weapon, attachments, camo: 'none' }, weapon);
  w.reserve = Math.min(w.def.reserve, w.def.magazine * reserveMags);
  const e = spawnDrop(room, w, at, { x: 0, y: 0, z: 0 }, null, null, 'death');
  if (!e) return null;
  e.y = at.y + PICKUP.restHeight;
  e.data.landed = true;
  e.data.vx = e.data.vy = e.data.vz = 0;
  e.s = { ...e.s, l: true };
  return e;
}

/** Fill the map's spots for a new match (seeded). Returns how many entities were added. */
export function spawnLoot(room: Room, seed: number): number {
  const spots = lootSpots(room.map, room.world);
  const r = rng(seed ^ 0x1007);
  let n = 0;
  for (const s of spots) {
    if (r() > BLACKOUT.lootChance) continue;
    if (n >= BLACKOUT.maxLoot) break;
    const roll = rollLoot(r);
    if ('weapon' in roll) {
      if (addWeapon(room, roll.weapon, roll.attachments, s)) n++;
    } else {
      addItem(room, roll.item, s);
      n++;
    }
  }
  return n;
}

/** Can `p` use this item now? (Ammo for a gun they carry, a better vest, room in the bag.) */
export function wants(p: PlayerState, it: LootItem): boolean {
  const st = bx(p);
  switch (it.k) {
    case 'ammo':
      return p.weapons.some((w) => AMMO_OF_CLASS[w.def.class] === it.t && w.reserve < w.def.reserve * 2);
    case 'armor':
      return it.l * BLACKOUT.armor.perLevel > st.armorMax || (it.l * BLACKOUT.armor.perLevel === st.armorMax && st.armor < st.armorMax);
    case 'bandage':
      return st.bandages < BLACKOUT.heals.bandage.max;
    case 'medkit':
      return st.medkits < BLACKOUT.heals.medkit.max;
    case 'frag':
      return (wext(p).lethal === null || wext(p).lethal === 'frag') && wext(p).lethalN < BLACKOUT.maxFrags;
  }
}

/** Take an item (assumes `wants`). */
export function take(room: Room, p: PlayerState, e: Entity, it: LootItem): void {
  const st = bx(p);
  switch (it.k) {
    case 'ammo': {
      for (const w of p.weapons) if (AMMO_OF_CLASS[w.def.class] === it.t) w.reserve = Math.min(w.def.reserve * 2, w.reserve + Math.max(AMMO_BOX[it.t], w.def.magazine));
      break;
    }
    case 'armor':
      st.armorMax = it.l * BLACKOUT.armor.perLevel;
      st.armor = st.armorMax;
      break;
    case 'bandage':
      st.bandages++;
      break;
    case 'medkit':
      st.medkits++;
      break;
    case 'frag': {
      const x = wext(p);
      x.lethal = 'frag';
      x.lethalN = Math.min(BLACKOUT.maxFrags, x.lethalN + 1);
      if (p.loadout) p.loadout.lethal = 'frag';
      sendEquip(room, p);
      break;
    }
  }
  room.entities.remove(e.id);
  if (p.session) room.sendFeature(p, 'blackout.picked', { text: `+ ${lootName(it)}` });
}

/** Spatial buckets of loot items (positions don't move), rebuilt when the item set changes. */
export class LootGrid {
  private cells = new Map<number, Entity[]>();
  private size = -1;
  private version = -1;
  constructor(private readonly cell = 8) {}

  private key(x: number, z: number) {
    return (Math.floor(x / this.cell) + 1024) * 4096 + (Math.floor(z / this.cell) + 1024);
  }

  rebuild(room: Room, version: number): void {
    if (version === this.version) return;
    this.version = version;
    this.cells.clear();
    for (const e of room.entities.all()) {
      if (e.kind !== LOOT_ENTITY && e.kind !== PICKUP_ENTITY) continue;
      const k = this.key(e.x, e.z);
      const l = this.cells.get(k);
      if (l) l.push(e);
      else this.cells.set(k, [e]);
    }
    this.size = this.cells.size;
  }

  /** Items within `r` (horizontal) of a point. */
  near(x: number, z: number, r: number, out: Entity[] = []): Entity[] {
    out.length = 0;
    const c = this.cell;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        const l = this.cells.get((i + 1024) * 4096 + (j + 1024));
        if (!l) continue;
        for (const e of l) if (Math.hypot(e.x - x, e.z - z) <= r) out.push(e);
      }
    return out;
  }

  get buckets(): number {
    return this.size;
  }
}

/** Walk-over pickup radius for items (m) and the height window. */
export const ITEM_REACH = 1.3;
const ITEM_DY = 1.4;

/** Take every item `p` stands on and can use. Returns how many. */
export function walkOver(room: Room, p: PlayerState, grid: LootGrid): number {
  let n = 0;
  for (const e of grid.near(p.move.x, p.move.z, ITEM_REACH)) {
    if (e.kind !== LOOT_ENTITY || !room.entities.get(e.id) || Math.abs(e.y - p.move.y) > ITEM_DY) continue;
    const it = (e.data as { item: LootItem }).item;
    if (!wants(p, it)) continue;
    take(room, p, e, it);
    n++;
  }
  return n;
}

/** What a dead player leaves: their other gun (the one in hand drops through the pickups feature), heals, a vest. */
export function deathLoot(room: Room, p: PlayerState, heldSlot: number): void {
  const st = bx(p);
  const at = p.move;
  const around = (i: number) => ({ x: at.x + Math.cos(i * 2.1) * 0.8, y: at.y, z: at.z + Math.sin(i * 2.1) * 0.8 });
  let i = 0;
  p.weapons.slice(0, 2).forEach((w, slot) => {
    if (slot === heldSlot || w.def.base.id === 'knife' || !WEAPON_BY_ID.get(w.def.base.id)) return;
    const e = spawnDrop(room, w, around(i++), { x: 0, y: 1, z: 0 }, p, null, 'death');
    if (e) e.data.landed = false;
  });
  if (st.medkits > 0) addItem(room, { k: 'medkit' }, around(i++));
  else if (st.bandages > 0) addItem(room, { k: 'bandage' }, around(i++));
  if (st.armorMax > 0 && st.armor > st.armorMax * 0.3) addItem(room, { k: 'armor', l: Math.max(1, Math.min(3, Math.round(st.armorMax / BLACKOUT.armor.perLevel))) as 1 | 2 | 3 }, around(i++));
  trimLoot(room);
}

/** Keep loot entities under the cap: the oldest dropped items go first. */
export function trimLoot(room: Room): void {
  const items = lootItems(room);
  const drops = dropsOf(room);
  let over = items.length + drops.length - BLACKOUT.maxLoot;
  for (let k = 0; over > 0 && k < items.length; k++, over--) room.entities.remove(items[k]!.id);
}
