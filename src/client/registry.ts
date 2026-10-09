/**
 * Client extension points (DESIGN.md section 6). Feature folders in src/client/features/<area>/
 * (auto-imported, see features/index.ts) register screens, HUD widgets, handlers for namespaced
 * server pushes, entity renderers and match hooks here. Core wires them into routing (router.ts),
 * the pixel HUD (hud/hud.ts), net.ts (feature dispatch) and the match loop (game/match.ts).
 */
import type * as THREE from 'three';
import type { FeatureId, FeatureMessages, EntitySnap } from '../shared/protocol';
import type { Vec3 } from '../shared/math';
import type { Match } from './game/match';

// ---------------------------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------------------------

/**
 * A full-screen menu/page. `mount` renders into `root` and may return an unmount function.
 * `params` come from the route (`#/barracks?tab=prestige`) or `navigate(id, params)`; when the
 * screen is shown as an overlay on top of a match, `params.overlay === '1'`.
 */
export type ScreenMount = (root: HTMLElement, params: Record<string, string>) => (() => void) | void;

export const screens = new Map<string, ScreenMount>();

/** Register (or replace) a screen. Core ids: `menu`, `settings`, `match`. */
export function registerScreen(id: string, mount: ScreenMount): void {
  screens.set(id, mount);
}

// ---------------------------------------------------------------------------------------------
// HUD widgets
// ---------------------------------------------------------------------------------------------

/** Draws onto the pixel HUD canvas (render resolution) every frame while in a match. */
export type HudDraw = (g: CanvasRenderingContext2D, w: number, h: number, dt: number) => void;

export const hudWidgets = new Map<string, { draw: HudDraw; order: number }>();
let hudSorted: HudDraw[] | null = null;

/**
 * Lower `order` draws first (on top: higher order). Re-registering an id replaces it; core widgets
 * are `core.<name>` (see hud/widgets.ts for ids and orders) so features can replace or remove them.
 */
export function registerHudWidget(id: string, draw: HudDraw, order = 0): void {
  hudWidgets.set(id, { draw, order });
  hudSorted = null;
}

export function unregisterHudWidget(id: string): void {
  hudWidgets.delete(id);
  hudSorted = null;
}

/** Widgets in draw order (cached). */
export function hudDrawList(): HudDraw[] {
  if (!hudSorted) hudSorted = [...hudWidgets.values()].sort((a, b) => a.order - b.order).map((w) => w.draw);
  return hudSorted;
}

// ---------------------------------------------------------------------------------------------
// Feature pushes
// ---------------------------------------------------------------------------------------------

const featureHandlers = new Map<string, Set<(data: unknown) => void>>();

/** Handle `{ t: 'feat', id, data }` pushes. Returns an unsubscribe function. */
export function onFeature<K extends FeatureId>(id: K, fn: (data: FeatureMessages[K]) => void): () => void {
  let set = featureHandlers.get(id);
  if (!set) featureHandlers.set(id, (set = new Set()));
  const h = fn as (data: unknown) => void;
  set.add(h);
  return () => set.delete(h);
}

/** Called by net.ts for every `feat` message. */
export function dispatchFeature(id: string, data: unknown): void {
  const set = featureHandlers.get(id);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(data);
    } catch (err) {
      console.error(`[feature ${id}]`, err);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Entities (killstreaks, dogs, care packages, flags...)
// ---------------------------------------------------------------------------------------------

export interface EntityView {
  /** Added to the world scene; positioned by core at the (smoothed) entity position + yaw. */
  object: THREE.Object3D;
  /** Every frame with the latest snapshot of the entity. Return false to let core skip positioning. */
  update?(e: EntitySnap, dt: number, match: Match): boolean | void;
  dispose?(): void;
}

export type EntityRenderer = (e: EntitySnap, match: Match) => EntityView | null;
export const entityRenderers = new Map<string, EntityRenderer>();

/** Render snapshot entities of a `kind` (server `room.entities.add({ kind })`). */
export function registerEntityRenderer(kind: string, fn: EntityRenderer): void {
  entityRenderers.set(kind, fn);
}

// ---------------------------------------------------------------------------------------------
// Match hooks
// ---------------------------------------------------------------------------------------------

export interface MatchHook {
  /** A match session began (room joined, map loaded). Return a cleanup function if needed. */
  start?(match: Match): (() => void) | void;
  /** Every frame after the world updated and before rendering. */
  frame?(match: Match, dt: number): void;
}

export const matchHooks = new Map<string, MatchHook>();
export function registerMatchHook(id: string, hook: MatchHook): void {
  matchHooks.set(id, hook);
}

// ---------------------------------------------------------------------------------------------
// Main menu entries
// ---------------------------------------------------------------------------------------------

export interface MenuItem {
  id: string;
  label: string;
  /** Small text on the right of the button. */
  hint?: string;
  /** Lower first. Core: quick play TDM 10, FFA 20, settings 90. */
  order?: number;
  primary?: boolean;
  action(): void;
}

export const menuItems = new Map<string, MenuItem>();
/** Add (or replace by id) a main menu button; features add theirs without touching the menu. */
export function registerMenuItem(item: MenuItem): void {
  menuItems.set(item.id, item);
}

// ---------------------------------------------------------------------------------------------
// Footsteps (Ninja / Ninja Pro, or anything else that changes what you hear)
// ---------------------------------------------------------------------------------------------

/** Return the volume for a remote player's footstep (0 = silent). Filters chain in registration order. */
export type FootstepFilter = (playerId: string, volume: number) => number;
export const footstepFilters = new Map<string, FootstepFilter>();
export function registerFootstepFilter(id: string, fn: FootstepFilter): void {
  footstepFilters.set(id, fn);
}
/** Called by remotes.ts for each remote footstep. */
export function footstepVolume(playerId: string, volume: number): number {
  for (const fn of footstepFilters.values()) {
    try {
      volume = fn(playerId, volume);
    } catch (err) {
      console.error('[footsteps]', err);
    }
  }
  return volume;
}

// ---------------------------------------------------------------------------------------------
// Aim assist (controller only; game/aim-assist.ts)
// ---------------------------------------------------------------------------------------------

/** Return false to switch aim assist off for this match (a private lobby's "Aim assist allowed" rule). */
export type AimAssistGate = (match: Match) => boolean;
export const aimAssistGates = new Map<string, AimAssistGate>();
export function registerAimAssistGate(id: string, fn: AimAssistGate): void {
  aimAssistGates.set(id, fn);
}

/** Return true when something other than world geometry (smoke...) blocks sight from a to b. */
export type SightBlocker = (a: Vec3, b: Vec3) => boolean;
export const sightBlockers = new Map<string, SightBlocker>();
export function registerSightBlocker(id: string, fn: SightBlocker): void {
  sightBlockers.set(id, fn);
}
