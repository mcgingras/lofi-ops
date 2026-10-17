/**
 * The Zombies HUD (pixel HUD widgets, only in a Zombies match):
 * - `zombies.round` (51): the round in red chalk, bottom left: tally marks for rounds 1-5 (BO1:
 *   four strokes and a slash), the number from 6; it flashes white between rounds;
 * - `core.score` (50, replaced in Zombies): every survivor's points, bottom right (yours first), with
 *   "+10" / "-950" popups drifting off yours;
 * - `zombies.perks` (44): Perk-a-Cola icons; `zombies.powerups` (46): Insta-Kill / Double Points timers;
 * - `zombies.prompt` (8): "HOLD F FOR MP5K [1000]", ammo, perks, the box, the box's weapon, revives;
 * - `zombies.banner` (72): announcer banners; `zombies.down` (64): bleeding out / reviving bars and
 *   markers over downed teammates; `zombies.drink` (42): the bottle while drinking;
 * - `zombies.gameover` (96): GAME OVER / YOU SURVIVED N ROUNDS.
 * Core widgets that make no sense here are wrapped to step aside in Zombies (killfeed, compass,
 * minimap, streak ladder, XP popups, class hint), the scoreboard shows points / kills / downs /
 * revives / headshots, and the death screen explains bleeding out.
 */
import * as THREE from 'three';
import { BOX_PHASE, MYSTERY_BOX } from '../../../shared/defs/mystery-box';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { BOX, PERK_COLA_BY_ID, perkPrice, POWERUP_BY_ID, ZM_ENTITY, ZOMBIES, type PerkColaId } from '../../../shared/defs/zombies';
import type { EntitySnap } from '../../../shared/protocol';
import type { Match } from '../../game/match';
import { blink, box, HUD_COLORS as C, rect, textWidth, txt, unit } from '../../hud/draw';
import { drawWaypoint, useKey, type WaypointSlot } from '../../hud/waypoints';
import { hudWidgets, registerHudWidget, registerMatchHook, type HudDraw } from '../../registry';
import { currentMatch } from '../../state';
import { isZombiesMatch, myInfo, now, zm } from './store';

const CHALK_RED = '#c02a1a';
const CHALK_HI = '#ff4a2a';
const HEADSHOT_GOLD = '#ffc83a';
const PLAYER_COLORS = ['#ece2ce', '#7ab0ff', '#ffd84a', '#7cff6a'];
const v3 = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------
// The round counter
// ---------------------------------------------------------------------------------------------

/** A chunky chalk stroke from (x0,y0) to (x1,y1), `w` units wide. */
function stroke(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, color: string, u: number): void {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / u);
  for (let i = 0; i <= n; i++) {
    const t = i / Math.max(1, n);
    const jitter = ((i * 7919) % 5) - 2;
    rect(g, x0 + (x1 - x0) * t - (w * u) / 2 + (jitter * u) / 4, y0 + (y1 - y0) * t, w * u, u * 1.5, color);
  }
}

/** BO1's chalk tally: up to four strokes and a slash across them. */
export function drawTally(g: CanvasRenderingContext2D, n: number, x: number, y: number, h: number, color: string, u: number): number {
  const gap = h * 0.32;
  for (let i = 0; i < Math.min(4, n); i++) stroke(g, x + i * gap, y, x + i * gap + h * 0.06, y + h, 6, C.ink, u);
  for (let i = 0; i < Math.min(4, n); i++) stroke(g, x + i * gap, y, x + i * gap + h * 0.06, y + h, 4, color, u);
  if (n >= 5) {
    stroke(g, x - gap * 0.4, y + h * 0.75, x + gap * 3.6, y + h * 0.2, 6, C.ink, u);
    stroke(g, x - gap * 0.4, y + h * 0.75, x + gap * 3.6, y + h * 0.2, 4, color, u);
  }
  return gap * 4;
}

registerHudWidget(
  'zombies.round',
  (g, W, H) => {
    const m = currentMatch();
    const st = zm.state;
    if (!isZombiesMatch(m) || !st || st.round <= 0) return;
    const u = unit(H);
    const t = now() - zm.roundAt;
    // Flash white as the round changes and while the break runs (BO1's chalk pulse).
    const breakFlash = st.phase === 'break' && blink(m.time, 1, 0.5);
    const color = t < 1.5 ? (blink(m.time, 0.25, 0.5) ? '#ffffff' : CHALK_HI) : breakFlash ? '#f0e0d0' : st.dogRound ? '#ff7a2a' : CHALK_RED;
    // Above the health readout (bottom left), big like BO1's chalk.
    const x = 14 * u;
    const y = H - 84 * u;
    if (st.round <= 5) drawTally(g, st.round, x, y, 34 * u, color, u);
    else txt(g, String(st.round), x - 4 * u, y - 4 * u, 40, color, 'left', u);
  },
  51,
);

