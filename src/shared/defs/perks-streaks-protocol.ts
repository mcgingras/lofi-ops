/**
 * Wire types for the perks and killstreaks features (owner: perks-streaks). Declaration-merged into
 * the core protocol so both the server and the client get typed RPCs and feature pushes. Lives in
 * shared so the client tsconfig sees it.
 */
import type { Team } from '../constants';

export interface KillstreakStateMsg {
  /** The three picked streaks with their cost after Hardline. */
  chosen: { id: string; cost: number }[];
  /** Kills toward streaks this life (streak kills excluded). */
  count: number;
  /** Every kill this life, streak kills included (what `countsStreakKills` streaks, the Tactical Nuke, count). */
  countAll?: number;
  /** Earned and waiting to be called (oldest first). */
  ready: string[];
  /** Index into `ready` the STREAK button calls. */
  selected: number;
  /** Designating targets for a streak (press STREAK again at each spot). */
  armed: { id: string; marks: [number, number, number][]; need: number; until: number } | null;
  /** Holding the Care Package marker canister for streak `id` (FIRE throws it, STREAK puts it away). */
  marker?: { id: string } | null;
  /**
   * Carrying a Sentry Gun / SAM Turret (`id`) to place it: FIRE or USE puts it down where the
   * preview shows (`turretPlacement`), STREAK puts it away. `moved`: a placed turret picked back up
   * (STREAK puts it back where it was instead; the streak is already used).
   */
  carry?: { id: string; moved: boolean } | null;
  /** The tactical map is up (radio raised) for streak `id` until room time `until`. */
  map: { id: string; until: number } | null;
  /**
   * Holding the Valkyrie launcher: rockets `left`, room time it can fire (`ready`: raised or
   * reloaded), `fired` once the first rocket went (putting it away then loses the spare).
   */
  launcher?: { left: number; ready: number; fired: boolean } | null;
  /**
   * Driving / gunning / steering one: the entity id the camera follows and when it ends (room
   * time). Valkyrie: `hold` once the rocket blew up (the camera stays on the blast, white, until then).
   */
  control: { id: string; entity: number; until: number; hold?: { until: number; x: number; y: number; z: number } } | null;
  /** Pack-a-Punch buff: room time it runs out (absent when not buffed). The HUD counts down to it. */
  papUntil?: number;
}

export interface KillstreakFx {
  kind: 'boom' | 'bigboom' | 'shell' | 'napalm' | 'crate_land' | 'crate_open' | 'hacked' | 'destroyed' | 'sam_launch' | 'rocket_launch' | 'bite' | 'bark';
  x: number;
  y: number;
  z: number;
  /** Blast radius, for the effect size. */
  r?: number;
}

declare module '../protocol' {
  interface RpcMap {
    /** Pick which ready streak the STREAK button calls. */
    'killstreaks.select': { req: { index: number }; res: { selected: number } };
    /** Call a ready streak. Targets default to where the caller aims (server-side raycast). Map-targeted streaks answer `use_map`. */
    'killstreaks.call': { req: { id: string; target?: [number, number, number]; targets?: [number, number, number][] }; res: { ok: boolean; reason?: string } };
    /**
     * The tactical map's choice for the streak whose map is up (opened with STREAK): `points` as
     * [x, z] (Mortar Team three, others one), `yaw` the run direction for Napalm / Rolling Thunder.
     */
    'killstreaks.mapTarget': { req: { id: string; points: [number, number][]; yaw?: number }; res: { ok: boolean; reason?: string } };
    /** Put the radio away (the streak is kept). */
    'killstreaks.mapCancel': { req: Record<string, never>; res: { ok: boolean } };
    /** Current streak state (also pushed as `killstreaks.state`). */
    'killstreaks.state': { req: Record<string, never>; res: KillstreakStateMsg | null };
    /** Dev only (server started with LOFI_CHEATS=1): grant a ready streak and/or add enemy bots. */
    'killstreaks.cheat': { req: { id?: string; bots?: number }; res: { ready: string[] } };
    /** Perk ids the caller has the Pro version of (create-a-class shows them). */
    'perks.pro': { req: Record<string, never>; res: { pro: string[]; progress: Record<string, number> } };
  }
  interface FeatureMessages {
    'killstreaks.state': KillstreakStateMsg;
    'killstreaks.earned': { id: string };
    /** Someone called a streak (everyone gets it; the HUD says friendly / enemy). */
    'killstreaks.called': { id: string; owner: string; team: Team | null };
    'killstreaks.ended': { id: string; owner: string; team: Team | null; destroyed: boolean; by?: string | null };
    'killstreaks.fx': KillstreakFx;
    /**
     * Pack-a-Punch started for player `p` (everyone gets it: the owner's gun dips, the jingle plays
     * where they stand): weapon `w` becomes `name` at room time `t0 + at`; the gun is down `dur` s.
     */
    'killstreaks.pap': { p: string; w: string; name: string; t0: number; dur: number; at: number };
    /** Pack-a-Punch landed: player `p`'s `w` is now `name` (the toast and the ding); the buff runs out at room time `until`. */
    'killstreaks.packed': { p: string; w: string; name: string; until: number };
    /** Player `p`'s Pack-a-Punch buff ran out: their guns are plain again (the power-down cue and toast). */
    'killstreaks.papEnd': { p: string };
    /** Care Package contents for the player standing at it. */
    'killstreaks.crate': { entity: number; contents: string; progress: number } | null;
    /** Players whose perks change what others hear/see (Ninja footsteps, Ghost Pro name tags). */
    'perks.public': { ninja: string[]; ghostPro: string[] };
    /**
     * Your last stand: until (room time) or null when it ends; revive progress 0..1. On a revive
     * `slot` is the weapon slot the server put back in your hands (the one you went down with).
     */
    'perks.lastStand': { until: number | null; revive: number; slot?: number };
    'perks.notice': { text: string };
  }
}

export {};
