/**
 * Core HUD widgets (ported from the prototype's drawHud, plus match UI). Ids and draw orders:
 *
 *   core.names 5, core.damage 10, core.scope 15, core.crosshair 20, core.hitmarker 25,
 *   core.compass 30, core.health 40, core.ammo 41, core.score 50, core.killfeed 55,
 *   core.status 60, core.title 70, core.death 80, core.phase 85, core.scoreboard 90, core.fps 99,
 *   core.aimDebug 98 (`?aimdebug=1`: controller aim assist state)
 *
 * Replace one with `registerHudWidget('core.ammo', myDraw, 41)` or drop it with
 * `unregisterHudWidget`. All read `currentMatch()`.
 */
import * as THREE from 'three';
import { EQUIPMENT_BY_ID } from '../../shared/defs/equipment';
import { KILLSTREAK_BY_ID } from '../../shared/defs/killstreaks';
import { WEAPON_BY_ID } from '../../shared/defs/weapons';
import { TEAM_NAMES } from '../../shared/constants';
import { inputDevice } from '../game/gamepad';
import { promptKey } from '../game/prompts';
import { registerHudWidget } from '../registry';
import { settings } from '../settings';
import { currentMatch } from '../state';
import { blink, box, clock, HUD_COLORS as C, rect, txt, unit } from './draw';

/** Display name for a kill's weapon id: guns, lethals, killstreaks ("Attack Helicopter", not "ATTACK_HELICOPTER"). */
const weaponName = (id: string) => WEAPON_BY_ID.get(id)?.name ?? EQUIPMENT_BY_ID.get(id)?.name ?? KILLSTREAK_BY_ID.get(id)?.name ?? id.replace(/_/g, ' ').toUpperCase();
const v = new THREE.Vector3();

// Name tags over teammates (always) and enemies under the crosshair.
registerHudWidget(
  'core.names',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.map) return;
    const u = unit(H);
    const cam = m.renderer.cam;
    for (const r of m.remotes.views.values()) {
      if (!r.alive) continue;
      const enemy = m.isEnemy(r.id);
      v.set(r.x, r.y + (r.crouch > 0.5 ? 1.45 : 2.05), r.z).project(cam);
      if (v.z > 1 || v.z < -1) continue;
      const x = (v.x * 0.5 + 0.5) * W;
      const y = (-v.y * 0.5 + 0.5) * H;
      const d = Math.hypot(r.x - cam.position.x, r.z - cam.position.z);
      if (enemy) {
        // Only when aimed near and visible.
        if (Math.abs(x - W / 2) > 14 * u || Math.abs(y - H / 2) > 40 * u || d > 45) continue;
        if (!m.net.world.lineOfSight({ x: cam.position.x, y: cam.position.y, z: cam.position.z }, { x: r.x, y: r.y + 1.5, z: r.z })) continue;
        txt(g, m.nameOf(r.id), x, y - 8 * u, 8, C.enemy, 'center');
      } else {
        if (d > 60) continue;
        txt(g, m.nameOf(r.id), x, y - 8 * u, 8, C.friend, 'center');
      }
    }
  },
  5,
);

// Damage direction: red arcs pointing at where the hit came from.
registerHudWidget(
  'core.damage',
  (g, W, H) => {
    const m = currentMatch();
    if (!m) return;
    const u = unit(H);
    m.damageMarks = m.damageMarks.filter((d) => m.time - d.t < 1.6);
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.28;
    for (const d of m.damageMarks) {
      const a = 1 - (m.time - d.t) / 1.6;
      // Screen angle: 0 = straight ahead (top), clockwise.
      const rel = -(d.yaw - m.yaw);
      g.globalAlpha = Math.min(1, a * 1.5);
      for (let i = -3; i <= 3; i++) {
        const t = rel + i * 0.06;
        const x = cx + Math.sin(t) * R;
        const y = cy - Math.cos(t) * R;
        rect(g, x - 2 * u, y - 2 * u, 4 * u, 4 * u, i === 0 ? '#ff3a2a' : '#b01818');
      }
      g.globalAlpha = 1;
    }
  },
  10,
);

// Sniper scope.
registerHudWidget(
  'core.scope',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.alive) return;
    const def = m.weapon();
    const ads = m.net.predictor.state.ads;
    if (!def?.scope || ads < 0.85) return;
    const u = unit(H);
    const r = H * 0.42;
    g.fillStyle = C.ink;
    g.beginPath();
    g.rect(0, 0, W, H);
    g.arc(W / 2, H / 2, r, 0, Math.PI * 2, true);
    g.fill('evenodd');
    rect(g, 0, H / 2, W, u, C.ink);
    rect(g, W / 2, 0, u, H, C.ink);
    for (let i = 1; i < 5; i++) rect(g, W / 2 - 3 * u, H / 2 + i * 8 * u, 7 * u, u, C.ink);
  },
  15,
);

