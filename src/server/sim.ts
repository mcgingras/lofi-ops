/**
 * Authoritative simulation step for players: applies queued input commands in order with the
 * shared `stepMove`, handles button edges (reload, weapon switch), feeds bots' brains, and
 * processes shots once the inputs they were fired at have been applied.
 */
import { MAX_CMD_DT, MOVE, TICK_DT } from '../shared/constants';
import { Buttons, type InputCmd } from '../shared/input';
import { clamp, quantizeAngle } from '../shared/math';
import { DEFAULT_MOVE_PARAMS, stepMove, type MoveParams } from '../shared/movement';
import { fire, startReload, switchWeapon } from './combat';
import { currentWeapon, type PlayerState } from './player';
import type { Room } from './room';

/** Most commands applied per player per tick (a burst after a lag spike catches up over ticks). */
const MAX_CMDS_PER_TICK = 12;
/** How far ahead of real time a client's commands may run before they are dropped. */
const TIME_BUDGET_MAX = 0.25;
/** Without input this long, a player still falls (idle step, not acked). */
const IDLE_AFTER = 0.25;
/** Shots waiting for their input seq are dropped after this long. */
const FIRE_WAIT = 1;

/** Current movement params for a player: weapon in hand x modifiers. Sent as `me.params`. */
export function moveParamsFor(room: Room, p: PlayerState): MoveParams {
  const w = currentWeapon(p);
  const fireRate = room.modifiers.mul('fireRateMultiplier', p);
  const canFire = room.modifiers.any('canFire', p) !== false;
  const canAds = room.modifiers.any('canAds', p) !== false;
  return {
    ...DEFAULT_MOVE_PARAMS,
    speed: (w?.def.moveMult ?? 1) * room.modifiers.mul('speedMultiplier', p),
    adsTime: ((w?.def.adsMs ?? 250) / 1000) * room.modifiers.mul('adsMultiplier', p),
    adsMove: MOVE.ads,
    sprint: room.modifiers.mul('sprintMultiplier', p),
    canSprint: room.modifiers.any('canSprint', p) !== false,
    canMove: p.alive && room.phase === 'playing',
    ...(fireRate !== 1 ? { fireRate } : {}),
    ...(canFire ? {} : { canFire }),
    ...(canAds ? {} : { canAds }),
  };
}

/** Apply one command (human or bot). `dt` already clamped. */
export function applyCommand(room: Room, p: PlayerState, cmd: Omit<InputCmd, 'seq' | 'dt'>, dt: number): void {
  p.yaw = quantizeAngle(cmd.yaw);
  p.pitch = clamp(quantizeAngle(cmd.pitch), -1.55, 1.55);
  const prev = p.buttons;
  const buttons = cmd.buttons | 0;
  p.buttons = buttons;
  const pressed = buttons & ~prev;
  const released = prev & ~buttons;
  if (p.alive && room.phase === 'playing') {
    // A slot the server chose (spawn, last stand) holds until the client asks for it too.
    const lock = p.slotLock;
    if (lock && (cmd.weaponSlot === lock.slot || room.time >= lock.until)) p.slotLock = null;
    if (cmd.weaponSlot !== p.slot && !p.slotLock) switchWeapon(room, p, cmd.weaponSlot | 0);
    if (pressed & Buttons.RELOAD) startReload(room, p);
  }
  if (p.alive) stepMove(room.world, p.move, buttons, p.yaw, dt, moveParamsFor(room, p));
  if (pressed || released) room.bus.emit('buttons', { player: p, pressed, released, buttons });
}

/** Step one player for this tick: inputs (or brain), then any shots that are now in order. */
export function stepPlayer(room: Room, p: PlayerState): void {
  if (p.isBot) {
    if (p.brain) {
      const cmd = p.brain.think(room, p, TICK_DT);
      if (cmd) applyCommand(room, p, cmd, TICK_DT);
    } else if (p.alive) {
      applyCommand(room, p, { buttons: 0, yaw: p.yaw, pitch: p.pitch, weaponSlot: p.slot }, TICK_DT);
    }
    return;
  }
  p.timeBudget = Math.min(TIME_BUDGET_MAX, p.timeBudget + TICK_DT);
  let applied = 0;
  while (p.inputQueue.length && applied < MAX_CMDS_PER_TICK) {
    const cmd = p.inputQueue.shift()!;
    if (cmd.seq <= p.lastSeq) continue;
    const dt = clamp(cmd.dt, 0, MAX_CMD_DT);
    p.lastSeq = cmd.seq;
    p.lastInputTime = room.time;
    if (p.timeBudget - dt < -0.1) continue; // running too fast: acked but not simulated
    p.timeBudget -= dt;
    applyCommand(room, p, cmd, dt);
    applied++;
    processFires(room, p);
  }
  if (applied === 0 && p.alive && room.time - p.lastInputTime > IDLE_AFTER) {
    applyCommand(room, p, { buttons: 0, yaw: p.yaw, pitch: p.pitch, weaponSlot: p.slot }, TICK_DT);
  }
  processFires(room, p);
}

/** Shots whose input seq has been applied go through now; stale ones are dropped. */
function processFires(room: Room, p: PlayerState): void {
  if (!p.pendingFires.length) return;
  const keep = [];
  for (const f of p.pendingFires) {
    if (f.seq <= p.lastSeq) fire(room, p, { time: f.time, origin: { x: f.origin[0], y: f.origin[1], z: f.origin[2] }, dir: { x: f.dir[0], y: f.dir[1], z: f.dir[2] }, shot: f.shot });
    else if (room.time - f.receivedAt < FIRE_WAIT) keep.push(f);
  }
  p.pendingFires = keep;
}
