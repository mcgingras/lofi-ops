/**
 * Buying in Zombies: wall-buys (chalk outlines: the gun, or its ammo if you already carry it),
 * Perk-a-Cola machines and the Mystery Box. Hold USE (`BUY_HOLD`) at one to buy; USE must be let go
 * before the next purchase. While a buyable is in reach it claims USE (`useClaimed`), so weapon
 * pickups and other USE actions stand aside.
 *
 * The box (BO1 `_zombiemode_weapons.gsc`): 950 points, the lid opens, weapons cycle and land on a
 * roll (every classable gun the buyer doesn't carry, the Ray Gun rarer, other wonder weapons rarer
 * still); the buyer takes it with USE within 12 s or it sinks back. After four uses the teddy bear
 * can show up (`teddyRoll`): the points are refunded, the box flies up its beam and comes down at
 * another spot a few seconds later. Entity `zm_box` carries the killstreak box's `BoxSnap` fields.
 */
import { BOX_CYCLE_SEC, BOX_PHASE, MYSTERY_BOX } from '../../../shared/defs/mystery-box';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { ammoPrice, BOX, PERK_COLA_BY_ID, PERK_EFFECTS, perkPrice, rollBoxWeapon, teddyRoll, WALL_PRICES, ZM_ENTITY, type PerkColaId } from '../../../shared/defs/zombies';
import type { ZombiesItemSpot, ZombiesWallBuy } from '../../../shared/maps/zombies/index';
import { Buttons } from '../../../shared/input';
import type { Entity } from '../../entities';
import { forceSlot } from '../../combat';
import { makeWeapon, type PlayerState } from '../../player';
import type { ZombiesGame } from './game';
import { survivorOf } from './state';

/** Seconds USE must be held to buy. */
export const BUY_HOLD = 0.2;
/** Reach from a wall-buy's chalk (and only from in front of it), a perk machine, the box. */
export const REACH = { wall: 1.7, perk: 1.9, box: BOX.reach } as const;

interface WallBuy {
  ent: Entity;
  spot: ZombiesWallBuy;
  price: number;
  ammo: number;
}
interface PerkMachine {
  ent: Entity;
  id: PerkColaId;
}
type Target = { kind: 'wall'; wall: WallBuy } | { kind: 'perk'; perk: PerkMachine } | { kind: 'box' };

interface BoxState {
  ent: Entity | null;
  spot: number;
  /** Uses since the last move (BO1 `chest_accessed`) and moves so far (`chest_moves`). */
  accessed: number;
  moves: number;
  user: PlayerState | null;
  weapon: string | null;
  teddy: boolean;
  openAt: number;
  showAt: number;
  offerEnd: number;
  /** The lid is closing (after a take or a timeout) since this time. */
  closingAt: number | null;
  /** Teddy: the box left at `leaveAt`, and lands somewhere else at `landAt`. */
  leaveAt: number | null;
  nextSpot: number;
  landAt: number | null;
  /** The buyer has let go of USE since opening (taking needs a fresh press). */
  released: boolean;
}

const yawDir = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

export class Buyables {
  walls: WallBuy[] = [];
  perks: PerkMachine[] = [];
  box: BoxState = Buyables.freshBox();

  constructor(private game: ZombiesGame) {}

  private static freshBox(): BoxState {
    return { ent: null, spot: 0, accessed: 0, moves: 0, user: null, weapon: null, teddy: false, openAt: 0, showAt: 0, offerEnd: 0, closingAt: null, leaveAt: null, nextSpot: 0, landAt: null, released: false };
  }

  /** Each match start (entities were just cleared): place everything from the map's layer. */
  reset(): void {
    const room = this.game.room;
    const layer = this.game.layer;
    this.walls = [];
    this.perks = [];
    this.box = Buyables.freshBox();
    if (!layer) return;
    for (const w of layer.wallBuys) {
      const price = w.price ?? WALL_PRICES[w.weapon] ?? 1000;
      const ent = room.entities.add({ kind: ZM_ENTITY.wall, x: w.x, y: w.y, z: w.z, yaw: w.yaw, s: { w: w.weapon, p: price, a: ammoPrice(price) } });
      this.walls.push({ ent, spot: w, price, ammo: ammoPrice(price) });
    }
    for (const m of layer.perks) {
      const ent = room.entities.add({ kind: ZM_ENTITY.perk, x: m.x, y: m.y, z: m.z, yaw: m.yaw, s: { k: m.perk, p: PERK_COLA_BY_ID.get(m.perk)!.price } });
      this.perks.push({ ent, id: m.perk });
    }
    layer.boxSpots.forEach((b, i) => {
      if (i > 0) room.entities.add({ kind: ZM_ENTITY.boxSpot, x: b.x, y: b.y, z: b.z, yaw: b.yaw, s: {} });
    });
    if (layer.boxSpots.length) this.placeBox(0, room.time - 10);
  }