// Crosshair: four ticks spread by the weapon cone.
registerHudWidget(
  'core.crosshair',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.alive || m.phase === 'ended') return;
    const ads = m.net.predictor.state.ads;
    if (ads > 0.5) return;
    const u = unit(H);
    const fovRad = (m.renderer.cam.fov * Math.PI) / 180;
    const px = (Math.tan((m.spread * Math.PI) / 180) / Math.tan(fovRad / 2)) * (H / 2);
    const gap = Math.round(Math.max(2 * u, px));
    const L = 3 * u;
    const mx = Math.floor(W / 2);
    const my = Math.floor(H / 2);
    const sprint = m.net.predictor.state.sprinting;
    if (sprint) return;
    for (const [x, y, w, h] of [[mx - gap - L, my, L, u], [mx + gap + u, my, L, u], [mx, my - gap - L, u, L], [mx, my + gap + u, u, L]] as const) box(g, x, y, w, h, C.paper, u);
  },
  20,
);

registerHudWidget(
  'core.hitmarker',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || m.time - m.hitAt > 0.22) return;
    const u = unit(H);
    const mx = Math.floor(W / 2);
    const my = Math.floor(H / 2);
    const col = m.hitKill ? '#ff4a3a' : '#ffffff';
    for (let i = 3; i < 7; i++) for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) rect(g, mx + sx * i * u, my + sy * i * u, u, u, col);
  },
  25,
);

registerHudWidget(
  'core.compass',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.map) return;
    const u = unit(H);
    const cw = Math.min(110 * u, W * 0.5);
    const cx = W / 2;
    const cy = 6 * u;
    rect(g, cx - cw / 2, cy, cw, 9 * u, 'rgba(10,10,10,.55)');
    const head = ((((-m.yaw * 180) / Math.PI) % 360) + 360) % 360;
    for (let a = 0; a < 360; a += 15) {
      let d = a - head;
      d = ((d + 540) % 360) - 180;
      const x = cx + d * (cw / 150);
      if (Math.abs(x - cx) > cw / 2 - 3 * u) continue;
      const lab = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[a];
      if (lab) txt(g, lab, x, cy + u, 8, lab === 'N' ? C.warn : C.paper, 'center', u);
      else rect(g, x, cy + 3 * u, u, 3 * u, C.dim);
    }
    rect(g, cx, cy + 9 * u, u, 2 * u, C.hi);
  },
  30,
);

registerHudWidget(
  'core.health',
  (g, W, H) => {
    const m = currentMatch();
    const me = m?.me;
    if (!m || !me || !me.alive) return;
    const u = unit(H);
    const hy = H - 24 * u;
    const hx = 8 * u;
    rect(g, hx - u, hy + 2 * u, 11 * u, 11 * u, C.ink);
    rect(g, hx + 3 * u, hy + 3 * u, 3 * u, 9 * u, C.health);
    rect(g, hx, hy + 6 * u, 9 * u, 3 * u, C.health);
    const hp = Math.max(0, Math.round(me.health));
    txt(g, String(hp), hx + 14 * u, hy, 16, hp < 40 ? C.warn : C.hi, 'left', u);
    const frac = Math.max(0, Math.min(1, me.health / Math.max(1, me.maxHealth)));
    rect(g, hx, hy + 18 * u, 46 * u, 3 * u, C.ink);
    rect(g, hx + u, hy + 19 * u, Math.round(44 * u * frac), u, frac < 0.4 ? C.warn : C.blue);
  },
  40,
);

registerHudWidget(
  'core.ammo',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.alive) return;
    const def = m.weapon();
    if (!def) return;
    const u = unit(H);
    const { mag, reserve } = m.ammo();
    txt(g, String(mag), W - 30 * u, H - 24 * u, 16, mag <= Math.ceil(def.magazine * 0.25) ? C.warn : C.hi, 'right', u);
    txt(g, '/' + reserve, W - 8 * u, H - 18 * u, 8, '#d8d0c0', 'right', u);
    txt(g, def.name.toUpperCase(), W - 8 * u, H - 9 * u, 8, C.dim, 'right', u);
    const n = Math.min(def.magazine, 60);
    const perRow = Math.min(n, 15);
    const shown = Math.round((mag / Math.max(1, def.magazine)) * n);
    for (let i = 0; i < n; i++) {
      const x = W - 8 * u - (i % perRow) * 3 * u - 2 * u;
      const y = H - 32 * u - Math.floor(i / perRow) * 5 * u;
      rect(g, x - u, y - u, 3 * u, 5 * u, C.ink);
      rect(g, x, y, u, 3 * u, i < shown ? C.ammo : C.empty);
    }
  },
  41,
);

