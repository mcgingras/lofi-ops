/**
 * Client lobby state and flows (owner: frontend). Asks the server for a lobby (matchmake /
 * private / code), joins it through the core match screen (`navigate('match', { room })`), keeps
 * the latest `frontend.lobby` push, and shows the 'lobby' overlay over the match screen while the
 * room is in its lobby phase (the map loads behind it).
 */
import type { LobbyState } from '../../../shared/frontend/lobby';
import type { LobbyTicket } from '../../../shared/frontend/protocol';
import { net } from '../../net';
import { onFeature } from '../../registry';
import { closeOverlay, currentScreen, navigate, onScreenChange, openOverlay, overlayOpen } from '../../router';
import { currentMatch } from '../../state';

const store: { state: LobbyState | null; receivedAt: number } = { state: null, receivedAt: 0 };
const fns = new Set<(s: LobbyState | null) => void>();
const nowSec = () => performance.now() / 1000;

export const lobbyState = (): LobbyState | null => store.state;

/** The lobby's room time now (from the last push plus local elapsed time). */
export function lobbyNow(): number {
  const s = store.state;
  if (!s) return 0;
  return s.time + (nowSec() - store.receivedAt);
}

export function onLobby(fn: (s: LobbyState | null) => void): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}

function set(s: LobbyState | null) {
  store.state = s;
  store.receivedAt = nowSec();
  for (const fn of fns) fn(s);
  sync();
}

onFeature('frontend.lobby', (s) => set(s));
net.on('left', () => set(null));
net.on('joined', (m) => {
  if (store.state && store.state.roomId !== m.roomId) set(null);
  else sync();
});
net.on('phase', () => setTimeout(sync, 0));
onScreenChange(() => setTimeout(sync, 0));
setInterval(sync, 500);

const overlayId = () => (overlayOpen() ? (document.getElementById('overlay')?.dataset.screen ?? null) : null);

/** Lobby overlay on while our room is in its lobby phase, off otherwise. */
function sync() {
  const m = currentMatch();
  const s = store.state;
  const inLobby = !!m && !!s && currentScreen() === 'match' && s.roomId === m.joined.roomId && m.phase === 'lobby';
  const ov = overlayId();
  if (inLobby && ov !== 'lobby') {
    if (ov === null || ov === 'class-picker') {
      m!.controls.releaseLock();
      openOverlay('lobby');
    }
  } else if (!inLobby && ov === 'lobby') closeOverlay();
}

function enter(t: LobbyTicket) {
  set(null);
  navigate('match', { room: t.roomId });
}

/** Quick Play a playlist; falls back to core quick play if the frontend server isn't there. */
export async function quickPlay(playlist: string): Promise<void> {
  try {
    enter(await net.rpc('frontend.matchmake', { playlist }));
  } catch (err) {
    if (err instanceof Error && /unknown rpc/.test(err.message)) navigate('match', { mode: playlist });
    else throw err;
  }
}

export async function createPrivate(opts: { mode?: string; bots?: boolean } = {}): Promise<void> {
  enter(await net.rpc('frontend.createPrivate', opts));
}

export async function joinByCode(code: string): Promise<void> {
  enter(await net.rpc('frontend.resolveCode', { code }));
}

export function inviteUrl(code: string): string {
  return `${location.origin}${location.pathname}#/lobby?code=${code}`;
}

/** Resolves once the socket is online. */
export function whenOnline(): Promise<void> {
  return new Promise((resolve) => {
    let off: (() => void) | null = null;
    off = net.onStatus((s) => {
      if (s !== 'online') return;
      queueMicrotask(() => off?.());
      resolve();
    });
  });
}
