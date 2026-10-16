/**
 * Killcam replay maths on the client (shared by the final killcam and the per-death one): the
 * final killcam's clock (slow motion, fades, hold), spline pose interpolation without jitter, a
 * respawn not swept through, a killer who left held in place, the killer's weapon model picked
 * from a real server clip, the projectile a grenade kill follows, Thundergun / Winter's Howl
 * deaths, and the winner line.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { deathEffects, killProjectile, posesAt, projectileAt, replayGun } from '../src/client/features/modes/killcam-math';
import { winnerLine } from '../src/client/features/modes/summary-data';
import modesFeature, { registerModeRules } from '../src/server/features/modes/index';
import { Lobby } from '../src/server/lobby';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import { gearKey, unpackClip, type ProjectileTrack, type UnpackedClip } from '../src/shared/defs/deathcam';
import { FINAL_KILLCAM, finalClock, finalTimeline, type FinalKillcamPayload } from '../src/shared/defs/killcam';
import type { KillcamFrame } from '../src/shared/defs/modestate';
import { WEAPON_BY_ID } from '../src/shared/defs/weapons';
import type { MatchResults } from '../src/shared/events';
import { PlayerFlags } from '../src/shared/protocol';

const A = PlayerFlags.ALIVE;

describe('final killcam clock', () => {
  it('fades in from black, plays, fades out, holds black, then is done', () => {
    const tl = finalTimeline(100, 107, 105);
    const k = FINAL_KILLCAM;
    expect(finalClock(tl, 0)).toMatchObject({ t: 100, rate: 1, fade: 1, done: false });
    expect(finalClock(tl, k.fadeInSec / 2).fade).toBeCloseTo(0.5, 5);
    expect(finalClock(tl, 3).fade).toBe(0);
    expect(finalClock(tl, tl.realSec - k.fadeOutSec / 2).fade).toBeCloseTo(0.5, 5);
    const end = finalClock(tl, tl.realSec + k.holdSec / 2);
    expect(end).toMatchObject({ t: 107, fade: 1, done: false });
    expect(finalClock(tl, tl.realSec + k.holdSec).done).toBe(true);
  });
});

describe('pose interpolation', () => {
  /** A player running a curve at 20 Hz (positions on a circle, yaw along it). */
  const curve = (n = 30): KillcamFrame[] =>
    Array.from({ length: n }, (_, i) => {
      const a = i * 0.08;
      return { t: 10 + i * 0.05, p: [['k', Math.cos(a) * 10, 0, Math.sin(a) * 10, -a, 0, A]] };
    });

  it('is smooth between the 20 Hz frames: no speed jumps at the frames, closer to the true curve than straight lines', () => {
    const frames = curve();
    const dt = 0.005;
    let prevV: number | null = null;
    let maxJump = 0;
    let maxErr = 0;
    for (let t = 10.2; t < 11.1; t += dt) {
      const p = posesAt(frames, t).get('k')!;
      const q = posesAt(frames, t + dt).get('k')!;
      const v = Math.hypot(q.x - p.x, q.z - p.z) / dt;
      if (prevV !== null) maxJump = Math.max(maxJump, Math.abs(v - prevV));
      prevV = v;
      maxErr = Math.max(maxErr, Math.abs(Math.hypot(p.x, p.z) - 10));
    }
    // True speed is 0.08 rad / 0.05 s * 10 m = 16 m/s, steady.
    expect(maxJump).toBeLessThan(0.5);
    // A chord between two frames sags 10 * (1 - cos(0.04)) = 8 mm; the spline stays within 1 mm.
    expect(maxErr).toBeLessThan(0.001);
  });

  it('does not sweep through a respawn (a jump between two frames)', () => {
    const frames: KillcamFrame[] = [
      { t: 1, p: [['k', 0, 0, 0, 0, 0, 0]] },
      { t: 1.05, p: [['k', 0, 0, 0, 0, 0, 0]] },
      { t: 1.1, p: [['k', 40, 0, 40, 1, 0, A]] },
      { t: 1.15, p: [['k', 40.5, 0, 40, 1, 0, A]] },
    ];
    const mid = posesAt(frames, 1.07).get('k')!;
    expect(mid.x).toBe(0);
    expect(posesAt(frames, 1.09).get('k')!.x).toBe(40);
    // The spline doesn't overshoot back toward the old spot either.
    expect(posesAt(frames, 1.12).get('k')!.x).toBeGreaterThanOrEqual(40);
  });

  it('holds a killer or victim who left at their last pose; others vanish', () => {
    const frames: KillcamFrame[] = [
      { t: 1, p: [['k', 1, 0, 1, 0, 0, A], ['o', 5, 0, 5, 0, 0, A]] },
      { t: 1.05, p: [['k', 2, 0, 1, 0, 0, A], ['o', 5, 0, 5, 0, 0, A]] },
      { t: 1.1, p: [] },
      { t: 1.15, p: [] },
    ];
    const later = posesAt(frames, 1.14, new Set(['k']));
    expect(later.get('k')?.x).toBe(2);
    expect(later.has('o')).toBe(false);
  });
});

