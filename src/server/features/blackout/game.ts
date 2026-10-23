/**
 * One room's Blackout match: the plane, the drop (freefall and chute), the circle and its damage,
 * armour and heals, loot, placements and the end. Built by the mode rules (rules.ts) and wired to
 * the room's bus, modifiers and core hooks (`moveParamsHook` for the glide physics, `interest` for
 * snapshots). Pure maths lives in shared/defs/blackout.ts.
 */
import { BLACKOUT, BLACKOUT_MODE, GLIDE, LOOT_ENTITY, PLANE_ENTITY, buildCircles, circleState, outsideBy, placementXp, planeAt, planePath, type BlackoutStatePayload, type Circle, type CircleState, type PlanePath } from '../../../shared/defs/blackout';
import { Buttons } from '../../../shared/input';
import type { MatchResults, PlayerResult } from '../../../shared/events';
import type { SpawnPoint } from '../../../shared/maps/types';
import { damageAtRange } from '../../../shared/ballistics';
import { currentWeapon } from '../../player';
import { forceSlot } from '../../combat';
import type { Entity } from '../../entities';
import { makeWeapon, type PlayerState } from '../../player';
import type { Room } from '../../room';
import { heldSlot, setPickupRules } from '../pickups/index';
import { sendEquip } from '../weapons/equipment';
import { wext } from '../weapons/state';
import { BlackoutBrain } from './brain';
import { focusOf, interestFor } from './interest';
import { deathLoot, LootGrid, lootSpots, spawnLoot, trimLoot, walkOver } from './loot';
import { bx, freshExt } from './state';

const KNIFE = 'knife';
const STATE_EVERY = 0.5;
const isKnife = (id: string | undefined) => id === KNIFE;
const clampNum = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Test hooks: force the next match's seed. */
export interface BlackoutOptions {
  seed?: number;
}

export class BlackoutGame {
  seed = 1;
  plane!: PlanePath;
  circles: Circle[] = [];
  /** Room time play started (circle and plane clock), null before. */
  t0: number | null = null;
  /** Players who dropped this match. */
  readonly entrants = new Set<string>();
  readonly places = new Map<string, number>();
  winner: string | null = null;
  endAt: number | null = null;
  planeEntity: Entity | null = null;
  readonly loot = new LootGrid(8);
  /** Bumped when loot items appear or go (the grid rebuilds). */
  lootVersion = 0;
  lootSpawned = 0;
  opts: BlackoutOptions = {};
  /** Names of entrants (for the killer line after they leave). */
  private names = new Map<string, string>();
  private nextState = 0;
  private nextStorm = 0;
  private dirty = new Set<string>();
  /** Per-tick profiling (ms), for the benchmark. */
  readonly prof = { ticks: 0, ms: 0, farFights: 0 };
  /** Alive players by 32 m cell (rebuilt every tick). */
  private grid = new Map<number, PlayerState[]>();
  /** Bots near a human this tick (full brain). */
  private near = new Set<string>();
  /** Bots fighting each human (fairness cap). */
  private engaged = new Map<string, Set<string>>();
  /** Far-fight line of sight per pair, cached for 2 s. */
  private farLos = new Map<string, { t: number; ok: boolean }>();
  private nextFar = 0;
  /** Landing spots bots already picked (loot spot index). */
  private dropClaims = new Set<number>();
  /** Loot entities a bot is heading for (entity id -> bot id), so two bots don't race for one. */
  readonly lootClaims = new Map<number, string>();

  constructor(readonly room: Room) {}

  // -------------------------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------------------------

