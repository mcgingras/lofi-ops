/**
 * Per-death killcam playback (BO1/MW2 "KILLCAM"). After you are killed by an enemy the server
 * sends you `modes.deathcam`: the last few seconds before the kill (20 Hz poses of nearby players,
 * the weapons in their hands, their shots and projectiles) and a killer card. After a short death
 * view (DEATHCAM.beatSec) the replay plays at 1x through the shared replay renderer
 * (replay-view.ts: the killer's eyes with their gun, the projectile for grenade kills, or the
 * killstreak that did it), then hands back to the death screen / respawn. The timeline is anchored
 * to room time, so it always ends by the respawn (the server cut the clip to fit; the server still
 * respawns you on time, which ends the replay); F (or the gamepad's X / Square) skips back to the
 * death screen. Card only (no replay) when there was no room before the respawn. The live game is
 * ducked underneath (BO1 plays the killcam's own sound).
 */
import { ATTACHMENT_BY_ID } from '../../../shared/defs/attachments';
import { unpackClip, type DeathcamPayload, type KillerCard, type UnpackedClip } from '../../../shared/defs/deathcam';
import { EQUIPMENT_BY_ID } from '../../../shared/defs/equipment';
import { KILLSTREAK_BY_ID } from '../../../shared/defs/killstreaks';
import { rankFor } from '../../../shared/defs/progression';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import type { Match } from '../../game/match';
import { HUD_COLORS as C, rect, textWidth, txt, unit } from '../../hud/draw';
import { PAD, PadEdges } from '../../game/gamepad';
import { promptKey } from '../../game/prompts';
import { net } from '../../net';
import { onFeature, registerHudWidget, registerMatchHook } from '../../registry';
import { currentMatch } from '../../state';
import { drawScopeMask } from '../weapons/scope';
import { badgePixels, drawPixels } from '../progression/emblems';
import { cardLines, deathcamClock, killcamTimer } from './deathcam-math';
import { ReplayView } from './replay-view';

/** Live game volume under the per-death killcam (BO1 plays the killcam's own sound). */
const DEATHCAM_DUCK = 0.2;

const S = {
  d: null as DeathcamPayload | null,
  clip: null as UnpackedClip | null,
  from: 0,
  to: 0,
  /** Skipped or finished: back to the death screen until the next death. */
  over: false,
  playing: false,
  left: 0,
  /** Skip key must be released after the clip arrives before a press counts. */
  useWas: true,
};
/** The controller's X (shared gamepad module), primed when a clip arrives. */
const padEdges = new PadEdges();

const view = new ReplayView();

/** True while the per-death killcam is on screen. */
export const deathcamPlaying = () => S.playing;

function clear(): void {
  S.d = null;
  S.clip = null;
  S.over = false;
}

onFeature('modes.deathcam', (d) => {
  const m = currentMatch();
  if (!m || d.victim !== m.myId) return;
  clear();
  S.d = d;
  if (d.clip) {
    const c = unpackClip(d.clip);
    S.clip = c;
    S.from = c.frames[0]?.t ?? d.at;
    S.to = c.frames.at(-1)?.t ?? d.at;
  }
  S.useWas = true;
  padEdges.prime();
});
net.on('spawned', () => clear());
net.on('joined', () => clear());
net.on('phase', (p) => {
  if (p.phase !== 'playing') clear();
});

/**
 * Edge-triggered skip: USE (F) or the controller's X, as in BO1. The pad is read here directly
 * (not through `controls.isHeld('use')`, which also carries the pad's X) so one press is one skip.
 */
function skipPressed(m: Match): boolean {
  const use = m.controls.isHeld('use');
  const pad = padEdges.update().has(PAD.X);
  const hit = (use && !S.useWas) || pad;
  S.useWas = use;
  return hit;
}

function end(): void {
  S.playing = false;
  view.end(currentMatch());
}

function frame(m: Match, dt: number): void {
  const d = S.d;
  const death = m.death;
  const clip = S.clip;
  if (!d || S.over || d.view === 'none' || !clip?.frames.length || m.alive || !death || m.phase !== 'playing' || !m.map) {
    if (S.playing) end();
    return;
  }
  const respawnAt = death.respawnAt ?? d.respawnAt;
  const c = deathcamClock(d.playAt, respawnAt, S.from, S.to, m.serverTime);
  if (c.state === 'beat') return;
  if (c.state === 'done' || (S.playing && skipPressed(m))) {
    S.over = true;
    end();
    return;
  }
  if (!S.playing) {
    S.playing = true;
    view.begin(m, { killer: d.killer, victim: d.victim, weapon: d.weapon, means: d.means, at: d.at, view: d.view, cam: d.cam, vm: d.vm, clip }, c.t, DEATHCAM_DUCK);
    skipPressed(m);
  }
  S.left = c.left;
  view.frame(m, c.t, dt);
}

registerMatchHook('modes.deathcam', {
  start: () => () => {
    end();
    clear();
    view.dispose();
  },
  frame,
});

// ---------------------------------------------------------------------------------------------
// HUD: KILLCAM banner + timer, killer card, skip prompt (the band and card are shared with the final killcam)
// ---------------------------------------------------------------------------------------------

