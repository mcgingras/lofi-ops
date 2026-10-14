/**
 * Per-death killcam (BO1/MW2 "KillCam"): when a human is killed by an enemy, they get the last few
 * seconds before the kill from the killer's eyes, cut from the final killcam's 20 Hz pose history
 * (killcam.ts), plus a killer card. Sent only to the victim (`modes.deathcam`), `postSec` after
 * the kill so the clip runs a moment past it, and cut so it ends by the victim's respawn
 * (deathcamWindow): the killcam never delays a respawn. Only players near the killer or the
 * victim go in, quantised and delta coded (packClip).
 *
 * No replay for suicides, falls, out of bounds or world kills (no message at all). Killstreak kills
 * are watched from the streak: the helicopter, sentry, dog or RC-XD that did it, top-down over
 * the victim for strikes and crates, or riding the Valkyrie rocket along its flight (BO1 replays
 * the killer's view, which was the rocket cam).
 */
import { DEATHCAM, deathcamWindow, NO_DEATHCAM_MEANS, packClip, packTrack, TOP_DOWN_STREAKS, type DeathcamPayload, type DeathcamTuning, type KillerCard } from '../../../shared/defs/deathcam';
import { rocketTrack } from '../killstreaks/api';
import { isStreakWeapon, KS_ENTITY } from '../../../shared/defs/killstreaks';
import type { KillcamFrame } from '../../../shared/defs/modestate';
import type { DeathEvent } from '../../../shared/events';
import type { Vec3 } from '../../../shared/math';
import { currentWeapon, type PlayerState } from '../../player';
import type { Room } from '../../room';
import type { KillcamRecorder } from './killcam';

/** Streak weapon id -> the entity kind to watch it from (owned by the killer). */
const STREAK_ENTITY: Record<string, { kind: string; up: number }> = {
  attack_helicopter: { kind: KS_ENTITY.heli, up: -0.5 },
  chopper_gunner: { kind: KS_ENTITY.gunner, up: -0.5 },
  sentry_gun: { kind: KS_ENTITY.sentry, up: 1.1 },
  attack_dogs: { kind: KS_ENTITY.dog, up: 0.6 },
  rcxd: { kind: KS_ENTITY.rcxd, up: 0.4 },
};
/** Height of the top-down camera over the victim. */
const TOP_HEIGHT = 16;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Does this death get a killcam? Humans killed by an enemy player, not by the world or themselves. */
export function wantsDeathcam(room: Room, e: DeathEvent<PlayerState>): e is DeathEvent<PlayerState> & { attacker: PlayerState } {
  return !!e.victim.session && !!e.attacker && e.attacker !== e.victim && room.isEnemy(e.attacker, e.victim) && !NO_DEATHCAM_MEANS.has(e.means);
}

/** Keep the killer, the victim and whoever was within `nearM` of either at the kill (closest first). */
export function nearbyIds(frames: readonly KillcamFrame[], killer: string, victim: string, at: number, t: DeathcamTuning = DEATHCAM): Set<string> {
  let ref = frames[0];
  for (const f of frames) if (f.t <= at + 1e-6) ref = f;
  const keep = new Set([killer, victim]);
  if (!ref) return keep;
  const pos = new Map(ref.p.map((p) => [p[0], p] as const));
  const k = pos.get(killer);
  const v = pos.get(victim);
  const d = (p: KillcamFrame['p'][number], q: KillcamFrame['p'][number] | undefined) => (q ? Math.hypot(p[1] - q[1], p[3] - q[3]) : Infinity);
  const near = ref.p
    .filter((p) => !keep.has(p[0]))
    .map((p) => ({ id: p[0], d: Math.min(d(p, k), d(p, v)) }))
    .filter((x) => x.d <= t.nearM)
    .sort((a, b) => a.d - b.d);
  for (const x of near.slice(0, Math.max(0, t.maxPlayers - 2))) keep.add(x.id);
  return keep;
}

export class Deathcams {
  /** Where each player's last damage came from (streak views). */
  private lastFrom = new Map<string, Vec3>();
  private pending = new Set<() => void>();

  constructor(
    private room: Room,
    private rec: KillcamRecorder,
  ) {}

  clear(): void {
    for (const cancel of this.pending) cancel();
    this.pending.clear();
    this.lastFrom.clear();
  }

