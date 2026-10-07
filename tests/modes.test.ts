/**
 * Rules-level tests for the modes feature: TDM/FFA polish, Domination, Search and Destroy,
 * Headquarters, Kill Confirmed, the end-of-match summary, bot objective hooks, the final killcam
 * and objective points for maps without objective data. Rooms are driven tick by tick.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import modesFeature, { registerModeRules } from '../src/server/features/modes/index';
import { bestObjective, objectivesFor } from '../src/server/features/modes/bots';
import { controllerOf, objectivePoints } from '../src/server/features/modes/common';
import type { DomRules } from '../src/server/features/modes/dom';
import type { HqRules } from '../src/server/features/modes/hq';
import type { KcRules } from '../src/server/features/modes/kc';
import type { SdRules } from '../src/server/features/modes/sd';
import { derivedXp, pickMvp, progressionXp } from '../src/server/features/modes/summary';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room, RoomOptions } from '../src/server/room';
import { moveParamsFor } from '../src/server/sim';
import { Store } from '../src/server/store';
import { PLAYER, TICK_DT } from '../src/shared/constants';
import { MODE_TUNING, MODE_XP } from '../src/shared/defs/modes';
import { MODE_ENTITY, type MatchSummaryExt } from '../src/shared/defs/modestate';
import { getMapData } from '../src/shared/defs/maps';
import type { MatchResults, PlayerResult } from '../src/shared/events';
import { Buttons } from '../src/shared/input';
import { buildCollisionWorld, type MapData } from '../src/shared/maps/types';
import { createMoveState } from '../src/shared/movement';

let store: Store | undefined;
let lobby: Lobby | undefined;

beforeAll(() => registerModeRules());

function setup(mode: string, opts: Partial<RoomOptions> = {}): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [modesFeature], log: () => {}, autoTick: false });
  return lobby.createRoom({ mode, map: 'yard', closeWhenEmpty: false, ...opts });
}

afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

const place = (p: PlayerState, x: number, z: number) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
};
const steps = (room: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) room.step();
};
const hold = (p: PlayerState, buttons: number) => {
  p.brain = { think: (_r, self) => ({ buttons, yaw: self.yaw, pitch: 0, weaponSlot: 0 }) };
};
const idle = (p: PlayerState) => {
  p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: 0 }) };
};
/** Kill `victim` as `attacker` (a credited enemy kill with a bullet). */
const killBy = (room: Room, attacker: PlayerState, victim: PlayerState) => room.kill(victim, attacker, { weapon: 'ak47', means: 'bullet', part: 'torso' });

function objectiveLog(room: Room): string[] {
  const log: string[] = [];
  room.bus.on('objective', (e) => log.push(`${e.kind}:${e.team}${(e.data as { obj?: string })?.obj ? `:${(e.data as { obj?: string }).obj}` : ''}`));
  return log;
}

// -----------------------------------------------------------------------------------------------

describe('TDM / FFA polish', () => {
  it('TDM: first spawns at the team spawns, later spawns away from enemies', () => {
    const room = setup('tdm');
    const a = room.addBot({ team: 0 });
    const b = room.addBot({ team: 1 });
    const own0 = room.map.spawns.teams[0];
    expect(own0.some((s) => Math.hypot(s.x - a.move.x, s.z - a.move.z) < 0.5)).toBe(true);
    steps(room, MODE_TUNING.spawn.initialSec + 1);
    // An enemy camping a team-0 spawn: a's respawn must not land within 10 m of it.
    const camp = own0[0]!;
    place(b, camp.x, camp.z);
    idle(b);
    for (let i = 0; i < 8; i++) {
      killBy(room, b, a);
      expect(room.teamScores[1]).toBe(i + 1);
      steps(room, 3.1);
      expect(a.alive).toBe(true);
      expect(Math.hypot(a.move.x - b.move.x, a.move.z - b.move.z)).toBeGreaterThan(MODE_TUNING.spawn.enemyNear);
    }
    expect(b.ext.modes?.xp.kill).toBe(800);
  });

  it('TDM: a tie at the time limit is a draw (no overtime)', () => {
    const room = setup('tdm', { onEnd: 'close' });
    const a = room.addBot({ team: 0 });
    const b = room.addBot({ team: 1 });
    killBy(room, a, b);
    killBy(room, b, a);
    steps(room, room.mode.timeLimitSec + 0.5);
    expect(room.results?.reason).toBe('time');
    expect(room.results?.winnerTeam).toBeNull();
    expect(room.results?.winners).toEqual([]);
  });

  it('FFA: kill limit ends it and spawns spread out', () => {
    const room = setup('ffa', { onEnd: 'close' });
    const a = room.addBot();
    const b = room.addBot();
    expect(a.team).toBeNull();
    for (let i = 0; i < room.mode.scoreLimit; i++) {
      if (!b.alive) room.spawn(b);
      killBy(room, a, b);
    }
    expect(room.phase).toBe('ended');
    expect(room.results?.winners).toEqual([a.id]);
    expect(a.stats.score).toBe(room.mode.scoreLimit * 100);
  });
});

