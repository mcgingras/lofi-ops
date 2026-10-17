/**
 * Barriers and doors (BO1 `_zombiemode_blockers.gsc`, `tear_into_building` in `_zombiemode_spawner.gsc`),
 * for layers that have them (src/shared/maps/zombies/types.ts):
 *
 * Barriers: boarded windows, six boards each (entity `zm_barrier`, `s.b` = boards up). The opening
 * itself is a players-only clip in the map, so nobody walks through it and bullets fly through the
 * gaps. A zombie that spawns at a spawn tied to a barrier walks to the window's outside stand point,
 * tears a board off every `BARRIER.tearSec` (at most `BARRIER.tearers` at once), swipes at anyone
 * standing at the window, and once the last board is down climbs over the sill (a scripted move,
 * `BARRIER.climbSec`); then it hunts like any other zombie. Survivors hold USE at a window to put
 * boards back, one a second, 10 points each while the round's total stays under the cap
 * (`boardReward`). Carpenter puts every board back.
 *
 * Doors / debris (entity `zm_door`): the gap is closed by map brushes with `gate: 'door:<id>'`.
 * The room gets its own CollisionWorld whose `gateOn` says which are still shut, so they block
 * players, zombies, bullets and sight until a survivor buys them (hold USE, `zombies.bought`
 * `door:<id>`); buying opens the door's zones, which wakes their zombie spawns and barriers. The
 * zombie path search avoids nav cells inside shut doors (`cellCost`).
 */
import { BARRIER, barrierPoints, boardReward, DOORS, ZM_ENTITY } from '../../../shared/defs/zombies';
import { CollisionWorld } from '../../../shared/collision';
import { Buttons } from '../../../shared/input';
import { mapSolids } from '../../../shared/maps/types';
import type { ZombiesBarrier, ZombiesDoor, ZombiesSpawn } from '../../../shared/maps/zombies/index';
import type { Vec3 } from '../../../shared/math';
import type { Entity } from '../../entities';
import type { PlayerState } from '../../player';
import type { NavCell } from '../bots/nav';
import type { HordeEntry } from './brain';
import type { ZombiesGame } from './game';
import { survivorOf, undeadOf } from './state';

export interface BarrierState {
  index: number;
  spec: ZombiesBarrier;
  ent: Entity | null;
  boards: number;
  inside: Vec3;
  outside: Vec3;
  /** The zombie climbing through right now. */
  climber: string | null;
}

export interface DoorState {
  spec: ZombiesDoor;
  gate: string;
  ent: Entity | null;
  open: boolean;
  /** Nav cells inside the gap (path search avoids them while shut). */
  cells: Set<number>;
}

type Stage = 'approach' | 'tear' | 'climb';

interface Entry {
  barrier: number;
  stage: Stage;
  /** Next board pull (tear) / when the climb started. */
  next: number;
  t0: number;
}

const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};
const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

export class Blockers {
  barriers: BarrierState[] = [];
  doors: DoorState[] = [];
  readonly openZones = new Set<string>(['start']);
  /** Zombies still outside, by body id. */
  readonly entries = new Map<string, Entry>();
  /** Rebuild hold per survivor id. */
  private hold = new Map<string, number>();
  private rnd: () => number;

  constructor(
    private game: ZombiesGame,
    rnd: () => number = Math.random,
  ) {
    this.rnd = rnd;
  }

  get active(): boolean {
    return this.barriers.length > 0 || this.doors.length > 0;
  }

