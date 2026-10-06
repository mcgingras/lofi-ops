/**
 * Typed per-room event bus. `room.bus.on(name, fn, { priority })` returns an unsubscribe
 * function. Handlers run synchronously in priority order (higher first, then registration order).
 * A throwing handler is logged and skipped; it never breaks the tick.
 */
import type { RoomEvents } from '../shared/events';
import type { PlayerState } from './player';

/** The events with the server's player type filled in. */
export type ServerEvents = RoomEvents<PlayerState>;

type Handler<T> = (e: T) => void;
interface Entry {
  fn: Handler<never>;
  priority: number;
  order: number;
  owner: unknown;
}

export class EventBus<M extends object> {
  private handlers = new Map<keyof M, Entry[]>();
  private order = 0;
  private owner: unknown = null;
  constructor(private onError: (name: string, err: unknown) => void = (name, err) => console.error(`[bus] ${name} handler failed`, err)) {}

  on<K extends keyof M>(name: K, fn: Handler<M[K]>, opts: { priority?: number } = {}): () => void {
    const list = this.handlers.get(name) ?? [];
    const entry: Entry = { fn: fn as Handler<never>, priority: opts.priority ?? 0, order: this.order++, owner: this.owner };
    list.push(entry);
    list.sort((a, b) => b.priority - a.priority || a.order - b.order);
    this.handlers.set(name, list);
    return () => {
      const l = this.handlers.get(name);
      if (!l) return;
      const i = l.indexOf(entry);
      if (i >= 0) l.splice(i, 1);
    };
  }

  once<K extends keyof M>(name: K, fn: Handler<M[K]>, opts: { priority?: number } = {}): () => void {
    const off = this.on(
      name,
      (e) => {
        off();
        fn(e);
      },
      opts,
    );
    return off;
  }

  emit<K extends keyof M>(name: K, payload: M[K]): void {
    const list = this.handlers.get(name);
    if (!list || list.length === 0) return;
    for (const h of [...list]) {
      try {
        (h.fn as Handler<M[K]>)(payload);
      } catch (err) {
        this.onError(String(name), err);
      }
    }
  }

  /** Handlers registered while `fn` runs are tagged with `owner` (removable with `offOwner`). */
  withOwner<T>(owner: unknown, fn: () => T): T {
    const prev = this.owner;
    this.owner = owner;
    try {
      return fn();
    } finally {
      this.owner = prev;
    }
  }

  /** Remove every handler tagged with `owner`. */
  offOwner(owner: unknown): void {
    for (const [k, list] of this.handlers)
      this.handlers.set(
        k,
        list.filter((e) => e.owner !== owner),
      );
  }

  listenerCount(name: keyof M): number {
    return this.handlers.get(name)?.length ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}
