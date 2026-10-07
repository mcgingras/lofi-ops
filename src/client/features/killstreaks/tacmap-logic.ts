/**
 * Placement on the tactical map, without any DOM (unit-tested in tests/tacmap.client.test.ts).
 * BO1 per streak:
 *   line   (Napalm, Rolling Thunder): press at the target, drag to swing the run direction, release
 *          to confirm (PC: hold the attack button and move the mouse). Keys/stick rotate the arrow.
 *   points (Mortar Team): a mark per press, three in a row; undo removes the last; the third confirms.
 *   area   (Attack Helicopter): one press picks the patrol point.
 * The panel maps world x/z to screen pixels with `MapView`: north (-z) up, +x right.
 */
import type { MapPick } from '../../../shared/defs/killstreaks';
import { strikeFootprint, yawFromDrag, wrapAngle, type XZ } from '../../../shared/defs/tactical-map';

export interface MapRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A target ready to send as `killstreaks.mapTarget`. */
export interface MapSubmit {
  id: string;
  points: [number, number][];
  yaw?: number;
}

/** Drags shorter than this (metres) keep the previous direction. */
export const MIN_DRAG_M = 1.5;

const r2 = (v: number) => Math.round(v * 100) / 100;

export class TacMapPicker {
  cursor: XZ;
  /** Run direction for line strikes (yaw 0 = north). */
  yaw: number;
  marks: XZ[] = [];
  /** Line strikes: where the press landed while the button is held. */
  anchor: XZ | null = null;
  /** Waiting for the server's answer. */
  pending = false;
  /** What was sent (drawn while pending). */
  private sent: { points: XZ[]; yaw?: number } | null = null;

  constructor(
    readonly id: string,
    readonly pick: MapPick,
    readonly need: number,
    readonly rect: MapRect,
    start: XZ,
    startYaw = 0,
  ) {
    this.cursor = this.clamp(start);
    this.yaw = wrapAngle(startYaw);
  }

  clamp(p: XZ): XZ {
    const r = this.rect;
    return { x: Math.min(r.maxX, Math.max(r.minX, p.x)), z: Math.min(r.maxZ, Math.max(r.minZ, p.z)) };
  }

  /** Move the cursor by a world delta (mouse deltas, keys, stick). */
  moveBy(dx: number, dz: number): void {
    this.moveTo(this.cursor.x + dx, this.cursor.z + dz);
  }

  /** Put the cursor somewhere (absolute pointer). While a line press is held it swings the arrow. */
  moveTo(x: number, z: number): void {
    this.cursor = this.clamp({ x, z });
    if (this.anchor && Math.hypot(this.cursor.x - this.anchor.x, this.cursor.z - this.anchor.z) >= MIN_DRAG_M) this.yaw = yawFromDrag(this.anchor, this.cursor);
  }

  rotate(dYaw: number): void {
    this.yaw = wrapAngle(this.yaw + dYaw);
  }

  /** Primary button down. Returns a target when this press completes the choice. */
  press(): MapSubmit | null {
    if (this.pending) return null;
    if (this.pick === 'line') {
      this.anchor = { ...this.cursor };
      return null;
    }
    if (this.pick === 'points') {
      if (this.marks.length >= this.need) return null;
      this.marks.push({ ...this.cursor });
      return this.marks.length >= this.need ? this.submit(this.marks) : null;
    }
    return this.submit([this.cursor]);
  }

  /** Primary button up: confirms a held line strike. */
  release(): MapSubmit | null {
    if (this.pending || this.pick !== 'line' || !this.anchor) return null;
    const at = this.anchor;
    this.anchor = null;
    return this.submit([at], this.yaw);
  }

  /** A tap (keyboard Enter/Space, gamepad A): press then release. */
  tap(): MapSubmit | null {
    return this.press() ?? this.release();
  }

  /** Remove the last mortar mark (right click / Backspace). */
  undo(): boolean {
    if (this.pending || !this.marks.length) return false;
    this.marks.pop();
    return true;
  }

  /** The server refused: let the player try again (the last mortar mark comes off). */
  refused(): void {
    this.pending = false;
    this.sent = null;
    if (this.pick === 'points' && this.marks.length >= this.need) this.marks.pop();
  }

  /** The points a press would use right now (for drawing the preview). */
  previewPoints(): XZ[] {
    if (this.sent) return this.sent.points;
    if (this.pick === 'line') return [this.anchor ?? this.cursor];
    if (this.pick === 'points') return this.marks.length < this.need ? [...this.marks, this.cursor] : [...this.marks];
    return [this.cursor];
  }

  /** Circles covered by the preview, in metres (same as the server's drops). */
  footprint(): { x: number; z: number; r: number }[] {
    return strikeFootprint(this.id, this.previewPoints(), this.yaw);
  }

  private submit(points: XZ[], yaw?: number): MapSubmit {
    this.pending = true;
    this.sent = { points: points.map((p) => ({ ...p })), yaw };
    const out: MapSubmit = { id: this.id, points: points.map((p) => [r2(p.x), r2(p.z)] as [number, number]) };
    if (yaw !== undefined) out.yaw = Math.round(yaw * 10000) / 10000;
    return out;
  }
}

/** World <-> panel pixels: the map's bounds fitted into a screen rectangle, north up. */
export class MapView {
  readonly scale: number;
  readonly w: number;
  readonly h: number;
  readonly x0: number;
  readonly y0: number;

  constructor(
    readonly rect: MapRect,
    box: { x: number; y: number; w: number; h: number },
  ) {
    const mw = rect.maxX - rect.minX;
    const mh = rect.maxZ - rect.minZ;
    this.scale = Math.max(0.01, Math.min(box.w / mw, box.h / mh));
    this.w = Math.round(mw * this.scale);
    this.h = Math.round(mh * this.scale);
    this.x0 = Math.round(box.x + (box.w - this.w) / 2);
    this.y0 = Math.round(box.y + (box.h - this.h) / 2);
  }

  toScreen(x: number, z: number): [number, number] {
    return [this.x0 + (x - this.rect.minX) * this.scale, this.y0 + (z - this.rect.minZ) * this.scale];
  }

  toWorld(sx: number, sy: number): XZ {
    return { x: this.rect.minX + (sx - this.x0) / this.scale, z: this.rect.minZ + (sy - this.y0) / this.scale };
  }
}

/** BO1-style grid: square cells, about `cells` along the longer side; rows A.., columns 1.. */
export function gridCell(rect: MapRect, cells = 6): number {
  const longest = Math.max(rect.maxX - rect.minX, rect.maxZ - rect.minZ);
  return Math.max(5, Math.ceil(longest / cells / 5) * 5);
}

/** Grid reference of a point ("C4"). */
export function gridRef(rect: MapRect, p: XZ, cell = gridCell(rect)): string {
  const col = Math.floor((p.x - rect.minX) / cell) + 1;
  const row = Math.floor((p.z - rect.minZ) / cell);
  return `${String.fromCharCode(65 + Math.max(0, Math.min(25, row)))}${Math.max(1, col)}`;
}