  onDamage(victim: PlayerState, from: Vec3 | null | undefined): void {
    if (from) this.lastFrom.set(victim.id, { x: from.x, y: from.y, z: from.z });
  }

  onDeath(e: DeathEvent<PlayerState>): void {
    const from = this.lastFrom.get(e.victim.id) ?? null;
    this.lastFrom.delete(e.victim.id);
    if (!wantsDeathcam(this.room, e)) return;
    const room = this.room;
    const a = e.attacker;
    const v = e.victim;
    const at = room.time;
    const win = deathcamWindow(at, v.respawnAt);
    const streak = isStreakWeapon(e.weapon);
    const held = a.weapons.find((w) => w.def.base.id === e.weapon);
    const cur = currentWeapon(a);
    const card: KillerCard = {
      name: a.name,
      bot: a.isBot,
      level: a.profile?.level ?? 1,
      prestige: a.profile?.prestige ?? 0,
      weapon: e.weapon,
      attachments: held ? [...held.def.attachmentIds] : [],
      health: a.alive ? Math.max(1, Math.ceil(a.health)) : 0,
      maxHealth: Math.round(a.maxHealth),
      streak: a.stats.streak,
    };
    const base: DeathcamPayload = {
      killer: a.id,
      victim: v.id,
      weapon: e.weapon,
      means: e.means,
      headshot: e.headshot,
      at: r2(at),
      playAt: r2(at + DEATHCAM.beatSec),
      respawnAt: v.respawnAt,
      card,
      view: 'none',
      clip: null,
    };
    if (streak) base.cam = this.streakCam(e.weapon, a, v, from);
    else if (cur) base.vm = { weapon: cur.def.base.id, attachments: [...cur.def.attachmentIds], camo: cur.camo, suppressed: cur.def.suppressed };

    const send = () => {
      this.pending.delete(cancel);
      if (room.phase !== 'playing' || !v.session || room.players.get(v.id) !== v || v.alive || v.diedAt !== at) return;
      const msg: DeathcamPayload = { ...base, respawnAt: v.respawnAt };
      if (win) {
        const got = this.rec.between(win.from, win.to);
        if (got.frames.length >= 4) {
          const keep = nearbyIds(got.frames, a.id, v.id, at);
          const frames = got.frames.map((f) => ({ t: f.t, p: f.p.filter((p) => keep.has(p[0])) }));
          msg.clip = packClip(frames, got.shots.filter((s) => keep.has(s.id)));
          msg.view = streak ? 'streak' : 'eyes';
        }
      }
      room.sendFeature(v, 'modes.deathcam', msg);
    };
    const cancel = room.schedule(win ? Math.max(0, win.to - at) : 0, send);
    this.pending.add(cancel);
  }

  /** Where to watch a streak kill from: the killer's streak entity, else the blast, else top-down. */
  private streakCam(weapon: string, a: PlayerState, v: PlayerState, from: Vec3 | null): NonNullable<DeathcamPayload['cam']> {
    const top = { x: r2(v.move.x), y: r2(v.move.y + TOP_HEIGHT), z: r2(v.move.z), top: true };
    if (TOP_DOWN_STREAKS.has(weapon)) return top;
    if (weapon === 'valkyrie') {
      // The rocket is gone by now (it blew up to make the kill): ride its recorded flight.
      const tr = rocketTrack(this.room, a.id);
      const pts = tr?.points.filter((q) => q.t >= this.room.time - DEATHCAM.maxSec - 0.5) ?? [];
      const last = pts.at(-1);
      if (last && pts.length >= 2) return { x: r2(last.x), y: r2(last.y), z: r2(last.z), top: false, track: packTrack(pts) };
    }
    const ent = STREAK_ENTITY[weapon];
    if (ent) {
      let best: { x: number; y: number; z: number } | null = null;
      let bd = Infinity;
      for (const en of this.room.entities.all()) {
        if (en.kind !== ent.kind || en.owner !== a.id) continue;
        const d = Math.hypot(en.x - v.move.x, en.z - v.move.z);
        if (d < bd) {
          bd = d;
          best = en;
        }
      }
      if (best) return { x: r2(best.x), y: r2(best.y + ent.up), z: r2(best.z), top: false };
    }
    if (from && Math.hypot(from.x - v.move.x, from.y - v.move.y, from.z - v.move.z) > 1.5) return { x: r2(from.x), y: r2(from.y + 0.5), z: r2(from.z), top: false };
    return top;
  }
}