  setup(): void {
    const room = this.room;
    const isMode = () => room.mode.id === BLACKOUT_MODE;
    setPickupRules(room, { keep: true, cap: BLACKOUT.maxLoot, bots: false, slotFor: (p) => this.pickupSlot(p) });
    room.moveParamsHook = (p) => {
      const st = p.ext.blackout;
      if (!p.alive || !st || st.stage === 'ground') return null;
      return st.stage === 'plane' ? { glide: GLIDE.plane, canMove: false } : { glide: GLIDE[st.stage] };
    };
    room.interest = interestFor(this);

    // No regeneration: heals and armour carry you (BO4 Blackout).
    room.modifiers.add('regenDelayMultiplier', () => (BLACKOUT.regen ? undefined : 1e6), 'blackout.noregen');
    // No shooting in the air or while healing.
    room.modifiers.add('canFire', (p) => (isMode() && (bx(p).stage !== 'ground' || bx(p).healUntil !== null) ? false : undefined), 'blackout.hands');
    room.modifiers.add('canAds', (p) => (isMode() && bx(p).stage !== 'ground' ? false : undefined), 'blackout.air');
    room.modifiers.add('canSprint', (p) => (isMode() && bx(p).healUntil !== null ? false : undefined), 'blackout.heal');

    room.bus.on('beforeSpawn', (e) => {
      // Everyone starts with a knife only (the guns are placeholders, swapped at spawn).
      e.loadout = { name: 'Blackout', primary: { weapon: 'ak47', attachments: [], camo: 'none' }, secondary: { weapon: 'm1911', attachments: [], camo: 'none' }, perks: [], killstreaks: [], lethal: null, tactical: null };
      e.point = this.planeSpawn();
    }, { priority: -100 });
    room.bus.on('spawn', ({ player: p }) => this.onSpawn(p));
    room.bus.on('matchStart', () => this.start());
    room.bus.on('beforeDamage', (e) => {
      const st = e.victim.ext.blackout;
      if (!st) return;
      if (st.stage === 'plane') {
        e.cancel = true;
        return;
      }
      // Armour soaks part of bullets, blasts and knives (never the circle or falls).
      if (st.armor > 0 && (e.means === 'bullet' || e.means === 'explosive' || e.means === 'melee' || e.means === 'fire')) {
        const soak = Math.min(st.armor, e.amount * BLACKOUT.armor.absorb);
        st.armor -= soak;
        e.amount -= soak;
        this.dirty.add(e.victim.id);
      }
    });
    room.bus.on('death', (e) => this.onDeath(e.victim, e.attacker));
    room.bus.on('damage', ({ victim, attacker }) => {
      if (victim.brain instanceof BlackoutBrain) victim.brain.onHurt(attacker, room.time, 2.5 * room.modifiers.mul('flinchMultiplier', victim));
    });
    room.bus.on('pickups.dropped', () => this.lootChanged());
    room.bus.on('pickups.ammo', () => this.lootChanged());
    room.bus.on('playerLeave', ({ player }) => this.onLeave(player));
    room.bus.on('buttons', ({ player, pressed }) => this.onButtons(player, pressed));
    room.bus.on('pickups.swapped', ({ player, slot }) => {
      // Took a gun into the empty (knife) slot: it comes up in hand.
      if (player.alive && slot !== player.slot && isKnife(player.weapons[player.slot]?.def.base.id)) forceSlot(room, player, slot);
      this.dirty.add(player.id);
    });
    room.bus.on('tick', ({ dt }) => {
      if (!isMode()) return;
      const t0 = performance.now();
      this.tick(dt);
      this.prof.ticks++;
      this.prof.ms += performance.now() - t0;
    });
  }

  /** The slot a human's pickup fills: an empty (knife) slot first, else the gun in hand. */
  pickupSlot(p: PlayerState): number {
    const held = heldSlot(p);
    if (!isKnife(p.weapons[held]?.def.base.id)) {
      const free = p.weapons.findIndex((w, i) => i < 2 && isKnife(w.def.base.id));
      if (free >= 0) return free;
    }
    return held;
  }

  // -------------------------------------------------------------------------------------------
  // Match flow
  // -------------------------------------------------------------------------------------------

  /** A new match (rules.reset): seed, plane line, circles; loot and drop plans come at the start. */
  reset(): void {
    this.seed = this.opts.seed ?? (Math.floor(Math.random() * 0x7fffffff) ^ Math.floor(this.room.time * 1000));
    this.plane = planePath(this.seed, this.room.map.bounds);
    const b = this.room.map.bounds;
    const half = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
    const start: Circle = { x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2, r: half * Math.SQRT2 + 8 };
    this.circles = buildCircles(this.seed, start);
    this.t0 = null;
    this.entrants.clear();
    this.places.clear();
    this.names.clear();
    this.winner = null;
    this.endAt = null;
    this.planeEntity = null;
    this.lootSpawned = 0;
    this.dropClaims.clear();
    this.lootClaims.clear();
    for (const p of this.room.players.values()) p.ext.blackout = freshExt();
  }

