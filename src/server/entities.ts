/**
 * Feature-owned world entities (killstreak vehicles, sentry guns, dogs, care packages, flags).
 * Everything in the store goes out in every snapshot as `EntitySnap` (minus `data`). Features
 * move them in a `tick` handler and remove them when done.
 */
import type { Team } from '../shared/constants';
import type { EntitySnap } from '../shared/protocol';
import { q3 } from '../shared/protocol';

export interface Entity {
  id: number;
  kind: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  owner?: string;
  team?: Team | null;
  /** Sent to clients (keep small). */
  s?: Record<string, number | string | boolean>;
  /** Server-only state. */
  data?: unknown;
}

export class EntityStore {
  private next = 1;
  private map = new Map<number, Entity>();

  add(e: Omit<Entity, 'id'>): Entity {
    const ent: Entity = { ...e, id: this.next++ };
    this.map.set(ent.id, ent);
    return ent;
  }
  get(id: number) {
    return this.map.get(id);
  }
  remove(id: number) {
    return this.map.delete(id);
  }
  all(): IterableIterator<Entity> {
    return this.map.values();
  }
  byKind(kind: string): Entity[] {
    return [...this.map.values()].filter((e) => e.kind === kind);
  }
  clear() {
    this.map.clear();
  }
  get size() {
    return this.map.size;
  }
  snapshot(): EntitySnap[] {
    const out: EntitySnap[] = [];
    for (const e of this.map.values()) {
      const s: EntitySnap = { id: e.id, kind: e.kind, x: q3(e.x), y: q3(e.y), z: q3(e.z), yaw: q3(e.yaw) };
      if (e.owner !== undefined) s.owner = e.owner;
      if (e.team !== undefined) s.team = e.team;
      if (e.s) s.s = e.s;
      out.push(s);
    }
    return out;
  }
}
