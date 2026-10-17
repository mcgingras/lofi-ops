/**
 * Client state of Zombies: the latest `zombies.state`, announcer banners, point popups and the
 * stingers that go with events. Cleared on every `joined`.
 */
import { PERK_COLA_BY_ID, POWERUP_BY_ID, type PowerupId, type ZombiesEventPayload, type ZombiesPlayerInfo, type ZombiesStatePayload } from '../../../shared/defs/zombies';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { net } from '../../net';
import { onFeature } from '../../registry';
import { currentMatch } from '../../state';

export const now = () => performance.now() / 1000;

export interface Banner {
  text: string;
  sub?: string;
  color: string;
  at: number;
  /** Seconds on screen. */
  dur: number;
  big?: boolean;
}

export const zm = {
  state: null as ZombiesStatePayload | null,
  /** Local time the state arrived. */
  stateAt: 0,
  banners: [] as Banner[],
  /** Point popups for me: amount, local time, a little x jitter. */
  popups: [] as { amount: number; at: number; dx: number }[],
  /** Round change animation: local time the round number last changed (chalk flash). */
  roundAt: 0,
  lastRound: 0,
  /** Local time the game-over card appeared. */
  gameOverAt: 0,
  /** Local time a drink started (viewmodel bottle) and its perk colour. */
  drinkAt: -99,
  drinkColor: '#ffffff',
};

export function isZombiesMatch(m: Match | null | undefined): m is Match {
  return !!m && m.joined.mode === 'zombies';
}

export function myInfo(m: Match | null = currentMatch()): ZombiesPlayerInfo | null {
  if (!m || !zm.state) return null;
  return zm.state.players.find((p) => p.id === m.myId) ?? null;
}

export function reset(): void {
  zm.state = null;
  zm.banners = [];
  zm.popups = [];
  zm.lastRound = 0;
  zm.roundAt = 0;
  zm.gameOverAt = 0;
  zm.drinkAt = -99;
}

export function banner(text: string, color: string, opts: { sub?: string; dur?: number; big?: boolean } = {}): void {
  zm.banners = zm.banners.filter((b) => now() - b.at < b.dur && b.big !== opts.big);
  zm.banners.push({ text, color, at: now(), dur: opts.dur ?? 3, ...(opts.sub ? { sub: opts.sub } : {}), ...(opts.big ? { big: true } : {}) });
}

net.on('joined', () => reset());

onFeature('zombies.state', (d) => {
  if (d.round !== zm.lastRound) {
    zm.lastRound = d.round;
    zm.roundAt = now();
  }
  if (d.survived !== null && !zm.gameOverAt) zm.gameOverAt = now();
  zm.state = d;
  zm.stateAt = now();
});

onFeature('zombies.event', (e: ZombiesEventPayload) => {
  const m = currentMatch();
  if (!m) return;
  const mine = e.player === m.myId;
  const name = e.player ? m.nameOf(e.player) : '';
  // AI partners read as "PARTNER <name>".
  const bot = !!e.player && !!zm.state?.players.find((p) => p.id === e.player)?.bot;
  const who = bot ? `PARTNER ${name.toUpperCase()}` : name.toUpperCase();
  switch (e.kind) {
    case 'points':
      if (mine && e.amount) zm.popups.push({ amount: e.amount, at: now(), dx: (Math.random() - 0.5) * 16 });
      if (zm.popups.length > 12) zm.popups.shift();
      break;
    case 'round_start':
      sfx.play('zombies.round_start', { volume: 0.9 });
      break;
    case 'dog_round':
      sfx.play('zombies.dog_round', { volume: 1 });
      banner('HELLHOUNDS', '#ff7040', { sub: 'FETCH ME THEIR SOULS', dur: 5, big: true });
      break;
    case 'round_end':
      sfx.play('zombies.round_end', { volume: 0.9 });
      break;
    case 'powerup': {
      const def = POWERUP_BY_ID.get(e.id as PowerupId);
      sfx.play(e.id === 'nuke' ? 'zombies.nuke' : 'zombies.powerup_grab', { volume: 1 });
      if (e.id === 'nuke') m.renderer.white = Math.max(m.renderer.white, 0.85);
      banner((def?.name ?? String(e.id)).toUpperCase(), def?.color ?? '#ffffff', { dur: 3, big: true });
      break;
    }
    case 'perk':
      if (e.text === 'drink') {
        if (mine) {
          zm.drinkAt = now();
          zm.drinkColor = PERK_COLA_BY_ID.get(e.id as never)?.color ?? '#ffffff';
          sfx.play('zombies.drink', { volume: 0.9 });
        }
      } else if (mine) banner((e.text ?? '').toUpperCase(), PERK_COLA_BY_ID.get(e.id as never)?.color ?? '#ffffff', { dur: 2.5 });
      break;
    case 'buy':
      if (mine) sfx.play('zombies.buy', { volume: 0.8 });
      break;
    case 'ammo':
      if (mine) {
        sfx.play('zombies.buy', { volume: 0.6 });
        banner(`${(WEAPON_BY_ID.get(e.id ?? '')?.name ?? 'AMMO').toUpperCase()} AMMO`, '#e8c060', { dur: 1.5 });
      }
      break;
    case 'nope':
      if (mine) {
        sfx.play('zombies.nope', { volume: 0.7 });
        banner(e.text ?? 'NO', '#ff6a4a', { dur: 1.2 });
      }
      break;
    case 'box':
      break;
    case 'teddy':
      sfx.play('zombies.teddy', { volume: 1 });
      banner('BYE BYE', '#c8a0ff', { sub: 'THE BOX IS MOVING', dur: 3.5, big: true });
      break;
    case 'box_move':
      banner('THE BOX HAS MOVED', '#9ad8ff', { dur: 3 });
      break;
    case 'down':
      if (mine) sfx.play('zombies.down', { volume: 1 });
      else banner(`${who} IS DOWN!`, '#ff6a4a', { dur: 3, ...(bot ? { sub: 'HOLD USE NEXT TO THEM TO REVIVE' } : {}) });
      break;
    case 'revived':
      if (!mine) banner(`${who} IS BACK UP`, '#7ab0ff', { dur: 2.5 });
      break;
    case 'bleedout':
      if (!mine) banner(`${who} BLED OUT`, '#ff6a4a', { dur: 3, ...(bot ? { sub: 'BACK NEXT ROUND' } : {}) });
      break;
    case 'game_over':
      sfx.play('zombies.game_over', { volume: 1 });
      break;
    case 'board':
      break;
    case 'callout':
      // A partner's line ("DUTCH: REVIVING YOU", "... NEEDS A REVIVE", "... GETTING JUGGERNOG").
      if (e.text) banner(e.text, '#9ac8ff', { dur: 2.5 });
      break;
  }
});