// -----------------------------------------------------------------------------------------------

describe('Domination', () => {
  function dom() {
    const room = setup('dom', { onEnd: 'close' });
    const a = room.addBot({ name: 'A', team: 0 });
    const b = room.addBot({ name: 'B', team: 1 });
    idle(a);
    idle(b);
    place(a, -20, -10);
    place(b, 20, -10);
    const rules = controllerOf(room) as DomRules;
    const flag = (id: string) => rules.flags.find((f) => f.zone.id === id)!.zone;
    return { room, a, b, rules, flag };
  }

  it('places A/B/C flags as entities and captures a neutral flag in 10 s', () => {
    const { room, a, flag } = dom();
    const log = objectiveLog(room);
    expect(room.entities.byKind(MODE_ENTITY.flag).map((e) => e.s?.id).sort()).toEqual(['A', 'B', 'C']);
    const B = flag('B');
    place(a, B.x, B.z);
    steps(room, MODE_TUNING.dom.captureSec - 0.5);
    expect(B.owner).toBeNull();
    expect(B.capTeam).toBe(0);
    expect(B.cap).toBeGreaterThan(0.9);
    steps(room, 0.7);
    expect(B.owner).toBe(0);
    expect(log).toContain('dom.capture:0:B');
    expect(a.ext.modes?.stats.captures).toBe(1);
    expect(a.stats.score).toBe(MODE_XP.capture);
    const ent = room.entities.byKind(MODE_ENTITY.flag).find((e) => e.s?.id === 'B')!;
    expect(ent.s?.o).toBe(0);
  });

  it('two capturers are faster; contested freezes; partial progress decays', () => {
    const { room, a, b, flag } = dom();
    const a2 = room.addBot({ name: 'A2', team: 0 });
    idle(a2);
    const C = flag('C');
    place(a, C.x, C.z);
    place(a2, C.x + 1, C.z);
    steps(room, 4);
    const fast = C.cap;
    expect(fast).toBeCloseTo((4 * 1.5) / MODE_TUNING.dom.captureSec, 1);
    place(b, C.x - 1, C.z);
    steps(room, 2);
    expect(C.contested).toBe(true);
    expect(C.cap).toBeCloseTo(fast, 2);
    place(a, -20, -10);
    place(a2, -21, -10);
    place(b, 20, -10);
    steps(room, 2);
    expect(C.cap).toBeLessThan(fast);
  });

  it('enemy flags are neutralised first, then captured', () => {
    const { room, a, b, flag } = dom();
    const log = objectiveLog(room);
    const A = flag('A');
    place(a, A.x, A.z);
    steps(room, MODE_TUNING.dom.captureSec + 0.2);
    expect(A.owner).toBe(0);
    place(a, -20, -10);
    place(b, A.x, A.z);
    steps(room, MODE_TUNING.dom.neutralizeSec + 0.2);
    expect(A.owner).toBeNull();
    expect(log).toContain('dom.neutralize:1:A');
    steps(room, MODE_TUNING.dom.captureSec + 0.2);
    expect(A.owner).toBe(1);
    expect(log).toContain('dom.capture:1:A');
  });

  it('held flags score every 5 s; reaching the limit ends the match', () => {
    const { room, a, flag } = dom();
    const B = flag('B');
    place(a, B.x, B.z);
    steps(room, MODE_TUNING.dom.captureSec + 0.1);
    const before = room.teamScores[0];
    steps(room, MODE_TUNING.dom.tickSec * 2 + 0.1);
    expect(room.teamScores[0] - before).toBeGreaterThanOrEqual(2);
    expect(room.teamScores[1]).toBe(0);
    room.teamScores[0] = room.mode.scoreLimit - 1;
    steps(room, MODE_TUNING.dom.tickSec + 0.1);
    expect(room.phase).toBe('ended');
    expect(room.results?.winnerTeam).toBe(0);
  });

  it('kills give no team score; a kill near your flag is a defend', () => {
    const { room, a, b, flag } = dom();
    const log = objectiveLog(room);
    const B = flag('B');
    place(a, B.x, B.z);
    steps(room, MODE_TUNING.dom.captureSec + 0.1);
    room.teamScores = [0, 0];
    place(b, B.x + 4, B.z);
    killBy(room, a, b);
    expect(room.teamScores).toEqual([0, 0]);
    expect(log).toContain('dom.defend:0:B');
    expect(a.ext.modes?.stats.defends).toBe(1);
  });

  it('bot hooks: capture neutral flags, defend threatened ones', () => {
    const { room, a, b, flag } = dom();
    const objs = objectivesFor(room, a);
    expect(objs.map((o) => o.kind)).toEqual(['capture', 'capture', 'capture']);
    expect(objs.every((o) => o.stay)).toBe(true);
    const B = flag('B');
    place(a, B.x, B.z);
    steps(room, MODE_TUNING.dom.captureSec + 0.1);
    place(a, -20, -10);
    place(b, B.x, B.z);
    steps(room, 1);
    const def = objectivesFor(room, a).find((o) => o.id === 'B')!;
    expect(def.kind).toBe('defend');
    expect(def.priority).toBeGreaterThan(0.8);
    expect(bestObjective(room, a)).not.toBeNull();
  });
});

