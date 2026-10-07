/**
 * Client side of the 'pickups' feature: dropped guns in the world (model.ts), the
 * "HOLD F TO SWAP FOR <GUN>" prompt, swap / ammo notices, and hiding the gun in a corpse's hands
 * once it has fallen to the floor. See docs/features/pickups.md.
 *
 * USE priority (mirrors the server's `useClaimed`): a care package in reach, planting / defusing,
 * last stand and driving a streak own the key, so the prompt stays hidden then and a hold that
 * started on one of them never shows the swap prompt until the key is let go.
 */
import * as THREE from 'three';
import { ATTACHMENT_BY_ID } from '../../../shared/defs/attachments';
import { CRATE_REACH, KS_ENTITY } from '../../../shared/defs/killstreaks';
import { MODE_TUNING } from '../../../shared/defs/modes';
import { dropAttachments, pickDropTarget, PICKUP, PICKUP_ENTITY, type DropSnapState } from '../../../shared/defs/pickups';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { eyeHeight } from '../../../shared/movement';
import type { EntitySnap } from '../../../shared/protocol';
import { sfx } from '../../game/audio';
import type { Match } from '../../game/match';
import { blink, box, HUD_COLORS as C, rect, txt, unit } from '../../hud/draw';
import { useKey } from '../../hud/waypoints';
import { onFeature, registerEntityRenderer, registerHudWidget, registerMatchHook } from '../../registry';
import { currentMatch } from '../../state';
import { ksClient } from '../killstreaks/store';
import { modes, myAction } from '../modes/store';
import { perkState } from '../perks/state';
import { dropRenderer, dropState } from './model';

export { buildDroppedGun } from './model';

registerEntityRenderer(PICKUP_ENTITY, dropRenderer);

const weaponName = (id: string) => (WEAPON_BY_ID.get(id)?.name ?? id).toUpperCase();

/** Does a crate, an objective, last stand or a streak own USE right now? */
export function useClaimedLocally(m: Match): boolean {
  if (perkState.lastStandUntil !== null) return true;
  const ks = ksClient.state;
  if (ks?.control || ks?.map) return true;
  if (ksClient.crate && m.time - ksClient.crate.at < 1) return true;
  const pos = m.net.predictor.shown();
  for (const e of m.net.lastSnap?.ents ?? []) {
    if (e.kind === KS_ENTITY.crate && e.s?.l === true && Math.hypot(pos.x - e.x, pos.z - e.z) <= CRATE_REACH.r && Math.abs(pos.y - e.y) < CRATE_REACH.dy) return true;
  }
  const st = modes.state;
  if (st && st.mode === m.joined.mode) {
    if (myAction()) return true;
    const sd = st.sd;
    if (sd?.phase === 'live' && sd.bomb.carrier === m.myId && sd.sites.some((s) => Math.hypot(pos.x - s.x, pos.z - s.z) <= s.r)) return true;
    if (sd?.phase === 'planted' && m.myTeam !== sd.attackers && Math.hypot(pos.x - sd.bomb.x, pos.z - sd.bomb.z) <= MODE_TUNING.sd.defuseReach) return true;
  }
  return false;
}

type DropEnt = EntitySnap & { s: DropSnapState };

/** The gun a USE hold would swap for (same maths as the server), or null. */
export function promptTarget(m: Match): DropEnt | null {
  const me = m.me;
  const snap = m.net.lastSnap;
  if (!me?.alive || !snap || m.phase !== 'playing' || m.slot >= 2) return null;
  const carried = new Set(me.weapons.slice(0, 2).map((w) => w.id));
  const pos = m.net.predictor.shown();
  const eyeY = pos.y + eyeHeight(m.net.predictor.state);
  const drops = snap.ents.filter((e): e is DropEnt => e.kind === PICKUP_ENTITY && !!dropState(e)?.l);
  const eye = { x: pos.x, y: eyeY, z: pos.z };
  const now = performance.now() / 1000;
  for (const d of drops) if (!seenAt.has(d.id)) seenAt.set(d.id, now);
  if (seenAt.size > 64) for (const id of [...seenAt.keys()]) if (!drops.some((d) => d.id === id)) seenAt.delete(id);
  // Not the gun I just put down (the server refuses it for PICKUP.reswapSec).
  const fresh = (d: DropEnt) => d.s.o === m.myId && now - (seenAt.get(d.id) ?? 0) < PICKUP.reswapSec;
  return pickDropTarget(pos, eyeY, m.yaw, m.pitch, drops, (d) => !carried.has(d.s.w) && !fresh(d) && m.net.world.lineOfSight(eye, { x: d.x, y: d.y + 0.1, z: d.z }, 'players'));
}