// Score + timer (top left), CoD style.
registerHudWidget(
  'core.score',
  (g, W, H) => {
    const m = currentMatch();
    if (!m) return;
    const u = unit(H);
    const x = 8 * u;
    let y = 6 * u;
    const limit = m.joined.scoreLimit;
    const left = m.phaseEndsAt !== null && m.phase === 'playing' ? m.phaseEndsAt - m.serverTime : m.timeLeft;
    if (left !== null && left !== undefined) {
      txt(g, clock(left), x, y, 8, left < 30 && blink(m.time, 1, 0.6) ? C.warn : C.paper, 'left', u);
      y += 10 * u;
    }
    const barW = 60 * u;
    if (m.teamScores && m.myTeam !== null) {
      const mine = m.myTeam;
      const ours = m.teamScores[mine];
      const theirs = m.teamScores[mine === 0 ? 1 : 0];
      for (const [label, score, col] of [[TEAM_NAMES[mine], ours, C.friend], [TEAM_NAMES[mine === 0 ? 1 : 0], theirs, C.enemy]] as const) {
        rect(g, x, y, barW + 2 * u, 7 * u, 'rgba(10,10,10,.6)');
        rect(g, x + u, y + u, Math.round(barW * Math.min(1, score / Math.max(1, limit))), 5 * u, col);
        txt(g, String(score), x + barW + 5 * u, y - u, 8, col, 'left', u);
        txt(g, label.toUpperCase(), x + barW + 22 * u, y - u, 8, C.dim, 'left', u);
        y += 9 * u;
      }
    } else {
      const myScore = m.scores.get(m.myId);
      let lead = 0;
      for (const s of m.scores.values()) if (s.id !== m.myId) lead = Math.max(lead, s.kills);
      const mine = myScore?.kills ?? 0;
      for (const [label, score, col] of [['YOU', mine, C.friend], ['LEADER', lead, C.enemy]] as const) {
        rect(g, x, y, barW + 2 * u, 7 * u, 'rgba(10,10,10,.6)');
        rect(g, x + u, y + u, Math.round(barW * Math.min(1, score / Math.max(1, limit))), 5 * u, col);
        txt(g, `${score} ${label}`, x + barW + 5 * u, y - u, 8, col, 'left', u);
        y += 9 * u;
      }
    }
  },
  50,
);

registerHudWidget(
  'core.killfeed',
  (g, W, H) => {
    const m = currentMatch();
    if (!m) return;
    const u = unit(H);
    const feed = m.killfeed.filter((f) => m.time - f.t < 5);
    let y = 20 * u;
    for (const f of feed) {
      const victimCol = f.victim === m.myId ? C.hi : m.isEnemy(f.victim) ? C.enemy : C.friend;
      const attCol = f.attacker === m.myId ? C.hi : f.attacker && m.isEnemy(f.attacker) ? C.enemy : C.friend;
      let x = W - 8 * u;
      const vw = txt(g, m.nameOf(f.victim), x, y, 8, victimCol, 'right', u);
      x -= vw + 4 * u;
      const wtxt = `[${weaponName(f.weapon).toUpperCase()}${f.headshot ? ' HS' : ''}]`;
      const ww = txt(g, wtxt, x, y, 8, C.paper, 'right', u);
      x -= ww + 4 * u;
      if (f.attacker && f.attacker !== f.victim) txt(g, m.nameOf(f.attacker), x, y, 8, attCol, 'right', u);
      y += 9 * u;
    }
  },
  55,
);

// Reloading / low ammo / notices.
registerHudWidget(
  'core.status',
  (g, W, H) => {
    const m = currentMatch();
    if (!m) return;
    const u = unit(H);
    if (m.alive) {
      if (m.reloadProgress() >= 0) txt(g, 'RELOADING', W / 2, H / 2 + 14 * u, 8, C.paper, 'center', u);
      else {
        const def = m.weapon();
        const a = m.ammo();
        if (def && a.mag === 0 && a.reserve === 0) txt(g, 'NO AMMO', W / 2, H / 2 + 14 * u, 8, C.warn, 'center', u);
        else if (def && a.mag <= Math.ceil(def.magazine * 0.25)) txt(g, `PRESS ${promptKey('reload')} TO RELOAD`, W / 2, H / 2 + 14 * u, 8, blink(m.time, 0.8, 0.5) ? C.warn : C.paper, 'center', u);
      }
    }
    m.notices = m.notices.filter((n) => m.time - n.t < 4);
    m.notices.forEach((n, i) => txt(g, n.text.toUpperCase(), W / 2, H * 0.62 + i * 10 * u, 8, C.hi, 'center', u));
  },
  60,
);