  /** The box at spot `i`; `t0` is when its call-in started (in the past = already standing there). */
  private placeBox(i: number, t0: number): void {
    const room = this.game.room;
    const spot = this.game.layer!.boxSpots[i]!;
    const tl = t0 + MYSTERY_BOX.descendAt + MYSTERY_BOX.descendSec;
    const landed = room.time >= tl;
    this.box.ent = room.entities.add({ kind: ZM_ENTITY.box, x: spot.x, y: spot.y, z: spot.z, yaw: spot.yaw, s: { ph: landed ? BOX_PHASE.idle : BOX_PHASE.call, t0, tl, sd: 1 + Math.floor(Math.random() * 1e6), o: '', c: BOX.cost } });
    this.box.spot = i;
    this.box.landAt = landed ? null : tl;
  }

  // -------------------------------------------------------------------------------------------
  // Reach
  // -------------------------------------------------------------------------------------------

  /** The buyable `p` stands at, if any (nearest). */
  targetOf(p: PlayerState): Target | null {
    const m = p.move;
    let best: Target | null = null;
    let bd = Infinity;
    for (const w of this.walls) {
      const f = yawDir(w.spot.yaw);
      const dx = m.x - w.spot.x;
      const dz = m.z - w.spot.z;
      const d = Math.hypot(dx, dz);
      // In front of the chalk, within reach, on its floor.
      if (d > REACH.wall || dx * f.x + dz * f.z < 0.1 || Math.abs(m.y - w.spot.y) > 1.2) continue;
      if (d < bd) {
        bd = d;
        best = { kind: 'wall', wall: w };
      }
    }
    for (const k of this.perks) {
      const d = Math.hypot(m.x - k.ent.x, m.z - k.ent.z);
      if (d > REACH.perk || Math.abs(m.y - k.ent.y) > 1.2) continue;
      if (d < bd) {
        bd = d;
        best = { kind: 'perk', perk: k };
      }
    }
    const b = this.box.ent;
    if (b) {
      const d = Math.hypot(m.x - b.x, m.z - b.z);
      if (d <= REACH.box && Math.abs(m.y - b.y) < BOX.dy && d < bd) best = { kind: 'box' };
    }
    return best;
  }

  claimsUse(p: PlayerState): boolean {
    return !!survivorOf(p) && p.alive && !this.game.isDown(p) && this.targetOf(p) !== null;
  }

  // -------------------------------------------------------------------------------------------
  // Tick: USE holds, the box's timeline
  // -------------------------------------------------------------------------------------------

  tick(dt: number): void {
    const g = this.game;
    const room = g.room;
    const now = room.time;
    for (const p of g.survivors()) {
      const s = survivorOf(p)!;
      if (s.drinkingUntil > 0 && now >= s.drinkingUntil) this.finishDrink(p);
      const held = (p.buttons & Buttons.USE) !== 0;
      if (!held) {
        s.useLatched = false;
        s.useHold = 0;
        if (this.box.user === p) this.box.released = true;
        continue;
      }
      if (!g.isUp(p) || s.useLatched || s.drinkingUntil > now) continue;
      const t = this.targetOf(p);
      if (!t) {
        s.useHold = 0;
        continue;
      }
      const id = t.kind === 'wall' ? t.wall.ent.id : t.kind === 'perk' ? t.perk.ent.id : (this.box.ent?.id ?? -1);
      if (s.useTarget !== id) {
        s.useTarget = id;
        s.useHold = 0;
      }
      s.useHold += dt;
      if (s.useHold < BUY_HOLD) continue;
      s.useLatched = true;
      s.useHold = 0;
      if (t.kind === 'wall') this.buyWall(p, t.wall);
      else if (t.kind === 'perk') this.buyPerk(p, t.perk);
      else this.useBox(p);
    }
    this.boxTick(now);
  }

  // -------------------------------------------------------------------------------------------
  // Wall-buys
  // -------------------------------------------------------------------------------------------