/** Local time each dropped gun was first seen. */
const seenAt = new Map<number, number>();

const ui = { holdT: 0, holdOn: -1, blocked: false };

registerHudWidget(
  'pickups.prompt',
  (g, W, H, dt) => {
    const m = currentMatch();
    if (!m || m.loading) return;
    const held = m.controls.isHeld('use');
    if (!held) ui.blocked = false;
    if (!m.alive || m.phase !== 'playing' || useClaimedLocally(m)) {
      if (held) ui.blocked = true;
      ui.holdT = 0;
      return;
    }
    const target = ui.blocked ? null : promptTarget(m);
    if (!target) {
      ui.holdT = 0;
      return;
    }
    if (held && ui.holdOn === target.id) ui.holdT += dt;
    else ui.holdT = 0;
    ui.holdOn = target.id;
    const u = unit(H);
    const cx = W / 2;
    const y = H / 2 + 34 * u;
    const s = target.s;
    txt(g, `HOLD ${useKey()} TO SWAP FOR ${weaponName(s.w)}`, cx, y, 8, blink(m.time, 1, 0.7) || held ? C.hi : C.paper, 'center', u);
    const atts = dropAttachments(s).map((a) => (ATTACHMENT_BY_ID.get(a)?.name ?? a).toUpperCase());
    txt(g, [...atts, `${s.m}/${s.r}`].join('  ·  '), cx, y + 10 * u, 6, C.dim, 'center', u);
    if (held && ui.holdT > 0) {
      const bw = 60 * u;
      box(g, cx - bw / 2, y + 18 * u, bw, 3 * u, C.empty, u);
      rect(g, cx - bw / 2, y + 18 * u, Math.min(1, ui.holdT / PICKUP.holdSec) * bw, 3 * u, C.hi);
    }
  },
  8,
);

function notice(text: string) {
  const m = currentMatch();
  if (!m) return;
  m.notices.push({ t: m.time, text });
  if (m.notices.length > 4) m.notices.shift();
}

onFeature('pickups.swapped', () => {
  ui.blocked = true; // no prompt for the gun we just put down until USE is let go (the server agrees)
  sfx.play('weapons.magin', { volume: 0.6 });
});

onFeature('pickups.ammo', (d) => {
  notice(`+${d.amount} ${weaponName(d.weapon)} ammo`);
  sfx.play('weapons.magin', { volume: 0.45 });
});

// A corpse whose gun has fallen to the floor stops holding it.
const hidden = new Map<string, { soldier: object; objs: THREE.Object3D[] }>();
registerMatchHook('pickups.corpses', {
  start() {
    hidden.clear();
  },
  frame(m) {
    const owners = new Set<string>();
    for (const e of m.net.lastSnap?.ents ?? []) if (e.kind === PICKUP_ENTITY) owners.add(dropState(e)?.o ?? '');
    for (const v of m.remotes.views.values()) {
      const h = hidden.get(v.id);
      const hide = !v.alive && owners.has(v.id);
      if (h && (!hide || h.soldier !== v.soldier)) {
        for (const o of h.objs) o.visible = true;
        hidden.delete(v.id);
      }
      if (hide && !hidden.has(v.id)) {
        const objs = v.soldier.aim.children.filter((o) => o instanceof THREE.Group && o.visible);
        for (const o of objs) o.visible = false;
        hidden.set(v.id, { soldier: v.soldier, objs });
      }
    }
    for (const id of [...hidden.keys()]) if (!m.remotes.views.has(id)) hidden.delete(id);
  },
});