registerHudWidget(
  'core.title',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.map) return;
    const ct = m.time - m.cardAt;
    if (ct > 3.5 || !(ct < 3 || Math.floor(ct * 10) % 2)) return;
    const u = unit(H);
    const T = m.map.time;
    txt(g, m.mapName.toUpperCase(), W / 2, H * 0.26, 16, C.paper, 'center', u);
    txt(g, `${(m.mode?.name ?? m.joined.mode).toUpperCase()} · ${T.name.toUpperCase()} · ${T.clock}`, W / 2, H * 0.26 + 20 * u, 8, C.hi, 'center', u);
  },
  70,
);

registerHudWidget(
  'core.death',
  (g, W, H) => {
    const m = currentMatch();
    const d = m?.death;
    if (!m || !d || m.alive || m.phase === 'ended') return;
    const u = unit(H);
    const y = H * 0.3;
    rect(g, 0, y - 6 * u, W, 44 * u, 'rgba(10,10,10,.55)');
    if (d.attacker && d.attacker !== m.myId) {
      txt(g, 'KILLED BY', W / 2, y, 8, C.paper, 'center', u);
      txt(g, m.nameOf(d.attacker), W / 2, y + 9 * u, 16, C.enemy, 'center', u);
      txt(g, weaponName(d.weapon).toUpperCase(), W / 2, y + 27 * u, 8, C.dim, 'center', u);
    } else {
      txt(g, d.weapon === 'world' ? 'OUT OF BOUNDS' : 'YOU DIED', W / 2, y + 9 * u, 16, C.warn, 'center', u);
    }
    if (d.respawnAt !== null) {
      const left = d.respawnAt - m.serverTime;
      txt(g, left > 0 ? `RESPAWN IN ${Math.ceil(left)}` : 'RESPAWNING', W / 2, H * 0.62, 8, C.hi, 'center', u);
    } else txt(g, 'WAITING FOR NEXT ROUND', W / 2, H * 0.62, 8, C.hi, 'center', u);
  },
  80,
);

registerHudWidget(
  'core.phase',
  (g, W, H) => {
    const m = currentMatch();
    if (!m) return;
    const u = unit(H);
    if (m.loading) {
      txt(g, m.loading.toUpperCase(), W / 2, H / 2, 8, C.paper, 'center', u);
      return;
    }
    if (m.phase === 'countdown' && m.phaseEndsAt !== null) {
      const left = m.phaseEndsAt - m.serverTime;
      txt(g, 'MATCH BEGINS IN', W / 2, H * 0.36, 8, C.paper, 'center', u);
      txt(g, String(Math.max(0, Math.ceil(left))), W / 2, H * 0.36 + 10 * u, 16, C.hi, 'center', u);
    } else if (m.phase === 'lobby') {
      txt(g, 'WAITING FOR PLAYERS', W / 2, H * 0.36, 8, C.paper, 'center', u);
    } else if (m.phase === 'ended') {
      const r = m.results;
      let title = 'MATCH OVER';
      if (r) {
        const won = r.winners.includes(m.myId);
        title = r.winners.length === 0 ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT';
      }
      txt(g, title, W / 2, 16 * u, 16, title === 'VICTORY' ? C.hi : title === 'DEFEAT' ? C.warn : C.paper, 'center', u);
      if (m.phaseEndsAt !== null) txt(g, `NEXT MATCH IN ${Math.max(0, Math.ceil(m.phaseEndsAt - m.serverTime))}`, W / 2, H - 14 * u, 8, C.paper, 'center', u);
    }
  },
  85,
);

