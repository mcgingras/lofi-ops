/**
 * Headshots on zombies ("headshots don't seem to do more damage?"). Two causes, both covered:
 *
 * 1. Damage: our guns carry multiplayer head multipliers (x1.4 for ARs, SMGs and pistols, x1 for
 *    shotguns), and `ZOMBIE_DAMAGE` scaled head and body alike, so a head took 2 MP5K rounds in
 *    round 1 like the body did. BO1 Zombies' weapon files hit the head x3-x10 (`ZOMBIE_PARTS`).
 * 2. Pose: the shamble leaned the whole body up to 0.37 rad about the feet, drawing the head
 *    0.2-0.5 m in front of its hitbox, so a shot at the drawn head from off-axis missed the head
 *    box. The pose now stays inside it (`ZOMBIE_POSE`).
 *
 * Real rooms: a survivor fires at a zombie bot (spread off, so the bullet goes where it's aimed).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { undeadOf } from '../src/server/features/zombies/state';
import type { PlayerState } from '../src/server/player';
import { playerHitboxes, rayHitboxes, type HitPart } from '../src/shared/collision';
import { WEAPON_BY_ID } from '../src/shared/defs/weapons';
import { legacyZombieHeadCenter, killPoints, ZOMBIE_PARTS, ZOMBIE_POSE, zombieBulletDamage, zombieHeadCenter, zombieHealth, zombiePose } from '../src/shared/defs/zombies';
import { eyeHeight } from '../src/shared/movement';
import { arm, human, place, startRound, steps, zmClose, zmRoom, type ZmWorld } from './zombies-helpers';

let w: ZmWorld | undefined;
afterEach(() => {
  zmClose(w);
  w = undefined;
});

/** World point of a body-frame offset (right `x`, up `y`, ahead `z`) for a body at `p` facing `yaw`. */
const bodyPoint = (p: { x: number; y: number; z: number }, yaw: number, o: { x: number; y: number; z: number }) => ({
  x: p.x + Math.cos(yaw) * o.x - Math.sin(yaw) * o.z,
  y: p.y + o.y,
  z: p.z - Math.sin(yaw) * o.x - Math.cos(yaw) * o.z,
});

const GUNS = ['mp5k', 'ak74u', 'm16', 'mpl', 'commando', 'm1911', 'asp', 'rpk', 'l96a1', 'dragunov'];

describe('headshot damage against zombies (BO1 zombie weapon multipliers)', () => {
  it('heads take the BO1 multiplier: x4 ARs / SMGs, x3.5 pistols, x3 LMGs, x10 snipers', () => {
    for (const id of GUNS) {
      const def = WEAPON_BY_ID.get(id)!;
      const zm = ZOMBIE_PARTS.byWeapon[id] ?? ZOMBIE_PARTS.byClass[def.class]!;
      const head = zombieBulletDamage(id, 'head');
      const body = zombieBulletDamage(id, 'torso');
      expect(head / body, id).toBeCloseTo(zm.head / (zm.torso ?? def.multipliers.torso), 6);
      expect(head / body, id).toBeGreaterThanOrEqual(2.3);
    }
    // Shotguns: no head bonus in BO1 either (N/A); the Python's head and chest are both x1.5.
    expect(zombieBulletDamage('olympia', 'head')).toBe(zombieBulletDamage('olympia', 'torso'));
    expect(zombieBulletDamage('python', 'head')).toBeCloseTo(zombieBulletDamage('python', 'torso'), 6);
  });

  it('clearly fewer bullets to the head: round 1 one-shot heads, round 10 a third of the body count', () => {
    const shots = (id: string, part: HitPart, round: number) => Math.ceil(zombieHealth(round) / zombieBulletDamage(id, part));
    for (const id of ['mp5k', 'ak74u', 'm16', 'mpl', 'commando']) {
      expect(shots(id, 'head', 1), id).toBe(1);
      expect(shots(id, 'torso', 1), id).toBe(2);
      expect(shots(id, 'head', 10), id).toBeLessThanOrEqual(Math.ceil(shots(id, 'torso', 10) / 3));
    }
    // The M1911: BO1's 20 a round, x1.25 chest (6 to the body in round 1), x3.5 head (3).
    expect(shots('m1911', 'torso', 1)).toBe(6);
    expect(shots('m1911', 'head', 1)).toBe(3);
  });
});

