/**
 * Mode HUD widgets (pixel HUD, render resolution):
 *
 *   modes.waypoints  6   objective markers projected from world space (flags, sites, bomb, HQ,
 *                        nearby dog tags), clamped to the screen edge when off screen
 *   modes.panel      52  top-centre status: DOM flags, S&D round/timer/alive/bomb, HQ, KC tags
 *   modes.progress   62  capture / plant / defuse progress bar and "HOLD F" hints
 *   modes.popups     63  personal objective points under the crosshair
 *   modes.announcer  72  centre banner (big lines) and the small objective feed
 *   modes.spectate   81  S&D: "you join at the next round" for mid-round joiners
 */
import type { Team } from '../../../shared/constants';
import { MODE_TUNING } from '../../../shared/defs/modes';
import { MODE_ENTITY, type ModeStatePayload, type ZoneState } from '../../../shared/defs/modestate';
import type { Match } from '../../game/match';
import { blink, box, clock, HUD_COLORS as C, rect, textWidth, txt, unit } from '../../hud/draw';
import { useKey, drawWaypoint, type Waypoint, type WaypointSlot } from '../../hud/waypoints';
import { registerHudWidget } from '../../registry';
import { currentMatch } from '../../state';
import { modes, myAction, now } from './store';
import type { LineColor } from './text';


export const lineColor = (c: LineColor): string => ({ friend: C.friend, enemy: C.enemy, hi: C.hi, paper: C.paper, warn: C.warn })[c];

/** Colour of something owned by `team` as seen by this player. */
export function teamColor(team: Team | null | undefined, myTeam: Team | null): string {
  if (team === null || team === undefined) return C.paper;
  return team === myTeam ? C.friend : C.enemy;
}

/** Live (in-match, mode state present, not in the killcam) check shared by widgets. */
function live(): { m: Match; st: ModeStatePayload } | null {
  const m = currentMatch();
  const st = modes.state;
  if (!m || !st || m.loading || st.mode !== m.joined.mode) return null;
  if (modes.killcamStart !== null) return null;
  return { m, st };
}

// ---------------------------------------------------------------------------------------------
// Waypoints
// ---------------------------------------------------------------------------------------------


function zoneMarker(z: ZoneState, myTeam: Team | null, label: string): Waypoint {
  const col = teamColor(z.owner, myTeam);
  const verb = z.owner === myTeam && myTeam !== null ? 'DEFEND' : z.owner === null ? 'CAPTURE' : label === 'HQ' ? 'DESTROY' : 'CAPTURE';
  const taking = z.capTeam !== null && z.cap > 0 ? teamColor(z.capTeam, myTeam) : undefined;
  return { x: z.x, y: z.y + 2.6, z: z.z, label, caption: verb, color: col, blink: z.contested, hideWithin: z.r, fill: taking && blink(now(), 0.8, 0.4) ? 'rgba(60,50,20,.8)' : undefined };
}

registerHudWidget(
  'modes.waypoints',
  (g, W, H) => {
    const L = live();
    if (!L) return;
    const { m, st } = L;
    const my = m.myTeam;
    const marks: Waypoint[] = [];
    if (st.flags) for (const f of st.flags) marks.push(zoneMarker(f, my, f.id));
    if (st.hq?.zone) marks.push(zoneMarker(st.hq.zone, my, 'HQ'));
    const sd = st.sd;
    if (sd && (sd.phase === 'live' || sd.phase === 'planted' || sd.phase === 'prep')) {
      const attacking = my === sd.attackers;
      const b = sd.bomb;
      if (b.state === 'planted') {
        marks.push({ x: b.x, y: b.y + 1.6, z: b.z, label: 'BOMB', caption: attacking ? 'DEFEND' : 'DEFUSE', color: attacking ? C.friend : C.enemy, blink: true });
      } else {
        for (const s of sd.sites) marks.push({ x: s.x, y: s.y + 2.4, z: s.z, label: s.id, caption: attacking ? 'PLANT' : 'DEFEND', color: attacking ? C.enemy : C.friend });
        if (attacking && b.state === 'dropped') marks.push({ x: b.x, y: b.y + 1.2, z: b.z, label: 'BOMB', caption: 'PICK UP', color: C.hi });
        if (attacking && b.state === 'carried' && b.carrier && b.carrier !== m.myId) {
          const r = m.remotes.views.get(b.carrier);
          if (r?.alive) marks.push({ x: r.x, y: r.y + 2.4, z: r.z, label: 'BOMB', color: C.hi, small: true });
        }
      }
    }
    if (st.mode === 'kc') {
      for (const e of m.net.lastSnap?.ents ?? []) {
        if (e.kind !== MODE_ENTITY.tag) continue;
        marks.push({ x: e.x, y: e.y + 0.9, z: e.z, label: e.team === my ? 'DENY' : 'TAG', color: teamColor(e.team, my), maxDist: 25, small: true });
      }
    }
    const placed: WaypointSlot[] = [];
    for (const k of marks) drawWaypoint(m, g, W, H, k, placed);
  },
  6,
);

