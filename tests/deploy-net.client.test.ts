/**
 * Deploy area, client side: the socket URL comes from the page origin (wss on https), and the
 * "Waking server..." state covers a scale-to-zero cold start (slow first handshake, a hung
 * handshake that must be retried, and the 1012 close a draining server sends).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Net, socketUrl, type NetStatus } from '../src/client/net';
import { encodeMsg } from '../src/shared/protocol';

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static all: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  private listeners = new Map<string, Set<() => void>>();
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  private fire(type: 'open' | 'close') {
    for (const fn of this.listeners.get(type) ?? []) fn();
    if (type === 'open') this.onopen?.();
    else this.onclose?.();
  }
  send(data: string) {
    this.sent.push(data);
  }
  /** Server side: accept the upgrade. */
  accept() {
    this.readyState = FakeSocket.OPEN;
    this.fire('open');
  }
  welcome() {
    this.onmessage?.({ data: encodeMsg({ t: 'welcome', sessionId: 's1', token: 'tok'.padEnd(20, 'x'), profile: {} as never, version: 1, defaultLoadouts: [] }) as string });
  }
  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.fire('close');
  }
}

describe('socketUrl', () => {
  it('derives ws/wss from the page origin', () => {
    expect(socketUrl({ protocol: 'https:', host: 'lofi-ops.fly.dev' })).toBe('wss://lofi-ops.fly.dev/ws');
    expect(socketUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws');
    expect(socketUrl({ protocol: 'http:', host: '192.168.1.20:8080' })).toBe('ws://192.168.1.20:8080/ws');
  });
});

describe('Net waking / retry', () => {
  let statuses: NetStatus[];
  let net: Net;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('location', { protocol: 'https:', host: 'lofi-ops.fly.dev' });
    net = new Net();
    statuses = [];
    net.onStatus((s) => statuses.push(s));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows waking during a slow cold-start handshake, then goes online', () => {
    net.connect();
    expect(FakeSocket.all[0]!.url).toBe('wss://lofi-ops.fly.dev/ws');
    expect(net.status).toBe('connecting');
    vi.advanceTimersByTime(1600);
    expect(net.status).toBe('waking');
    FakeSocket.all[0]!.accept();
    expect(FakeSocket.all[0]!.sent[0]).toContain('"hello"');
    FakeSocket.all[0]!.welcome();
    expect(net.status).toBe('online');
    expect(statuses).toEqual(['idle', 'connecting', 'waking', 'online']);
  });

  it('a fast handshake never flashes waking', () => {
    net.connect();
    FakeSocket.all[0]!.accept();
    FakeSocket.all[0]!.welcome();
    vi.advanceTimersByTime(5000);
    expect(statuses).toEqual(['idle', 'connecting', 'online']);
  });

  it('drops a hung handshake and retries until the server answers', () => {
    net.connect();
    vi.advanceTimersByTime(15_100);
    expect(FakeSocket.all[0]!.readyState).toBe(FakeSocket.CLOSED);
    expect(net.status).toBe('waking');
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.all.length).toBe(2);
    FakeSocket.all[1]!.accept();
    FakeSocket.all[1]!.welcome();
    expect(net.status).toBe('online');
  });

  it('reconnects after a draining server closes the socket (deploy / scale down)', () => {
    net.connect();
    FakeSocket.all[0]!.accept();
    FakeSocket.all[0]!.welcome();
    FakeSocket.all[0]!.close();
    expect(net.status).toBe('waking');
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.all.length).toBe(2);
    FakeSocket.all[1]!.accept();
    FakeSocket.all[1]!.welcome();
    expect(net.status).toBe('online');
  });
});
