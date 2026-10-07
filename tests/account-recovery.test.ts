import { afterEach, describe, expect, it } from 'vitest';
import { normalizeRecoveryCode, startServer, type GameServer } from '../src/server/app';
import { Store } from '../src/server/store';
import { FakeClient } from './fake-client';

describe('recovery codes', () => {
  it('normalises pasted codes', () => {
    const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';
    const pretty = token.toUpperCase().match(/.{1,4}/g)!.join('-');
    expect(normalizeRecoveryCode(pretty)).toBe(token);
    expect(normalizeRecoveryCode(` ${pretty.replaceAll('-', ' ')} `)).toBe(token);
    expect(normalizeRecoveryCode('nope')).toBeNull();
    expect(normalizeRecoveryCode(42)).toBeNull();
  });

  it('peek finds a profile without creating one', () => {
    const store = new Store(':memory:');
    const { token, profile } = store.authenticate(null, 'Mason');
    expect(store.count()).toBe(1);
    expect(store.peek(token)).toMatchObject({ id: profile.id, name: 'Mason', level: 1 });
    expect(store.peek('0'.repeat(48))).toBeNull();
    expect(store.count()).toBe(1);
    store.close();
  });
});

describe('POST /api/recover', () => {
  let server: GameServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('confirms a real code, rejects typos, and the code signs back into the same profile', async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {}, quickPlayDefaults: { botFill: 0 } });
    const base = `http://127.0.0.1:${server.port}`;

    const first = await FakeClient.connect(server.url, 'Woods');
    const token = first.welcome.token;
    const id = first.welcome.profile.id;
    first.client.close();

    const pretty = token.toUpperCase().match(/.{1,4}/g)!.join('-');
    const post = (body: unknown) => fetch(`${base}/api/recover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    let res = await post({ code: pretty });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, name: 'Woods', level: 1 });

    res = await post({ code: pretty.slice(0, -1) + (pretty.endsWith('0') ? '1' : '0') });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);

    res = await post({ code: 'hello' });
    expect(res.status).toBe(400);

    res = await fetch(`${base}/api/recover`);
    expect(res.status).toBe(405);

    // "Another device" uses the code: it lands on the same profile, no new account.
    const second = await FakeClient.connect(server.url, undefined, token);
    expect(second.welcome.profile.id).toBe(id);
    expect(second.welcome.token).toBe(token);
    second.client.close();
  });
});