// ---------------------------------------------------------------------------------------------
// Top-centre panel
// ---------------------------------------------------------------------------------------------

function drawFlags(m: Match, g: CanvasRenderingContext2D, W: number, y: number, u: number, zones: ZoneState[]): void {
  const bw = 14 * u;
  const gap = 4 * u;
  const total = zones.length * bw + (zones.length - 1) * gap;
  let x = W / 2 - total / 2;
  for (const z of zones) {
    const col = teamColor(z.owner, m.myTeam);
    const bg = z.owner === null ? 'rgba(10,10,10,.7)' : z.owner === m.myTeam ? '#2a4a7a' : '#7a2a1a';
    box(g, x, y, bw, 11 * u, bg, u);
    if (!z.contested || blink(m.time, 0.5, 0.3)) txt(g, z.id.slice(0, 2), x + bw / 2, y + 2 * u, 8, z.contested ? C.hi : col === C.paper ? C.paper : '#ffffff', 'center', u);
    if (z.capTeam !== null && z.cap > 0) {
      rect(g, x, y + 12 * u, bw, 2 * u, C.ink);
      rect(g, x, y + 12 * u, Math.round(bw * z.cap), 2 * u, teamColor(z.capTeam, m.myTeam));
    }
    x += bw + gap;
  }
}

function pips(g: CanvasRenderingContext2D, x: number, y: number, n: number, total: number, col: string, u: number, align: 'left' | 'right'): void {
  for (let i = 0; i < total; i++) {
    const px = align === 'left' ? x + i * 4 * u : x - (i + 1) * 4 * u;
    rect(g, px, y, 3 * u, 5 * u, C.ink);
    rect(g, px + u, y + u, u, 3 * u, i < n ? col : C.empty);
  }
}

registerHudWidget(
  'modes.panel',
  (g, W, H) => {
    const L = live();
    if (!L) return;
    const { m, st } = L;
    const u = unit(H);
    let y = 20 * u;
    const server = m.serverTime;
    if (st.flags) drawFlags(m, g, W, y, u, st.flags);
    if (st.hq) {
      const hq = st.hq;
      if (hq.state === 'waiting') {
        const left = hq.endsAt !== null ? hq.endsAt - server : 0;
        txt(g, `NEXT HQ ${clock(left)}`, W / 2, y, 8, C.paper, 'center', u);
      } else if (hq.zone) {
        drawFlags(m, g, W, y, u, [{ ...hq.zone, id: 'HQ' }]);
        const left = hq.endsAt !== null ? hq.endsAt - server : 0;
        const label = hq.state === 'held' ? (hq.zone.owner === m.myTeam ? 'HELD' : 'ENEMY HQ') : 'ONLINE';
        txt(g, `${label} ${clock(left)}`, W / 2, y + 16 * u, 8, hq.state === 'held' ? teamColor(hq.zone.owner, m.myTeam) : C.hi, 'center', u);
      }
    }
    const sd = st.sd;
    if (sd) {
      const attacking = m.myTeam === sd.attackers;
      const left = sd.endsAt - server;
      const phaseText = sd.phase === 'prep' ? 'GET READY' : sd.phase === 'planted' ? 'BOMB' : sd.phase === 'post' ? 'ROUND OVER' : attacking ? 'ATTACK' : 'DEFEND';
      const timerCol = sd.phase === 'planted' ? (blink(m.time, left < 10 ? 0.3 : 0.8, 0.5) ? C.warn : C.paper) : left < 15 && sd.phase === 'live' ? C.warn : C.paper;
      txt(g, `ROUND ${sd.round} · ${phaseText}`, W / 2, y, 8, attacking ? C.hi : C.friend, 'center', u);
      txt(g, clock(left), W / 2, y + 9 * u, 16, timerCol, 'center', u);
      // Alive: my team left, enemies right.
      const my = (m.myTeam ?? 0) as Team;
      const en = (my === 0 ? 1 : 0) as Team;
      const tot = (t: Team) => [...m.roster.values()].filter((r) => r.team === t).length;
      pips(g, W / 2 - 3 * u, y + 28 * u, sd.alive[my], tot(my), C.friend, u, 'right');
      pips(g, W / 2 + 3 * u, y + 28 * u, sd.alive[en], tot(en), C.enemy, u, 'left');
      y += 36 * u;
      const b = sd.bomb;
      let line = '';
      let col: string = C.paper;
      if (b.state === 'planted') {
        line = `BOMB PLANTED ${b.site ?? ''}`;
        col = attacking ? C.friend : C.warn;
      } else if (attacking) {
        if (b.state === 'carried' && b.carrier === m.myId) {
          line = 'YOU HAVE THE BOMB';
          col = C.hi;
        } else if (b.state === 'carried' && b.carrier) line = `BOMB: ${m.nameOf(b.carrier).toUpperCase()}`;
        else if (b.state === 'dropped') {
          line = 'BOMB DROPPED';
          col = C.warn;
        }
      }
      if (line) txt(g, line, W / 2, y, 8, col, 'center', u);
      if (sd.switched && sd.phase === 'prep') txt(g, 'SIDES SWITCHED', W / 2, y + 9 * u, 8, C.dim, 'center', u);
    }
    if (st.kc && m.myTeam !== null) {
      const my = m.myTeam;
      txt(g, `CONFIRMED ${st.kc.confirmed[my]}  DENIED ${st.kc.denied[my]}`, W / 2, y, 8, C.dim, 'center', u);
    }
  },
  52,
);