// ---------------------------------------------------------------------------------------------
// Points (replaces core.score in Zombies)
// ---------------------------------------------------------------------------------------------

function drawPoints(m: Match, g: CanvasRenderingContext2D, W: number, H: number): void {
  const st = zm.state;
  if (!st) return;
  const u = unit(H);
  const mine = st.players.find((p) => p.id === m.myId);
  const others = st.players.filter((p) => p.id !== m.myId);
  const rows = mine ? [mine, ...others] : others;
  let y = H - 62 * u;
  rows.forEach((p, i) => {
    const col = PLAYER_COLORS[st.players.indexOf(p) % PLAYER_COLORS.length]!;
    const size = i === 0 && p === mine ? 16 : 8;
    const right = W - 8 * u;
    const label = p.dead ? 'DEAD' : p.down ? 'DOWN' : String(p.points);
    txt(g, label, right, y - size * u, size, p.down || p.dead ? C.warn : col, 'right', u);
    if (p !== mine) {
      // Teammates and AI partners: name (a BOT tag), points, perks, and while down the bleed-out
      // left and the revive progress.
      let x = right - textWidth(g, label, size, u) - 6 * u;
      const name = m.nameOf(p.id).toUpperCase();
      txt(g, name, x, y - size * u, 8, C.dim, 'right', u);
      x -= textWidth(g, name, 8, u) + 4 * u;
      if (p.bot) {
        txt(g, 'BOT', x, y - size * u, 8, C.friend, 'right', u);
        x -= textWidth(g, 'BOT', 8, u) + 4 * u;
      }
      for (const id of [...p.perks].reverse()) {
        const d = PERK_COLA_BY_ID.get(id);
        if (!d) continue;
        rect(g, x - 7 * u, y - size * u, 7 * u, 7 * u, C.ink);
        rect(g, x - 6 * u, y - size * u + u, 5 * u, 5 * u, d.color);
        x -= 9 * u;
      }
      if (p.down) {
        const bw = 60 * u;
        const left = p.downUntil !== null ? Math.max(0, p.downUntil - m.serverTime) : 0;
        rect(g, right - bw, y + u, bw, 2 * u, C.ink);
        rect(g, right - bw, y + u, bw * Math.min(1, left / ZOMBIES.bleedOutSec), 2 * u, C.health);
        if (p.revive > 0) rect(g, right - bw, y + 3 * u, bw * Math.min(1, p.revive), 2 * u, C.friend);
        y -= 5 * u;
      }
    }
    y -= (size + 4) * u;
  });
  // Popups for my points: drift left and fade (BO1 "+10").
  const t = now();
  zm.popups = zm.popups.filter((p) => t - p.at < 1.1);
  for (const p of zm.popups) {
    const k = (t - p.at) / 1.1;
    const s = p.amount > 0 ? `+${p.amount}` : String(p.amount);
    txt(g, s, W - 70 * u - k * 40 * u + p.dx * u, H - 78 * u - k * 14 * u, 8, p.amount > 0 ? C.hi : C.warn, 'right', u);
  }
}

// ---------------------------------------------------------------------------------------------
// Perks and power-ups
// ---------------------------------------------------------------------------------------------

registerHudWidget(
  'zombies.perks',
  (g, W, H) => {
    const m = currentMatch();
    const me = myInfo(m);
    if (!isZombiesMatch(m) || !me || !me.perks.length) return;
    const u = unit(H);
    let x = 10 * u;
    const y = H - 40 * u;
    for (const id of me.perks) {
      const d = PERK_COLA_BY_ID.get(id);
      if (!d) continue;
      rect(g, x - u, y - u, 14 * u, 14 * u, C.ink);
      rect(g, x, y, 12 * u, 12 * u, d.color);
      txt(g, d.short.slice(0, 1), x + 6 * u, y + 2 * u, 8, C.ink, 'center', u);
      x += 16 * u;
    }
    void W;
  },
  44,
);

