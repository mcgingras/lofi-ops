/** Per-death killcam playback maths: the room-time timeline (beat, play, cut at respawn), timer text, aim and card text. */
import { describe, expect, it } from 'vitest';
import { aimAt, cardLines, deathcamClock, killcamTimer } from '../src/client/features/modes/deathcam-math';
import { posesAt } from '../src/client/features/modes/killcam-math';
import { DEATHCAM, deathcamWindow, packClip, unpackClip } from '../src/shared/defs/deathcam';
import type { KillcamFrame } from '../src/shared/defs/modestate';
import { viewDir } from '../src/shared/math';

describe('deathcam timeline', () => {
  it('death view, then 1x replay that ends at the clip end or the respawn, whichever is first', () => {
    // TDM: kill at 10, respawn at 13 -> clip 8.5..10.5 plays 11..13.
    const at = 10;
    const respawnAt = at + 3;
    const w = deathcamWindow(at, respawnAt)!;
    const playAt = at + DEATHCAM.beatSec;
    expect(deathcamClock(playAt, respawnAt, w.from, w.to, 10.4)).toMatchObject({ state: 'beat', left: 2 });
    const mid = deathcamClock(playAt, respawnAt, w.from, w.to, 12);
    expect(mid.state).toBe('play');
    expect(mid.t).toBeCloseTo(9.5, 5); // half a second before the kill
    expect(mid.left).toBeCloseTo(1, 5);
    expect(deathcamClock(playAt, respawnAt, w.from, w.to, 12.6).t).toBeCloseTo(10.1, 5); // past the kill
    expect(deathcamClock(playAt, respawnAt, w.from, w.to, 13).state).toBe('done'); // at the respawn
    // A respawn that came sooner than the server planned for still cuts the replay.
    expect(deathcamClock(playAt, 12, w.from, w.to, 12).state).toBe('done');
    expect(deathcamClock(playAt, 12, w.from, w.to, 11.5).left).toBeCloseTo(0.5, 5);
    // No respawn (S&D): the whole clip.
    const sd = deathcamWindow(at, null)!;
    expect(deathcamClock(playAt, null, sd.from, sd.to, playAt + 3.9).state).toBe('play');
    expect(deathcamClock(playAt, null, sd.from, sd.to, playAt + 4).state).toBe('done');
  });

  it('a clip that arrives late starts part-way, still ending on time', () => {
    const c = deathcamClock(11, 13, 8.5, 10.5, 11.8);
    expect(c.t).toBeCloseTo(9.3, 5);
    expect(c.left).toBeCloseTo(1.2, 5);
  });

  it('timer, aim and killer card text', () => {
    expect(killcamTimer(1.43)).toBe('0:01.5');
    expect(killcamTimer(0)).toBe('0:00.0');
    expect(killcamTimer(4)).toBe('0:04.0');
    const a = { x: 0, y: 10, z: 0 };
    const b = { x: 3, y: 4, z: -4 };
    const { yaw, pitch } = aimAt(a, b);
    const d = viewDir(yaw, pitch);
    const len = Math.hypot(3, -6, -4);
    expect(d.x).toBeCloseTo(3 / len, 5);
    expect(d.y).toBeCloseTo(-6 / len, 5);
    expect(d.z).toBeCloseTo(-4 / len, 5);
    const names = { weapon: (id: string) => (id === 'ak47' ? 'AK-47' : id), attachment: (id: string) => (id === 'grip' ? 'Grip' : 'Red Dot'), rank: () => 'Sergeant' };
    const card = { name: 'Rex', bot: false, level: 23, prestige: 0, weapon: 'ak47', attachments: ['reflex', 'grip'], health: 37, maxHealth: 100, streak: 4 };
    expect(cardLines(card, names)).toEqual({ rank: 'SERGEANT · LV 23', weapon: 'AK-47', attachments: 'RED DOT + GRIP', health: '37% HEALTH', healthFrac: 0.37 });
    expect(cardLines({ ...card, prestige: 2, health: 0 }, names)).toMatchObject({ rank: 'PRESTIGE 2 · LV 23', health: 'DEAD', healthFrac: 0 });
  });

  it('packed clips replay through the final killcam interpolation', () => {
    const frames: KillcamFrame[] = [
      { t: 5, p: [['k', 0, 0, 0, 0, 0, 1, 80]] },
      { t: 5.05, p: [['k', 1, 0, 0, 0.1, 0, 1, 60]] },
    ];
    const back = unpackClip(packClip(frames)).frames;
    const p = posesAt(back, 5.025).get('k')!;
    expect(p.x).toBeCloseTo(0.5, 5);
    expect(p.yaw).toBeCloseTo(0.05, 5);
    expect(p.hp).toBe(80);
  });
});