// ---------------------------------------------------------------------------------------------
// Progress bar + hints
// ---------------------------------------------------------------------------------------------

const ACTION_LABEL = { plant: 'PLANTING', defuse: 'DEFUSING', capture: 'CAPTURING', neutralize: 'NEUTRALIZING', destroy: 'DESTROYING' } as const;

registerHudWidget(
  'modes.progress',
  (g, W, H) => {
    const L = live();
    if (!L || !L.m.alive) return;
    const { m, st } = L;
    const u = unit(H);
    const y = Math.round(H / 2 + 26 * u);
    const act = myAction();
    if (act) {
      const bw = 90 * u;
      txt(g, `${ACTION_LABEL[act.kind]} ${act.target}`, W / 2, y - 10 * u, 8, C.paper, 'center', u);
      box(g, W / 2 - bw / 2, y, bw, 5 * u, 'rgba(10,10,10,.75)', u);
      rect(g, W / 2 - bw / 2, y, Math.round(bw * act.shown), 5 * u, act.kind === 'defuse' || act.kind === 'plant' ? C.hi : C.friend);
      return;
    }
    const sd = st.sd;
    if (!sd) return;
    const pos = m.net.predictor.shown();
    const key = useKey();
    if (sd.phase === 'live' && sd.bomb.carrier === m.myId) {
      const site = sd.sites.find((s) => Math.hypot(pos.x - s.x, pos.z - s.z) <= s.r);
      if (site) txt(g, `HOLD ${key} TO PLANT THE BOMB`, W / 2, y, 8, blink(m.time, 1, 0.7) ? C.hi : C.paper, 'center', u);
    } else if (sd.phase === 'planted' && m.myTeam !== sd.attackers) {
      if (Math.hypot(pos.x - sd.bomb.x, pos.z - sd.bomb.z) <= MODE_TUNING.sd.defuseReach) txt(g, `HOLD ${key} TO DEFUSE`, W / 2, y, 8, blink(m.time, 1, 0.7) ? C.hi : C.paper, 'center', u);
    }
  },
  62,
);

registerHudWidget(
  'modes.popups',
  (g, W, H) => {
    const L = live();
    if (!L) return;
    const u = unit(H);
    const t = now();
    modes.popups = modes.popups.filter((p) => t - p.at < 1.8);
    modes.popups.forEach((p, i) => {
      const k = (t - p.at) / 1.8;
      txt(g, p.text, W / 2, H / 2 + 40 * u + i * 10 * u - k * 8 * u, 8, C.hi, 'center', u);
    });
  },
  63,
);

// ---------------------------------------------------------------------------------------------
// Announcer
// ---------------------------------------------------------------------------------------------

registerHudWidget(
  'modes.announcer',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || m.loading || modes.killcamStart !== null) return;
    const u = unit(H);
    const t = now();
    const b = modes.banner;
    if (b && t - b.at < 3.2) {
      const age = t - b.at;
      if (age > 0.25 || blink(age, 0.1, 0.05)) {
        // Below the panel, and below the map title card while that is up.
        const y = m.time - m.cardAt < 3.5 ? Math.round(H * 0.26) + 34 * u : Math.max(Math.round(H * 0.2), 70 * u);
        const col = lineColor(b.color);
        const w = Math.max(textWidth(g, b.text, 16, u), b.sub ? textWidth(g, b.sub, 8, u) : 0) + 16 * u;
        rect(g, W / 2 - w / 2, y - 3 * u, w, (b.sub ? 30 : 21) * u, 'rgba(10,10,10,.55)');
        rect(g, W / 2 - w / 2, y - 3 * u, w, u, col);
        txt(g, b.text, W / 2, y, 16, col, 'center', u);
        if (b.sub) txt(g, b.sub, W / 2, y + 18 * u, 8, C.paper, 'center', u);
      }
    }
    modes.feed = modes.feed.filter((f) => t - f.at < 4.5);
    let y = H - 60 * u;
    for (const f of modes.feed) {
      txt(g, f.text, 8 * u, y, 8, lineColor(f.color), 'left', u);
      y -= 9 * u;
    }
  },
  72,
);


// S&D: joined mid-round (never spawned this round, so core has no death screen to show).
registerHudWidget(
  'modes.spectate',
  (g, W, H) => {
    const L = live();
    if (!L) return;
    const { m, st } = L;
    if (!st.sd || m.alive || m.death || m.phase !== 'playing') return;
    const u = unit(H);
    txt(g, 'ONE LIFE PER ROUND', W / 2, H * 0.36, 8, C.paper, 'center', u);
    txt(g, 'YOU JOIN AT THE NEXT ROUND', W / 2, H * 0.36 + 10 * u, 8, C.hi, 'center', u);
  },
  81,
);