  /** Each match start (entities were just cleared). */
  reset(): void {
    const g = this.game;
    const room = g.room;
    const layer = g.layer;
    this.barriers = [];
    this.doors = [];
    this.openZones.clear();
    this.openZones.add('start');
    this.entries.clear();
    this.hold.clear();
    if (!layer) return;
    (layer.barriers ?? []).forEach((spec, index) => {
      const { inside, outside } = barrierPoints(spec);
      const ent = room.entities.add({ kind: ZM_ENTITY.barrier, x: spec.x, y: spec.y, z: spec.z, yaw: spec.yaw, s: { b: BARRIER.boards, w: spec.w, h: spec.h, sl: spec.sill ?? BARRIER.sill } });
      this.barriers.push({ index, spec, ent, boards: BARRIER.boards, inside, outside, climber: null });
    });
    const nav = g.horde.nav;
    for (const spec of layer.doors ?? []) {
      const gate = `door:${spec.id}`;
      const ent = room.entities.add({ kind: ZM_ENTITY.door, x: spec.x, y: spec.y, z: spec.z, yaw: spec.yaw, s: { c: spec.cost, k: spec.kind, w: spec.w, h: spec.h, ...(spec.label ? { l: spec.label } : {}) } });
      const cells = new Set<number>();
      for (const b of room.map.brushes) {
        if (b.gate !== gate) continue;
        for (const c of nav.cells) if (c.x > b.min.x - 0.4 && c.x < b.max.x + 0.4 && c.z > b.min.z - 0.4 && c.z < b.max.z + 0.4 && c.y > b.min.y - 1 && c.y < b.max.y) cells.add(c.i);
      }
      this.doors.push({ spec, gate, ent, open: false, cells });
    }
    if (this.doors.length) {
      // This room's own world: its doors open and shut apart from every other room on the map.
      const w = new CollisionWorld(mapSolids(room.map));
      w.gateOn = (gate) => this.gateShut(gate);
      room.world = w;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Zones, gates, nav
  // -------------------------------------------------------------------------------------------

  zoneOpen(zone: string | undefined): boolean {
    return zone === undefined || this.openZones.has(zone);
  }

  /** May zombies spawn here now (its zone open, its window's zone open)? */
  spawnActive(s: ZombiesSpawn): boolean {
    if (!this.zoneOpen(s.zone)) return false;
    if (s.barrier !== undefined) {
      const b = this.barriers[s.barrier];
      if (!b || !this.zoneOpen(b.spec.zone)) return false;
    }
    return true;
  }

  gateShut(gate: string): boolean {
    const d = this.doors.find((x) => x.gate === gate);
    return d ? !d.open : true;
  }

  /** Path cost multiplier: shut doors are as good as walls. */
  cellCost = (c: NavCell): number => {
    for (const d of this.doors) if (!d.open && d.cells.has(c.i)) return 1e4;
    return 1;
  };

  // -------------------------------------------------------------------------------------------
  // Zombies at the windows
  // -------------------------------------------------------------------------------------------

  /** A zombie spawned outside `barrier`: it has to come in through it. */
  assign(body: PlayerState, barrier: number): void {
    if (!this.barriers[barrier]) return;
    this.entries.set(body.id, { barrier, stage: 'approach', next: 0, t0: this.game.room.time });
  }

  /** The body died (or was reused): forget it. */
  release(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    const b = this.barriers[e.barrier];
    if (b && b.climber === id) b.climber = null;
    this.entries.delete(id);
  }

  isOutside(id: string): boolean {
    return this.entries.has(id);
  }

  /** What the brain should do with this body (brain.ts `Horde.entry`). */
  entry = (self: PlayerState, now: number): HordeEntry | null => {
    const e = this.entries.get(self.id);
    if (!e) return null;
    const b = this.barriers[e.barrier]!;
    if (e.stage === 'climb') return { script: true, goal: b.outside };
    const near = flat(self.move, b.outside) <= BARRIER.tearReach * 1.6;
    if (!near) return { goal: b.outside };
    // At the window: swipe whoever stands in reach on the other side.
    let hit: PlayerState | null = null;
    let bd: number = BARRIER.swipeReach;
    for (const t of this.game.horde.targets) {
      const d = flat(t.move, self.move);
      if (d < bd && Math.abs(t.move.y - self.move.y) < 1.4) {
        bd = d;
        hit = t;
      }
    }
    void now;
    return { goal: b.outside, hold: true, face: b.inside, hit };
  };

  private tearing(barrier: number): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.barrier === barrier && e.stage === 'tear') n++;
    return n;
  }