  buyWall(p: PlayerState, w: WallBuy): boolean {
    const g = this.game;
    const id = w.spot.weapon;
    const owned = p.weapons.find((x) => x.def.base.id === id);
    if (owned) {
      if (owned.reserve >= owned.def.reserve && owned.mag >= owned.def.magazine) return this.nope(p, 'AMMO FULL');
      if (!g.spend(p, w.ammo)) return this.nope(p, 'NOT ENOUGH POINTS');
      owned.reserve = owned.def.reserve;
      g.event({ kind: 'ammo', player: p.id, id }, p);
      g.room.bus.emit('zombies.bought', { player: p, what: `ammo:${id}`, cost: w.ammo });
      return true;
    }
    if (!g.spend(p, w.price)) return this.nope(p, 'NOT ENOUGH POINTS');
    this.giveWeapon(p, id);
    g.event({ kind: 'buy', player: p.id, id, text: WEAPON_BY_ID.get(id)?.name ?? id }, p);
    g.room.bus.emit('zombies.bought', { player: p, what: id, cost: w.price });
    return true;
  }

  /** Into an empty slot, else in place of the gun in hand (BO1: two guns). */
  giveWeapon(p: PlayerState, id: string): void {
    const room = this.game.room;
    const has = p.weapons.findIndex((x) => x.def.base.id === id);
    const fresh = makeWeapon({ weapon: id, attachments: [], camo: 'none' }, id);
    if (has >= 0) {
      p.weapons[has] = fresh;
      forceSlot(room, p, has);
      return;
    }
    if (p.weapons.length < 2) {
      p.weapons.push(fresh);
      forceSlot(room, p, p.weapons.length - 1);
      return;
    }
    const slot = Math.max(0, Math.min(p.weapons.length - 1, p.slot));
    p.weapons[slot] = fresh;
    p.reloadEnd = 0;
    p.swapEnd = room.time + (fresh.def.swapMs ?? 500) / 1000;
    room.bus.emit('weaponSwitch', { player: p, slot, weapon: id });
  }

  private nope(p: PlayerState, text: string): false {
    this.game.event({ kind: 'nope', player: p.id, text }, p);
    return false;
  }

  // -------------------------------------------------------------------------------------------
  // Perk-a-Colas
  // -------------------------------------------------------------------------------------------

  buyPerk(p: PlayerState, m: PerkMachine): boolean {
    const g = this.game;
    const s = survivorOf(p)!;
    if (s.perks.includes(m.id)) return this.nope(p, 'ALREADY HAVE IT');
    if (s.drinkingUntil > g.room.time) return false;
    const solo = g.solo;
    if (m.id === 'revive' && solo && g.soloLives <= 0) return this.nope(p, 'SOLD OUT');
    const price = perkPrice(m.id, solo);
    if (!g.spend(p, price)) return this.nope(p, 'NOT ENOUGH POINTS');
    if (m.id === 'revive' && solo) {
      g.soloLives--;
      if (g.soloLives <= 0) m.ent.s = { ...m.ent.s, off: 1 };
    }
    // The drink: the gun goes down for the bottle, then the perk kicks in.
    s.drinkingUntil = g.room.time + PERK_EFFECTS.drinkSec;
    s.pendingPerk = m.id;
    p.reloadEnd = 0;
    p.swapEnd = Math.max(p.swapEnd, s.drinkingUntil + 0.3);
    g.event({ kind: 'perk', player: p.id, id: m.id, text: 'drink' });
    g.room.bus.emit('zombies.bought', { player: p, what: `perk:${m.id}`, cost: price });
    g.dirty = true;
    return true;
  }

  private finishDrink(p: PlayerState): void {
    const s = survivorOf(p)!;
    s.drinkingUntil = 0;
    const id = s.pendingPerk;
    s.pendingPerk = null;
    if (id && p.alive && !this.game.isDown(p)) this.game.givePerk(p, id);
  }

  // -------------------------------------------------------------------------------------------
  // Mystery Box
  // -------------------------------------------------------------------------------------------