  planeSpawn(): SpawnPoint {
    const at = planeAt(this.plane, 0);
    return { x: at.x, y: at.y, z: at.z, yaw: at.yaw };
  }

  private onSpawn(p: PlayerState): void {
    const st = (p.ext.blackout = freshExt());
    st.stage = 'plane';
    // A knife in both slots: the two slots fill with guns from the floor.
    p.weapons = [makeWeapon({ weapon: KNIFE, attachments: [], camo: 'none' }, KNIFE), makeWeapon({ weapon: KNIFE, attachments: [], camo: 'none' }, KNIFE)];
    p.slot = 0;
    p.reloadEnd = 0;
    const x = wext(p);
    x.lethal = null;
    x.lethalN = 0;
    x.tactical = null;
    x.tacticalN = 0;
    this.board(p, this.t0 === null ? 0 : this.room.time - this.t0);
    this.dirty.add(p.id);
  }

  /** Put a player aboard the plane at flight time `t`. */
  private board(p: PlayerState, t: number): void {
    const at = planeAt(this.plane, t);
    const m = p.move;
    m.x = at.x;
    m.y = at.y;
    m.z = at.z;
    // Frozen countdown: hover at the start; in play the body flies with the plane.
    m.vx = this.t0 === null ? 0 : at.vx;
    m.vz = this.t0 === null ? 0 : at.vz;
    m.vy = 0;
    m.onGround = false;
    p.yaw = at.yaw;
  }

  /** Play starts: the plane takes off, loot appears, bots pick where to land. */
  private start(): void {
    const room = this.room;
    this.t0 = room.time;
    this.nextStorm = room.time + BLACKOUT.circle.tickSec;
    for (const p of room.players.values()) {
      if (!p.alive) continue;
      this.entrants.add(p.id);
      this.names.set(p.id, p.name);
      const st = bx(p);
      st.stage = 'plane';
      this.board(p, 0);
      if (p.isBot) this.planBotDrop(p);
    }
    this.lootSpawned = spawnLoot(room, this.seed);
    this.lootVersion++;
    const at = planeAt(this.plane, 0);
    this.planeEntity = room.entities.add({ kind: PLANE_ENTITY, x: at.x, y: at.y, z: at.z, yaw: at.yaw, s: { t0: Math.round(room.time * 1000) / 1000 } });
    this.pushAll();
  }

  /** A bot's landing spot (loot towns weighted by size, some open ground) and the moment to jump. */
  private planBotDrop(p: PlayerState): void {
    const st = bx(p);
    const r = Math.random;
    const b = this.room.map.bounds;
    // Anywhere in reach of a glide from the line: pick a point, then jump where the plane passes
    // nearest to it, a little early (the glide carries you forward).
    let tx = 0;
    let tz = 0;
    const spots = lootSpots(this.room.map, this.room.world);
    if (spots.length && r() < 0.85) {
      // A spot nobody else picked yet (bots spread over the map like players do).
      let i = Math.floor(r() * spots.length);
      for (let k = 0; k < 8 && this.dropClaims.has(i); k++) i = Math.floor(r() * spots.length);
      this.dropClaims.add(i);
      const s = spots[i]!;
      tx = s.x + (r() - 0.5) * 6;
      tz = s.z + (r() - 0.5) * 6;
    } else {
      tx = b.min.x + 30 + r() * (b.max.x - b.min.x - 60);
      tz = b.min.z + 30 + r() * (b.max.z - b.min.z - 60);
    }
    st.dropTo = { x: tx, z: tz };
    const pl = this.plane;
    const lx = pl.x1 - pl.x0;
    const lz = pl.z1 - pl.z0;
    const l2 = lx * lx + lz * lz;
    const k = Math.max(0, Math.min(1, ((tx - pl.x0) * lx + (tz - pl.z0) * lz) / l2));
    const lead = 3 + r() * 4;
    st.jumpAt = this.room.time + Math.max(BLACKOUT.plane.doorsSec + 0.5, k * pl.duration - lead) + r() * 1.5;
  }