  private setBoards(b: BarrierState, n: number): void {
    b.boards = Math.max(0, Math.min(BARRIER.boards, n));
    if (b.ent) b.ent.s = { ...b.ent.s, b: b.boards };
    this.game.dirty = true;
  }

  // -------------------------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------------------------

  tick(dt: number): void {
    const g = this.game;
    const room = g.room;
    const now = room.time;
    // Zombies outside: walking up, tearing, climbing.
    for (const [id, e] of [...this.entries]) {
      const body = room.players.get(id);
      const z = body ? undeadOf(body) : null;
      if (!body || !z || !body.alive) {
        this.release(id);
        continue;
      }
      const b = this.barriers[e.barrier]!;
      // They are busy, not lost: keep the respawn failsafe off them while they work at a window.
      if (e.stage !== 'approach' || flat(body.move, b.outside) < 3) z.progressAt = now;
      if (e.stage === 'approach') {
        if (flat(body.move, b.outside) <= BARRIER.tearReach && Math.abs(body.move.y - b.outside.y) < 0.8 && this.tearing(e.barrier) < BARRIER.tearers) {
          e.stage = 'tear';
          e.next = now + BARRIER.tearSec * (0.6 + this.rnd() * 0.4);
        }
      } else if (e.stage === 'tear') {
        if (b.boards > 0) {
          if (now >= e.next && flat(body.move, b.outside) <= BARRIER.tearReach * 1.6) {
            this.setBoards(b, b.boards - 1);
            e.next = now + BARRIER.tearSec * (0.85 + this.rnd() * 0.3);
          }
        } else if (b.climber === null) {
          b.climber = id;
          e.stage = 'climb';
          e.t0 = now;
          e.next = now + BARRIER.climbSec;
          body.move.x = b.outside.x;
          body.move.z = b.outside.z;
        }
      } else {
        this.climb(body, b, e, now);
      }
    }
    // Survivors holding USE at a window put boards back.
    for (const p of g.survivors()) {
      const s = survivorOf(p)!;
      const held = (p.buttons & Buttons.USE) !== 0;
      const b = held && g.isUp(p) && !p.isBot && s.drinkingUntil <= now && !g.buy.targetOf(p) ? this.barrierTarget(p) : null;
      if (!b) {
        this.hold.delete(p.id);
        continue;
      }
      const rate = BARRIER.rebuildSec * (g.hasPerk(p, 'speed') ? 0.5 : 1);
      const t = (this.hold.get(p.id) ?? 0) + dt;
      if (t < rate) {
        this.hold.set(p.id, t);
        continue;
      }
      this.hold.set(p.id, t - rate);
      this.rebuild(p, b);
    }
  }

  /** Over the sill: outside stand point -> up onto the sill -> down inside, then free to hunt. */
  private climb(body: PlayerState, b: BarrierState, e: Entry, now: number): void {
    const k = (now - e.t0) / BARRIER.climbSec;
    const m = body.move;
    const sill = b.spec.y + (b.spec.sill ?? BARRIER.sill);
    if (k >= 1) {
      m.x = b.inside.x;
      m.y = b.inside.y;
      m.z = b.inside.z;
      m.vx = m.vy = m.vz = 0;
      m.onGround = true;
      m.mantle = null;
      b.climber = null;
      this.entries.delete(body.id);
      return;
    }
    const t = smooth(k);
    m.x = b.outside.x + (b.inside.x - b.outside.x) * t;
    m.z = b.outside.z + (b.inside.z - b.outside.z) * t;
    const base = b.outside.y + (b.inside.y - b.outside.y) * t;
    // Up to the sill in the first half, down the other side in the second.
    m.y = Math.max(base, base + (sill - base) * Math.sin(Math.PI * Math.min(1, k * 1.1)));
    m.vx = m.vy = m.vz = 0;
    m.onGround = false;
    body.yaw = b.spec.yaw;
  }

