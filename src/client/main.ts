/**
 * Client boot. TODO(client stage): renderer, net (prediction/reconciliation/interpolation), HUD,
 * menus. For now: connect, say hello, show the profile, so the scaffold builds and runs.
 */
import { PROTOCOL_VERSION, WS_PATH } from '../shared/constants';
import { decodeServerMsg, encodeMsg } from '../shared/protocol';
import { dispatchFeature } from './registry';

const app = document.getElementById('app')!;
const status = document.createElement('pre');
status.style.cssText = 'margin:16px;font:12px/1.5 Silkscreen,monospace;white-space:pre-wrap';
status.textContent = 'Lo-Fi Ops\nconnecting...';
app.append(status);

const TOKEN_KEY = 'lofi.token';
const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`);
ws.onopen = () => ws.send(encodeMsg({ t: 'hello', token: readToken(), version: PROTOCOL_VERSION }) as string);
ws.onmessage = (ev) => {
  const msg = decodeServerMsg(ev.data as string);
  if (!msg) return;
  if (msg.t === 'welcome') {
    try {
      localStorage.setItem(TOKEN_KEY, msg.token);
    } catch {
      /* private mode */
    }
    status.textContent = `Lo-Fi Ops\nconnected as ${msg.profile.name} (level ${msg.profile.level}, ${msg.profile.codPoints} CP)\nclient coming in the next stage`;
  } else if (msg.t === 'feat') dispatchFeature(msg.id, msg.data);
};
ws.onclose = () => (status.textContent += '\ndisconnected');