registerHudWidget(
  'zombies.powerups',
  (g, W, H) => {
    const m = currentMatch();
    const st = zm.state;
    if (!isZombiesMatch(m) || !st) return;
    const u = unit(H);
    const active: { id: string; until: number }[] = [];
    if (st.insta > m.serverTime) active.push({ id: 'insta_kill', until: st.insta });
    if (st.double > m.serverTime) active.push({ id: 'double_points', until: st.double });
    let x = W / 2 - ((active.length - 1) * 30 * u) / 2;
    for (const a of active) {
      const left = a.until - m.serverTime;
      const d = POWERUP_BY_ID.get(a.id as never);
      if (left > 5 || blink(m.time, 0.3, 0.5)) {
        rect(g, x - 11 * u, H - 34 * u, 22 * u, 16 * u, C.ink);
        rect(g, x - 10 * u, H - 33 * u, 20 * u, 14 * u, d?.color ?? C.hi);
        txt(g, a.id === 'insta_kill' ? 'IK' : 'x2', x, H - 30 * u, 8, C.ink, 'center', u);
      }
      txt(g, String(Math.ceil(left)), x, H - 16 * u, 8, C.paper, 'center', u);
      x += 30 * u;
    }
  },
  46,
);

// ---------------------------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------------------------

const yawDir = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

interface Prompt {
  text: string;
  color: string;
  bar?: number;
}

/** What USE would do here (mirrors the server's buy.ts reach rules). */
export function promptFor(m: Match): Prompt | null {
  const st = zm.state;
  const me = myInfo(m);
  if (!st || !me || !m.alive || me.down) return null;
  const pos = m.net.predictor.shown();
  const points = me.points;
  const held = new Set((m.me?.weapons ?? []).map((w) => w.id));
  let best: { d: number; p: Prompt } | null = null;
  const consider = (d: number, p: Prompt) => {
    if (!best || d < best.d) best = { d, p };
  };
  const key = () => useKey();
  for (const e of m.net.lastSnap?.ents ?? []) {
    if (e.kind === ZM_ENTITY.wall) {
      const f = yawDir(e.yaw);
      const dx = pos.x - e.x;
      const dz = pos.z - e.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.7 || dx * f.x + dz * f.z < 0.1 || Math.abs(pos.y - e.y) > 1.2) continue;
      const id = String(e.s?.w ?? '');
      const name = (WEAPON_BY_ID.get(id)?.name ?? id).toUpperCase();
      const own = held.has(id);
      const cost = Number(own ? e.s?.a : e.s?.p);
      consider(d, { text: own ? `HOLD ${key()} FOR ${name} AMMO [${cost}]` : `HOLD ${key()} FOR ${name} [${cost}]`, color: points >= cost ? C.paper : C.warn });
    } else if (e.kind === ZM_ENTITY.perk) {
      const d = Math.hypot(pos.x - e.x, pos.z - e.z);
      if (d > 1.9 || Math.abs(pos.y - e.y) > 1.2) continue;
      const id = String(e.s?.k) as PerkColaId;
      const def = PERK_COLA_BY_ID.get(id);
      if (!def) continue;
      if (me.perks.includes(id)) {
        consider(d, { text: def.name.toUpperCase(), color: C.dim });
        continue;
      }
      if (e.s?.off === 1) {
        consider(d, { text: `${def.name.toUpperCase()}: SOLD OUT`, color: C.dim });
        continue;
      }
      const cost = perkPrice(id, st.solo);
      consider(d, { text: `HOLD ${key()} FOR ${def.name.toUpperCase()} [${cost}]`, color: points >= cost ? def.color : C.warn });
    } else if (e.kind === ZM_ENTITY.box) {
      const d = Math.hypot(pos.x - e.x, pos.z - e.z);
      if (d > BOX.reach || Math.abs(pos.y - e.y) > BOX.dy) continue;
      const ph = Number(e.s?.ph ?? -1);
      const w = String(e.s?.w ?? '');
      if (ph === BOX_PHASE.idle && e.s?.tc === undefined) consider(d, { text: `HOLD ${key()} FOR THE MYSTERY BOX [${BOX.cost}]`, color: points >= BOX.cost ? '#9ad8ff' : C.warn });
      else if (ph === BOX_PHASE.offer && e.s?.o === m.myId && w && w !== 'teddy' && e.s?.tk !== 1 && e.s?.tc === undefined) {
        const te = Number(e.s?.te ?? 0);
        const tw = Number(e.s?.tw ?? 0);
        consider(d, { text: `PRESS ${key()} FOR ${(WEAPON_BY_ID.get(w)?.name ?? w).toUpperCase()}`, color: blink(m.time, 0.6, 0.4) ? C.hi : C.paper, bar: te > tw ? Math.max(0, (te - m.serverTime) / (te - tw)) : 0 });
      }
    }
  }
  // Reviving a downed teammate.
  for (const p of st.players) {
    if (p.id === m.myId || !p.down) continue;
    const r = m.remotes.views.get(p.id);
    if (!r) continue;
    const d = Math.hypot(pos.x - r.x, pos.z - r.z);
    if (d > ZOMBIES.reviveRadius || Math.abs(pos.y - r.y) > 1.5) continue;
    consider(d - 1, { text: `HOLD ${key()} TO REVIVE ${m.nameOf(p.id).toUpperCase()}`, color: C.friend, ...(p.revive > 0 ? { bar: p.revive } : {}) });
  }
  return (best as { d: number; p: Prompt } | null)?.p ?? null;
}