describe('the zombie pose stays inside its hitboxes', () => {
  it('the drawn head is inside the head box at every speed, phase and facing (the old lean was not)', () => {
    const hb = playerHitboxes({ x: 0, y: 0, z: 0 }, 'stand');
    for (const speed of [0, 1.35, 3.1, 4.7]) {
      for (let ph = 0; ph < Math.PI * 4; ph += 0.1) {
        const c = zombieHeadCenter(zombiePose(speed, ph));
        for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 12) {
          const p = bodyPoint({ x: 0, y: 0, z: 0 }, yaw, c);
          expect(p.x).toBeGreaterThan(hb.head.min.x);
          expect(p.x).toBeLessThan(hb.head.max.x);
          expect(p.z).toBeGreaterThan(hb.head.min.z);
          expect(p.z).toBeLessThan(hb.head.max.z);
          expect(p.y).toBeGreaterThan(hb.head.min.y);
          expect(p.y).toBeLessThan(hb.head.max.y);
        }
      }
    }
    // Before: a running zombie's head was drawn 0.4 m ahead of the hitbox; seen from 45 degrees
    // off its facing, a ray through the drawn head missed the head box.
    const old = legacyZombieHeadCenter(3.1);
    expect(old.z).toBeGreaterThan(0.35);
    const yaw = Math.PI / 4;
    const at = bodyPoint({ x: 0, y: 0, z: 0 }, yaw, old);
    const eye = { x: at.x + 10, y: 1.6, z: at.z };
    const d = { x: at.x - eye.x, y: at.y - eye.y, z: at.z - eye.z };
    const l = Math.hypot(d.x, d.y, d.z);
    const hit = rayHitboxes(eye, { x: d.x / l, y: d.y / l, z: d.z / l }, hb, 20);
    expect(hit?.part).not.toBe('head');
  });
});

