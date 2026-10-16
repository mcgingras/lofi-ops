/**
 * Final killcam, server side: which kill is chosen in every mode (BO1: the kill that ended the
 * match or one within 2 s of the end; MW3's Kill Confirmed and Infected: the winning team's last
 * kill), what the clip carries (5 s before to 2 s after, the killer's weapon and every player's
 * gear, stance, shots, projectiles, teams), the clip starting at the killer's spawn, the Nuke's
 * skip, a killer or victim who left, S&D's end-of-round killcam, the post-match waiting for it,
 * the shared timeline maths and the clip codec. Rooms are driven tick by tick.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import economy from '../src/server/features/economy/index';
import { gunGameLadder } from '../src/server/features/economy/modes/gungame';
import { controllerOf } from '../src/server/features/modes/common';
import type { InfectedRules } from '../src/server/features/modes/infected';
import modesFeature, { registerModeRules } from '../src/server/features/modes/index';
import { pickFinalKill, type KillCapture } from '../src/server/features/modes/killcam';
import type { SdRules } from '../src/server/features/modes/sd';
import weaponsFeature from '../src/server/features/weapons/index';
import type { Feature } from '../src/server/feature';
import { Lobby } from '../src/server/lobby';
import { registerMode } from '../src/server/modes/index';
import type { PlayerState } from '../src/server/player';
import type { Room, RoomOptions } from '../src/server/room';
import { RpcRegistry } from '../src/server/rpc';
import { Store } from '../src/server/store';
import { registerWeaponBehavior } from '../src/server/combat';
import { TICK_DT } from '../src/shared/constants';
import { gearKey, packClip, parseGear, unpackClip } from '../src/shared/defs/deathcam';
import { NADE_ENTITY } from '../src/shared/defs/equipment';
import { FINAL_KILLCAM, finalKillcamSeconds, finalTimeline, type FinalKillcamPayload } from '../src/shared/defs/killcam';
import { MODE_TUNING } from '../src/shared/defs/modes';
import type { KillcamFrame } from '../src/shared/defs/modestate';
import { Buttons } from '../src/shared/input';
import { PlayerFlags } from '../src/shared/protocol';
import { createMoveState } from '../src/shared/movement';

let store: Store | undefined;
let lobby: Lobby | undefined;

beforeAll(() => registerModeRules());

function setup(mode: string, opts: Partial<RoomOptions> = {}, features: Feature[] = [modesFeature]): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features, log: () => {}, autoTick: false });
  if (features.includes(economy)) {
    const api = { lobby, store, rpc: new RpcRegistry(), registerMode, registerWeaponBehavior, sessions: () => [][Symbol.iterator](), log: () => {} };
    for (const f of features) f.setup?.(api as never);
  }
  return lobby.createRoom({ mode, map: 'yard', closeWhenEmpty: false, onEnd: 'close', ...opts });
}

afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

const steps = (room: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) room.step();
};
const idle = (p: PlayerState) => {
  p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: self.slot }) };
  return p;
};
const hold = (p: PlayerState, buttons: number) => {
  p.brain = { think: (_r, self) => ({ buttons, yaw: self.yaw, pitch: 0, weaponSlot: self.slot }) };
};
const place = (p: PlayerState, x: number, z: number) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
};
const killBy = (room: Room, attacker: PlayerState, victim: PlayerState, weapon = 'ak47') => room.kill(victim, attacker, { weapon, means: 'bullet', part: 'torso' });

/** Everything the room broadcasts as `modes.killcam`. */
function killcams(room: Room): FinalKillcamPayload[] {
  const out: FinalKillcamPayload[] = [];
  const orig = room.sendFeature.bind(room);
  room.sendFeature = ((to, id, data) => {
    if (to === null && id === 'modes.killcam') out.push(data as FinalKillcamPayload);
    orig(to, id, data);
  }) as Room['sendFeature'];
  return out;
}

function team(room: Room, names: string[], t: 0 | 1): PlayerState[] {
  return names.map((n) => idle(room.addBot({ name: n, team: t })));
}