  /** Circle state now (null before play). */
  circle(): CircleState | null {
    return this.t0 === null ? null : circleState(this.circles, this.room.time - this.t0);
  }

  aliveEntrants(): PlayerState[] {
    const out: PlayerState[] = [];
    for (const id of this.entrants) {
      const p = this.room.players.get(id);
      if (p?.alive) out.push(p);
    }
    return out;
  }

  aliveCount(): number {
    let n = 0;
    for (const id of this.entrants) if (this.room.players.get(id)?.alive) n++;
    return n;
  }

  // -------------------------------------------------------------------------------------------
  // Per tick
  // -------------------------------------------------------------------------------------------

  private tick(dt: number): void {
    const room = this.room;
    if (room.phase !== 'playing' || this.t0 === null) return;
    const t = room.time - this.t0;
    const pl = planeAt(this.plane, t);
    if (this.planeEntity) {
      if (t > this.plane.duration + 4) {
        room.entities.remove(this.planeEntity.id);
        this.planeEntity = null;
      } else {
        this.planeEntity.x = pl.x;
        this.planeEntity.z = pl.z;
        this.planeEntity.yaw = pl.yaw;
      }
    }
    this.rebuildGrid();
    if (room.tick % 6 === 0) this.updateLod();
    if (room.time >= this.nextFar) {
      this.nextFar = room.time + 0.5;
      this.farFights(0.5);
    }
    const forceOut = t >= this.plane.duration - BLACKOUT.plane.forceJumpBeforeEnd;
    const lootTick = room.tick % 6 === 0;
    if (lootTick) this.loot.rebuild(room, this.lootVersion);
    for (const p of room.players.values()) {
      if (!p.alive) continue;
      const st = bx(p);
      switch (st.stage) {
        case 'plane':
          p.move.x = pl.x;
          p.move.y = pl.y;
          p.move.z = pl.z;
          p.move.vx = pl.vx;
          p.move.vz = pl.vz;
          p.move.vy = 0;
          p.move.onGround = false;
          if (forceOut || (p.isBot && st.jumpAt !== null && room.time >= st.jumpAt)) this.jump(p);
          break;
        case 'freefall': {
          if (p.move.onGround) this.land(p);
          else if (this.heightAboveGround(p) <= BLACKOUT.deployHeight) this.deploy(p);
          break;
        }
        case 'chute':
          if (p.move.onGround) this.land(p);
          break;
        case 'ground': {
          if (st.healUntil !== null) this.heal(p, st, dt);
          if (lootTick && walkOver(room, p, this.loot) > 0) {
            this.lootVersion++;
            this.dirty.add(p.id);
          }
          break;
        }
      }
    }
    if (room.time >= this.nextStorm) {
      this.nextStorm += BLACKOUT.circle.tickSec;
      this.storm(t);
    }
    if (this.endAt !== null && room.time >= this.endAt) {
      this.endAt = null;
      room.endMatch('score');
      return;
    }
    if (room.time >= this.nextState || this.dirty.size) this.push();
  }

  heightAboveGround(p: PlayerState): number {
    const g = this.room.world.groundBelow(p.move.x, p.move.z, p.move.y, 400);
    return g === null ? Infinity : p.move.y - g;
  }

  /** Leave the plane: freefall, keeping some of the plane's speed. */
  jump(p: PlayerState): void {
    const st = bx(p);
    if (st.stage !== 'plane' || this.t0 === null || this.room.time - this.t0 < BLACKOUT.plane.doorsSec) return;
    st.stage = 'freefall';
    st.jumpedAt = this.room.time;
    const v = Math.hypot(p.move.vx, p.move.vz);
    const k = v > BLACKOUT.exitSpeed ? BLACKOUT.exitSpeed / v : 1;
    p.move.vx *= k;
    p.move.vz *= k;
    p.move.vy = -2;
    this.dirty.add(p.id);
  }