describe('the killer\'s gun', () => {
  let store: Store | undefined;
  let lobby: Lobby | undefined;
  beforeAll(() => registerModeRules());
  afterEach(() => {
    lobby?.shutdown();
    store?.close();
    lobby = store = undefined;
  });

  it('the replay shows the weapon model the killer held, from a real server clip (and switches with them)', () => {
    store = new Store(':memory:');
    lobby = new Lobby({ store, features: [modesFeature], log: () => {}, autoTick: false });
    const room: Room = lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, onEnd: 'close' });
    const a = room.addBot({ name: 'A', team: 0 });
    const b = room.addBot({ name: 'B', team: 1 });
    for (const p of [a, b]) p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: self.slot }) };
    const steps = (s: number) => {
      for (let i = 0; i < Math.round(s / TICK_DT); i++) room.step();
    };
    steps(4);
    const primary = a.weapons[0]!;
    const secondary = a.weapons[1];
    primary.camo = 'tiger';
    steps(1);
    if (secondary) {
      a.slot = 1; // switch to the pistol for the kill
      steps(0.5);
    }
    let got: FinalKillcamPayload | null = null;
    const orig = room.sendFeature.bind(room);
    room.sendFeature = ((to, id, data) => {
      if (id === 'modes.killcam') got = data as FinalKillcamPayload;
      orig(to, id, data);
    }) as Room['sendFeature'];
    room.teamScores[0] = room.mode.scoreLimit - 1;
    room.kill(b, a, { weapon: (secondary ?? primary).def.base.id, means: 'bullet', part: 'torso' });
    const k = got as unknown as FinalKillcamPayload;
    expect(k).toBeTruthy();
    const clip = unpackClip(k.clip);
    const held = secondary ?? primary;
    const atKill = replayGun(posesAt(clip.frames, k.at).get(a.id), k.vm)!;
    expect(atKill.weapon).toBe(held.def.base.id);
    expect(atKill.model).toBe(WEAPON_BY_ID.get(held.def.base.id)!.model ?? held.def.base.id);
    expect(atKill.attachments).toEqual([...held.def.attachmentIds]);
    if (secondary) {
      // A second before: still the primary, in its camo.
      const before = replayGun(posesAt(clip.frames, k.at - 1.2).get(a.id), k.vm)!;
      expect(before.weapon).toBe(primary.def.base.id);
      expect(before.camo).toBe('tiger');
    }
    // No gear recorded (an older clip): the gun at the kill.
    expect(replayGun({ gear: undefined }, { weapon: 'ak47', attachments: ['acog'], camo: 'none', suppressed: false })).toMatchObject({ weapon: 'ak47', attachments: ['acog'] });
    expect(replayGun({ gear: gearKey('l96a1', 'none', ['varzoom']) }, undefined)!.eff.scope).toBe(true);
  });
});

