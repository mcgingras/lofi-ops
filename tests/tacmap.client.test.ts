/**
 * Tactical map placement on the client (no DOM): BO1 per-streak UX (Napalm / Rolling Thunder: press,
 * drag to swing the direction, release; Mortar Team: three numbered marks with undo, the third
 * confirms; Attack Helicopter: one patrol point), cursor clamping, and the screen <-> world mapping.
 */
import { describe, expect, it } from 'vitest';
import { MapView, MIN_DRAG_M, TacMapPicker, gridCell, gridRef } from '../src/client/features/killstreaks/tacmap-logic';
import { KILLSTREAK_BY_ID } from '../src/shared/defs/killstreaks';
import { getMapData } from '../src/shared/defs/maps';
import { strikeFootprint, validateMapTarget } from '../src/shared/defs/tactical-map';

const RECT = { minX: -40, maxX: 40, minZ: -20, maxZ: 20 };
const BOUNDS = { min: { x: -40, y: 0, z: -20 }, max: { x: 40, y: 10, z: 20 } };

describe('tactical map picker', () => {
  it('napalm: press anchors, dragging swings the run, release sends spot + yaw the server accepts', () => {
    const p = new TacMapPicker('napalm', 'line', 1, RECT, { x: 0, z: 0 }, 0.3);
    p.moveTo(10, 5);
    expect(p.press()).toBeNull();
    expect(p.anchor).toEqual({ x: 10, z: 5 });
    p.moveBy(0.5, 0); // tiny drag keeps the old direction
    expect(p.yaw).toBeCloseTo(0.3);
    p.moveBy(MIN_DRAG_M + 4.5, 0); // drag east -> run east (yaw -PI/2)
    expect(p.yaw).toBeCloseTo(-Math.PI / 2);
    const req = p.release();
    expect(req).toEqual({ id: 'napalm', points: [[10, 5]], yaw: -1.5708 });
    expect(p.pending).toBe(true);
    expect(p.press()).toBeNull(); // no double sends
    const check = validateMapTarget(KILLSTREAK_BY_ID.get('napalm'), BOUNDS, req);
    expect(check.ok).toBe(true);
    // The preview footprint is the one the server drops on.
    expect(p.footprint()).toEqual(strikeFootprint('napalm', [{ x: 10, z: 5 }], p.yaw));
  });

  it('rolling thunder: keys rotate the arrow and a tap confirms where the cursor is', () => {
    const p = new TacMapPicker('rolling_thunder', 'line', 1, RECT, { x: 0, z: 0 }, 0);
    p.rotate(Math.PI / 2);
    p.moveBy(-5, 3);
    expect(p.tap()).toEqual({ id: 'rolling_thunder', points: [[-5, 3]], yaw: 1.5708 });
  });

  it('mortar: three numbered marks, undo removes the last, the third confirms', () => {
    const p = new TacMapPicker('mortar', 'points', 3, RECT, { x: 0, z: 0 });
    p.moveTo(1, 1);
    expect(p.press()).toBeNull();
    p.moveTo(2, 2);
    expect(p.press()).toBeNull();
    expect(p.undo()).toBe(true);
    expect(p.marks).toEqual([{ x: 1, z: 1 }]);
    expect(p.previewPoints()).toEqual([{ x: 1, z: 1 }, { x: 2, z: 2 }]);
    p.moveTo(3, -3);
    expect(p.press()).toBeNull();
    p.moveTo(-6, 4);
    expect(p.press()).toEqual({ id: 'mortar', points: [[1, 1], [3, -3], [-6, 4]] });
    // A refusal lets the player re-place the last one.
    p.refused();
    expect(p.pending).toBe(false);
    expect(p.marks).toHaveLength(2);
  });

  it('attack helicopter: one press picks the patrol point; the cursor stays on the map', () => {
    const p = new TacMapPicker('attack_helicopter', 'area', 1, RECT, { x: 100, z: -100 });
    expect(p.cursor).toEqual({ x: 40, z: -20 });
    p.moveBy(-1000, 1000);
    expect(p.cursor).toEqual({ x: -40, z: 20 });
    p.moveTo(12, -3);
    expect(p.press()).toEqual({ id: 'attack_helicopter', points: [[12, -3]] });
  });
});

describe('map view', () => {
  it('fits the bounds into the panel north-up and maps both ways', () => {
    const v = new MapView(RECT, { x: 10, y: 20, w: 400, h: 300 });
    expect(v.scale).toBe(5); // 80 m wide into 400 px
    expect([v.w, v.h, v.x0, v.y0]).toEqual([400, 200, 10, 70]);
    expect(v.toScreen(-40, -20)).toEqual([10, 70]); // north-west corner top-left
    expect(v.toScreen(40, 20)).toEqual([410, 270]);
    const w = v.toWorld(...v.toScreen(7.5, -3.25));
    expect(w.x).toBeCloseTo(7.5);
    expect(w.z).toBeCloseTo(-3.25);
  });

  it('grid references like BO1 (rows lettered from the north, columns numbered from the west)', () => {
    const nuke = getMapData('nuketown').bounds;
    const rect = { minX: nuke.min.x, maxX: nuke.max.x, minZ: nuke.min.z, maxZ: nuke.max.z };
    const cell = gridCell(rect);
    expect(cell % 5).toBe(0);
    expect(gridRef(rect, { x: rect.minX + 0.1, z: rect.minZ + 0.1 })).toBe('A1');
    expect(gridRef(rect, { x: rect.minX + cell * 2.5, z: rect.minZ + cell * 1.5 })).toBe('B3');
  });
});