describe('a real room: shots at a zombie bot', () => {
  function range(): { h: PlayerState; z: PlayerState; hits: { part: HitPart | null; amount: number }[] } {
    w = zmRoom('nuketown');
    const h = human(w.room);
    startRound(w);
    const g = w.g;
    g.queue = 0;
    expect(g.spawnOne('zombie')).toBe(true);
    const z = g.aliveUndead().at(-1)!;
    g.horde.frozen = true;
    // No spread: the bullet goes where it's aimed.
    w.room.modifiers.add('spreadMultiplier', () => 0, 'test.nospread');
    const hits: { part: HitPart | null; amount: number }[] = [];
    w.room.bus.on('damage', (e) => {
      if (e.victim === z) hits.push({ part: e.part ?? null, amount: e.amount });
    });
    return { h, z, hits };
  }

  /** Put the zombie 8 m away facing `rel` radians off the line to the shooter, and fire at `at` (body frame). */
  function shoot(h: PlayerState, z: PlayerState, rel: number, at: { x: number; y: number; z: number }, gun: string) {
    const room = w!.room;
    place(room, h, 8, 22, 0);
    place(room, z, 8, 14, 0);
    // The zombie faces the shooter (yaw 0 faces -z; the shooter is at +z), turned by `rel`.
    z.yaw = Math.PI + rel;
    z.health = z.maxHealth = 1e6;
    arm(room, h, gun);
    const target = bodyPoint(z.move, z.yaw, at);
    const eye = { x: h.move.x, y: h.move.y + eyeHeight(h.move), z: h.move.z };
    const d = { x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z };
    const l = Math.hypot(d.x, d.y, d.z);
    for (const wpn of h.weapons) wpn.credit = 2;
    return room.fire(h, { dir: { x: d.x / l, y: d.y / l, z: d.z / l }, origin: eye, shot: 7 });
  }

  it('a shot at the drawn head registers on the head and does at least the BO1 multiplier, from any side', () => {
    const { h, z, hits } = range();
    for (const gun of ['mp5k', 'ak74u', 'm16', 'm1911']) {
      for (const rel of [0, Math.PI / 6, Math.PI / 3, Math.PI / 2, -Math.PI / 4]) {
        for (const speed of [0, 3.1]) {
          hits.length = 0;
          const head = zombieHeadCenter(zombiePose(speed, 1.3));
          expect(shoot(h, z, rel, head, gun).ok).toBe(true);
          expect(hits.length, `${gun} ${rel}`).toBe(1);
          expect(hits[0]!.part, `${gun} rel ${rel.toFixed(2)} speed ${speed}`).toBe('head');
          const headDmg = hits[0]!.amount;
          hits.length = 0;
          expect(shoot(h, z, rel, { x: 0, y: 1.2, z: 0 }, gun).ok).toBe(true);
          expect(hits[0]!.part).toBe('torso');
          const bodyDmg = hits[0]!.amount;
          const def = WEAPON_BY_ID.get(gun)!;
          const zm = ZOMBIE_PARTS.byWeapon[gun] ?? ZOMBIE_PARTS.byClass[def.class]!;
          expect(headDmg / bodyDmg).toBeGreaterThanOrEqual(zm.head / (zm.torso ?? 1) - 1e-6);
          expect(headDmg).toBeCloseTo(zombieBulletDamage(gun, 'head', w!.g.difficulty), 3);
        }
      }
    }
    void undeadOf(z);
  });

  it('a head kill pays 100 and pops the head (killfeed headshot); the client hitmarker gets part "head"', () => {
    const { h, z } = range();
    const sent: { part: string; kill: boolean }[] = [];
    const sess = h.session!;
    const orig = sess.send.bind(sess);
    sess.send = (m: { t: string; part?: string; kill?: boolean }) => {
      if (m.t === 'hit') sent.push({ part: m.part!, kill: !!m.kill });
      return orig(m as never);
    };
    const feed: { headshot: boolean }[] = [];
    w!.room.bus.on('death', (e) => {
      if (e.victim === z) feed.push({ headshot: e.headshot });
    });
    const before = h.ext.zombies && 'points' in h.ext.zombies ? h.ext.zombies.points : 0;
    shoot(h, z, Math.PI / 4, zombieHeadCenter(zombiePose(1.35, 0)), 'mp5k');
    // shoot() set the zombie's health high: this time leave it at round-1 health.
    z.health = z.maxHealth = zombieHealth(1);
    for (const wpn of h.weapons) wpn.credit = 2;
    sent.length = 0;
    const target = bodyPoint(z.move, z.yaw, zombieHeadCenter(zombiePose(1.35, 0)));
    const eye = { x: h.move.x, y: h.move.y + eyeHeight(h.move), z: h.move.z };
    const d = { x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z };
    const l = Math.hypot(d.x, d.y, d.z);
    w!.room.fire(h, { dir: { x: d.x / l, y: d.y / l, z: d.z / l }, origin: eye, shot: 9 });
    expect(z.alive).toBe(false);
    expect(sent).toEqual([{ part: 'head', kill: true }]);
    expect(feed).toEqual([{ headshot: true }]);
    const after = h.ext.zombies && 'points' in h.ext.zombies ? h.ext.zombies.points : 0;
    // +10 for the first (non-lethal) hit, then the kill: 50 + 50 head.
    expect(after - before).toBe(10 + killPoints('head', 'bullet'));
  });

  it('climbing out of the ground the body is crouched (the drawn head is low), then stands', () => {
    w = zmRoom('nuketown');
    human(w.room);
    startRound(w);
    w.g.queue = 0;
    expect(w.g.spawnOne('zombie')).toBe(true);
    const z = w.g.aliveUndead().at(-1)!;
    const x0 = z.move.x;
    steps(w.room, 0.2);
    expect(z.move.crouched).toBe(true);
    steps(w.room, ZOMBIE_POSE.riseCrouchSec);
    expect(z.move.crouched).toBe(false);
    // Still for the whole climb.
    expect(Math.abs(z.move.x - x0)).toBeLessThan(0.05);
  });
});
