/**
 * Mystery Box (BO1 Zombies' box as a killstreak; timeline and maths in shared/defs/mystery-box.ts).
 *
 * Humans throw the Care Package marker (a `ks_marker` with `s.mb` = 1, the box canister); where it
 * settles (`resolveDrop`, the same rules as a crate: open sky, inside the map) the call-in starts:
 * a beam of light, the sky flickers, lightning strikes, and the box (`ks_mbox`) rides the beam down
 * and crashes in, crushing enemies under it. Bots (and the RPC) skip the canister: the box comes
 * down a couple of metres in front of a bot, or at the RPC's target.
 *
 * The owner holds USE at the box (MYSTERY_BOX.reach) to open it: the lid opens and weapons cycle
 * for ~3 s, landing on a wonder weapon the owner doesn't carry (`rollWonder`, never a teddy bear).
 * A fresh USE press then takes it into the hand they hold, on loan for WONDER_LOAN.sec: the old
 * gun is put away and comes back when the loan ends (`giveWonder` / `endLoan`; the clock runs
 * through death, the owner respawns holding it, and it never drops at the body meanwhile). Untaken, it sinks back after MYSTERY_BOX.offerSec; then, or after a
 * take, the box flies up the beam and is gone. An unopened box leaves after `idleSec`.
 *
 * Enemies see the beam and the box but can't open it or take its weapon; nor can teammates (it's
 * the owner's roll, and a stolen roll would be a feel-bad for the one who earned it). Bot owners
 * open it the moment it lands and take the weapon when it shows (bots don't walk to it).
 * While the owner is in reach the box claims USE (`useClaimed`), so weapon pickups stand aside.
 */
