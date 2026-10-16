/**
 * Final killcam playback (BO1, see defs/killcam.ts). When the match ends on (or within 2 s of) a
 * kill the server sends the clip (`modes.killcam`): 5 s before the kill to 2 s after it, every
 * nearby player's pose, weapon, shots and projectiles, the killer card. After `matchEnd` it plays
 * through the shared replay renderer (replay-view.ts: the killer's eyes with their real gun, ADS
 * and scope, tracers and gunshots, the projectile for grenade kills, the streak's camera for
 * streak kills), at 1x then BO1's 0.25x slow motion around the kill, fading in from and out to
 * black, with the live game muted underneath. HUD: "FINAL KILLCAM", who won, a timer and the
 * killer's card. Not skippable (BO1's finalKillcam has no skip thread). Then the summary.
 */
import { unpackClip, type UnpackedClip } from '../../../shared/defs/deathcam';
import { FINAL_KILLCAM, finalTimeline, type FinalKillcamPayload, type FinalTimeline } from '../../../shared/defs/killcam';
import type { Match } from '../../game/match';
import { HUD_COLORS as C, txt, unit } from '../../hud/draw';
import { registerHudWidget, registerMatchHook } from '../../registry';
import { currentMatch } from '../../state';
import { drawScopeMask } from '../weapons/scope';
import { band, drawCard } from './deathcam';
import { killcamTimer } from './deathcam-math';
import { ReplayView } from './replay-view';
import { modes, now } from './store';
import { winnerLine } from './summary-data';

/** Seconds the screen comes back from black after the killcam, under the opening summary. */
const AFTER_FADE = 0.6;

const view = new ReplayView();
const S = {
  payload: null as FinalKillcamPayload | null,
  clip: null as UnpackedClip | null,
  tl: null as FinalTimeline | null,
  from: 0,
  /** Local time the killcam ended (the black fades out under the summary). */
  endedAt: -Infinity,
};

/** True while the final killcam is on screen. */
export const killcamPlaying = () => modes.killcamStart !== null;

function stop(): void {
  view.end(currentMatch());
}

/** Unpack a newly arrived clip and build its timeline. */
function load(d: FinalKillcamPayload): void {
  S.payload = d;
  S.clip = unpackClip(d.clip);
  S.from = S.clip.frames[0]?.t ?? d.at;
  S.tl = finalTimeline(S.from, d.to, d.at);
}

/** Where the final killcam is, `elapsed` real seconds in: clip time, speed, fade (0 clear .. 1 black), done. */
export function finalClock(tl: FinalTimeline, elapsed: number, k = FINAL_KILLCAM): { t: number; rate: number; fade: number; done: boolean } {
  const real = tl.realSec;
  const t = tl.clipAt(Math.min(elapsed, real));
  const rate = elapsed < real ? tl.rateAt(elapsed) : 1;
  let fade = 0;
  if (elapsed < k.fadeInSec) fade = 1 - elapsed / k.fadeInSec;
  else if (elapsed >= real) fade = 1;
  else if (elapsed > real - k.fadeOutSec) fade = (elapsed - (real - k.fadeOutSec)) / k.fadeOutSec;
  return { t, rate, fade: Math.max(0, Math.min(1, fade)), done: elapsed >= real + k.holdSec };
}

function frame(m: Match, dt: number): void {
  const d = modes.killcam;
  if (!d || modes.killcamDone || !m.map || !(d.round === undefined ? !!modes.results && m.phase === 'ended' : m.phase === 'playing' && (d.endsAt === null || m.serverTime < d.endsAt))) {
    if (view.active) stop();
    if (modes.killcamStart !== null) modes.killcamStart = null;
    return;
  }
  if (S.payload !== d) load(d);
  const clip = S.clip!;
  const tl = S.tl!;
  if (modes.killcamStart === null) {
    if (clip.frames.length < 2) {
      modes.killcamDone = true;
      return;
    }
    modes.killcamStart = now();
    view.begin(m, { killer: d.killer, victim: d.victim, weapon: d.weapon, means: d.means, at: d.at, view: d.view, cam: d.cam, vm: d.vm, clip }, S.from, 0);
  }
  const c = finalClock(tl, now() - modes.killcamStart);
  if (c.done) {
    modes.killcamDone = true;
    modes.killcamStart = null;
    S.endedAt = now();
    stop();
    return;
  }
  view.frame(m, c.t, dt, c.rate);
}

registerMatchHook('modes.killcam', {
  start: () => () => {
    view.dispose();
    S.payload = null;
    S.clip = null;
  },
  frame,
});

registerHudWidget(
  'modes.killcam',
  (g, W, H) => {
    const m = currentMatch();
    const d = modes.killcam;
    if (!m) return;
    // After the killcam: the black lifts under the summary as it opens.
    const after = now() - S.endedAt;
    if (modes.killcamStart === null) {
      if (after >= 0 && after < AFTER_FADE) {
        g.fillStyle = `rgba(0,0,0,${1 - after / AFTER_FADE})`;
        g.fillRect(0, 0, W, H);
      }
      return;
    }
    if (!d || !S.tl) return;
    const u = unit(H);
    const elapsed = now() - modes.killcamStart;
    const c = finalClock(S.tl, elapsed);
    if (view.scoped) drawScopeMask(g, W, H);
    const top = Math.round(H * 0.13);
    band(g, 0, W, top);
    txt(g, d.round === undefined ? 'FINAL KILLCAM' : 'ROUND KILLCAM', W / 2, Math.max(2 * u, top / 2 - 13 * u), 16, C.paper, 'center', u);
    const res = modes.results;
    const sd = modes.state?.sd;
    if (d.round !== undefined && sd?.lastRound) {
      const mine = m.myTeam === null ? null : sd.lastRound.winner === m.myTeam;
      txt(g, `ROUND ${d.round} · ${mine === null ? 'OVER' : mine ? 'WON' : 'LOST'}`, W / 2, top / 2 + 5 * u, 8, mine === null ? C.paper : mine ? C.hi : C.warn, 'center', u);
    } else if (res) {
      const w = winnerLine(res, m.myId);
      const outcome = w.mine === null ? '' : w.mine ? ' · VICTORY' : ' · DEFEAT';
      txt(g, w.text + outcome, W / 2, top / 2 + 5 * u, 8, w.mine === null ? C.paper : w.mine ? C.hi : C.warn, 'center', u);
    }
    txt(g, killcamTimer(Math.max(0, S.tl.realSec - elapsed)), W - 8 * u, Math.max(2 * u, top / 2 - 4 * u), 8, C.paper, 'right', u);
    const bottom = 66 * u;
    band(g, H - bottom, W, bottom);
    const team = S.clip?.teams.get(d.killer);
    const friendly = team !== null && team !== undefined ? team === m.myTeam && m.myTeam !== null : d.killer === m.myId;
    drawCard(g, m, { card: d.card, killer: d.killer, headshot: d.headshot, label: `KILLED ${(d.vname || m.nameOf(d.victim)).toUpperCase()}`, nameColor: friendly ? C.friend : C.enemy }, W, H - bottom + 18 * u, u);
    if (c.fade > 0) {
      g.fillStyle = `rgba(0,0,0,${c.fade})`;
      g.fillRect(0, 0, W, H);
    }
  },
  95,
);
