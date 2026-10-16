/**
 * The grenade indicator (pure, unit-tested): which live lethals get a HUD marker and where it
 * points. BO1 draws a grenade icon on a ring around the crosshair with a pointer aimed at the
 * grenade (top = ahead, bottom = behind) for a live grenade close enough to hurt you
 * (`cg_hudGrenadeIconMaxRangeFrag` 250 units = 6.35 m, `cg_hudGrenadeIconMaxHeight`). The range is
 * that, or a lethal's kill radius plus `GRENADE_INDICATOR.margin` if further, so a marker always
 * means "you are inside or just outside the kill radius: move". Your own grenades
 * count (they hurt you); teammates' don't (friendly fire is off). A semtex stuck to you always
 * shows.
 */
import { EQUIPMENT_BY_ID, GRENADE_INDICATOR, killRadius } from '../../../shared/defs/equipment';

export interface DangerNade {
  x: number;
  y: number;
  z: number;
  /** Equipment id (`s.e` of a `weapons.nade` entity). */
  equip: string;
  owner: string | null;
  /** Stuck to this player (semtex). */
  stuckTo?: string | null;
}

export interface DangerViewer {
  /** Eye position and view yaw (yaw 0 looks down -z). */
  x: number;
  y: number;
  z: number;
  yaw: number;
  id: string;
  /** Can this grenade owner hurt you? (an enemy, or yourself). */
  canHurt: (owner: string | null) => boolean;
}

export interface DangerMark {
  equip: string;
  /** Distance from the eye (m). */
  dist: number;
  /** Direction on the ring: 0 = straight ahead (top), +PI/2 = to the right, PI = behind. */
  angle: number;
  /** Inside the kill radius itself (the marker turns red). */
  lethal: boolean;
}

/** Indicator range for a piece of equipment (0 = never shown). */
export function indicatorRange(equip: string): number {
  const def = EQUIPMENT_BY_ID.get(equip);
  if (!def || def.kind !== 'lethal' || (def.effect !== 'frag' && def.effect !== 'semtex')) return 0;
  return Math.max(GRENADE_INDICATOR.range, killRadius(def) + GRENADE_INDICATOR.margin);
}

/** Markers for the live grenades that threaten the viewer, nearest first. */
export function grenadeDangers(nades: readonly DangerNade[], v: DangerViewer): DangerMark[] {
  const out: DangerMark[] = [];
  for (const n of nades) {
    const range = indicatorRange(n.equip);
    if (range <= 0) continue;
    const stuckOnMe = !!n.stuckTo && n.stuckTo === v.id;
    if (!stuckOnMe && !v.canHurt(n.owner)) continue;
    const dx = n.x - v.x;
    const dz = n.z - v.z;
    const dy = n.y - v.y;
    const dist = Math.hypot(dx, dy, dz);
    if (!stuckOnMe && (dist > range || Math.abs(dy) > GRENADE_INDICATOR.maxHeight)) continue;
    const def = EQUIPMENT_BY_ID.get(n.equip)!;
    // Bearing of the grenade relative to the view: 0 ahead, positive clockwise (to the right).
    const bearing = Math.atan2(-dx, -dz);
    let angle = v.yaw - bearing;
    angle = Math.atan2(Math.sin(angle), Math.cos(angle));
    out.push({ equip: n.equip, dist, angle: stuckOnMe ? Math.PI : angle, lethal: stuckOnMe || dist <= killRadius(def) });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

/** Screen position of a marker on the ring of radius `r` around (cx, cy), and the pointer's tip. */
export function dangerRingPos(angle: number, cx: number, cy: number, r: number, pointer: number): { x: number; y: number; tipX: number; tipY: number } {
  const sx = Math.sin(angle);
  const sy = -Math.cos(angle);
  return { x: cx + sx * r, y: cy + sy * r, tipX: cx + sx * (r + pointer), tipY: cy + sy * (r + pointer) };
}