import { MARKER, markerBody, markerStep, resolveDrop } from '../../../../shared/defs/care-marker';
import { KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { BOX_CYCLE_SEC, BOX_PHASE, MYSTERY_BOX, MYSTERY_BOX_ENTITY, MYSTERY_BOX_ID, rollWonder, WONDER_LOAN, type BoxPhase } from '../../../../shared/defs/mystery-box';
import { Buttons } from '../../../../shared/input';
import type { Vec3 } from '../../../../shared/math';
import type { Body } from '../../../../shared/projectile';
import { forceSlot } from '../../../combat';
import type { Entity } from '../../../entities';
import { makeWeapon, type PlayerState, type WeaponState } from '../../../player';
import type { Room } from '../../../room';
import type { Active, KsRoom } from '../world';
import type { CallArgs } from './types';

/** The live state of one box (server side). */
export interface MysteryBox {
  ent: Entity;
  owner: PlayerState;
  phase: BoxPhase;
  /** Room times: call start, landing, lid open, result shows, offer ends, leave start. */
  t0: number;
  tl: number;
  to: number;
  tw: number;
  te: number;
  tx: number;
  /** Unopened boxes leave at this time. */
  idleUntil: number;
  weapon: string | null;
  taken: boolean;
  /** Seconds the owner has held USE at the closed box. */
  hold: number;
  /** USE was down last tick (taking needs a fresh press). */
  useWas: boolean;
}

const boxes = new WeakMap<KsRoom, MysteryBox[]>();
export const boxesOf = (ctx: KsRoom): MysteryBox[] => {
  let b = boxes.get(ctx);
  if (!b) boxes.set(ctx, (b = []));
  return b;
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function snap(b: MysteryBox): void {
  b.ent.s = {
    ph: b.phase,
    t0: r3(b.t0),
    tl: r3(b.tl),
    sd: (b.ent.s?.sd as number) ?? 1,
    o: b.owner.id,
    ...(b.phase >= BOX_PHASE.open ? { to: r3(b.to), tw: r3(b.tw), w: b.weapon ?? '' } : {}),
    ...(b.phase >= BOX_PHASE.offer ? { te: r3(b.te) } : {}),
    ...(b.phase === BOX_PHASE.leave ? { tx: r3(b.tx) } : {}),
    ...(b.taken ? { tk: 1 } : {}),
  };
}

/** Is `p` close enough to the box to open it or take from it? */
export const inBoxReach = (b: MysteryBox, p: PlayerState): boolean => p.alive && Math.hypot(p.move.x - b.ent.x, p.move.z - b.ent.z) <= MYSTERY_BOX.reach && Math.abs(p.move.y - b.ent.y) < MYSTERY_BOX.dy;

/** The owner stands at their own box while it can be opened or taken from: USE belongs to it. */
export function boxClaimsUse(ctx: KsRoom, p: PlayerState): boolean {
  return boxesOf(ctx).some((b) => b.owner === p && (b.phase === BOX_PHASE.idle || b.phase === BOX_PHASE.open || b.phase === BOX_PHASE.offer) && inBoxReach(b, p));
}

/** A Mystery Box loan on a player: the wonder weapon, the slot it took, when it ends, and what it replaced. */
export interface WonderLoan {
  weapon: WeaponState;
  slot: number;
  until: number;
  /** The gun it replaced (comes back when the loan ends), and the underbarrel launcher slot it took with it. */
  stash: WeaponState | null;
  gl: WeaponState | null;
}

declare module '../../../player' {
  interface PlayerExt {
    wonderLoan?: WonderLoan;
  }
}

/** The loan running on `p` (null when none). */
export const loanOf = (p: PlayerState): WonderLoan | null => p.ext.wonderLoan ?? null;

/** Put `w` into `p`'s slot `slot`, dropping the launcher slot when no carried gun has the launcher any more. */
function seat(room: Room, p: PlayerState, slot: number, w: WeaponState): WeaponState | null {
  const gl = p.weapons[2]?.def.base.id === 'gl' ? p.weapons[2]! : null;
  w.creditTime = room.time;
  p.weapons[slot] = w;
  if (gl && !p.weapons.slice(0, 2).some((x) => x.def.attachmentIds.includes('gl'))) {
    p.weapons.splice(2, 1);
    return gl;
  }
  return null;
}

/**
 * Put a wonder weapon in `p`'s hands on loan (WONDER_LOAN.sec): it replaces the gun they hold (the
 * primary if the underbarrel launcher is up); that gun is put away and comes back when the loan ends.
 */
export function giveWonder(room: Room, p: PlayerState, weaponId: string): void {
  // A second box while a loan runs: the first loan ends now (its gun gives way to the new one).
  if (loanOf(p)) endLoan(room, p, false);
  if (p.slot >= 2) forceSlot(room, p, 0);
  const slot = p.slot;
  const old = p.weapons[slot] ?? null;
  const nw = makeWeapon({ weapon: weaponId, attachments: [], camo: 'none' }, weaponId);
  const gl = seat(room, p, slot, nw);
  p.reloadEnd = 0;
  p.swapEnd = room.time + ((nw.def.swapMs ?? 500) / 1000) * room.modifiers.mul('swapMultiplier', p);
  p.ext.wonderLoan = { weapon: nw, slot, until: room.time + WONDER_LOAN.sec, stash: old, gl };
  room.sendFeature(p, 'killstreaks.wonderLoan', { w: weaponId, until: r3(room.time + WONDER_LOAN.sec) });
  room.bus.emit('weaponSwitch', { player: p, slot, weapon: weaponId });
}

/** End `p`'s loan: the wonder weapon goes, the gun it replaced comes back and the primary is put in hand (when alive). */
export function endLoan(room: Room, p: PlayerState, toPrimary = true): void {
  const loan = loanOf(p);
  if (!loan) return;
  delete p.ext.wonderLoan;
  const at = p.weapons.indexOf(loan.weapon);
  if (at >= 0 && at < 2) {
    const fallback = at === 0 ? (p.loadout?.primary ?? { weapon: 'ak47', attachments: [], camo: 'none' }) : (p.loadout?.secondary ?? { weapon: 'm1911', attachments: [], camo: 'none' });
    const back = loan.stash ?? makeWeapon(fallback, at === 0 ? 'primary' : 'secondary');
    seat(room, p, at, back);
    if (back.def.attachmentIds.includes('gl') && p.weapons.length === 2) p.weapons.push(loan.gl ?? makeWeapon({ weapon: 'gl', attachments: [], camo: back.camo }, 'gl'));
    if (p.alive && toPrimary) {
      p.reloadEnd = 0;
      if (p.slot === 0) {
        p.swapEnd = room.time + ((p.weapons[0]!.def.swapMs ?? 500) / 1000) * room.modifiers.mul('swapMultiplier', p);
        room.bus.emit('weaponSwitch', { player: p, slot: 0, weapon: p.weapons[0]!.def.base.id });
      } else forceSlot(room, p, 0);
    }
  }
  room.sendFeature(p, 'killstreaks.wonderLoan', { w: null, until: 0, ...(p.alive && toPrimary ? { slot: 0 } : {}) });
}

/** Where a bot's box comes down: a couple of metres in front of it (never on its own head). */
function botSpot(ctx: KsRoom, p: PlayerState): Vec3 {
  const t = ctx.clampToMap({ x: p.move.x - Math.sin(p.yaw) * 2.2, y: p.move.y, z: p.move.z - Math.cos(p.yaw) * 2.2 });
  return { x: t.x, y: ctx.groundAt(t.x, t.z), z: t.z };
}

/** Called through `callKillstreak(room, p, 'mystery_box', ...)`: a thrown canister (`launch`) or a target / the bot's spot. */
export function callMysteryBox(ctx: KsRoom, p: PlayerState, args: CallArgs): string | null {
  const room = ctx.room;
  let canister: { ent: Entity; body: Body | null; flown: number; from: Vec3 };
  let box: MysteryBox | null = null;
  if (args.launch) {
    const l = args.launch.throw;
    const ent = room.entities.add({ kind: KS_ENTITY.marker, x: l.pos.x, y: l.pos.y, z: l.pos.z, yaw: Math.atan2(-l.vel.x, -l.vel.z), owner: p.id, team: p.team, s: { k: 0, mb: 1 } });
    canister = { ent, body: markerBody(l), flown: 0, from: { ...args.launch.from } };
  } else {
    const want = p.isBot || !args.target ? botSpot(ctx, p) : ctx.clampToMap(args.target);
    const drop = resolveDrop(room.world, room.map, { x: want.x, y: ctx.groundAt(want.x, want.z), z: want.z }, { x: p.move.x, y: p.move.y, z: p.move.z }, true);
    const ent = room.entities.add({ kind: KS_ENTITY.marker, x: drop.x, y: drop.y, z: drop.z, yaw: Math.random() * Math.PI * 2, owner: p.id, team: p.team, s: { k: 1, sm: room.time, v: 1, mb: 1 } });
    canister = { ent, body: null, flown: 0, from: drop };
  }
  const act: Active = {
    streak: MYSTERY_BOX_ID,
    owner: p,
    entities: [canister.ent.id],
    update(dt) {
      const b = canister.body;
      if (b && room.entities.get(canister.ent.id)) {
        markerStep(room.world, b, dt);
        canister.flown += dt;
        const e = canister.ent;
        if (Math.hypot(b.pos.x - e.x, b.pos.z - e.z) > 1e-3) e.yaw = Math.atan2(-(b.pos.x - e.x), -(b.pos.z - e.z));
        e.x = b.pos.x;
        e.y = b.pos.y;
        e.z = b.pos.z;
        const lost = b.pos.y < room.map.bounds.min.y - 20;
        if (b.resting || lost || canister.flown >= MARKER.maxFlightSec - 1e-6) {
          canister.body = null;
          const drop = resolveDrop(room.world, room.map, b.pos, canister.from, b.resting);
          if (lost || drop.reason === 'bounds') {
            e.x = drop.x;
            e.y = drop.y;
            e.z = drop.z;
          }
          e.s = { k: 1, sm: room.time + 0.3, v: drop.valid ? 1 : 0, mb: 1 };
          room.bus.emit('killstreaks.marker', { player: p, x: drop.x, y: drop.y, z: drop.z, valid: drop.valid, reason: drop.reason });
          box = startBox(ctx, act, p, { x: drop.x, y: drop.y, z: drop.z }, room.time + 0.5);
        }
      } else if (!b && !box) box = startBox(ctx, act, p, { x: canister.ent.x, y: canister.ent.y, z: canister.ent.z }, room.time + 0.2);
      if (box) {
        // The canister goes once the box is down.
        if (room.entities.get(canister.ent.id) && room.time >= box.tl) ctx.removeEntity(canister.ent.id);
        return updateBox(ctx, box, dt);
      }
      return true;
    },
    cleanup() {
      const list = boxesOf(ctx);
      for (let i = list.length - 1; i >= 0; i--) if (act.entities.includes(list[i]!.ent.id)) list.splice(i, 1);
    },
  };
  ctx.add(act);
  return null;
}

function startBox(ctx: KsRoom, act: Active, owner: PlayerState, at: Vec3, t0: number): MysteryBox {
  const room = ctx.room;
  const tl = t0 + MYSTERY_BOX.descendAt + MYSTERY_BOX.descendSec;
  // Its front (model -z, game yaw convention) faces the owner, so the lid opens toward them.
  const yaw = Math.atan2(-(owner.move.x - at.x), -(owner.move.z - at.z));
  const ent = room.entities.add({ kind: MYSTERY_BOX_ENTITY, x: at.x, y: at.y, z: at.z, yaw, owner: owner.id, team: owner.team, s: { sd: 1 + Math.floor(Math.random() * 1e6) } });
  act.entities.push(ent.id);
  const b: MysteryBox = { ent, owner, phase: BOX_PHASE.call, t0, tl, to: 0, tw: 0, te: 0, tx: 0, idleUntil: tl + MYSTERY_BOX.idleSec, weapon: null, taken: false, hold: 0, useWas: false };
  snap(b);
  boxesOf(ctx).push(b);
  return b;
}

/** Open the lid and roll (the result is fixed now; the cycle is for show). */
export function openBox(ctx: KsRoom, b: MysteryBox): void {
  const now = ctx.room.time;
  b.phase = BOX_PHASE.open;
  b.to = now;
  b.tw = now + BOX_CYCLE_SEC;
  b.weapon = rollWonder(b.owner.weapons.slice(0, 2).map((w) => w.def.base.id));
  snap(b);
}

/** Take the offered weapon (owner, alive, in reach: checked by the caller). */
export function takeFromBox(ctx: KsRoom, b: MysteryBox): void {
  if (!b.weapon) return;
  giveWonder(ctx.room, b.owner, b.weapon);
  b.taken = true;
  leave(ctx, b);
  ctx.room.bus.emit('killstreaks.boxTaken', { player: b.owner, weapon: b.weapon });
}

function leave(ctx: KsRoom, b: MysteryBox): void {
  b.phase = BOX_PHASE.leave;
  b.tx = ctx.room.time;
  snap(b);
}

/** One tick of a box. Returns false once it has flown away. */
function updateBox(ctx: KsRoom, b: MysteryBox, dt: number): boolean {
  const room = ctx.room;
  const now = room.time;
  const o = b.owner;
  const ownerHere = room.players.get(o.id) === o;
  const use = ownerHere && o.alive && (o.buttons & Buttons.USE) !== 0;
  const pressed = use && !b.useWas;
  b.useWas = use;
  switch (b.phase) {
    case BOX_PHASE.call:
      if (now >= b.tl) {
        b.phase = BOX_PHASE.idle;
        snap(b);
        // It crashes in: enemies under it are crushed (never its owner or their team).
        for (const q of room.players.values()) {
          if (q === o || !q.alive || !room.isEnemy(o, q)) continue;
          if (Math.hypot(q.move.x - b.ent.x, q.move.z - b.ent.z) < MYSTERY_BOX.crushR && Math.abs(q.move.y - b.ent.y) < 1.8)
            room.damage({ victim: q, attacker: o, amount: 1000, weapon: MYSTERY_BOX_ID, part: null, means: 'killstreak', from: { x: b.ent.x, y: b.ent.y + 2, z: b.ent.z }, distance: 0 });
        }
        if (o.isBot && ownerHere && o.alive) openBox(ctx, b);
      }
      return true;
    case BOX_PHASE.idle:
      if (now >= b.idleUntil || !ownerHere) {
        leave(ctx, b);
        return true;
      }
      if (o.isBot) {
        if (o.alive) openBox(ctx, b);
      } else if (use && inBoxReach(b, o)) {
        b.hold += dt;
        if (b.hold >= MYSTERY_BOX.openHoldSec - 1e-6) openBox(ctx, b);
      } else b.hold = 0;
      return true;
    case BOX_PHASE.open:
      if (now >= b.tw) {
        b.phase = BOX_PHASE.offer;
        b.te = now + MYSTERY_BOX.offerSec;
        snap(b);
        if (o.isBot && ownerHere && o.alive) takeFromBox(ctx, b);
      }
      return true;
    case BOX_PHASE.offer:
      if (now >= b.te || !ownerHere) {
        leave(ctx, b);
        return true;
      }
      if (pressed && inBoxReach(b, o)) takeFromBox(ctx, b);
      else if (o.isBot && o.alive) takeFromBox(ctx, b);
      return true;
    default:
      return now < b.tx + MYSTERY_BOX.closeSec + MYSTERY_BOX.leaveSec;
  }
}

declare module '../../../../shared/events' {
  interface RoomEvents<P> {
    /** The owner took the wonder weapon from their Mystery Box. */
    'killstreaks.boxTaken': { player: P; weapon: string };
  }
}

/**
 * Per room: the box claims USE from weapon pickups while its owner stands at it; loans run out
 * (through death too), come back at respawn while they run, and never drop at the body.
 */
export function wireMysteryBox(room: Room, ctx: KsRoom): void {
  room.modifiers.add('useClaimed', (p) => (boxClaimsUse(ctx, p) ? true : undefined), 'killstreaks.mysterybox');
  room.modifiers.add('keepsWeapon', (p, w) => {
    const loan = loanOf(p);
    return loan && loan.weapon === w && room.time < loan.until ? true : undefined;
  }, 'killstreaks.mysterybox');
  room.bus.on('tick', () => {
    for (const p of room.players.values()) {
      const loan = loanOf(p);
      if (!loan) continue;
      // Swapped away for a gun off the floor: the loan is over (the dropped wonder weapon is a pickup).
      if (p.alive && !p.weapons.includes(loan.weapon)) {
        delete p.ext.wonderLoan;
        room.sendFeature(p, 'killstreaks.wonderLoan', { w: null, until: 0 });
      } else if (room.time >= loan.until) endLoan(room, p);
    }
  });
  // Respawning while the loan runs: the wonder weapon is back in its slot, in hand (the fresh gun
  // the class gave that slot is what returns when it ends). Low priority: after the weapons
  // feature's spawn handler (launcher slot).
  room.bus.on(
    'spawn',
    ({ player }) => {
      const loan = loanOf(player);
      if (!loan) return;
      if (room.time >= loan.until) {
        delete player.ext.wonderLoan;
        room.sendFeature(player, 'killstreaks.wonderLoan', { w: null, until: 0 });
        return;
      }
      loan.stash = player.weapons[loan.slot] ?? null;
      loan.gl = seat(room, player, loan.slot, loan.weapon);
      if (loan.slot !== player.slot) forceSlot(room, player, loan.slot);
      room.sendFeature(player, 'killstreaks.wonderLoan', { w: loan.weapon.def.base.id, until: r3(loan.until), slot: loan.slot });
    },
    { priority: -20 },
  );
  room.bus.on('matchStart', () => {
    for (const p of room.players.values()) delete p.ext.wonderLoan;
  });
}
