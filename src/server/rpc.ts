/**
 * Namespaced feature RPCs (client -> server). Register in a feature's `setup(api)`:
 *
 *   api.rpc.handle('economy.buy', (ctx, data) => {
 *     const { item } = data as { item?: unknown };          // data is untrusted: validate it
 *     if (typeof item !== 'string') throw new RpcError('bad_request', 'item required');
 *     ...; return { codPoints: ctx.session.profile.codPoints };
 *   });
 *
 * Ids are '<area>.<name>' and typed by merging `RpcMap` in shared/protocol.ts. A handler may be
 * async. If the client sent a `rid`, the return value (or thrown RpcError) is sent back as
 * `rpcResult`. Handlers run for sessions in menus too (`ctx.room`/`ctx.player` may be null).
 */
import type { RpcId, RpcRes } from '../shared/protocol';
import type { PlayerState } from './player';
import type { Room } from './room';
import type { Session } from './session';

export interface RpcContext {
  session: Session;
  room: Room | null;
  player: PlayerState | null;
}

export class RpcError extends Error {
  constructor(
    readonly code: string,
    message: string = code,
  ) {
    super(message);
  }
}

type AnyHandler = (ctx: RpcContext, data: unknown) => unknown;

export class RpcRegistry {
  private handlers = new Map<string, AnyHandler>();

  handle<K extends RpcId>(id: K, fn: (ctx: RpcContext, data: unknown) => RpcRes<K> | Promise<RpcRes<K>>): void {
    if (!/^[a-z0-9_-]+\.[A-Za-z0-9_.-]+$/.test(id)) throw new Error(`rpc id must be '<area>.<name>': ${id}`);
    this.handlers.set(id, fn as AnyHandler);
  }

  has(id: string): boolean {
    return this.handlers.has(id);
  }

  /** Run a handler and reply if `rid` is set. Never throws. */
  async dispatch(ctx: RpcContext, id: string, data: unknown, rid?: number): Promise<void> {
    const fn = this.handlers.get(id);
    const reply = (ok: boolean, payload?: unknown, error?: string) => {
      if (typeof rid === 'number') ctx.session.send(ok ? { t: 'rpcResult', rid, ok, data: payload } : { t: 'rpcResult', rid, ok, error });
    };
    if (!fn) return reply(false, undefined, `unknown rpc: ${id}`);
    try {
      const res = await fn(ctx, data);
      reply(true, res);
    } catch (err) {
      if (!(err instanceof RpcError)) console.error(`[rpc] ${id} failed`, err);
      reply(false, undefined, err instanceof RpcError ? `${err.code}: ${err.message}` : 'internal_error');
    }
  }
}