// Tab scoreboard (also shown after the match).
registerHudWidget(
  'core.scoreboard',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.scoreboardOpen || m.loading) return;
    const u = unit(H);
    const bw = Math.min(W - 16 * u, 230 * u);
    const x0 = (W - bw) / 2;
    let y = (m.phase === 'ended' ? 38 : 30) * u;
    const cols = [
      // Right edges; PING is ~28 units wide, so D sits clear of it.
      { k: 'SCORE', x: bw - 86 * u },
      { k: 'K', x: bw - 68 * u },
      { k: 'A', x: bw - 53 * u },
      { k: 'D', x: bw - 38 * u },
      { k: 'PING', x: bw - 2 * u },
    ];
    const header = (label: string, col: string) => {
      rect(g, x0, y, bw, 10 * u, 'rgba(10,10,10,.8)');
      txt(g, label, x0 + 4 * u, y + u, 8, col, 'left', u);
      for (const c of cols) txt(g, c.k, x0 + c.x, y + u, 8, C.dim, 'right', u);
      y += 11 * u;
    };
    const row = (id: string) => {
      const s = m.scores.get(id);
      const me = id === m.myId;
      rect(g, x0, y, bw, 9 * u, me ? 'rgba(90,80,30,.75)' : 'rgba(10,10,10,.6)');
      const r = m.roster.get(id);
      const name = `${r?.bot ? '[BOT] ' : ''}${m.nameOf(id)}`;
      txt(g, name.slice(0, 22), x0 + 4 * u, y + u, 8, me ? C.hi : C.paper, 'left', u);
      const vals = [s?.score ?? 0, s?.kills ?? 0, s?.assists ?? 0, s?.deaths ?? 0];
      vals.forEach((val, i) => txt(g, String(val), x0 + cols[i]!.x, y + u, 8, C.paper, 'right', u));
      txt(g, me ? String(Math.round(m.netRtt * 1000)) : r?.bot ? 'BOT' : '-', x0 + cols[4]!.x, y + u, 8, C.dim, 'right', u);
      y += 10 * u;
    };
    const ids = [...m.roster.keys()];
    const byScore = (a: string, b: string) => (m.scores.get(b)?.score ?? 0) - (m.scores.get(a)?.score ?? 0);
    if (m.mode?.teams) {
      const mine = m.myTeam ?? 0;
      for (const team of [mine, mine === 0 ? 1 : 0] as const) {
        const score = m.teamScores?.[team] ?? 0;
        header(`${TEAM_NAMES[team]!.toUpperCase()}  ${score}`, team === mine ? C.friend : C.enemy);
        for (const id of ids.filter((i) => m.roster.get(i)?.team === team).sort(byScore)) row(id);
        y += 4 * u;
      }
    } else {
      header(`${(m.mode?.name ?? 'FREE-FOR-ALL').toUpperCase()}`, C.hi);
      for (const id of ids.sort(byScore)) row(id);
    }
  },
  90,
);

registerHudWidget(
  'core.fps',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !settings.showFps) return;
    const u = unit(H);
    txt(g, `${Math.round(m.fps)} FPS  ${Math.round(m.netRtt * 1000)} MS  ${W}x${H}`, 8 * u, H - 36 * u, 8, C.dim, 'left', u);
  },
  99,
);

// Debug: controller aim assist (`?aimdebug=1`): device, strength, slowdown, rotation and target.
const aimDebugOn = (() => {
  try {
    const v = new URLSearchParams(location.search).get('aimdebug');
    return v !== null && v !== '0';
  } catch {
    return false;
  }
})();
registerHudWidget(
  'core.aimDebug',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !aimDebugOn) return;
    const u = unit(H);
    const a = m.aimDebug;
    const x = 8 * u;
    let y = 40 * u;
    const line = (s: string, c: string = C.paper) => {
      txt(g, s, x, y, 8, c, 'left', u);
      y += 10 * u;
    };
    rect(g, x - 3 * u, y - 3 * u, 132 * u, 66 * u, C.ink);
    line(`AIM ASSIST ${settings.aimAssist.toUpperCase()}  ${inputDevice().toUpperCase()}`, C.hi);
    if (!a) return line('NO STICK INPUT', C.dim);
    const on = a.slow < 0.999;
    line(`SLOW ${Math.round((1 - a.slow) * 100)}%`, on ? C.hi : C.dim);
    line(`ROT ${((a.rotRate * 180) / Math.PI).toFixed(1)} DEG/S`, a.rotRate > 1e-4 ? C.hi : C.dim);
    line(`TARGET ${a.target ? m.nameOf(a.target).toUpperCase() : '-'}`, a.target ? C.enemy : C.dim);
    box(g, x, y, 100 * u, 4 * u, C.empty, u);
    rect(g, x, y, Math.round(100 * u * a.weight), 4 * u, C.hi);
    // Crosshair ring while slowed.
    if (on) {
      const r = 9 * u;
      for (let i = 0; i < 24; i++) {
        const t = (i / 24) * Math.PI * 2;
        rect(g, W / 2 + Math.cos(t) * r - u / 2, H / 2 + Math.sin(t) * r - u / 2, u, u, C.hi);
      }
    }
  },
  98,
);
