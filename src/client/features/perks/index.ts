/**
 * Client side of the "perks" feature (owner: perks-streaks): Ninja footsteps (silent) and Ninja
 * Pro (louder enemies), the Second Chance last stand (pistol forced, crawl camera, bleed-out and
 * revive HUD), Scavenger packs (only Scavenger users see them), perk notices and the perk list
 * shown at spawn.
 */
import { PERK_BY_ID, PERK_TUNING } from '../../../shared/defs/perks';
import { KS_ENTITY } from '../../../shared/defs/killstreaks';
import { blink, box, rect, txt, unit, HUD_COLORS as C } from '../../hud/draw';
import { onFeature, registerEntityRenderer, registerFootstepFilter, registerHudWidget, registerMatchHook } from '../../registry';
import { currentMatch } from '../../state';
import { buildPack, Kit } from '../killstreaks/models';
import { iHave, iHavePro, perkState, refreshPro } from './state';

export { myPerks, iHave, iHavePro, perkState } from './state';

// Footsteps: Ninja players are silent; with Ninja Pro you hear enemies louder.
registerFootstepFilter('perks.ninja', (id, volume) => {
  if (perkState.ninja.has(id)) return 0;
  const m = currentMatch();
  if (m && m.isEnemy(id) && iHavePro('ninja')) return volume * PERK_TUNING.ninjaProFootsteps;
  return volume;
});

onFeature('perks.notice', (d) => {
  const m = currentMatch();
  if (!m) return;
  m.notices.push({ t: m.time, text: d.text });
  if (m.notices.length > 4) m.notices.shift();
});

registerMatchHook('perks.client', {
  start() {
    void refreshPro();
    perkState.lastStandUntil = null;
  },
  frame(m) {
    // Revived: back to the weapon you went down with (BO1), as the server already switched.
    if (perkState.reviveSlot !== null) {
      if (m.alive && perkState.reviveSlot < (m.me?.weapons.length ?? 0)) m.slot = perkState.reviveSlot;
      perkState.reviveSlot = null;
    }
    if (perkState.lastStandUntil === null || !m.alive) return;
    // Last stand: pistol out, crawling low.
    if ((m.me?.weapons.length ?? 0) > 1) m.slot = 1;
    m.renderer.cam.position.y -= 0.9;
  },
});

// Scavenger packs: only for players with Scavenger, only the enemy's.
registerEntityRenderer(KS_ENTITY.scavenger, (e, match) => {
  const kit = new Kit();
  buildPack(kit);
  let t = Math.random() * 6;
  return {
    object: kit.root,
    update(snap, dt) {
      const enemyPack = snap.team === null || snap.team === undefined || snap.team !== match.myTeam || !match.mode?.teams;
      kit.root.visible = iHave('scavenger') && enemyPack;
      t += dt;
      kit.root.rotation.y = snap.yaw + t * 1.5;
      kit.root.position.set(snap.x, snap.y + 0.1 + Math.sin(t * 3) * 0.05, snap.z);
      kit.light(dt, match.map ? (x, y, z) => match.map!.lightAt(x, y, z) : null, kit.root.position);
      return false;
    },
    dispose: () => kit.dispose(),
  };
});

// Last stand HUD.
registerHudWidget(
  'perks.laststand',
  (g, W, H) => {
    const m = currentMatch();
    const until = perkState.lastStandUntil;
    if (!m || until === null || !m.alive) return;
    const u = unit(H);
    const left = Math.max(0, until - m.serverTime);
    const total = iHavePro('second_chance') ? PERK_TUNING.lastStandProSec : PERK_TUNING.lastStandSec;
    txt(g, 'SECOND CHANCE', W / 2, H * 0.3, 16, blink(m.time, 0.8, 0.55) ? C.warn : C.hi, 'center', u);
    const bw = 90 * u;
    box(g, W / 2 - bw / 2, H * 0.3 + 20 * u, bw, 4 * u, C.ink, u);
    rect(g, W / 2 - bw / 2, H * 0.3 + 20 * u, bw * (left / total), 4 * u, C.health);
    if (perkState.revive > 0) {
      txt(g, 'BEING REVIVED', W / 2, H * 0.3 + 28 * u, 8, C.friend, 'center', u);
      rect(g, W / 2 - bw / 2, H * 0.3 + 38 * u, bw * perkState.revive, 2 * u, C.friend);
    }
  },
  64,
);

// Perks at spawn (bottom left, above health) for a few seconds.
registerHudWidget(
  'perks.list',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.alive || !perkState.loadout) return;
    const age = performance.now() / 1000 - perkState.spawnedAt;
    if (age > 4) return;
    const u = unit(H);
    let y = H - 34 * u - perkState.loadout.perks.length * 9 * u;
    for (const id of perkState.loadout.perks) {
      const def = PERK_BY_ID.get(id);
      if (!def) continue;
      const pro = perkState.pro.has(id);
      txt(g, `${def.name.toUpperCase()}${pro ? ' PRO' : ''}`, 8 * u, y, 8, pro ? C.hi : C.paper, 'left', u);
      y += 9 * u;
    }
    void W;
  },
  43,
);