// -----------------------------------------------------------------------------------------------

describe('Search and Destroy', () => {
  function sd(n = 1) {
    const room = setup('sd', { onEnd: 'close' });
    const atk: PlayerState[] = [];
    const def: PlayerState[] = [];
    for (let i = 0; i < n; i++) {
      atk.push(room.addBot({ name: `Atk${i}`, team: 0 }));
      def.push(room.addBot({ name: `Def${i}`, team: 1 }));
    }
    for (const p of [...atk, ...def]) idle(p);
    const rules = controllerOf(room) as SdRules;
    return { room, atk, def, rules };
  }
  /** Starts round 1 (the match started on room creation before the bots joined). */
  function begin(room: Room) {
    room.endMatch('aborted');
    room.startMatch();
  }

  it('round 1: prep freeze, bomb on an attacker, one life', () => {
    const { room, atk, def, rules } = sd(2);
    begin(room);
    expect(rules.round).toBe(1);
    expect(rules.phase).toBe('prep');
    expect(rules.bomb.state).toBe('carried');
    expect(atk).toContain(rules.bomb.carrier);
    // Attackers spawn on team 0's side, defenders by the sites (team 1's spawns).
    for (const p of atk) expect(p.move.z).toBeLessThan(-10);
    for (const p of def) expect(p.move.z).toBeGreaterThan(10);
    expect(moveParamsFor(room, atk[0]!).speed).toBe(0);
    // No damage during prep.
    room.damage({ victim: def[0]!, attacker: atk[0]!, amount: 50, weapon: 'ak47', part: 'torso', means: 'bullet', from: null, distance: 5 });
    expect(def[0]!.health).toBe(100);
    steps(room, MODE_TUNING.sd.prepSec + 0.1);
    expect(rules.phase).toBe('live');
    expect(moveParamsFor(room, atk[0]!).speed).toBeGreaterThan(0);
    killBy(room, atk[0]!, def[0]!);
    expect(def[0]!.respawnAt).toBeNull();
    steps(room, 5);
    expect(def[0]!.alive).toBe(false);
  });

  it('plant (hold USE 5 s in a site) then the bomb detonates: attackers win the round', () => {
    const { room, atk, def, rules } = sd();
    const log = objectiveLog(room);
    begin(room);
    steps(room, MODE_TUNING.sd.prepSec + 0.1);
    const carrier = rules.bomb.carrier!;
    const A = rules.sites.find((s) => s.id === 'A')!;
    place(carrier, A.x, A.z);
    place(def[0]!, A.x, A.z + 3); // in the blast
    hold(carrier, Buttons.USE);
    steps(room, MODE_TUNING.sd.plantSec - 0.5);
    expect(rules.phase).toBe('live');
    expect(rules.acting.get(carrier)?.kind).toBe('plant');
    expect(moveParamsFor(room, carrier).speed).toBe(0);
    steps(room, 0.7);
    expect(rules.phase).toBe('planted');
    expect(rules.bomb).toMatchObject({ state: 'planted', site: 'A' });
    expect(log).toContain('sd.plant:0:A');
    expect(carrier.ext.modes?.stats.plants).toBe(1);
    expect(room.entities.byKind(MODE_ENTITY.bomb)[0]?.s?.st).toBe('planted');
    idle(carrier);
    place(carrier, -20, -20);
    steps(room, MODE_TUNING.sd.bombSec + 0.1);
    expect(log).toContain('sd.explode:0:A');
    expect(def[0]!.alive).toBe(false);
    expect(rules.phase).toBe('post');
    expect(rules.lastRound).toEqual({ winner: 0, reason: 'detonated' });
    expect(room.teamScores).toEqual([1, 0]);
    // Next round: everyone back.
    steps(room, MODE_TUNING.sd.postSec + 0.1);
    expect(rules.round).toBe(2);
    expect(rules.phase).toBe('prep');
    expect(atk[0]!.alive && def[0]!.alive).toBe(true);
  });

  it('letting go of USE resets the plant; a defender defuses (7.5 s)', () => {
    const { room, def, rules } = sd();
    begin(room);
    steps(room, MODE_TUNING.sd.prepSec + 0.1);
    const carrier = rules.bomb.carrier!;
    const B = rules.sites.find((s) => s.id === 'B')!;
    place(carrier, B.x, B.z);
    hold(carrier, Buttons.USE);
    steps(room, 3);
    idle(carrier);
    steps(room, 0.1);
    expect(rules.acting.has(carrier)).toBe(false);
    hold(carrier, Buttons.USE);
    steps(room, 3);
    expect(rules.phase).toBe('live');
    steps(room, 2.2);
    expect(rules.phase).toBe('planted');
    idle(carrier);
    place(carrier, -20, -20);
    const d = def[0]!;
    place(d, rules.bomb.pos.x + 1, rules.bomb.pos.z);
    hold(d, Buttons.USE);
    steps(room, MODE_TUNING.sd.defuseSec + 0.2);
    expect(rules.bomb.state).toBe('defused');
    expect(rules.lastRound).toEqual({ winner: 1, reason: 'defused' });
    expect(room.teamScores).toEqual([0, 1]);
    expect(d.ext.modes?.stats.defuses).toBe(1);
  });

  it('carrier death drops the bomb; another attacker picks it up', () => {
    const { room, atk, def, rules } = sd(2);
    const log = objectiveLog(room);
    begin(room);
    steps(room, MODE_TUNING.sd.prepSec + 0.1);
    const carrier = rules.bomb.carrier!;
    const other = atk.find((p) => p !== carrier)!;
    place(carrier, 0, 0);
    place(other, 6, 0);
    killBy(room, def[0]!, carrier);
    expect(rules.bomb.state).toBe('dropped');
    expect(log).toContain('sd.drop:0');
    expect(room.entities.byKind(MODE_ENTITY.bomb)).toHaveLength(1);
    // A defender walking over it does nothing.
    place(def[1]!, 0, 0);
    steps(room, 0.2);
    expect(rules.bomb.state).toBe('dropped');
    place(def[1]!, 20, 20);
    place(other, 0.5, 0);
    steps(room, 0.1);
    expect(rules.bomb).toMatchObject({ state: 'carried', carrier: other });
    expect(room.entities.byKind(MODE_ENTITY.bomb)).toHaveLength(0);
    // The carrier is only in the attackers' state.
    expect(rules.state(other).sd!.bomb.carrier).toBe(other.id);
    expect(rules.state(def[0]!).sd!.bomb.carrier).toBeNull();
  });

  it('elimination and time-out decide rounds; a planted bomb survives the attackers dying', () => {
    const { room, atk, def, rules } = sd();
    begin(room);
    steps(room, MODE_TUNING.sd.prepSec + 0.1);
    killBy(room, atk[0]!, def[0]!);
    steps(room, 0.1);
    expect(rules.lastRound).toEqual({ winner: 0, reason: 'eliminated' });
    steps(room, MODE_TUNING.sd.postSec + MODE_TUNING.sd.prepSec + 0.2);
    expect(rules.round).toBe(2);
    expect(rules.phase).toBe('live');
    steps(room, MODE_TUNING.sd.roundSec + 0.1);
    expect(rules.lastRound).toEqual({ winner: 1, reason: 'time' });
    steps(room, MODE_TUNING.sd.postSec + MODE_TUNING.sd.prepSec + 0.2);
    // Round 3: plant, then the attacker dies: the round goes on until the bomb.
    const c = rules.bomb.carrier!;
    const A = rules.sites[0]!;
    place(c, A.x, A.z);
    place(def[0]!, 20, -20);
    hold(c, Buttons.USE);
    steps(room, MODE_TUNING.sd.plantSec + 0.1);
    expect(rules.phase).toBe('planted');
    killBy(room, def[0]!, c);
    steps(room, 1);
    expect(rules.phase).toBe('planted');
    steps(room, MODE_TUNING.sd.bombSec);
    expect(rules.lastRound?.reason).toBe('detonated');
    expect(room.teamScores).toEqual([2, 1]);
  });

  it('switches sides at halftime and ends at 4 rounds', () => {
    const { room, atk, def, rules } = sd();
    begin(room);
    const winRound = () => {
      steps(room, MODE_TUNING.sd.prepSec + 0.1);
      // Team 0 always wins by eliminating team 1 (whichever side they are on).
      killBy(room, atk[0]!, def[0]!);
      steps(room, 0.1);
    };
    for (let r = 1; r <= 3; r++) {
      expect(rules.attackers).toBe(0);
      winRound();
      steps(room, MODE_TUNING.sd.postSec + 0.05);
    }
    expect(rules.switched).toBe(true);
    expect(rules.attackers).toBe(1);
    expect(def[0]!.move.z).toBeLessThan(-10); // team 1 now spawns on the attacking side
    winRound();
    expect(room.phase).toBe('ended');
    expect(room.results?.reason).toBe('rounds');
    expect(room.results?.winnerTeam).toBe(0);
    expect((room.results?.ext.modes as MatchSummaryExt).rounds).toBe(4);
  });

  it('a team with nobody on it cannot be eliminated (solo practice)', () => {
    const room = setup('sd', { onEnd: 'close' });
    const solo = room.addBot({ team: 0 });
    idle(solo);
    room.endMatch('aborted');
    room.startMatch();
    const rules = controllerOf(room) as SdRules;
    steps(room, MODE_TUNING.sd.prepSec + 5);
    expect(rules.phase).toBe('live');
    expect(rules.round).toBe(1);
  });

  it('an attacker joining during prep of a round that started without attackers gets the bomb', () => {
    const room = setup('sd', { onEnd: 'close' });
    const d = room.addBot({ team: 1 });
    idle(d);
    room.endMatch('aborted');
    room.startMatch();
    const rules = controllerOf(room) as SdRules;
    expect(rules.bomb.state).toBe('dropped');
    const a = room.addBot({ team: 0 });
    expect(a.alive).toBe(true);
    expect(rules.bomb).toMatchObject({ state: 'carried', carrier: a });
  });

  it('bot hooks: the carrier plants, defenders defuse a planted bomb', () => {
    const { room, def, rules } = sd(2);
    begin(room);
    expect(objectivesFor(room, def[0]!)).toEqual([]);
    steps(room, MODE_TUNING.sd.prepSec + 0.1);
    const carrier = rules.bomb.carrier!;
    const best = bestObjective(room, carrier)!;
    expect(best.kind).toBe('plant');
    expect(best.holdUse).toBe(true);
    expect(objectivesFor(room, def[0]!).every((o) => o.kind === 'defend')).toBe(true);
    place(carrier, rules.sites[0]!.x, rules.sites[0]!.z);
    hold(carrier, Buttons.USE);
    steps(room, MODE_TUNING.sd.plantSec + 0.1);
    expect(bestObjective(room, def[0]!)).toMatchObject({ kind: 'defuse', holdUse: true });
  });
});

