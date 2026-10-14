/**
 * Valkyrie Rockets, BO1's TV-guided missile (`m220_tow_mp`; see shared/defs/valkyrie.ts for the
 * sources). Three stages:
 *
 * 1. The drop (`callValkyrieDrop`): the earned streak is a supply drop marker like the Care
 *    Package (`m220_tow_drop_mp`): the Chinook drops a crate that holds the launcher. Taking it
 *    puts `VALKYRIE_LAUNCHER` in the ready list (so does a Care Package that rolled the Valkyrie).
 * 2. The launcher (`raiseLauncher`): STREAK with the launcher selected brings it up in place of the
 *    gun (`ks.launcher`, 2 rockets). STREAK again, a weapon switch, a grenade or the knife puts it
 *    away: before the first shot the streak is kept, after it the spare rocket is lost (BO1
 *    `checkIfSwitchableWeapon` / `watchKillsteakWeaponSwitch`). Dying loses it the same way.
 * 3. The rockets (`fireLauncher`, one `Active` per launcher): FIRE launches one from the eye along
 *    the aim; the first shot uses the streak and tells everyone it is inbound. While it flies the
 *    owner's view rides it (`ks.control`), their body stands still and can be killed, look steers
 *    it (`stepRocket`: turn rate, no gravity), holding boost speeds it up, FIRE detonates it, and
 *    it blows up on whatever it hits (the world, a player, an aircraft) or when its fuel runs out
 *    or it stays out of the play area for 2 s. The camera holds on the blast for 1 s, then the
 *    owner is back with the launcher, which reloads (3 s) before the second rocket.
 *
 * The rocket is hardware: any bullet (over 5 damage) or a SAM missile destroys it, and it then
 * detonates as BO1's did. If the owner dies it flies on dead straight and they don't respawn until
 * it is gone plus 2 s (BO1 `killstreak_waitamount` / `WaitTillKillStreakDone`); if they leave it
 * detonates.
 * Bots raise the launcher through the same API; the feature aims and fires for them and steers
 * their rockets at the nearest enemy with a skill-scaled error.
 */