  private setBox(patch: Record<string, number | string | undefined>): void {
    const e = this.box.ent;
    if (!e) return;
    const next: Record<string, number | string> = { ...(e.s as Record<string, number | string>) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    e.s = next;
  }

  private boxPhase(): number {
    return Number((this.box.ent?.s as { ph?: number } | undefined)?.ph ?? -1);
  }

  useBox(p: PlayerState): boolean {
    const g = this.game;
    const b = this.box;
    if (!b.ent) return false;
    const ph = this.boxPhase();
    if (ph === BOX_PHASE.offer && b.user === p && !b.teddy && b.weapon && b.released) {
      this.giveWeapon(p, b.weapon);
      g.event({ kind: 'buy', player: p.id, id: b.weapon, text: WEAPON_BY_ID.get(b.weapon)?.name ?? b.weapon }, p);
      this.closeBox(true);
      return true;
    }
    if (ph !== BOX_PHASE.idle || b.closingAt !== null) return false;
    if (!g.spend(p, BOX.cost)) return this.nope(p, 'NOT ENOUGH POINTS');
    const now = g.room.time;
    b.accessed++;
    b.user = p;
    b.released = false;
    b.teddy = (g.layer?.boxSpots.length ?? 0) > 1 && teddyRoll(b.accessed, b.moves, Math.random());
    b.weapon = b.teddy ? 'teddy' : rollBoxWeapon(p.weapons.map((w) => w.def.base.id), Math.random());
    b.openAt = now;
    b.showAt = now + BOX_CYCLE_SEC;
    b.offerEnd = b.showAt + BOX.offerSec;
    this.setBox({ ph: BOX_PHASE.open, to: now, tw: b.showAt, te: b.offerEnd, w: b.weapon, o: p.id, sd: 1 + Math.floor(Math.random() * 1e6), tk: undefined, tc: undefined, tx: undefined, ty: b.teddy ? 1 : undefined });
    g.event({ kind: 'box', player: p.id });
    g.room.bus.emit('zombies.bought', { player: p, what: 'box', cost: BOX.cost });
    return true;
  }

  /** The weapon was taken (or the offer ran out): the lid shuts, the box waits again. */
  private closeBox(taken: boolean): void {
    const b = this.box;
    b.closingAt = this.game.room.time;
    this.setBox({ tk: taken ? 1 : undefined, tc: b.closingAt });
  }

  private boxTick(now: number): void {
    const g = this.game;
    const b = this.box;
    const layer = g.layer;
    if (!layer) return;
    if (!b.ent) {
      // Teddy bear: the box comes down at its next spot.
      if (b.landAt === null && b.leaveAt !== null && now >= b.leaveAt + BOX.moveSec) {
        b.leaveAt = null;
        this.placeBox(b.nextSpot, now);
        g.event({ kind: 'box_move' });
      }
      return;
    }
    const ph = this.boxPhase();
    if (b.landAt !== null && now >= b.landAt) {
      b.landAt = null;
      this.setBox({ ph: BOX_PHASE.idle });
    }
    if (ph === BOX_PHASE.open && now >= b.showAt) this.setBox({ ph: BOX_PHASE.offer });
    if (ph === BOX_PHASE.offer && b.teddy && b.leaveAt === null && now >= b.showAt + 1.6) {
      // BO1: the bear laughs, the box flies away, the points come back.
      if (b.user && survivorOf(b.user)) {
        const s = survivorOf(b.user)!;
        s.points += BOX.cost;
        g.event({ kind: 'points', player: b.user.id, amount: BOX.cost }, b.user);
      }
      b.leaveAt = now;
      b.moves++;
      b.accessed = 0;
      const spots = layer.boxSpots.map((_, i) => i).filter((i) => i !== b.spot);
      b.nextSpot = spots[Math.floor(Math.random() * spots.length)] ?? b.spot;
      this.setBox({ ph: BOX_PHASE.leave, tx: now });
      g.event({ kind: 'teddy', player: b.user?.id });
      g.dirty = true;
    }
    if (ph === BOX_PHASE.leave && b.leaveAt !== null && now >= b.leaveAt + MYSTERY_BOX.closeSec + MYSTERY_BOX.leaveSec) {
      g.room.entities.remove(b.ent.id);
      b.ent = null;
      b.user = null;
      b.weapon = null;
      return;
    }
    if (ph === BOX_PHASE.offer && !b.teddy && b.closingAt === null && now >= b.offerEnd) this.closeBox(false);
    if (b.closingAt !== null && now >= b.closingAt + MYSTERY_BOX.closeSec) {
      b.closingAt = null;
      b.user = null;
      b.weapon = null;
      this.setBox({ ph: BOX_PHASE.idle, to: undefined, tw: undefined, te: undefined, w: undefined, tk: undefined, tc: undefined, o: '' });
    }
  }

  /** Spots the box can use (tests). */
  get boxSpots(): readonly ZombiesItemSpot[] {
    return this.game.layer?.boxSpots ?? [];
  }
}