registerHudWidget(
  'zombies.prompt',
  (g, W, H) => {
    const m = currentMatch();
    if (!isZombiesMatch(m)) return;
    const p = promptFor(m);
    if (!p) return;
    const u = unit(H);
    const y = H / 2 + 34 * u;
    txt(g, p.text, W / 2, y, 8, p.color, 'center', u);
    if (p.bar !== undefined) {
      const bw = 70 * u;
      box(g, W / 2 - bw / 2, y + 10 * u, bw, 3 * u, C.empty, u);
      rect(g, W / 2 - bw / 2, y + 10 * u, bw * Math.max(0, Math.min(1, p.bar)), 3 * u, C.hi);
    }
  },
  8,
);

// ---------------------------------------------------------------------------------------------
// Banners, downs, the drink, game over
// ---------------------------------------------------------------------------------------------

registerHudWidget(
  'zombies.banner',
  (g, W, H) => {
    const m = currentMatch();
    if (!isZombiesMatch(m)) return;
    const u = unit(H);
    const t = now();
    zm.banners = zm.banners.filter((b) => t - b.at < b.dur);
    let y = H * 0.24;
    for (const b of zm.banners) {
      const age = t - b.at;
      if (age > b.dur - 0.4 && blink(m.time, 0.12, 0.5)) continue;
      txt(g, b.text, W / 2, y, b.big ? 16 : 8, b.color, 'center', u);
      y += (b.big ? 18 : 10) * u;
      if (b.sub) {
        txt(g, b.sub, W / 2, y, 8, C.paper, 'center', u);
        y += 10 * u;
      }
    }
    const st = zm.state;
    // "ROUND 1" while the first round comes in.
    if (st && st.phase === 'pre' && st.phaseEndsAt !== null) txt(g, 'GET READY', W / 2, H * 0.36, 16, CHALK_HI, 'center', u);
  },
  72,
);

registerHudWidget(
  'zombies.down',
  (g, W, H) => {
    const m = currentMatch();
    const st = zm.state;
    if (!isZombiesMatch(m) || !st) return;
    const u = unit(H);
    // Markers over downed teammates (red, with the bleed-out left).
    const placed: WaypointSlot[] = [];
    for (const p of st.players) {
      if (p.id === m.myId || !p.down) continue;
      const r = m.remotes.views.get(p.id);
      if (!r) continue;
      const left = p.downUntil !== null ? Math.max(0, Math.ceil(p.downUntil - m.serverTime)) : 0;
      drawWaypoint(m, g, W, H, { x: r.x, y: r.y + 1.0, z: r.z, label: p.revive > 0 ? 'REVIVING' : 'REVIVE', caption: `${m.nameOf(p.id).toUpperCase()} ${left}`, color: p.revive > 0 ? C.friend : C.warn, blink: p.revive <= 0, hideWithin: 1.2 }, placed);
      // The revive progress under the marker (whoever is reviving: you or a partner).
      if (p.revive > 0) {
        v3.set(r.x, r.y + 1.0, r.z).project(m.renderer.cam);
        if (v3.z < 1 && Math.abs(v3.x) < 1 && Math.abs(v3.y) < 1) {
          const sx = (v3.x * 0.5 + 0.5) * W;
          const sy = (-v3.y * 0.5 + 0.5) * H;
          const bw = 40 * u;
          box(g, sx - bw / 2, sy + 26 * u, bw, 3 * u, C.empty, u);
          rect(g, sx - bw / 2, sy + 26 * u, bw * Math.min(1, p.revive), 3 * u, C.friend);
        }
      }
    }
    const me = myInfo(m);
    if (!me || !me.down || !m.alive) return;
    const left = me.downUntil !== null ? Math.max(0, me.downUntil - m.serverTime) : 0;
    const total = me.selfRevive ? ZOMBIES.soloReviveSec : ZOMBIES.bleedOutSec;
    const title = me.selfRevive ? 'QUICK REVIVE' : me.revive > 0 ? 'BEING REVIVED' : 'BLEEDING OUT';
    txt(g, title, W / 2, H * 0.3, 16, blink(m.time, 0.8, 0.55) ? C.warn : C.hi, 'center', u);
    const bw = 90 * u;
    box(g, W / 2 - bw / 2, H * 0.3 + 20 * u, bw, 4 * u, C.ink, u);
    rect(g, W / 2 - bw / 2, H * 0.3 + 20 * u, bw * Math.min(1, me.selfRevive ? 1 - left / total : left / total), 4 * u, me.selfRevive ? C.friend : C.health);
    if (me.revive > 0) rect(g, W / 2 - bw / 2, H * 0.3 + 28 * u, bw * me.revive, 2 * u, C.friend);
  },
  64,
);