// -----------------------------------------------------------------------------------------------

describe('which kill', () => {
  it('TDM: the kill that reaches the score limit, not the kill before it (the mode rules end the match inside the death event)', () => {
    const room = setup('tdm');
    const [a] = team(room, ['A'], 0);
    const [b, c] = team(room, ['B', 'C'], 1);
    steps(room, 4);
    const cams = killcams(room);
    killBy(room, a!, c!);
    steps(room, 3);
    room.teamScores[0] = room.mode.scoreLimit - 1;
    const at = room.time;
    killBy(room, a!, b!);
    expect(room.phase).toBe('ended');
    expect(cams).toHaveLength(1);
    const k = cams[0]!;
    expect(k).toMatchObject({ killer: a!.id, victim: b!.id, weapon: 'ak47', means: 'bullet', view: 'eyes', vname: 'B' });
    expect(k.at).toBeCloseTo(at, 3);
    expect(k.to).toBeCloseTo(at + FINAL_KILLCAM.afterSec, 3);
    expect(k.card.name).toBe('A');
    expect(k.vm?.weapon).toBe(a!.weapons[a!.slot]!.def.base.id);
    const clip = unpackClip(k.clip);
    // 5 s before the kill at 20 Hz; frames stop at the match end (the kill).
    expect(clip.frames[0]!.t).toBeCloseTo(at - FINAL_KILLCAM.beforeSec, 1);
    expect(clip.frames.at(-1)!.t).toBeCloseTo(at, 3);
    expect(clip.frames.length).toBeGreaterThanOrEqual(100);
    // The victim is dead in the last frame, the killer alive.
    const last = clip.frames.at(-1)!.p;
    expect(last.find((p) => p[0] === b!.id)![6] & PlayerFlags.ALIVE).toBe(0);
    expect(last.find((p) => p[0] === a!.id)![6] & PlayerFlags.ALIVE).toBe(PlayerFlags.ALIVE);
    expect(clip.teams.get(a!.id)).toBe(0);
    expect(clip.teams.get(b!.id)).toBe(1);
  });

  it('TDM on time: a kill within 2 s of the end makes the killcam, an older one does not', () => {
    const room = setup('tdm');
    const [a] = team(room, ['A'], 0);
    const [b] = team(room, ['B'], 1);
    steps(room, 4);
    const cams = killcams(room);
    killBy(room, a!, b!);
    steps(room, 1.5);
    room.endMatch('time');
    expect(cams).toHaveLength(1);
    expect(cams[0]!.victim).toBe(b!.id);
    // The 1.5 s after the kill are in the clip; the rest of the 2 s is held on the client.
    expect(unpackClip(cams[0]!.clip).frames.at(-1)!.t).toBeGreaterThan(cams[0]!.at + 1.4);

    const room2 = setup('tdm');
    const [a2] = team(room2, ['A'], 0);
    const [b2] = team(room2, ['B'], 1);
    steps(room2, 4);
    const cams2 = killcams(room2);
    killBy(room2, a2!, b2!);
    steps(room2, 2.5);
    room2.endMatch('time');
    expect(cams2).toHaveLength(0);
  });

  it('FFA: the kill that reaches the kill limit', () => {
    const room = setup('ffa');
    const a = idle(room.addBot({ name: 'A' }));
    const b = idle(room.addBot({ name: 'B' }));
    const c = idle(room.addBot({ name: 'C' }));
    steps(room, 4);
    const cams = killcams(room);
    killBy(room, c, b);
    steps(room, 1);
    a.stats.kills = room.mode.scoreLimit - 1;
    killBy(room, a, c);
    expect(room.phase).toBe('ended');
    expect(cams.map((k) => [k.killer, k.victim])).toEqual([[a.id, c.id]]);
  });

  it('Domination: a kill just before the winning flag tick counts; one 5 s earlier does not (BO1 2 s rule)', () => {
    for (const [gap, expected] of [
      [1, 1],
      [MODE_TUNING.dom.tickSec, 0],
    ] as const) {
      const room = setup('dom');
      const [a] = team(room, ['A'], 0);
      const [b] = team(room, ['B'], 1);
      steps(room, 4);
      const cams = killcams(room);
      room.teamScores[0] = room.mode.scoreLimit - 1;
      killBy(room, a!, b!);
      steps(room, gap - 0.05);
      room.endMatch('score');
      expect(cams.length, `gap ${gap}`).toBe(expected);
    }
  });

  it('S&D: the eliminating kill of the last round is the final killcam', () => {
    const room = setup('sd');
    const [atk] = team(room, ['Atk'], 0);
    const [def] = team(room, ['Def'], 1);
    room.endMatch('aborted');
    room.startMatch();
    const rules = controllerOf(room) as unknown as SdRules;
    steps(room, MODE_TUNING.sd.prepSec + 1);
    expect(rules.phase).toBe('live');
    room.teamScores[0] = room.mode.scoreLimit - 1;
    const cams = killcams(room);
    killBy(room, atk!, def!);
    steps(room, 0.1);
    expect(room.phase).toBe('ended');
    expect(cams).toHaveLength(1);
    expect(cams[0]).toMatchObject({ killer: atk!.id, victim: def!.id });
    expect(cams[0]!.round).toBeUndefined();
  });

  it('S&D: earlier rounds end on a round killcam, and the post-round waits for it', () => {
    const room = setup('sd');
    const [atk] = team(room, ['Atk'], 0);
    const [def] = team(room, ['Def'], 1);
    room.endMatch('aborted');
    room.startMatch();
    const rules = controllerOf(room) as unknown as SdRules;
    steps(room, MODE_TUNING.sd.prepSec + 1);
    const cams = killcams(room);
    killBy(room, atk!, def!);
    steps(room, 0.1);
    expect(rules.phase).toBe('post');
    expect(cams).toHaveLength(1);
    const k = cams[0]!;
    expect(k.round).toBe(1);
    const sec = finalKillcamSeconds(k.clip.t0, k.to, k.at);
    expect(k.endsAt).toBeCloseTo(rules.endsAt, 3);
    // Post-round = BO1's 5 s plus the killcam.
    expect(rules.endsAt - k.at).toBeGreaterThan(MODE_TUNING.sd.postSec + sec - 0.2);
    // The next round forgets it: ending round 2 on time makes no killcam.
    steps(room, rules.endsAt - room.time + MODE_TUNING.sd.prepSec + 0.5);
    expect(rules.round).toBe(2);
    rules.endsAt = room.time;
    steps(room, 0.1);
    expect(rules.phase).toBe('post');
    expect(cams).toHaveLength(1);
  });

  it('Kill Confirmed (MW3): the winning team\'s last kill, even when the losers killed later and the tag ended it', () => {
    const room = setup('kc');
    const [a, a2] = team(room, ['A', 'A2'], 0);
    const [b] = team(room, ['B'], 1);
    place(a!, -10, 0);
    place(a2!, -20, -20);
    place(b!, 10, 0);
    steps(room, 4);
    const cams = killcams(room);
    killBy(room, a!, b!);
    const tag = room.entities.byKind('modes.tag')[0]!;
    steps(room, 3.2);
    place(b!, 10, 12); // (off their own tag, or they would deny it)
    killBy(room, b!, a2!); // a later kill by the losing side
    steps(room, 1);
    room.teamScores[0] = room.mode.scoreLimit - 1;
    place(a!, tag.x, tag.z); // a confirms their tag: the winning point, 4 s after their kill
    steps(room, 0.1);
    expect(room.phase).toBe('ended');
    expect(room.results!.winnerTeam).toBe(0);
    expect(cams).toHaveLength(1);
    expect(cams[0]).toMatchObject({ killer: a!.id, victim: b!.id });
  });

  it('Infected (MW3): the Infected\'s knife on the last Survivor', () => {
    const room = setup('infected', {}, [weaponsFeature, modesFeature]);
    const ps = [0, 1, 2].map((i) => idle(room.addBot({ name: `P${i}` })));
    room.step();
    const rules = controllerOf(room) as unknown as InfectedRules;
    rules.pickAt = room.time;
    room.step();
    const first = ps.find((p) => rules.roleOf(p) === 'infected')!;
    steps(room, 1);
    const cams = killcams(room);
    const [v1, v2] = ps.filter((p) => p !== first) as [PlayerState, PlayerState];
    room.kill(v1, first, { weapon: 'knife', means: 'melee', part: 'torso' });
    steps(room, 0.5);
    room.kill(v2, first, { weapon: 'knife', means: 'melee', part: 'torso' });
    expect(room.phase).toBe('ended');
    expect(cams).toHaveLength(1);
    expect(cams[0]).toMatchObject({ killer: first.id, victim: v2.id, means: 'melee' });
    // The victim was a Survivor at the kill (they turn Infected right after).
    expect(unpackClip(cams[0]!.clip).teams.get(v2.id)).toBe(0);
  });

  it('Gun Game (wager): the final rung\'s kill', () => {
    const room = setup('gungame', {}, [economy, modesFeature]);
    const a = idle(room.addBot({ name: 'A' }));
    const b = idle(room.addBot({ name: 'B' }));
    steps(room, 4);
    const cams = killcams(room);
    const ladder = gunGameLadder();
    a.ext.wager!.gunLevel = ladder.length - 1;
    room.kill(b, a, { weapon: ladder.at(-1)!, means: 'bullet' });
    expect(room.phase).toBe('ended');
    expect(cams.map((k) => [k.killer, k.weapon])).toEqual([[a.id, ladder.at(-1)!]]);
  });

  it('no final killcam after a Tactical Nuke', () => {
    const room = setup('tdm');
    const [a] = team(room, ['A'], 0);
    const [b] = team(room, ['B'], 1);
    steps(room, 4);
    const cams = killcams(room);
    killBy(room, a!, b!);
    steps(room, 0.5);
    room.endMatch('nuke');
    expect(cams).toHaveLength(0);
  });

  it('pickFinalKill: BO1 rule by age, MW3 rule by winning team', () => {
    const cap = (at: number, team: number) => ({ at, killerTeam: team }) as unknown as KillCapture;
    const latest = cap(9, 1);
    const byTeam = new Map([
      [0, cap(3, 0)],
      [1, latest],
    ]);
    expect(pickFinalKill({ mode: 'tdm', endTime: 10.9, winnerTeam: 0, latest, byTeam })).toBe(latest);
    expect(pickFinalKill({ mode: 'dom', endTime: 11.1, winnerTeam: 0, latest, byTeam })).toBeNull();
    expect(pickFinalKill({ mode: 'kc', endTime: 60, winnerTeam: 0, latest, byTeam })).toBe(byTeam.get(0));
    expect(pickFinalKill({ mode: 'infected', endTime: 60, winnerTeam: null, latest, byTeam })).toBeNull();
    expect(pickFinalKill({ mode: 'tdm', endTime: 10, winnerTeam: 0, latest: null, byTeam })).toBeNull();
  });
});