let pattern: { g: CanvasRenderingContext2D; p: CanvasPattern | null } | null = null;
/** A checkerboard of red pixels: reads as BO1's translucent red bands through the pixel HUD. */
export function band(g: CanvasRenderingContext2D, y: number, w: number, h: number): void {
  if (!pattern || pattern.g !== g) {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const pg = c.getContext('2d')!;
    pg.fillStyle = '#7a1410';
    pg.fillRect(0, 0, 1, 1);
    pg.fillRect(1, 1, 1, 1);
    pattern = { g, p: g.createPattern(c, 'repeat') };
  }
  if (!pattern.p) return rect(g, 0, y, w, h, '#7a1410');
  g.fillStyle = pattern.p;
  g.fillRect(0, Math.round(y), Math.round(w), Math.round(h));
}

export const weaponName = (id: string) => WEAPON_BY_ID.get(id)?.name ?? EQUIPMENT_BY_ID.get(id)?.name ?? KILLSTREAK_BY_ID.get(id)?.name ?? id.replace(/_/g, ' ');
const attachmentName = (id: string) => ATTACHMENT_BY_ID.get(id)?.name ?? id.replace(/_/g, ' ');

/** What a killer card shows: the card, whose it is, a headshot, the heading above it and the name colour. */
export interface CardInfo {
  card: KillerCard;
  killer: string;
  headshot: boolean;
  label: string;
  nameColor: string;
}

/** The killer card (BO1 playercard + weapon): badge, name, rank, weapon + attachments, health. */
export function drawCard(g: CanvasRenderingContext2D, m: Match, d: CardInfo, W: number, y: number, u: number): void {
  const L = cardLines(d.card, { weapon: weaponName, attachment: attachmentName, rank: (l) => rankFor(l).title });
  const cw = Math.min(W - 16 * u, 230 * u);
  const ch = 40 * u;
  const x = Math.round(W / 2 - cw / 2);
  txt(g, d.label, W / 2, y - 10 * u, 8, C.paper, 'center', u);
  rect(g, x - u, y - u, cw + 2 * u, ch + 2 * u, C.ink);
  rect(g, x, y, cw, ch, '#26221e');
  rect(g, x, y, cw, 2 * u, d.card.prestige > 0 ? C.hi : C.dim);
  const px = badgePixels(d.card.level, d.card.prestige);
  const n = Math.round(Math.sqrt(px.length));
  const scale = Math.max(1, Math.floor((28 * u) / n));
  drawPixels(g, px, x + 5 * u, y + 6 * u, scale);
  const tx = x + 5 * u + n * scale + 6 * u;
  const name = (d.card.name || m.nameOf(d.killer)).toUpperCase();
  txt(g, name, tx, y + 5 * u, 8, d.nameColor, 'left', u);
  txt(g, L.rank, tx, y + 15 * u, 6, C.dim, 'left', u);
  // Health bar.
  const bw = Math.max(30 * u, Math.min(70 * u, cw * 0.3));
  rect(g, tx, y + 27 * u, bw, 4 * u, C.ink);
  rect(g, tx + u, y + 28 * u, Math.round((bw - 2 * u) * L.healthFrac), 2 * u, L.healthFrac > 0.5 ? '#6ad04a' : L.healthFrac > 0.25 ? C.hi : C.health);
  txt(g, L.health, tx + bw + 4 * u, y + 26 * u, 6, C.paper, 'left', u);
  // Weapon (right side).
  const rx = x + cw - 6 * u;
  txt(g, L.weapon + (d.headshot ? ' · HEADSHOT' : ''), rx, y + 5 * u, 8, C.hi, 'right', u);
  if (L.attachments) {
    let a = L.attachments;
    while (a.length > 4 && textWidth(g, a, 6, u) > cw * 0.45) a = `${a.slice(0, -2)}`;
    txt(g, a === L.attachments ? a : `${a}…`, rx, y + 15 * u, 6, C.paper, 'right', u);
  }
  if (d.card.streak > 1) txt(g, `${d.card.streak} KILL STREAK`, rx, y + 26 * u, 6, C.dim, 'right', u);
}

registerHudWidget(
  'modes.deathcam',
  (g, W, H) => {
    const m = currentMatch();
    const d = S.d;
    if (!m || !d || m.alive || !m.death || m.phase !== 'playing') return;
    const u = unit(H);
    const card: CardInfo = { card: d.card, killer: d.killer, headshot: d.headshot, label: 'KILLED BY', nameColor: C.enemy };
    if (!S.playing) {
      // No replay (no room before the respawn, or a kill with nothing to watch): the card only.
      if (d.view === 'none' || !S.clip?.frames.length) drawCard(g, m, card, W, H - 52 * u, u);
      return;
    }
    // Through the killer's scope: the scope overlay under the bands.
    if (view.scoped) drawScopeMask(g, W, H);
    const top = Math.round(H * 0.13);
    band(g, 0, W, top);
    txt(g, 'KILLCAM', W / 2, Math.max(2 * u, top / 2 - 11 * u), 16, C.paper, 'center', u);
    txt(g, killcamTimer(S.left), W / 2, top / 2 + 7 * u, 8, C.paper, 'center', u);
    const bottom = 66 * u;
    band(g, H - bottom, W, bottom);
    drawCard(g, m, card, W, H - bottom + 18 * u, u);
    txt(g, `PRESS ${promptKey('skip', { brackets: true })} TO SKIP`, W / 2, H - bottom - 14 * u, 8, C.paper, 'center', u);
  },
  94,
);