registerHudWidget(
  'zombies.drink',
  (g, W, H) => {
    const m = currentMatch();
    if (!isZombiesMatch(m)) return;
    const t = now() - zm.drinkAt;
    if (t < 0 || t > 2.6) return;
    const u = unit(H);
    // The bottle comes up, tips back, goes away.
    const up = t < 0.4 ? t / 0.4 : t > 2.2 ? 1 - (t - 2.2) / 0.4 : 1;
    const tip = t > 0.6 && t < 2.0 ? Math.min(1, (t - 0.6) / 0.5) : t >= 2.0 ? Math.max(0, 1 - (t - 2.0) / 0.3) : 0;
    const bx = W * 0.56 - tip * 20 * u;
    const by = H - up * 70 * u + tip * 10 * u;
    const bw = 12 * u;
    const bh = 40 * u;
    const lean = tip * 8 * u;
    for (let i = 0; i < bh / u; i++) {
      const k = i / (bh / u);
      const w = k < 0.3 ? bw * 0.4 : bw;
      const x = bx - w / 2 - lean * (1 - k);
      rect(g, x - u, by + i * u, w + 2 * u, u, C.ink);
      rect(g, x, by + i * u, w, u, k < 0.3 ? '#2a2a2a' : k > 0.45 && k < 0.7 ? zm.drinkColor : '#5a3a22');
    }
  },
  42,
);

registerHudWidget(
  'zombies.gameover',
  (g, W, H) => {
    const m = currentMatch();
    const st = zm.state;
    if (!isZombiesMatch(m) || !st || st.survived === null) return;
    const u = unit(H);
    const t = now() - zm.gameOverAt;
    if (t < 0.4) return;
    rect(g, 0, H * 0.32, W, 46 * u, '#120404');
    txt(g, 'GAME OVER', W / 2, H * 0.32 + 6 * u, 16, CHALK_HI, 'center', u);
    const n = st.survived;
    txt(g, `YOU SURVIVED ${n} ROUND${n === 1 ? '' : 'S'}`, W / 2, H * 0.32 + 28 * u, 8, C.paper, 'center', u);
  },
  96,
);

// ---------------------------------------------------------------------------------------------
// Core widget wraps (Zombies only)
// ---------------------------------------------------------------------------------------------

