/**
 * Shell-by-shell reloads (Stakeout, SPAS-12). Core starts a reload and refills the magazine at
 * `reloadEnd`; for weapons with `shellReload` this feature retimes `reloadEnd` to open + shells +
 * close, inserts shells one at a time, and lets a held trigger cancel the reload once at least one
 * shell is in (BO1).
 */
import { Buttons } from '../../../shared/input';
import { currentWeapon, type PlayerState } from '../../player';
import type { Room } from '../../room';
import { wext } from './state';

/** Seconds a shell reload takes for `need` shells (`empty` adds the pump). */
export function shellReloadSec(sr: { startMs: number; perShellMs: number; endMs: number; pumpMs?: number }, need: number, empty: boolean): number {
  return (sr.startMs + sr.perShellMs * need + sr.endMs + (empty ? (sr.pumpMs ?? 0) : 0)) / 1000;
}

/** `reload` event: retime a shell reload. */
export function onReload(room: Room, p: PlayerState, empty: boolean): void {
  const w = currentWeapon(p);
  const sr = w?.def.shellReload;
  const x = wext(p);
  if (!w || !sr || p.reloadEnd <= 0) {
    x.shells = null;
    return;
  }
  const need = Math.min(w.def.magazine - w.mag, w.reserve);
  const mult = room.modifiers.mul('reloadMultiplier', p);
  p.reloadEnd = room.time + shellReloadSec(sr, need, empty) * mult;
  x.shells = { slot: p.slot, next: room.time + ((sr.startMs + sr.perShellMs) / 1000) * mult, per: (sr.perShellMs / 1000) * mult, close: ((sr.endMs + (empty ? (sr.pumpMs ?? 0) : 0)) / 1000) * mult };
}

/** Per tick: insert due shells; cancel on trigger. */
export function updateShells(room: Room, p: PlayerState): void {
  const x = p.ext.weapons;
  const s = x?.shells;
  if (!x || !s) return;
  const w = currentWeapon(p);
  if (!p.alive || p.reloadEnd <= 0 || p.slot !== s.slot || !w) {
    x.shells = null;
    return;
  }
  while (room.time >= s.next && w.mag < w.def.magazine && w.reserve > 0) {
    w.mag++;
    w.reserve--;
    s.next += s.per;
  }
  if (w.mag >= w.def.magazine || w.reserve <= 0) {
    // All in: just the close (and pump) left.
    p.reloadEnd = Math.min(p.reloadEnd, s.next - s.per + s.close);
    x.shells = null;
    return;
  }
  if (w.mag > 0 && (p.buttons & Buttons.FIRE) !== 0) {
    p.reloadEnd = 0;
    x.shells = null;
  }
}