// -----------------------------------------------------------------------------------------------

describe('Headquarters', () => {
  function hq() {
    const room = setup('hq', { onEnd: 'close' });
    const a = room.addBot({ name: 'A', team: 0 });
    const a2 = room.addBot({ name: 'A2', team: 0 });
    const b = room.addBot({ name: 'B', team: 1 });
    for (const p of [a, a2, b]) idle(p);
    room.endMatch('aborted');
    room.startMatch();
    for (const [p, x] of [[a, -24], [a2, -22], [b, 24]] as const) place(p, x, -20);
    const rules = controllerOf(room) as HqRules;
    return { room, a, a2, b, rules };
  }

  it('comes online, gets captured, scores per second, defenders do not respawn', () => {
    const { room, a, a2, b, rules } = hq();
    const log = objectiveLog(room);
    expect(rules.phase).toBe('waiting');
    steps(room, MODE_TUNING.hq.firstSec + 0.1);
    expect(rules.phase).toBe('neutral');
    expect(log).toContain('hq.online:null:HQ');
    expect(room.entities.byKind(MODE_ENTITY.hq)).toHaveLength(1);
    const z = rules.zone!;
    place(a, z.x, z.z);
    steps(room, MODE_TUNING.hq.captureSec + 0.1);
    expect(rules.phase).toBe('held');
    expect(z.owner).toBe(0);
    expect(log).toContain('hq.capture:0:HQ');
    const s0 = room.teamScores[0];
    steps(room, 3.05);
    expect(room.teamScores[0] - s0).toBe(3 * MODE_TUNING.hq.pointsPerSec);
    // A defender killed while the HQ stands waits.
    killBy(room, b, a2);
    expect(a2.respawnAt).toBeNull();
    // Attackers respawn as normal.
    killBy(room, a, b);
    expect(b.respawnAt).not.toBeNull();
  });

  it('enemies destroy it: dead defenders come back, the next HQ is elsewhere', () => {
    const { room, a, a2, b, rules } = hq();
    const log = objectiveLog(room);
    steps(room, MODE_TUNING.hq.firstSec + 0.1);
    const z = rules.zone!;
    const first = { x: z.x, z: z.z };
    place(a, z.x, z.z);
    steps(room, MODE_TUNING.hq.captureSec + 0.1);
    killBy(room, b, a2);
    expect(a2.respawnAt).toBeNull();
    place(a, -24, -20);
    if (!b.alive) room.spawn(b);
    place(b, z.x, z.z);
    steps(room, MODE_TUNING.hq.destroySec + 0.1);
    expect(log).toContain('hq.destroy:1:HQ');
    expect(b.ext.modes?.stats.destroys).toBe(1);
    expect(rules.phase).toBe('waiting');
    expect(a2.respawnAt).not.toBeNull();
    steps(room, MODE_TUNING.hq.releaseRespawnSec + 0.5);
    expect(a2.alive).toBe(true);
    steps(room, MODE_TUNING.hq.relocateSec);
    expect(rules.phase).toBe('neutral');
    expect(Math.hypot(rules.zone!.x - first.x, rules.zone!.z - first.z)).toBeGreaterThan(1);
  });

  it('an unclaimed HQ moves on; a held one expires after holdSec', () => {
    const { room, a, rules } = hq();
    const log = objectiveLog(room);
    steps(room, MODE_TUNING.hq.firstSec + MODE_TUNING.hq.idleSec + 0.2);
    expect(log).toContain('hq.move:null:HQ');
    steps(room, MODE_TUNING.hq.relocateSec + 0.1);
    const z = rules.zone!;
    place(a, z.x, z.z);
    steps(room, MODE_TUNING.hq.captureSec + 0.1);
    expect(rules.phase).toBe('held');
    steps(room, MODE_TUNING.hq.holdSec + 0.1);
    expect(log).toContain('hq.expire:0:HQ');
    expect(rules.phase).toBe('waiting');
  });

  it('bot hooks follow the HQ state', () => {
    const { room, a, b, rules } = hq();
    steps(room, MODE_TUNING.hq.firstSec + 0.1);
    expect(bestObjective(room, a)?.kind).toBe('capture');
    place(a, rules.zone!.x, rules.zone!.z);
    steps(room, MODE_TUNING.hq.captureSec + 0.1);
    expect(bestObjective(room, a)?.kind).toBe('defend');
    expect(bestObjective(room, b)?.kind).toBe('destroy');
  });
});