import { playerHitboxes, rayHitboxes } from '../../../../shared/collision';
import { KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { dirAngles, rocketLaunch, rocketOutOfBounds, signalWhite, stepRocket, VALKYRIE, VALKYRIE_LAUNCHER, type RocketState } from '../../../../shared/defs/valkyrie';
import { Buttons } from '../../../../shared/input';
import { viewDir, type Vec3 } from '../../../../shared/math';
import { eyeOf } from '../../../combat';
import type { Entity } from '../../../entities';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import { botStreakSkill } from '../skill';
import { ksOf, markDirty } from '../state';
import { chestOf, ksRoom, raySphere, type Active, type KsRoom } from '../world';
import { callCarePackage } from './package';
import type { CallArgs } from './types';

export { VALKYRIE, VALKYRIE_LAUNCHER };

/**
 * The boost bit on the wire. BO1 boosts with the tactical-grenade button; the client sends that
 * (Q / LB, or ADS: right mouse / LT) as ADS while steering and drops the TACTICAL bit, so the body
 * standing in the world doesn't throw a grenade. See docs/features/perks-streaks.md.
 */
export const BOOST_BUTTON = Buttons.ADS;

/** The earned streak: a supply drop whose crate holds the launcher (BO1 `m220_tow_drop_mp`). */
export function callValkyrieDrop(ctx: KsRoom, p: PlayerState, args: CallArgs): string | null {
  // Bots don't hold a canister: their drop comes down where they stand.
  const at = args.launch ? args : { ...args, target: p.isBot || !args.target ? { x: p.move.x, y: p.move.y, z: p.move.z } : args.target };
  return callCarePackage(ctx, p, at, { contents: 'valkyrie' });
}

/** STREAK with the launcher selected: it comes up in place of the gun (the streak stays ready until the first shot). */
export function raiseLauncher(room: Room, p: PlayerState): string | null {
  const ks = ksOf(p);
  if (!p.alive) return 'dead';
  if (ks.control || ks.launcher) return 'busy';
  if (!ks.ready.includes(VALKYRIE_LAUNCHER)) return 'not_ready';
  ks.launcher = { left: VALKYRIE.rockets, ready: room.time + VALKYRIE.raiseSec, fired: false, aimAt: null };
  p.reloadEnd = 0;
  markDirty(room, p);
  return null;
}

/** Put the launcher away (weapon switch, grenade, knife, STREAK, death): before the first shot the streak is kept, after it the spare is lost. */
export function putAwayLauncher(room: Room, p: PlayerState): void {
  const ks = p.ext.killstreaks;
  const l = ks?.launcher;
  if (!ks || !l) return;
  // Nothing comes out of your hands while your view rides a rocket (or holds on its blast).
  if (ks.control?.id === 'valkyrie' && p.alive) return;
  ks.launcher = null;
  markDirty(room, p);
  if (p.alive) p.swapEnd = Math.max(p.swapEnd, room.time + PUT_AWAY_SEC);
}

/** The gun comes back up this long after the launcher goes away. */
const PUT_AWAY_SEC = 0.5;

/** FIRE with the launcher up: launch a rocket (the first one uses the streak). */
export function fireLauncher(room: Room, p: PlayerState, aim?: { yaw: number; pitch: number }): boolean {
  const ks = ksOf(p);
  const l = ks.launcher;
  if (!l || !p.alive || room.phase !== 'playing' || ks.control || room.time < l.ready - 1e-6 || l.left <= 0) return false;
  const ctx = ksRoom(room);
  if (!l.fired) {
    const idx = ks.ready.indexOf(VALKYRIE_LAUNCHER);
    if (idx < 0) {
      ks.launcher = null;
      markDirty(room, p);
      return false;
    }
    ks.ready.splice(idx, 1);
    ks.selected = Math.max(0, Math.min(ks.selected, ks.ready.length - 1));
    l.fired = true;
    // BO1 `watchKillstreakWeaponUsage`: the first shot is when everyone hears the rockets are inbound
    // (the streak was called, `killstreaks.called` on the bus, when the drop was thrown).
    room.sendFeature(null, 'killstreaks.called', { id: 'valkyrie', owner: p.id, team: p.team });
  }
  let run = runs.get(p);
  if (!run || run.act.done) {
    run = new ValkyrieRun(ctx, p);
    runs.set(p, run);
    ctx.add(run.act);
  }
  run.launch(aim ?? { yaw: p.yaw, pitch: p.pitch });
  markDirty(room, p);
  return true;
}

/** The owner died: the launcher (and its spare) is gone; a rocket in flight flies on unguided. */
export function onOwnerDeath(room: Room, p: PlayerState): void {
  const ks = p.ext.killstreaks;
  if (!ks) return;
  const run = runs.get(p);
  if (run) {
    run.orphan();
    // A launcher from a later crate gets a run of its own while this rocket finishes.
    runs.delete(p);
  }
  if (ks.control?.id === 'valkyrie') ks.control = null;
  if (ks.launcher) ks.launcher = null;
  markDirty(room, p);
}

/** Per player, the launcher's run (its rockets) while it has one. */
const runs = new WeakMap<PlayerState, ValkyrieRun>();

/** The rocket a kill by `owner` came from, for the killcam: its flight path (room time, position). */
export interface RocketTrack {
  points: { t: number; x: number; y: number; z: number }[];
  /** Room time it exploded (or null while it flies). */
  end: number | null;
}

const tracks = new WeakMap<Room, Map<string, RocketTrack>>();

/** The latest Valkyrie rocket path of `ownerId` (killcam: the deathcam follows it). */
export function rocketTrack(room: Room, ownerId: string): RocketTrack | null {
  return tracks.get(room)?.get(ownerId) ?? null;
}

/** An owner killed while their rocket flew respawns this long after it is gone (BO1 `WaitTillKillStreakDone`). */
const RESPAWN_AFTER_ROCKET = 2;

/** Seconds of path kept for the killcam (longer than any clip). */
const TRACK_SEC = 6;

interface Flight {
  ent: Entity;
  st: RocketState;
  /** Steered by its owner (false once they died: dead straight). */
  guided: boolean;
  outSince: number | null;
  backAt: number | null;
  backFrom: number;
  track: RocketTrack;
  lastTrack: number;
  /** Bots: this rocket's steering error (unit-vector offset), from their skill. */
  bias: Vec3;
  /** The boost button was let go since the launch (BO1 needs that before boosting). */
  boostArmed: boolean;
}

/** One launcher's rockets, from the first shot until the last rocket is done (or the launcher is lost). */
class ValkyrieRun {
  readonly act: Active;
  private flight: Flight | null = null;
  private holdUntil = 0;
  private prevButtons: number;
  private orphaned = false;

  constructor(
    private ctx: KsRoom,
    private p: PlayerState,
  ) {
    this.prevButtons = p.buttons;
    this.act = {
      streak: 'valkyrie',
      owner: p,
      entities: [],
      update: (dt) => this.update(dt),
      cleanup: () => this.cleanup(),
    };
  }

  private get room(): Room {
    return this.ctx.room;
  }

  launch(aim: { yaw: number; pitch: number }): void {
    const room = this.room;
    const p = this.p;
    const ks = ksOf(p);
    const l = ks.launcher!;
    l.left--;
    l.aimAt = null;
    const eye = eyeOf(p);
    // Out of the muzzle, unless that point is already inside a wall: then from the eye.
    let st = rocketLaunch(eye, aim.yaw, aim.pitch);
    const dir = st.dir;
    if (room.world.raycast(eye, dir, VALKYRIE.muzzle + VALKYRIE.radius, 'bullets')) st = rocketLaunch(eye, aim.yaw, aim.pitch, 0);
    const a = dirAngles(st.dir);
    const ent = room.entities.add({ kind: KS_ENTITY.rocket, x: st.pos.x, y: st.pos.y, z: st.pos.z, yaw: a.yaw, owner: p.id, team: p.team, s: rocketSnap(st, 0) });
    this.act.entities.push(ent.id);
    const track: RocketTrack = { points: [{ t: room.time, x: st.pos.x, y: st.pos.y, z: st.pos.z }], end: null };
    let byOwner = tracks.get(room);
    if (!byOwner) tracks.set(room, (byOwner = new Map()));
    byOwner.set(p.id, track);
    const err = p.isBot ? (1 - botStreakSkill(p)) * VALKYRIE.botError : 0;
    const bias = { x: (Math.random() - 0.5) * err, y: (Math.random() - 0.5) * err * 0.5, z: (Math.random() - 0.5) * err };
    this.flight = { ent, st, guided: true, outSince: null, backAt: null, backFrom: 0, track, lastTrack: room.time, bias, boostArmed: (p.buttons & BOOST_BUTTON) === 0 };
    this.prevButtons = p.buttons;
    ks.control = { id: 'valkyrie', entity: ent.id, until: room.time + st.fuel };
    room.sendFeature(null, 'killstreaks.fx', { kind: 'rocket_launch', x: round(st.pos.x), y: round(st.pos.y), z: round(st.pos.z) });
    this.ctx.damageable(ent, {
      hp: VALKYRIE.hp,
      air: true,
      radius: VALKYRIE.hitRadius,
      yOff: 0,
      active: this.act,
      score: 100, // BO1 "Off The Air" medal
      onDestroyed: () => {
        // `MissileDamageWatcher`: shot down, it detonates where it is.
        const f = this.flight;
        if (f && f.ent === ent) this.explode({ x: ent.x, y: ent.y, z: ent.z });
      },
    });
  }

  /**
   * The owner died mid-flight: the rocket flies on dead straight (BO1 doesn't detonate it), the
   * launcher is gone, and their respawn waits for the rocket (then 2 s more).
   */
  orphan(): void {
    this.orphaned = true;
    this.holdUntil = 0;
    const f = this.flight;
    if (!f) return;
    f.guided = false;
    const p = this.p;
    if (!p.alive && p.respawnAt !== null) {
      this.heldRespawn = p.respawnAt;
      p.respawnAt = null;
    }
  }

  /** The owner's respawn time while it waits for an orphaned rocket. */
  private heldRespawn: number | null = null;

  private update(dt: number): boolean {
    const room = this.room;
    const p = this.p;
    const inRoom = room.players.get(p.id) === p;
    const ks = ksOf(p);
    const pressed = p.buttons & ~this.prevButtons;
    this.prevButtons = p.buttons;
    const f = this.flight;
    if (f) {
      if (!inRoom) {
        // `WatchOwnerDisconnect`: the rocket detonates.
        this.explode({ x: f.ent.x, y: f.ent.y, z: f.ent.z });
        return false;
      }
      this.fly(f, dt, f.guided && p.alive ? pressed : 0);
      return true;
    }
    if (!inRoom || this.orphaned || !p.alive) return false;
    if (this.holdUntil > 0) {
      if (room.time < this.holdUntil) return true;
      // Back in your body: the launcher reloads before the next rocket, or goes away when empty.
      this.holdUntil = 0;
      if (ks.control?.id === 'valkyrie') ks.control = null;
      const l = ks.launcher;
      if (l && l.left > 0) l.ready = room.time + VALKYRIE.reloadSec;
      else if (l) {
        ks.launcher = null;
        p.swapEnd = Math.max(p.swapEnd, room.time + PUT_AWAY_SEC);
      }
      markDirty(room, p);
    }
    const l = ks.launcher;
    return !!l && l.left > 0;
  }

  private fly(f: Flight, dt: number, pressed: number): void {
    const room = this.room;
    const p = this.p;
    if (pressed & Buttons.FIRE) {
      // FIRE detonates it in the air.
      this.explode({ x: f.ent.x, y: f.ent.y, z: f.ent.z });
      return;
    }
    let want: Vec3 | null = null;
    let boost = false;
    if (f.guided && p.alive) {
      if (p.isBot) {
        want = botSteer(this.ctx, p, f);
        // Skilled bots boost on the long straight run in, and let go to turn in at the end.
        const t = want ? this.ctx.targetsFor(p, KS_ENTITY.rocket, f.st.pos, 400, false)[0] : undefined;
        boost = !!t && botStreakSkill(p) > 0.5 && Math.hypot(t.move.x - f.st.pos.x, t.move.z - f.st.pos.z) > 30;
      } else {
        want = viewDir(p.yaw, p.pitch);
        const held = (p.buttons & BOOST_BUTTON) !== 0;
        if (!held) f.boostArmed = true;
        boost = held && f.boostArmed;
      }
    }
    const next = stepRocket(f.st, want, boost, dt);
    const from = f.st.pos;
    const seg = { x: next.pos.x - from.x, y: next.pos.y - from.y, z: next.pos.z - from.z };
    const segLen = Math.hypot(seg.x, seg.y, seg.z);
    const dir = segLen > 1e-9 ? { x: seg.x / segLen, y: seg.y / segLen, z: seg.z / segLen } : next.dir;
    const hit = this.impact(from, dir, segLen + VALKYRIE.radius);
    if (hit) {
      const t = Math.max(0, hit.t - VALKYRIE.radius);
      if (hit.entity !== undefined) this.ctx.hurtEntity(hit.entity, 5000, p);
      this.explode({ x: from.x + dir.x * t, y: from.y + dir.y * t, z: from.z + dir.z * t });
      return;
    }
    f.st = next;
    const e = f.ent;
    e.x = next.pos.x;
    e.y = next.pos.y;
    e.z = next.pos.z;
    // Out of the play area: the feed fades to white and it blows after 2 s; back in, it fades in over 1 s.
    if (rocketOutOfBounds(next.pos, room.map.bounds, this.ctx.groundY)) {
      f.outSince ??= room.time;
      f.backAt = null;
    } else if (f.outSince !== null) {
      f.backFrom = signalWhite(room.time - f.outSince, null);
      f.outSince = null;
      f.backAt = room.time;
    }
    const white = signalWhite(f.outSince === null ? null : room.time - f.outSince, f.backAt === null ? null : room.time - f.backAt, f.backFrom);
    if (f.backAt !== null && white <= 0) f.backAt = null;
    e.yaw = dirAngles(next.dir).yaw;
    e.s = { ...rocketSnap(next, white), hp: e.s?.hp ?? 1 };
    if (room.time - f.lastTrack >= 0.05 - 1e-6) {
      f.lastTrack = room.time;
      f.track.points.push({ t: room.time, x: e.x, y: e.y, z: e.z });
      while (f.track.points.length > 2 && f.track.points[0]!.t < room.time - TRACK_SEC) f.track.points.shift();
    }
    const ks = ksOf(p);
    if (ks.control?.entity === e.id) ks.control.until = room.time + Math.max(0, next.fuel);
    if (next.fuel <= 0 || (f.outSince !== null && room.time - f.outSince >= VALKYRIE.outOfBoundsSec - 1e-6)) this.explode(next.pos);
    else if (ks.control?.entity === e.id && Math.floor((room.time - dt) * 4) !== Math.floor(room.time * 4)) markDirty(room, p);
  }

  /** The first thing a rocket moving `len` along `dir` from `o` hits: the world, a player, or an aircraft. */
  private impact(o: Vec3, dir: Vec3, len: number): { t: number; entity?: number } | null {
    const room = this.room;
    let best: { t: number; entity?: number } | null = null;
    const wall = room.world.raycast(o, dir, len, 'bullets');
    if (wall) best = { t: wall.t };
    for (const q of room.players.values()) {
      if (!q.alive || q === this.p) continue;
      const h = rayHitboxes(o, dir, playerHitboxes({ x: q.move.x, y: q.move.y, z: q.move.z }, q.move.crouched), len);
      if (h && (!best || h.t < best.t)) best = { t: h.t };
    }
    // Aircraft: one rocket brings any of them down (BO1). Other rockets don't collide.
    for (const [id, d] of this.ctx.hp) {
      if (!d.air || this.act.entities.includes(id)) continue;
      const e = room.entities.get(id);
      if (!e || e.kind === KS_ENTITY.rocket) continue;
      const t = raySphere(o, dir, { x: e.x, y: e.y + d.yOff, z: e.z }, d.radius + VALKYRIE.radius);
      if (t !== null && t <= len && (!best || t < best.t)) best = { t, entity: this.ctx.sameSide(this.p, d.active.owner) ? undefined : id };
    }
    return best;
  }

  /** Blow the rocket up at `at` (credited to its owner, alive or not), then hold the camera there. */
  private explode(at: Vec3): void {
    const f = this.flight;
    if (!f) return;
    this.flight = null;
    const room = this.room;
    const p = this.p;
    f.track.points.push({ t: room.time, x: at.x, y: at.y, z: at.z });
    f.track.end = room.time;
    this.ctx.removeEntity(f.ent.id);
    const i = this.act.entities.indexOf(f.ent.id);
    if (i >= 0) this.act.entities.splice(i, 1);
    const ks = ksOf(p);
    const steering = ks.control?.entity === f.ent.id;
    if (steering) {
      ks.control = { id: 'valkyrie', entity: f.ent.id, until: room.time + VALKYRIE.holdSec, hold: { until: room.time + VALKYRIE.holdSec, x: round(at.x), y: round(at.y), z: round(at.z) } };
      markDirty(room, p);
    }
    this.holdUntil = steering && p.alive && !this.orphaned ? room.time + VALKYRIE.holdSec : 0;
    if (this.heldRespawn !== null) {
      if (!p.alive && p.respawnAt === null && room.players.get(p.id) === p) p.respawnAt = Math.max(this.heldRespawn, room.time + RESPAWN_AFTER_ROCKET);
      this.heldRespawn = null;
    }
    this.ctx.blast(at, VALKYRIE.blast.r, VALKYRIE.blast.max, VALKYRIE.blast.min, p, 'valkyrie', { fx: 'bigboom' });
  }

  private cleanup(): void {
    const room = this.room;
    const p = this.p;
    const f = this.flight;
    // Owner left (or the match is being torn down): a rocket still in the air goes off where it is.
    if (f && room.phase === 'playing' && room.players.get(p.id) !== p) this.explode({ x: f.ent.x, y: f.ent.y, z: f.ent.z });
    this.flight = null;
    const ks = p.ext.killstreaks;
    if (ks?.control?.id === 'valkyrie') {
      ks.control = null;
      markDirty(room, p);
    }
    if (ks?.launcher?.fired) {
      ks.launcher = null;
      markDirty(room, p);
    }
    if (runs.get(p) === this) runs.delete(p);
  }
}

/** Snapshot fields of a rocket: pitch (`p`), speed (`v`), fuel left (`f`, s), boosted (`b`), feed white (`w`). */
function rocketSnap(st: RocketState, white: number): Record<string, number> {
  return { p: Math.round(dirAngles(st.dir).pitch * 1000) / 1000, v: Math.round(st.speed * 10) / 10, f: Math.round(Math.max(0, st.fuel) * 10) / 10, b: st.boost ? 1 : 0, w: Math.round(white * 100) / 100 };
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Every tick, for bots holding the launcher: pick the nearest enemy, aim at it for a moment, then fire. */
export function botLauncher(room: Room, p: PlayerState): void {
  const ks = p.ext.killstreaks;
  const l = ks?.launcher;
  if (!p.isBot || !p.alive || !l || ks.control || room.time < l.ready) return;
  const ctx = ksRoom(room);
  const eye = eyeOf(p);
  const t = ctx.targetsFor(p, KS_ENTITY.rocket, eye, 120, false)[0];
  if (!t) return;
  l.aimAt ??= room.time + VALKYRIE.botAimSec * (1.5 - botStreakSkill(p));
  if (room.time < l.aimAt) return;
  // Up and over toward the target: launched a little high so it clears low cover.
  const c = chestOf(t);
  const yaw = Math.atan2(-(c.x - eye.x), -(c.z - eye.z));
  const flat = Math.hypot(c.x - eye.x, c.z - eye.z);
  const pitch = Math.atan2(c.y - eye.y, flat) + 0.35;
  fireLauncher(room, p, { yaw, pitch });
}

/** Bots: steer at the nearest enemy, with an error that shrinks with skill. */
function botSteer(ctx: KsRoom, p: PlayerState, f: Flight): Vec3 | null {
  const t = ctx.targetsFor(p, KS_ENTITY.rocket, f.st.pos, 400, false)[0];
  if (!t) return null;
  const c = chestOf(t);
  const v = { x: c.x - f.st.pos.x, y: c.y - f.st.pos.y, z: c.z - f.st.pos.z };
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  // The error fades as it closes in (the last few metres steer true), so it misses by a few metres at worst.
  const k = Math.min(1, l / 25);
  return { x: v.x / l + f.bias.x * k, y: v.y / l + f.bias.y * k, z: v.z / l + f.bias.z * k };
}

const launcherEnts = new WeakMap<PlayerState, number>();

/**
 * Keep the `ks_launcher` entity on a player while they hold the launcher (every tick): others see
 * it on the shoulder (`s.f` 1 while the view rides a rocket: the soldier stands aiming it).
 */
export function syncLauncherEntity(room: Room, p: PlayerState): void {
  const ks = p.ext.killstreaks;
  const want = !!ks?.launcher && p.alive && room.players.get(p.id) === p;
  let id = launcherEnts.get(p);
  let e = id !== undefined ? room.entities.get(id) : undefined;
  if (!want) {
    if (e) room.entities.remove(e.id);
    launcherEnts.delete(p);
    return;
  }
  if (!e) {
    e = room.entities.add({ kind: KS_ENTITY.launcher, x: p.move.x, y: p.move.y, z: p.move.z, yaw: p.yaw, owner: p.id, team: p.team, s: { f: 0 } });
    id = e.id;
    launcherEnts.set(p, id);
  }
  e.x = p.move.x;
  e.y = p.move.y;
  e.z = p.move.z;
  e.yaw = p.yaw;
  const flying = ks?.control?.id === 'valkyrie' ? 1 : 0;
  if (e.s?.f !== flying) e.s = { f: flying };
}