// -----------------------------------------------------------------------------------------------

describe('what the clip carries', () => {
  it('weapons in hand per player (with camo and attachments), crouch / prone, shots and the post-match wait', () => {
    const room = setup('tdm', { postMatchSec: 10 });
    const [a] = team(room, ['A'], 0);
    const [b] = team(room, ['B'], 1);
    place(a!, 0, 0);
    place(b!, 0, -10);
    steps(room, 4);
    a!.weapons[a!.slot]!.camo = 'gold';
    hold(b!, Buttons.CROUCH);
    hold(a!, Buttons.PRONE);
    steps(room, 1.5);
    room.fire(a!, { dir: { x: 0, y: 0, z: -1 } });
    steps(room, 0.2);
    const cams = killcams(room);
    room.teamScores[0] = room.mode.scoreLimit - 1;
    killBy(room, a!, b!);
    const k = cams[0]!;
    const clip = unpackClip(k.clip);
    const w = a!.weapons[a!.slot]!;
    const held = parseGear(clip.gear.get(a!.id)!.at(-1)!.gear)!;
    expect(held).toEqual({ weapon: w.def.base.id, camo: 'gold', attachments: [...w.def.attachmentIds] });
    expect(parseGear(clip.gear.get(b!.id)![0]!.gear)!.weapon).toBe(b!.weapons[b!.slot]!.def.base.id);
    const last = clip.frames.at(-2)!.p;
    expect(last.find((p) => p[0] === a!.id)![6] & PlayerFlags.PRONE).toBe(PlayerFlags.PRONE);
    expect(last.find((p) => p[0] === b!.id)![6] & PlayerFlags.CROUCH).toBe(PlayerFlags.CROUCH);
    expect(clip.shots.some((s) => s.id === a!.id)).toBe(true);
    // The post-match waits for the killcam (BO1 plays it before the scoreboard).
    const sec = finalKillcamSeconds(k.clip.t0, k.to, k.at);
    expect(sec).toBeGreaterThan(10);
    expect(room.phaseEndsAt! - room.time).toBeCloseTo(10 + sec, 3);
    expect(k.endsAt).toBeCloseTo(room.phaseEndsAt!, 3);
  });

  it('rooms with a short post-match (tests, quick rotations) do not wait', () => {
    const room = setup('tdm', { postMatchSec: 2 });
    const [a] = team(room, ['A'], 0);
    const [b] = team(room, ['B'], 1);
    steps(room, 4);
    const cams = killcams(room);
    room.teamScores[0] = room.mode.scoreLimit - 1;
    killBy(room, a!, b!);
    expect(cams[0]!.endsAt).toBeNull();
    expect(room.phaseEndsAt! - room.time).toBeCloseTo(2, 3);
  });

  it('starts at the killer\'s spawn when they respawned inside the window', () => {
    const room = setup('tdm');
    const [a] = team(room, ['A'], 0);
    const [b, c] = team(room, ['B', 'C'], 1);
    steps(room, 4);
    killBy(room, c!, a!);
    steps(room, 3.1 + 1.5); // dead for the respawn delay, then alive 1.5 s
    expect(a!.alive).toBe(true);
    const spawnedAt = room.time - 1.5;
    const cams = killcams(room);
    room.teamScores[0] = room.mode.scoreLimit - 1;
    killBy(room, a!, b!);
    const clip = unpackClip(cams[0]!.clip);
    expect(clip.frames[0]!.t).toBeGreaterThan(spawnedAt - 0.06);
    for (const f of clip.frames) expect(f.p.find((p) => p[0] === a!.id)![6] & PlayerFlags.ALIVE).toBe(PlayerFlags.ALIVE);
  });

  it('a killer who left the match still gets their killcam (frames up to the leave, card from the kill)', () => {
    const room = setup('kc');
    const [a, a2] = team(room, ['A', 'A2'], 0);
    const [b] = team(room, ['B'], 1);
    place(a!, -10, 0);
    place(b!, 10, 0);
    steps(room, 4);
    const cams = killcams(room);
    killBy(room, a!, b!);
    const tag = room.entities.byKind('modes.tag')[0]!;
    steps(room, 1);
    room.removePlayer(a!.id, 'left');
    room.teamScores[0] = room.mode.scoreLimit - 1;
    place(a2!, tag.x, tag.z);
    steps(room, 0.1);
    expect(room.phase).toBe('ended');
    const k = cams[0]!;
    expect(k).toMatchObject({ killer: a!.id, victim: b!.id });
    expect(k.card.name).toBe('A');
    const clip = unpackClip(k.clip);
    const lastWithKiller = clip.frames.filter((f) => f.p.some((p) => p[0] === a!.id)).at(-1)!;
    expect(lastWithKiller.t).toBeGreaterThan(k.at + 0.9);
    expect(lastWithKiller.t).toBeLessThan(k.at + 1.1);
  });

  it('a victim who disconnected right after the kill: the clip still has them up to the leave', () => {
    const room = setup('tdm');
    const [a] = team(room, ['A'], 0);
    const [b] = team(room, ['B'], 1);
    steps(room, 4);
    const cams = killcams(room);
    killBy(room, a!, b!);
    steps(room, 0.5);
    room.removePlayer(b!.id, 'left');
    steps(room, 0.5);
    room.endMatch('time');
    const k = cams[0]!;
    expect(k.vname).toBe('B');
    const clip = unpackClip(k.clip);
    expect(clip.frames.at(-1)!.p.some((p) => p[0] === b!.id)).toBe(false);
    expect(clip.frames.some((f) => f.t > k.at && f.p.some((p) => p[0] === b!.id))).toBe(true);
  });

  it('grenades in flight are recorded as projectiles owned by the thrower', () => {
    const room = setup('tdm');
    const [a] = team(room, ['A'], 0);
    const [b] = team(room, ['B'], 1);
    place(a!, 0, 0);
    place(b!, 0, -8);
    steps(room, 4);
    const ent = room.entities.add({ kind: NADE_ENTITY, x: 0, y: 1.5, z: -1, yaw: 0, owner: a!.id, team: 0, s: { e: 'frag' } });
    for (let i = 0; i < 20; i++) {
      ent.z -= 0.3;
      room.step();
    }
    room.entities.remove(ent.id);
    const cams = killcams(room);
    room.teamScores[0] = room.mode.scoreLimit - 1;
    room.kill(b!, a!, { weapon: 'frag', means: 'explosive' });
    const clip = unpackClip(cams[0]!.clip);
    const tr = clip.projectiles.find((p) => p.kind === NADE_ENTITY)!;
    expect(tr).toMatchObject({ owner: a!.id, sub: 'frag' });
    expect(tr.points.length).toBeGreaterThanOrEqual(5);
    expect(tr.points.at(-1)!.z).toBeLessThan(tr.points[0]!.z);
  });
});

