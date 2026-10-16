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
    room.bus.on('fire', (e) => cam.onShot(e.player, e.end, e.hits.length > 0));
    room.bus.on('damage', (e) => deathcams.onDamage(e.victim, e.from));
    room.bus.on('tick', ({ tick }) => {
      cam.onTick(tick);
      if (controllerOf(room)?.dirty) pushState(room);
    });
    room.bus.on('playerJoin', ({ player }) => {
      const c = controllerOf(room);
      if (c && player.session) c.dirty = true;
    });
    room.bus.on('death', (e) => {
      if (isEnemyKill(room, e)) cam.onKill(e.attacker, e.victim, e.weapon, e.headshot);
      deathcams.onDeath(e);
    });
    room.bus.on(
      'matchEnd',
      ({ results }) => {
        results.ext.modes = buildSummary(room, results);
        // No final killcam after a Tactical Nuke (MW2 cut straight to the scoreboard).
        const clip = results.reason === 'nuke' ? null : cam.clip();
        if (clip) room.sendFeature(null, 'modes.killcam', clip);
        pushState(room);
      },
      { priority: -10 },
    );
  },
};

export default feature;