  // -------------------------------------------------------------------------------------------
  // Survivors: rebuilding, buying doors
  // -------------------------------------------------------------------------------------------

  /** The window `p` can rebuild from here (boards missing, in reach on the inside), nearest first. */
  barrierTarget(p: PlayerState): BarrierState | null {
    let best: BarrierState | null = null;
    let bd: number = BARRIER.reach;
    for (const b of this.barriers) {
      if (b.boards >= BARRIER.boards) continue;
      const d = flat(p.move, b.inside);
      if (d > bd || Math.abs(p.move.y - b.inside.y) > 1.2) continue;
      // On the inside of the wall line.
      const fx = -Math.sin(b.spec.yaw);
      const fz = -Math.cos(b.spec.yaw);
      if ((p.move.x - b.spec.x) * fx + (p.move.z - b.spec.z) * fz < 0.1) continue;
      bd = d;
      best = b;
    }
    return best;
  }

  rebuild(p: PlayerState, b: BarrierState): void {
    const g = this.game;
    const s = survivorOf(p);
    if (!s || b.boards >= BARRIER.boards) return;
    this.setBoards(b, b.boards + 1);
    const r = boardReward(s.boardPoints, Math.max(1, g.round));
    s.boardPoints = r.total;
    if (r.pay > 0) g.award(p, r.pay, 'board');
    g.event({ kind: 'board', player: p.id, at: { x: b.spec.x, y: b.spec.y, z: b.spec.z } });
  }

  /** The shut door `p` stands at, if any. */
  doorTarget(p: PlayerState): DoorState | null {
    let best: DoorState | null = null;
    let bd: number = DOORS.reach;
    for (const d of this.doors) {
      if (d.open) continue;
      const dist = flat(p.move, d.spec);
      if (dist > bd || p.move.y < d.spec.y - 1.2 || p.move.y > d.spec.y + Math.max(1.2, d.spec.h * 0.6)) continue;
      bd = dist;
      best = d;
    }
    return best;
  }

  claimsUse(p: PlayerState): boolean {
    if (!survivorOf(p) || !p.alive || this.game.isDown(p)) return false;
    return this.doorTarget(p) !== null || this.barrierTarget(p) !== null;
  }

  buyDoor(p: PlayerState, d: DoorState): boolean {
    const g = this.game;
    if (d.open) return false;
    if (!g.spend(p, d.spec.cost)) {
      g.event({ kind: 'nope', player: p.id, text: 'NOT ENOUGH POINTS' }, p);
      return false;
    }
    this.open(d);
    g.event({ kind: 'door', player: p.id, id: d.spec.id, at: { x: d.spec.x, y: d.spec.y, z: d.spec.z } });
    g.room.bus.emit('zombies.bought', { player: p, what: `door:${d.spec.id}`, cost: d.spec.cost });
    return true;
  }

  /** Clear a door (bought, or by tests): its gap opens, its zones wake. */
  open(d: DoorState): void {
    if (d.open) return;
    d.open = true;
    if (d.ent) d.ent.s = { ...d.ent.s, o: this.game.room.time };
    for (const z of d.spec.zones) this.openZones.add(z);
    this.game.dirty = true;
  }

  // -------------------------------------------------------------------------------------------
  // Power-ups
  // -------------------------------------------------------------------------------------------

  /** Windows with every board gone (Carpenter needs five). */
  brokenWindows(): number {
    let n = 0;
    for (const b of this.barriers) if (b.boards === 0) n++;
    return n;
  }

  /** Carpenter: every board back up. */
  carpenter(): void {
    for (const b of this.barriers) this.setBoards(b, BARRIER.boards);
  }
}
