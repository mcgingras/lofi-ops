/**
 * Server side of the 'modes' feature area (owner: modes). See docs/features/modes.md.
 *
 * setup(): registers the rules for tdm, ffa (polished), dom, sd, hq, kc and infected.
 * room():  pushes team-relative objective state to each player (`modes.state`, every 0.25 s and
 *          on change), records the final killcam, sends each killed human their per-death
 *          killcam (deathcam.ts), and writes the end-of-match summary into
 *          `results.ext.modes` (MVP, objective stats, XP breakdown).
 * Bot hooks: ./bots.ts (`objectivesFor`, `bestObjective`).
 */
import { trackSpawns } from './spawns';
import type { Feature } from '../../feature';
import { registerMode } from '../../modes/index';
import type { ModeFactory } from '../../modes/types';
import type { Room } from '../../room';
import { controllerOf, isEnemyKill } from './common';
import { DomRules } from './dom';
import { HqRules } from './hq';
import { InfectedRules } from './infected';
import { KcRules } from './kc';
import { Deathcams } from './deathcam';
import { KillcamRecorder } from './killcam';
import { FINAL_KILLCAM, finalKillcamSeconds } from '../../../shared/defs/killcam';
import { SdRules } from './sd';
import { buildSummary } from './summary';
import { FfaRules, TdmRules } from './tdm';

export const MODE_FACTORIES: Record<string, ModeFactory> = {
  tdm: () => new TdmRules(),
  ffa: () => new FfaRules(),
  dom: () => new DomRules(),
  sd: () => new SdRules(),
  hq: () => new HqRules(),
  kc: () => new KcRules(),
  infected: () => new InfectedRules(),
};

/** Register every mode's rules (idempotent). Tests that build a Lobby directly call this. */
export function registerModeRules(register: (id: string, f: ModeFactory) => void = registerMode): void {
  for (const [id, f] of Object.entries(MODE_FACTORIES)) register(id, f);
}

const STATE_EVERY = 0.25;
/** Bus priority of the killcams' death handler (mode rules run at 0, Infected at -20). */
export const FINAL_KILL_PRIORITY = 100;

/** Send each human their view of the objective state. */
export function pushState(room: Room): void {
  const c = controllerOf(room);
  if (!c) return;
  c.dirty = false;
  if (room.phase === 'lobby') return;
  for (const p of room.players.values()) {
    if (!p.session) continue;
    const st = c.state(p);
    if (st) room.sendFeature(p, 'modes.state', st);
  }
}

const feature: Feature = {
  id: 'modes',
  setup(api) {
    registerModeRules(api.registerMode);
  },
  room(room) {
    trackSpawns(room);
    room.every(STATE_EVERY, () => pushState(room));
    const cam = new KillcamRecorder(room);
    const deathcams = new Deathcams(room, cam);
    room.bus.on('matchStart', () => {
      cam.clear();
      deathcams.clear();
    });
    room.bus.on('fire', (e) => cam.onShot(e.player, e.end, e.hits.length > 0, e.walls));
    room.bus.on('damage', (e) => deathcams.onDamage(e.victim, e.from));
    room.bus.on('tick', ({ tick }) => {
      cam.onTick(tick);
      if (controllerOf(room)?.dirty) pushState(room);
    });
    room.bus.on('playerJoin', ({ player }) => {
      const c = controllerOf(room);
      if (c && player.session) c.dirty = true;
    });
    // Ahead of the mode rules: the kill that reaches the score limit ends the match inside their
    // handler, and the final killcam must already have it.
    room.bus.on(
      'death',
      (e) => {
        const view = deathcams.describe(e);
        if (view && isEnemyKill(room, e)) cam.onKill(e, view);
        deathcams.onDeath(e, view);
      },
      { priority: FINAL_KILL_PRIORITY },
    );
    // BO1 replays the round's final kill at the end of every round too (`round_end_killcam`):
    // the post-round waits for it. The last round's goes out as the match's final killcam.
    room.bus.on('modes.roundEnd', ({ round, winner }) => {
      room.schedule(0, () => {
        const c = controllerOf(room);
        // Nobody to watch it (bots only): the round goes on as before.
        if (room.phase !== 'playing' || !(c instanceof SdRules) || c.phase !== 'post' || c.round !== round || !room.humans().length) return;
        const clip = cam.finalClip({ winnerTeam: winner });
        if (!clip) return;
        c.endsAt += finalKillcamSeconds(clip.clip.t0, clip.to, clip.at);
        c.dirty = true;
        clip.round = round;
        clip.endsAt = Math.round(c.endsAt * 1000) / 1000;
        room.sendFeature(null, 'modes.killcam', clip);
      });
    });
    room.bus.on('modes.roundStart', () => cam.forgetKills());
    room.bus.on(
      'matchEnd',
      ({ results }) => {
        results.ext.modes = buildSummary(room, results);
        // No final killcam after a Tactical Nuke (MW2 cut straight to the scoreboard).
        const clip = results.reason === 'nuke' ? null : cam.finalClip(results);
        if (clip) {
          // BO1 plays the final killcam before the scoreboard: the post-match waits for it.
          if (room.options.postMatchSec >= FINAL_KILLCAM.minPostMatchSec && room.phaseEndsAt !== null && room.humans().length) {
            room.phaseEndsAt += finalKillcamSeconds(clip.clip.t0, clip.to, clip.at);
            clip.endsAt = Math.round(room.phaseEndsAt * 1000) / 1000;
          }
          room.sendFeature(null, 'modes.killcam', clip);
        }
        pushState(room);
      },
      { priority: -10 },
    );
  },
};

export default feature;