describe('projectiles and deaths', () => {
  const track = (id: number, owner: string, t0: number, t1: number, end: { x: number; z: number }): ProjectileTrack => ({
    id,
    kind: 'weapons.nade',
    sub: 'frag',
    owner,
    points: Array.from({ length: Math.round((t1 - t0) / 0.05) + 1 }, (_, i) => {
      const k = i / Math.round((t1 - t0) / 0.05);
      return { t: t0 + i * 0.05, x: end.x * k, y: 1 + Math.sin(k * Math.PI), z: end.z * k };
    }),
  });

  it('a grenade kill follows the killer\'s grenade that went off at the kill, nearest the victim', () => {
    const victim = { x: 0, y: 0, z: -10 };
    const tracks = [track(1, 'k', 1, 2.5, { x: 0, z: -10 }), track(2, 'k', 0, 1, { x: 20, z: 0 }), track(3, 'other', 1, 2.5, { x: 0, z: -10 })];
    expect(killProjectile(tracks, 'k', 2.5, victim)?.id).toBe(1);
    expect(killProjectile(tracks, 'k', 4, victim)).toBeNull(); // nothing ended near this kill
    const p = projectileAt(tracks[0]!, 1.75)!;
    expect(p.z).toBeLessThan(-4);
    expect(p.dz).toBeLessThan(0);
    expect(projectileAt(tracks[0]!, 3)).toBeNull();
  });

  it('a Thundergun kill throws the body away from the shooter; a frozen Winter\'s Howl kill shatters it', () => {
    const frames: KillcamFrame[] = [
      { t: 1, p: [['k', 0, 0, 0, 0, 0, A, 100, gearKey('thundergun')], ['v', 0, 0, -5, 0, 0, A, 100, gearKey('ak47')], ['f', 5, 0, 0, 0, 0, A, 100, gearKey('ak47'), 100]] },
      { t: 1.05, p: [['k', 0, 0, 0, 0, 0, A, 100, gearKey('wintershowl')], ['v', 0, 0, -5, 0, 0, 0, 0, gearKey('ak47')], ['f', 5, 0, 0, 0, 0, A, 100, gearKey('ak47'), 100]] },
      { t: 1.1, p: [['k', 0, 0, 0, 0, 0, A, 100, gearKey('wintershowl')], ['v', 0, 0, -5, 0, 0, 0, 0, gearKey('ak47')], ['f', 5, 0, 0, 0, 0, 0, 0, gearKey('ak47'), 100]] },
    ];
    const clip: UnpackedClip = {
      frames,
      shots: [
        { t: 1.04, id: 'k', end: [0, 1, -5], hit: true },
        { t: 1.09, id: 'k', end: [5, 1, 0], hit: true },
      ],
      gear: new Map([
        ['k', [
          { t: 1, gear: gearKey('thundergun') },
          { t: 1.05, gear: gearKey('wintershowl') },
        ]],
      ]),
      frost: new Map(),
      teams: new Map(),
      projectiles: [],
    };
    const fx = deathEffects({ killer: 'k', victim: 'v', weapon: 'thundergun', clip });
    expect(fx.get('v')).toMatchObject({ kind: 'fling', t: 1.05, dx: 0, dz: -1 });
    expect(fx.get('f')).toMatchObject({ kind: 'shatter', t: 1.1 });
    expect(fx.has('k')).toBe(false);
  });
});

describe('winner line', () => {
  const base = { mode: 'tdm', players: [{ id: 'me', name: 'Me' }, { id: 'x', name: 'Rex' }] } as unknown as MatchResults;
  it('names the winning team or player, and whether I won', () => {
    expect(winnerLine({ ...base, winnerTeam: 1, winners: ['x'] }, 'me')).toEqual({ text: 'BLACK OPS WIN', mine: false });
    expect(winnerLine({ ...base, winnerTeam: 0, winners: ['me'] }, 'me')).toEqual({ text: 'SPETSNAZ WIN', mine: true });
    expect(winnerLine({ ...base, mode: 'ffa', winnerTeam: null, winners: ['x'] }, 'me')).toEqual({ text: 'REX WINS', mine: false });
    expect(winnerLine({ ...base, winnerTeam: null, winners: [] }, 'me')).toEqual({ text: 'DRAW', mine: null });
  });
});