  deploy(p: PlayerState): void {
    const st = bx(p);
    if (st.stage !== 'freefall') return;
    st.stage = 'chute';
    this.dirty.add(p.id);
  }

  land(p: PlayerState): void {
    const st = bx(p);
    st.stage = 'ground';
    st.landedAt = this.room.time;
    this.dirty.add(p.id);
  }

  private onButtons(p: PlayerState, pressed: number): void {
    if (!p.alive || this.room.phase !== 'playing') return;
    const st = bx(p);
    if (pressed & Buttons.JUMP) {
      if (st.stage === 'plane') this.jump(p);
      else if (st.stage === 'freefall' && this.heightAboveGround(p) > BLACKOUT.minPullHeight) this.deploy(p);
    }
    if (pressed & Buttons.STREAK && st.stage === 'ground') this.startHeal(p);
  }

  /** Start healing: a med kit when badly hurt (or no bandages), else a bandage. */
  startHeal(p: PlayerState): boolean {
    const st = bx(p);
    if (st.healUntil !== null || p.health >= p.maxHealth) return false;
    const missing = p.maxHealth - p.health;
    const kit = st.medkits > 0 && (missing >= 50 || st.bandages === 0);
    const H = BLACKOUT.heals;
    if (kit) {
      st.medkits--;
      st.healRate = H.medkit.heal / H.medkit.sec;
      st.healUntil = this.room.time + H.medkit.sec;
    } else if (st.bandages > 0) {
      st.bandages--;
      st.healRate = H.bandage.heal / H.bandage.sec;
      st.healUntil = this.room.time + H.bandage.sec;
    } else return false;
    this.dirty.add(p.id);
    return true;
  }

  private heal(p: PlayerState, st: ReturnType<typeof bx>, dt: number): void {
    p.health = Math.min(p.maxHealth, p.health + st.healRate * dt);
    if (this.room.time >= (st.healUntil ?? 0) || p.health >= p.maxHealth) {
      st.healUntil = null;
      st.healRate = 0;
      if (p.health >= p.maxHealth) p.damageLog = [];
      this.dirty.add(p.id);
    }
  }

