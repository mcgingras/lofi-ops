/** A headless websocket client for integration tests. */
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../src/shared/constants';
import { decodeServerMsg, encodeMsg, type ClientMsg, type ServerMessages, type ServerMsg, type ServerMsgOf } from '../src/shared/protocol';

export class FakeClient {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  private waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];
  seq = 0;

  private constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data) => {
      const m = decodeServerMsg(data.toString());
      if (!m) return;
      this.msgs.push(m);
      for (const w of [...this.waiters]) {
        if (w.pred(m)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(m);
        }
      }
    });
  }

  static async connect(url: string, name?: string, token?: string): Promise<{ client: FakeClient; welcome: ServerMsgOf<'welcome'> }> {
    const c = new FakeClient(url);
    await new Promise<void>((res, rej) => {
      c.ws.once('open', () => res());
      c.ws.once('error', rej);
    });
    const welcome = c.waitFor('welcome');
    c.send({ t: 'hello', version: PROTOCOL_VERSION, name, token });
    return { client: c, welcome: await welcome };
  }

  send(m: ClientMsg) {
    this.ws.send(encodeMsg(m) as string);
  }

  /** Resolve with the first message (already received or future) of type `t` matching `pred`. */
  waitFor<K extends keyof ServerMessages>(t: K, pred: (m: ServerMsgOf<K>) => boolean = () => true, timeoutMs = 5000): Promise<ServerMsgOf<K>> {
    const match = (m: ServerMsg): boolean => m.t === t && pred(m as unknown as ServerMsgOf<K>);
    const have = this.msgs.find(match);
    if (have) return Promise.resolve(have as unknown as ServerMsgOf<K>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${String(t)}`)), timeoutMs);
      this.waiters.push({
        pred: match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as unknown as ServerMsgOf<K>);
        },
      });
    });
  }

  last<K extends keyof ServerMessages>(t: K): ServerMsgOf<K> | undefined {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i]!.t === t) return this.msgs[i] as unknown as ServerMsgOf<K>;
    return undefined;
  }

  all<K extends keyof ServerMessages>(t: K): ServerMsgOf<K>[] {
    return this.msgs.filter((m) => m.t === t) as unknown as ServerMsgOf<K>[];
  }

  /** Send `n` input commands of 1/60 s each. Returns the last seq. */
  input(buttons: number, yaw: number, pitch: number, n = 3, weaponSlot = 0): number {
    const cmds = [];
    for (let i = 0; i < n; i++) cmds.push({ seq: ++this.seq, dt: 1 / 60, buttons, yaw, pitch, weaponSlot });
    this.send({ t: 'input', cmds });
    return this.seq;
  }

  close() {
    this.ws.close();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