let wrapped = false;
function wrapWidgets(): void {
  if (wrapped) return;
  wrapped = true;
  const wrap = (id: string, fn: (orig: HudDraw) => HudDraw) => {
    const w = hudWidgets.get(id);
    if (w) registerHudWidget(id, fn(w.draw), w.order);
  };
  const hideInZombies = (orig: HudDraw): HudDraw => (g, W, H, dt) => {
    if (!isZombiesMatch(currentMatch())) orig(g, W, H, dt);
  };
  for (const id of ['core.killfeed', 'core.compass', 'core.title', 'killstreaks.radar', 'killstreaks.ladder', 'progression.popups', 'progression.ticker', 'frontend.classHint', 'perks.laststand', 'perks.list']) wrap(id, hideInZombies);
  // Headshots: a bigger gold hitmarker (red with a gold centre on a head kill), so the x4 head
  // multiplier reads at a glance. The server's `hit` carries the part it registered.
  wrap('core.hitmarker', (orig) => (g, W, H, dt) => {
    const m = currentMatch();
    if (!isZombiesMatch(m) || !m.hitHead || m.time - m.hitAt > 0.3) return orig(g, W, H, dt);
    const u = unit(H);
    const mx = Math.floor(W / 2);
    const my = Math.floor(H / 2);
    const col = m.hitKill ? '#ff4a3a' : HEADSHOT_GOLD;
    for (let i = 3; i < 9; i++) for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) rect(g, mx + sx * i * u, my + sy * i * u, u * (i < 5 ? 2 : 1), u * (i < 5 ? 2 : 1), col);
    for (const [sx, sy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) rect(g, mx + sx * 2 * u, my + sy * 2 * u, u, u, HEADSHOT_GOLD);
  });
  wrap('core.score', (orig) => (g, W, H, dt) => {
    const m = currentMatch();
    if (!isZombiesMatch(m)) return orig(g, W, H, dt);
    drawPoints(m, g, W, H);
  });
  // No name tags over the horde.
  wrap('core.names', (orig) => (g, W, H, dt) => {
    const m = currentMatch();
    if (!isZombiesMatch(m)) return orig(g, W, H, dt);
    // core.names skips the dead: hide the undead from it for this draw.
    const hidden = [...m.remotes.views.values()].filter((v) => v.team === 1 && v.alive);
    for (const v of hidden) v.alive = false;
    try {
      orig(g, W, H, dt);
    } finally {
      for (const v of hidden) v.alive = true;
    }
  });
  wrap('core.scoreboard', (orig) => (g, W, H, dt) => {
    const m = currentMatch();
    if (!isZombiesMatch(m)) return orig(g, W, H, dt);
    if (!m.controls.isHeld('scores') || zm.state?.survived !== null) return;
    drawScoreboard(m, g, W, H);
  });
  wrap('core.death', (orig) => (g, W, H, dt) => {
    const m = currentMatch();
    if (!isZombiesMatch(m)) return orig(g, W, H, dt);
    if (m.alive || zm.state?.survived !== null || m.phase === 'ended') return;
    const u = unit(H);
    rect(g, 0, H * 0.3 - 6 * u, W, 34 * u, '#120404');
    txt(g, 'YOU BLED OUT', W / 2, H * 0.3, 16, C.warn, 'center', u);
    txt(g, 'BACK IN THE NEXT ROUND', W / 2, H * 0.3 + 18 * u, 8, C.paper, 'center', u);
  });
}

function drawScoreboard(m: Match, g: CanvasRenderingContext2D, W: number, H: number): void {
  const st = zm.state;
  if (!st) return;
  const u = unit(H);
  const cols = ['POINTS', 'KILLS', 'DOWNS', 'REVIVES', 'HEADSHOTS'];
  const w = Math.min(W - 20 * u, 300 * u);
  const x = (W - w) / 2;
  let y = H * 0.22;
  rect(g, x, y, w, (24 + st.players.length * 12) * u, '#0a0a0ae0');
  txt(g, `ROUND ${st.round}`, x + 6 * u, y + 4 * u, 8, CHALK_HI, 'left', u);
  cols.forEach((c, i) => txt(g, c, x + w * (0.42 + i * 0.12), y + 4 * u, 8, C.dim, 'center', u));
  y += 16 * u;
  st.players.forEach((p, k) => {
    const col = PLAYER_COLORS[k % PLAYER_COLORS.length]!;
    txt(g, m.nameOf(p.id).toUpperCase(), x + 6 * u, y, 8, p.id === m.myId ? C.hi : col, 'left', u);
    [p.points, p.kills, p.downs, p.revives, p.headshots].forEach((n, i) => txt(g, String(n), x + w * (0.42 + i * 0.12), y, 8, C.paper, 'center', u));
    y += 12 * u;
  });
}

registerMatchHook('zombies.hud', {
  start: () => wrapWidgets(),
});

/** The box's spot on screen (screenshots / tests). */
export function boxOnScreen(m: Match): { x: number; y: number } | null {
  for (const e of m.net.lastSnap?.ents ?? []) {
    if (e.kind !== ZM_ENTITY.box) continue;
    v3.set(e.x, e.y + MYSTERY_BOX.size.h, e.z).project(m.renderer.cam);
    return { x: v3.x, y: v3.y };
  }
  return null;
}

export type { EntitySnap };
