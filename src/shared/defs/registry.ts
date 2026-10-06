/** Shared helper: every defs file exports a typed array plus a `byId` map built with this. */
export interface HasId {
  id: string;
}

/** Map of id -> def. Throws on duplicate ids so mistakes fail fast in tests. */
export function indexById<T extends HasId>(list: readonly T[]): ReadonlyMap<string, T> {
  const m = new Map<string, T>();
  for (const d of list) {
    if (m.has(d.id)) throw new Error(`duplicate def id: ${d.id}`);
    m.set(d.id, d);
  }
  return m;
}

/** Lookup that throws with a helpful message (use where a missing def is a bug). */
export function must<T>(map: ReadonlyMap<string, T>, id: string, kind: string): T {
  const d = map.get(id);
  if (!d) throw new Error(`unknown ${kind}: ${id}`);
  return d;
}