// -----------------------------------------------------------------------------------------------

describe('timeline and codec', () => {
  it('BO1 slow motion: 1x, 0.25x from 0.5 s before the kill to 1.5 s after, 1x to the end', () => {
    const at = 105;
    const tl = finalTimeline(100, 107, at);
    const k = FINAL_KILLCAM;
    // 4.5 s at 1x (less half a ramp), 2 s of clip at 0.25x = 8 s, the last 0.5 s at 1x, plus the ramps.
    expect(tl.realSec).toBeGreaterThan(4.5 + 8 + 0.5 - 0.3);
    expect(tl.realSec).toBeLessThan(4.5 + 8 + 0.5 + 0.3);
    expect(tl.clipAt(0)).toBeCloseTo(100, 6);
    expect(tl.clipAt(2)).toBeCloseTo(102, 6);
    expect(tl.rateAt(2)).toBe(1);
    // The kill plays in slow motion...
    let real = 0;
    while (tl.clipAt(real) < at) real += 0.01;
    expect(tl.rateAt(real)).toBeCloseTo(k.slowRate, 6);
    // ...the clip is monotonic and ends exactly at `to`.
    let prev = -Infinity;
    for (let r = 0; r <= tl.realSec; r += 0.05) {
      const c = tl.clipAt(r);
      expect(c).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = c;
    }
    expect(tl.clipAt(tl.realSec)).toBeCloseTo(107, 6);
    expect(tl.clipAt(tl.realSec + 5)).toBe(107);
    expect(tl.rateAt(tl.realSec - 0.1)).toBeCloseTo(1, 6);
    // Speed eases (no jump) into the slow motion.
    let maxJump = 0;
    for (let r = 0.01; r <= tl.realSec; r += 0.01) maxJump = Math.max(maxJump, Math.abs(tl.rateAt(r) - tl.rateAt(r - 0.01)));
    expect(maxJump).toBeLessThan(0.06);
  });

  it('a clip that starts inside the slow stretch keeps just its part of it', () => {
    const tl = finalTimeline(104.8, 107, 105);
    expect(tl.rateAt(0)).toBeCloseTo(FINAL_KILLCAM.slowRate, 6);
    expect(tl.clipAt(0)).toBeCloseTo(104.8, 6);
    expect(tl.clipAt(tl.realSec)).toBeCloseTo(107, 6);
    const short = finalTimeline(100, 105.2, 105); // ends during the slow motion
    expect(short.clipAt(short.realSec)).toBeCloseTo(105.2, 6);
    expect(short.rateAt(short.realSec - 0.01)).toBeCloseTo(FINAL_KILLCAM.slowRate, 6);
  });

  it('clip codec: gear, stance flags, frost, teams, projectiles and shots round-trip', () => {
    const g1 = gearKey('ak47', 'gold', ['reflex', 'grip']);
    const g2 = gearKey('m1911', 'none');
    const frames: KillcamFrame[] = [
      { t: 10, p: [['a', 1, 0, 2, 0.5, 0.1, PlayerFlags.ALIVE | PlayerFlags.CROUCH, 100, g1], ['b', 5, 0, 5, 3, 0, PlayerFlags.ALIVE | PlayerFlags.PRONE | PlayerFlags.CROUCH, 80, g2, 40]], e: [[7, NADE_ENTITY, 'a', 1, 1.5, 2, 'frag']] },
      { t: 10.05, p: [['a', 1.1, 0, 2, 0.6, 0.1, PlayerFlags.ALIVE, 100, g2], ['b', 5, 0, 5, 3, 0, 0, 0, g2, 100]], e: [[7, NADE_ENTITY, 'a', 1.5, 1.4, 1.5, 'frag']] },
    ];
    const packed = packClip(frames, [{ t: 10.02, id: 'a', end: [5, 1, 5], hit: true }], new Map([
      ['a', 0],
      ['b', 1],
    ]));
    const back = unpackClip(JSON.parse(JSON.stringify(packed)));
    expect(back.frames).toEqual(frames);
    expect(back.gear.get('a')).toEqual([
      { t: 10, gear: g1 },
      { t: 10.05, gear: g2 },
    ]);
    expect(back.frost.get('b')).toEqual([
      { t: 10, frost: 40 },
      { t: 10.05, frost: 100 },
    ]);
    expect(back.teams).toEqual(new Map([
      ['a', 0],
      ['b', 1],
    ]));
    expect(back.projectiles).toEqual([{ id: 7, kind: NADE_ENTITY, sub: 'frag', owner: 'a', points: [{ t: 10, x: 1, y: 1.5, z: 2 }, { t: 10.05, x: 1.5, y: 1.4, z: 1.5 }] }]);
    expect(back.shots).toEqual([{ t: 10.02, id: 'a', end: [5, 1, 5], hit: true }]);
    expect(parseGear(g1)).toEqual({ weapon: 'ak47', camo: 'gold', attachments: ['reflex', 'grip'] });
    expect(parseGear('')).toBeNull();
  });

  it('bandwidth: a 7 s clip of 12 moving players with their guns stays small', () => {
    const frames: KillcamFrame[] = [];
    for (let i = 0; i <= 140; i++) {
      const t = 100 + i * 0.05;
      frames.push({ t, p: Array.from({ length: 12 }, (_, j) => [`p${j}`, j * 3 + Math.sin(t + j) * 4, 0, Math.cos(t * 0.7 + j) * 6, t * 0.3 + j, Math.sin(t) * 0.2, PlayerFlags.ALIVE | (i % 40 < 20 ? PlayerFlags.SPRINT : 0), 100, gearKey(j % 2 ? 'ak47' : 'mp5k', 'none', ['reflex'])] as KillcamFrame['p'][number]) });
    }
    const shots = Array.from({ length: 60 }, (_, i) => ({ t: 100 + i * 0.1, id: `p${i % 12}`, end: [1, 1, 1] as [number, number, number], hit: i % 3 === 0 }));
    const bytes = JSON.stringify(packClip(frames, shots, new Map())).length;
    expect(bytes).toBeLessThan(45_000);
  });
});