// -----------------------------------------------------------------------------------------------

describe('Kill Confirmed', () => {
  function kc() {
    const room = setup('kc', { onEnd: 'close' });
    const a = room.addBot({ name: 'A', team: 0 });
    const a2 = room.addBot({ name: 'A2', team: 0 });
    const b = room.addBot({ name: 'B', team: 1 });
    for (const p of [a, a2, b]) idle(p);
    place(a, -10, 0);
    place(a2, -20, -20);
    place(b, 10, 0);
    return { room, a, a2, b, rules: controllerOf(room) as KcRules };
  }

  it('kills drop tags and score nothing; enemies confirm (+1), teammates deny', () => {
    const { room, a, a2, b, rules } = kc();
    const log = objectiveLog(room);
    killBy(room, a, b);
    expect(room.teamScores).toEqual([0, 0]);
    const tags = room.entities.byKind(MODE_ENTITY.tag);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.team).toBe(1);
    place(a, tags[0]!.x, tags[0]!.z);
    steps(room, 0.05);
    expect(room.teamScores).toEqual([1, 0]);
    expect(log).toContain('kc.confirm:0');
    expect(a.ext.modes?.stats.confirms).toBe(1);
    expect(a.stats.score).toBe(100 + MODE_XP.confirm);
    expect(room.entities.byKind(MODE_ENTITY.tag)).toHaveLength(0);
    // a2 dies; their teammate a denies.
    steps(room, 3.1);
    place(b, 10, 0);
    killBy(room, b, a2);
    const t2 = room.entities.byKind(MODE_ENTITY.tag)[0]!;
    expect(t2.team).toBe(0);
    place(a, t2.x, t2.z);
    steps(room, 0.05);
    expect(room.teamScores).toEqual([1, 0]);
    expect(log).toContain('kc.deny:0');
    expect(rules.denied).toEqual([1, 0]);
    expect(rules.state().kc).toEqual({ confirmed: [1, 0], denied: [1, 0] });
  });

  it('tags expire and the confirm limit ends the match', () => {
    const { room, a, b } = kc();
    killBy(room, a, b);
    steps(room, MODE_TUNING.kc.tagLifeSec + 0.2);
    expect(room.entities.byKind(MODE_ENTITY.tag)).toHaveLength(0);
    room.teamScores = [room.mode.scoreLimit - 1, 0];
    if (!b.alive) room.spawn(b);
    place(b, 10, 0);
    killBy(room, a, b);
    const t = room.entities.byKind(MODE_ENTITY.tag)[0]!;
    expect(objectivesFor(room, a)[0]).toMatchObject({ kind: 'collect' });
    place(a, t.x, t.z);
    steps(room, 0.05);
    expect(room.phase).toBe('ended');
    expect(room.results?.winnerTeam).toBe(0);
  });
});

