// Post-deploy smoke test: GET /healthz, load the page, then a headless socket says hello, joins a
// TDM quick-play match and waits for a spawn and a snapshot.
//   npx tsx scripts/smoke.ts                       (http://127.0.0.1:8080)
//   npx tsx scripts/smoke.ts https://lofi-ops.fly.dev
// Exits non-zero on any failure. A cold (stopped) Fly machine can take a few seconds to answer.
import WebSocket from 'ws';
import { PROTOCOL_VERSION, WS_PATH } from '../src/shared/constants';
import { decodeServerMsg, encodeMsg, type ClientMsg, type ServerMsg } from '../src/shared/protocol';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8080');
const fail = (msg: string): never => {
  console.error(`FAIL ${msg}`);
  process.exit(1);
};

const t0 = Date.now();
const healthRes = await fetch(new URL('/healthz', base)).catch((e: unknown) => fail(`healthz: ${String(e)}`));
const health = (await healthRes.json()) as Record<string, unknown>;
if (!healthRes.ok || health.ok !== true) fail(`healthz ${healthRes.status} ${JSON.stringify(health)}`);
console.log(`ok   /healthz ${JSON.stringify(health)} (${Date.now() - t0} ms)`);

const page = await fetch(base);
const html = await page.text();
if (!page.ok || !html.includes('<script')) fail(`page ${page.status}`);
console.log(`ok   / ${page.status} ${html.length} bytes`);

const wsUrl = `${base.protocol === 'https:' ? 'wss' : 'ws'}://${base.host}${WS_PATH}`;
const ws = new WebSocket(wsUrl);
const send = (m: ClientMsg) => ws.send(encodeMsg(m) as string);
const timer = setTimeout(() => fail('socket: timed out after 15 s'), 15000);
const seen = new Set<string>();
ws.on('open', () => send({ t: 'hello', version: PROTOCOL_VERSION, name: 'SmokeTest' }));
ws.on('error', (e) => fail(`socket: ${e.message}`));
ws.on('message', (data) => {
  const m = decodeServerMsg(data.toString()) as ServerMsg | null;
  if (!m) return;
  if (m.t === 'error') fail(`server error ${m.code}: ${m.message}`);
  if (seen.has(m.t)) return;
  seen.add(m.t);
  if (m.t === 'welcome') {
    console.log(`ok   welcome as ${m.profile.name} (session ${m.sessionId})`);
    send({ t: 'quickplay', mode: 'tdm' });
  } else if (m.t === 'joined') {
    console.log(`ok   joined ${m.roomId} ${m.mode} on ${m.map} (team ${m.team}, phase ${m.phase})`);
  } else if (m.t === 'spawned') {
    console.log(`ok   spawned at ${m.x.toFixed(1)}, ${m.z.toFixed(1)}`);
  }
  if (seen.has('joined') && seen.has('snap')) {
    clearTimeout(timer);
    console.log(`PASS ${base.origin} in ${Date.now() - t0} ms`);
    ws.close();
    setTimeout(() => process.exit(0), 100);
  }
});