  /** Circle damage to everyone outside (once a second). */
  private storm(t: number): void {
    const c = circleState(this.circles, t);
    const amount = c.dps * BLACKOUT.circle.tickSec;
    for (const p of this.aliveEntrants()) {
      if (bx(p).stage === 'plane') continue;
      if (outsideBy(c.cur, p.move.x, p.move.z) <= 0) continue;
      this.room.damage({ victim: p, attacker: null, amount, weapon: 'storm', part: null, means: 'storm', from: null, distance: 0 });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Deaths, places, the end
  // -------------------------------------------------------------------------------------------

  private onDeath(v: PlayerState, attacker: PlayerState | null): void {
    if (!this.entrants.has(v.id) || this.places.has(v.id) || this.room.phase !== 'playing') return;
    const st = bx(v);
    st.killer = attacker && attacker !== v ? attacker.id : null;
    st.healUntil = null;
    deathLoot(this.room, v, heldSlot(v));
    this.lootVersion++;
    this.placeOut(v);
    // Start watching the killer (or whoever is near); whoever watched `v` follows on.
    st.watching = st.killer && this.room.players.get(st.killer)?.alive ? st.killer : this.nearestAlive(v)?.id ?? null;
    for (const h of this.room.players.values()) {
      const hs = h.ext.blackout;
      if (h !== v && !h.alive && hs?.watching === v.id) {
        hs.watching = st.watching;
        this.dirty.add(h.id);
      }
    }
  }

  private onLeave(p: PlayerState): void {
    if (!this.entrants.has(p.id) || this.places.has(p.id) || this.room.phase !== 'playing') return;
    if (p.alive) p.alive = false;
    this.placeOut(p);
  }

  /** `v` is out: their place is the number still alive plus one; one left wins. */
  private placeOut(v: PlayerState): void {
    // The alive counter on every human's HUD changes now.
    for (const h of this.room.players.values()) if (h.session) this.dirty.add(h.id);
    const alive = this.aliveEntrants().filter((p) => p !== v);
    const place = alive.length + 1;
    if (alive.length === 0) {
      // The last ones went down together (the circle): the last of them takes the win.
      this.finish(v, 1);
      return;
    }
    this.setPlace(v, place);
    if (alive.length === 1) this.finish(alive[0]!, 1);
  }

  private setPlace(p: PlayerState, place: number): void {
    this.places.set(p.id, place);
    bx(p).place = place;
    const xp = placementXp(place);
    this.room.bus.emit('objective', { kind: 'blackout.placement', team: null, player: p, data: { xp, points: place } });
    if (p.session) {
      const st = bx(p);
      const killer = st.killer ? this.room.players.get(st.killer) : null;
      this.room.sendFeature(p, 'blackout.placed', {
        place,
        of: this.entrants.size,
        kills: p.stats.kills,
        survived: Math.round(this.room.time - (this.t0 ?? this.room.time)),
        killer: st.killer,
        killerName: killer?.name ?? (st.killer ? (this.names.get(st.killer) ?? null) : null),
        won: place === 1,
        xp,
      });
    }
    this.dirty.add(p.id);
  }

  private finish(winner: PlayerState, place: number): void {
    if (this.winner) return;
    this.winner = winner.id;
    this.setPlace(winner, place);
    this.endAt = this.room.time + 1.5;
    this.pushAll();
  }

  /** Rules' checkEnd fallback: nobody left (e.g. everyone left the room). */
  checkEnd(): MatchResults['reason'] | null {
    if (this.t0 === null || this.endAt !== null) return null;
    if (this.entrants.size > 0 && this.aliveCount() === 0 && !this.winner) return 'score';
    return null;
  }

  nearestAlive(from: PlayerState): PlayerState | null {
    let best: PlayerState | null = null;
    let bd = Infinity;
    for (const p of this.aliveEntrants()) {
      if (p === from) continue;
      const d = Math.hypot(p.move.x - from.move.x, p.move.z - from.move.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Next player to watch after `cur` (alive entrants by id order, wrapping). */
  nextToWatch(viewer: PlayerState): string | null {
    const alive = this.aliveEntrants().filter((p) => p !== viewer).map((p) => p.id).sort();
    if (!alive.length) return null;
    const cur = bx(viewer).watching;
    const i = cur ? alive.indexOf(cur) : -1;
    return alive[(i + 1) % alive.length]!;
  }

  // -------------------------------------------------------------------------------------------
  // Spatial queries, level of detail, far fights
  // -------------------------------------------------------------------------------------------

  private static key(x: number, z: number): number {
    return (Math.floor(x / 32) + 512) * 1024 + (Math.floor(z / 32) + 512);
  }

  private rebuildGrid(): void {
    this.grid.clear();
    for (const p of this.room.players.values()) {
      if (!p.alive) continue;
      const k = BlackoutGame.key(p.move.x, p.move.z);
      const l = this.grid.get(k);
      if (l) l.push(p);
      else this.grid.set(k, [p]);
    }
  }

  /** Alive players within `r` (horizontal) of a point. */
  playersNear(x: number, z: number, r: number): PlayerState[] {
    const out: PlayerState[] = [];
    for (let i = Math.floor((x - r) / 32); i <= Math.floor((x + r) / 32); i++)
      for (let j = Math.floor((z - r) / 32); j <= Math.floor((z + r) / 32); j++) {
        const l = this.grid.get((i + 512) * 1024 + (j + 512));
        if (!l) continue;
        for (const p of l) if (Math.hypot(p.move.x - x, p.move.z - z) <= r) out.push(p);
      }
    return out;
  }

  /** Loot items and guns on the floor within `r` of a point. */
  lootNear(x: number, z: number, r: number): Entity[] {
    this.loot.rebuild(this.room, this.lootVersion);
    return this.loot.near(x, z, r);
  }

  lootChanged(): void {
    this.lootVersion++;
  }

  /** Bots near a human (or the player a dead human watches) think with the full brain. */
  private updateLod(): void {
    this.near.clear();
    const R = BLACKOUT.lod.nearDist;
    for (const h of this.room.players.values()) {
      if (h.isBot || !h.session) continue;
      const f = focusOf(this.room, h);
      for (const p of this.playersNear(f.x, f.z, R)) if (p.isBot) this.near.add(p.id);
    }
  }

  isNear(p: PlayerState): boolean {
    return this.near.has(p.id);
  }

  /** Fairness bookkeeping: bots fighting each human. */
  engage(target: PlayerState, bot: PlayerState): void {
    if (target.isBot) return;
    let s = this.engaged.get(target.id);
    if (!s) this.engaged.set(target.id, (s = new Set()));
    s.add(bot.id);
  }

  disengage(target: PlayerState, bot: PlayerState): void {
    this.engaged.get(target.id)?.delete(bot.id);
  }

  engagedOn(target: PlayerState): number {
    const s = this.engaged.get(target.id);
    if (!s) return 0;
    for (const id of s) {
      const b = this.room.players.get(id);
      if (!b?.alive || !(b.brain instanceof BlackoutBrain) || b.brain.target !== target) s.delete(id);
    }
    return s.size;
  }

  /**
   * Fights between bots far from every human, resolved cheaply: each far bot on the ground with a
   * loaded gun shoots at the nearest other far bot within `farFightRange` it can see (one line of
   * sight check per pair, cached 2 s): expected damage over `dt` from the gun's damage at that
   * range, its fire rate and a hit chance falling off with distance and growing with skill. Ammo
   * is spent; a knife only works within 2 m. Credited like a real kill.
   */
  private farFights(dt: number): void {
    const room = this.room;
    const R = BLACKOUT.lod.farFightRange;
    for (const p of this.aliveEntrants()) {
      const ps = bx(p);
      if (!p.isBot || this.near.has(p.id) || ps.stage !== 'ground' || ps.healUntil !== null || room.time - (ps.landedAt ?? room.time) < 4) continue;
      let foe: PlayerState | null = null;
      let fd: number = R;
      for (const q of this.playersNear(p.move.x, p.move.z, R)) {
        if (q === p || !q.isBot || this.near.has(q.id) || bx(q).stage !== 'ground') continue;
        const d = Math.hypot(q.move.x - p.move.x, q.move.z - p.move.z);
        if (d < fd) {
          fd = d;
          foe = q;
        }
      }
      if (!foe) continue;
      const key = p.id < foe.id ? `${p.id}|${foe.id}` : `${foe.id}|${p.id}`;
      let los = this.farLos.get(key);
      if (!los || room.time - los.t > 2) {
        los = { t: room.time, ok: room.world.lineOfSight({ x: p.move.x, y: p.move.y + 1.5, z: p.move.z }, { x: foe.move.x, y: foe.move.y + 1.2, z: foe.move.z }) };
        this.farLos.set(key, los);
      }
      if (!los.ok) continue;
      this.prof.farFights++;
      // Face each other (so a human arriving sees a fight, not two bots walking past).
      p.yaw = Math.atan2(-(foe.move.x - p.move.x), -(foe.move.z - p.move.z));
      if (p.brain instanceof BlackoutBrain) p.brain.aim.yaw = p.yaw;
      const w = currentWeapon(p);
      if (!w) continue;
      if (w.def.base.id === 'knife') {
        if (fd < 2 && Math.random() < 0.06) room.damage({ victim: foe, attacker: p, amount: 150, weapon: 'knife', part: 'torso', means: 'melee', from: p.move, distance: fd });
        continue;
      }
      if (w.mag <= 0) {
        if (w.reserve > 0) {
          const n = Math.min(w.def.magazine, w.reserve);
          w.reserve -= n;
          w.mag += n;
        }
        continue;
      }
      const shots = Math.min(w.mag, Math.max(1, Math.round((w.def.rpm / 60) * dt * 0.6)));
      w.mag -= shots;
      p.lastFireTime = room.time;
      const skill = p.ext.bots?.skill;
      const aimQ = skill ? clampNum(1.4 - skill.aimErrorDeg / 6, 0.4, 1.4) : 1;
      const hit = clampNum((0.32 - fd / 160) * aimQ, 0.03, 0.4);
      const dmg = damageAtRange(w.def, fd) * Math.max(1, w.def.pellets ?? 1) * 0.7 * shots * hit;
      if (dmg > 0) room.damage({ victim: foe, attacker: p, amount: dmg, weapon: w.def.base.id, part: 'torso', means: 'bullet', from: p.move, distance: fd });
    }
    if (this.farLos.size > 4000) this.farLos.clear();
  }

  results(reason: MatchResults['reason']): MatchResults {
    const room = this.room;
    const players = [...room.players.values()];
    const placeOf = (p: PlayerState) => this.places.get(p.id) ?? (p.alive && this.entrants.has(p.id) ? 1 : Infinity);
    const sorted = players.sort((a, b) => placeOf(a) - placeOf(b) || b.stats.kills - a.stats.kills);
    const winners = this.winner ? [this.winner] : [];
    const rows: PlayerResult[] = sorted.map((p, i) => ({
      id: p.id,
      profileId: p.profile?.id ?? null,
      name: p.name,
      team: p.team,
      bot: p.isBot,
      kills: p.stats.kills,
      deaths: p.stats.deaths,
      assists: p.stats.assists,
      headshots: p.stats.headshots,
      score: p.stats.score,
      bestStreak: p.stats.bestStreak,
      place: Number.isFinite(placeOf(p)) ? placeOf(p) : i + 1,
      won: winners.includes(p.id),
      timePlayed: Math.max(0, room.time - Math.max(p.joinTime, room.matchStartTime)),
    }));
    const places: Record<string, number> = {};
    for (const [id, pl] of this.places) places[id] = pl;
    return {
      roomId: room.id,
      mode: room.mode.id,
      map: room.mapId,
      reason,
      winnerTeam: null,
      winners,
      teamScores: null,
      players: rows,
      durationSec: Math.max(0, room.time - room.matchStartTime),
      ext: { blackout: { places, winner: this.winner, total: this.entrants.size } },
    };
  }

  // -------------------------------------------------------------------------------------------
  // State push
  // -------------------------------------------------------------------------------------------

  private push(): void {
    const room = this.room;
    const all = room.time >= this.nextState;
    if (all) this.nextState = room.time + STATE_EVERY;
    for (const p of room.players.values()) {
      if (!p.session || (!all && !this.dirty.has(p.id))) continue;
      room.sendFeature(p, 'blackout.state', this.stateFor(p));
    }
    this.dirty.clear();
  }

  pushAll(): void {
    this.nextState = 0;
    this.push();
  }

  stateFor(p: PlayerState): BlackoutStatePayload {
    const st = bx(p);
    const b = this.room.map.bounds;
    const half = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
    return {
      alive: this.t0 === null ? this.room.players.size : this.aliveCount(),
      total: this.t0 === null ? this.room.players.size : this.entrants.size,
      t0: this.t0 ?? -1,
      seed: this.seed,
      start: this.circles[0] ?? { x: 0, z: 0, r: half * Math.SQRT2 + 8 },
      plane: this.plane,
      stage: p.alive ? st.stage : 'ground',
      armor: Math.round(st.armor),
      armorMax: st.armorMax,
      bandages: st.bandages,
      medkits: st.medkits,
      healUntil: st.healUntil,
      kills: p.stats.kills,
      place: st.place,
      watching: p.alive ? null : st.watching,
    };
  }

  /** Spectate: the next alive player (or the killer first). */
  spectate(p: PlayerState, next: boolean): string | null {
    if (p.alive) return null;
    const st = bx(p);
    st.watching = next || !st.killer || !this.room.players.get(st.killer)?.alive ? this.nextToWatch(p) : st.killer;
    this.dirty.add(p.id);
    return st.watching;
  }

  /** Keep the loot under its cap (tests call it after dropping things). */
  trim(): void {
    trimLoot(this.room);
    this.lootVersion++;
  }

  /** Give the frag counts to the client after changes (tests). */
  syncEquip(p: PlayerState): void {
    sendEquip(this.room, p);
  }
}
