/**
 * Final killcam playback: when the match ends on a recent kill the server sends the clip
 * (`modes.killcam`: every player's pose at 20 Hz for 3.5 s up to the kill). After `matchEnd` we
 * replay it through the killer's eyes with stand-in soldiers (the live remotes are hidden), slow
 * motion for the last moment, then hand over to the summary screen.
 */
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { PlayerFlags } from '../../../shared/protocol';
import type { Match } from '../../game/match';
import { blink, HUD_COLORS as C, rect, txt, unit } from '../../hud/draw';
import { registerHudWidget, registerMatchHook } from '../../registry';
import { currentMatch } from '../../state';
import { clipTime, playSeconds, posesAt, SLOW_RATE, SLOW_SEC } from './killcam-math';
import { ReplayActors } from './replay';
import { modes, now } from './store';

const actors = new ReplayActors();

function stop(): void {
  actors.dispose();
}

/** True while the final killcam is on screen. */
export const killcamPlaying = () => modes.killcamStart !== null;

function frame(m: Match, dt: number): void {
  const clip = modes.killcam;
  if (!clip || !modes.results || modes.killcamDone || m.phase !== 'ended' || !m.map) {
    if (actors.size) stop();
    if (modes.killcamStart !== null) modes.killcamStart = null;
    return;
  }
  const first = clip.frames[0]!;
  const span = clip.frames.at(-1)!.t - first.t;
  if (modes.killcamStart === null) modes.killcamStart = now();
  const elapsed = now() - modes.killcamStart;
  if (elapsed > playSeconds(span)) {
    modes.killcamDone = true;
    modes.killcamStart = null;
    stop();
    return;
  }
  const t = first.t + clipTime(elapsed, span);
  const poses = posesAt(clip.frames, t);
  const slow = elapsed > Math.max(0, span - SLOW_SEC);
  actors.update(m, poses, clip.killer, dt, slow ? SLOW_RATE : 1);
  const k = poses.get(clip.killer);
  if (k) {
    const eye = k.f & PlayerFlags.CROUCH ? 1.0 : 1.6;
    m.renderer.cam.position.set(k.x, k.y + eye, k.z);
    m.renderer.cam.rotation.set(k.pitch, k.yaw, 0, 'YXZ');
    m.renderer.zoom = k.f & PlayerFlags.ADS ? 1.3 : 1;
    m.renderer.updateFov();
  }
}

registerMatchHook('modes.killcam', {
  start: () => () => stop(),
  frame,
});

registerHudWidget(
  'modes.killcam',
  (g, W, H) => {
    const m = currentMatch();
    const clip = modes.killcam;
    if (!m || !clip || modes.killcamStart === null) return;
    const u = unit(H);
    const bar = Math.round(H * 0.1);
    rect(g, 0, 0, W, bar, C.ink);
    rect(g, 0, H - bar, W, bar, C.ink);
    txt(g, 'FINAL KILLCAM', 8 * u, Math.max(2 * u, bar / 2 - 5 * u), 8, blink(m.time, 1, 0.7) ? C.warn : C.paper, 'left', u);
    const weapon = WEAPON_BY_ID.get(clip.weapon)?.name ?? clip.weapon.toUpperCase();
    const killer = m.nameOf(clip.killer).toUpperCase();
    const victim = m.nameOf(clip.victim).toUpperCase();
    const y = H - bar + Math.max(2 * u, bar / 2 - 8 * u);
    txt(g, killer, W / 2 - 6 * u, y, 8, m.isEnemy(clip.killer) ? C.enemy : C.friend, 'right', u);
    txt(g, `[${weapon.toUpperCase()}${clip.headshot ? ' HS' : ''}]`, W / 2, y + 9 * u, 6, C.paper, 'center', u);
    txt(g, victim, W / 2 + 6 * u, y, 8, m.isEnemy(clip.victim) ? C.enemy : C.friend, 'left', u);
  },
  95,
);