// -----------------------------------------------------------------------------------------------

describe('summary, killcam, objective points', () => {
  it('match end writes an MVP, objective stats and an XP breakdown; the final kill is replayable', () => {
    const room = setup('dom', { onEnd: 'close' });
    const a = room.addBot({ name: 'A', team: 0 });
    const b = room.addBot({ name: 'B', team: 1 });
    idle(a);
    idle(b);
    const rules = controllerOf(room) as DomRules;
    const B = rules.flags.find((f) => f.zone.id === 'B')!.zone;
    place(a, B.x, B.z);
    place(b, 20, -10);
    steps(room, MODE_TUNING.dom.captureSec + 0.2);
    const sent: { id: string; data: unknown }[] = [];
    room.sendFeature = ((to: PlayerState | null, id: string, data: unknown) => {
      if (to === null) sent.push({ id, data });
    }) as Room['sendFeature'];
    room.teamScores[0] = room.mode.scoreLimit - 1;
    killBy(room, a, b); // the last kill...
    steps(room, MODE_TUNING.dom.tickSec); // ...then the flag tick ends it
    expect(room.phase).toBe('ended');
    const ext = room.results!.ext.modes as MatchSummaryExt;
    expect(ext.mvp).toBe(a.id);
    expect(ext.xpSource).toBe('modes');
    expect(ext.players[a.id]!.stats).toMatchObject({ captures: 1, defends: 1 }); // a stood on B for the kill
    const labels = ext.players[a.id]!.xp.map((l) => l.label);
    expect(labels).toEqual(expect.arrayContaining(['Kills', 'Flag captures', 'Time played', 'Victory']));
    expect(ext.players[a.id]!.xpTotal).toBe(ext.players[a.id]!.xp.reduce((s, l) => s + l.amount, 0));
    const cam = sent.find((m) => m.id === 'modes.killcam')?.data as { killer: string; victim: string; frames: { t: number }[] } | undefined;
    expect(cam).toBeDefined();
    expect(cam!.killer).toBe(a.id);
    expect(cam!.victim).toBe(b.id);
    expect(cam!.frames.length).toBeGreaterThan(40);
  });

  it('prefers the progression feature XP breakdown when present', () => {
    const r: PlayerResult = { id: 'p1', profileId: 'prof1', name: 'x', team: 0, bot: false, kills: 2, deaths: 1, assists: 0, headshots: 1, score: 450, bestStreak: 2, place: 1, won: true, timePlayed: 100 };
    const results = { ext: { progression: { players: { prof1: { breakdown: [{ label: 'Kills', xp: 200 }, { label: 'Win', amount: 500 }] } } } } } as unknown as MatchResults;
    expect(progressionXp(results, r)).toEqual([{ label: 'Kills', amount: 200 }, { label: 'Win', amount: 500 }]);
    expect(progressionXp({ ext: {} } as unknown as MatchResults, r)).toBeNull();
    const lines = derivedXp(r, { kill: 200, headshot: 50 });
    expect(lines).toEqual([{ label: 'Kills', amount: 200 }, { label: 'Headshots', amount: 50 }, { label: 'Other', amount: 200 }, { label: 'Time played', amount: 100 }, { label: 'Victory', amount: 500 }]);
    expect(pickMvp([{ ...r, id: 'a', score: 100 }, { ...r, id: 'b', score: 300 }])).toBe('b');
    expect(pickMvp([{ ...r, id: 'a', score: 0, kills: 0 }])).toBeNull();
  });

  it('maps without objective data get derived points on free ground; the Yard has its own', () => {
    const yard = getMapData('yard');
    expect(objectivePoints(yard, 'dom').map((p) => p.id)).toEqual(['A', 'B', 'C']);
    expect(objectivePoints(yard, 'sd').every((p) => p.team === 1)).toBe(true);
    const bare: MapData = { ...yard, objectives: {} };
    const world = buildCollisionWorld(bare);
    for (const kind of ['dom', 'sd', 'hq']) {
      const pts = objectivePoints(bare, kind);
      expect(pts.length, kind).toBeGreaterThanOrEqual(kind === 'sd' ? 2 : 3);
      for (const p of pts) expect(world.free(p.x, p.y + 0.05, p.z), `${kind} ${p.id}`).toBe(true);
    }
    expect(objectivePoints(bare, 'sd').every((p) => p.team === 1)).toBe(true);
  });

  it('every objective point of every map that lists a mode is on free ground', () => {
    for (const mapId of ['yard', 'rust', 'scrapyard', 'terminal']) {
      const map = getMapData(mapId);
      const world = buildCollisionWorld(map);
      for (const [kind, pts] of Object.entries(map.objectives))
        for (const p of pts) {
          expect(world.free(p.x, p.y + 0.05, p.z, PLAYER.radius), `${mapId} ${kind} ${p.id}`).toBe(true);
          expect(world.groundBelow(p.x, p.z, p.y + 2, 6), `${mapId} ${kind} ${p.id} ground`).not.toBeNull();
        }
    }
  });

  it('pushes team-relative state to players with sessions', () => {
    const room = setup('dom');
    const got: unknown[] = [];
    const a = room.addBot({ team: 0 });
    a.session = { sendFeature: (id: string, data: unknown) => got.push({ id, data }), send: () => {}, open: true, congested: false } as unknown as PlayerState['session'];
    steps(room, 0.3);
    const st = got.find((m) => (m as { id: string }).id === 'modes.state') as { data: { mode: string; flags: unknown[] } } | undefined;
    expect(st?.data.mode).toBe('dom');
    expect(st?.data.flags).toHaveLength(3);
  });
});
