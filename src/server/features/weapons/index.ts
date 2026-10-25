/**
 * Server side of the 'weapons' feature area. See docs/features/weapons.md.
 *
 *   setup: the underbarrel grenade launcher behaviour (weapon id `gl`) and the Mystery Box's wonder
 *          weapons (`wonder/`: Ray Gun, Thundergun, Wunderwaffe DG-2, Winter's Howl, Scavenger,
 *          31-79 JGb215, Wave Gun; dev-only `weapons.wonderCheat` with LOFI_CHEATS=1).
 *   room:  primary attachment count (1 + `attachmentSlotsOffset(p, loadout)`, Warlord) at
 *          `beforeSpawn`; equipment (count + `equipmentCountOffset`, Warlord Pro) and the GL slot
 *          at `spawn`; Scavenger Pro refills (`perks.resupply`); knife on the MELEE edge (timing x
 *          `meleeSpeedMultiplier`); lethal / tactical raised on the press
 *          and thrown on release (frags cook while held); grenades, tomahawks (retrievable),
 *          and shell-by-shell reloads every tick; concussion slows movement and ADS; no ADS
 *          with a gun in each hand (`canAds`: Akimbo, Dual Wield).
 *
 * Bots: call `melee(room, bot)` / `startThrow(room, bot, 'lethal')` directly (or press the MELEE /
 * LETHAL / TACTICAL buttons; the throw leaves on release, so a one-tick press throws right after
 * the wind-up), read `flashedAmount` / `stunnedAmount` to blind/slow their brains.
 */
import { BASE_ATTACHMENT_SLOTS, validAttachments } from '../../../shared/defs/attachments';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { Buttons } from '../../../shared/input';
import { registerWeaponBehavior, type WeaponBehavior } from '../../combat';
import type { Feature } from '../../feature';
import type { Loadout } from '../../../shared/loadout';
import { makeWeapon } from '../../player';
import { dropCooked, equipAtSpawn, launchGrenade, refillEquipment, startThrow, stunnedAmount, updateNades, updateThrow } from './equipment';
import { melee } from './melee';
import { onReload, updateShells } from './reload';
import { updateTomahawks } from './tomahawk';
import { wext } from './state';
import { registerWonderBehaviors, wireWonder } from './wonder/index';
import { registerWonderCheat } from './wonder/cheat';

export { melee, meleeTarget } from './melee';
export { startThrow, flashedAmount, stunnedAmount, explode, spawnNade } from './equipment';
export { canRetrieveTomahawk, dropTomahawk, spawnTomahawk } from './tomahawk';
export type { WeaponsExt } from './state';

/** In place: the primary keeps at most `primarySlots` attachments (in the order picked), the secondary one. */
export function trimAttachments(loadout: Loadout, primarySlots: number): void {
  for (const slot of ['primary', 'secondary'] as const) {
    const w = loadout[slot];
    const def = WEAPON_BY_ID.get(w?.weapon ?? '');
    if (w && def) w.attachments = validAttachments(def, w.attachments, slot === 'primary' ? primarySlots : BASE_ATTACHMENT_SLOTS);
  }
}

const GL_BEHAVIOR: WeaponBehavior = {
  fire(room, player, _weapon, shot) {
    launchGrenade(room, player, shot.origin, shot.dir);
  },
};

const feature: Feature = {
  id: 'weapons',
  setup(api) {
    api.registerWeaponBehavior('gl', GL_BEHAVIOR);
    registerWonderBehaviors(api.registerWeaponBehavior);
    registerWonderCheat(api);
  },
  room(room) {
    // Idempotent: also here so rooms built without the app (unit tests) get the launcher.
    registerWeaponBehavior('gl', GL_BEHAVIOR);
    // Mystery Box wonder weapons: Ray Gun bolts, Thundergun, Wunderwaffe arcs, Winter's Howl frost.
    registerWonderBehaviors(registerWeaponBehavior);
    wireWonder(room);
    // BO1: one attachment per weapon; Warlord (perks) adds a primary slot through the modifier. It
    // reads the loadout being spawned: `player.loadout` is still the previous life's here, and a
    // class change mid-match must use the new class's perks. Low priority: after progression's
    // unlock gate (100), which may swap the class or strip a locked Warlord.
    room.bus.on(
      'beforeSpawn',
      (ev) => {
        trimAttachments(ev.loadout, BASE_ATTACHMENT_SLOTS + Math.max(0, Math.round(room.modifiers.sum('attachmentSlotsOffset', ev.player, ev.loadout))));
      },
      { priority: -10 },
    );

    room.bus.on('spawn', ({ player }) => {
      equipAtSpawn(room, player);
      // Underbarrel grenade launcher: an extra weapon slot (switch with 3 / the wheel).
      const primary = player.weapons[0];
      if (primary?.def.attachmentIds.includes('gl') && player.weapons.length === 2) player.weapons.push(makeWeapon({ weapon: 'gl', attachments: [], camo: primary.camo }, 'gl'));
    });

    room.bus.on('buttons', ({ player, pressed }) => {
      if (!player.alive || room.phase !== 'playing') return;
      // Hands taken (frozen solid by Winter's Howl, swelling under the Wave Gun): no knife, no throw.
      if (room.modifiers.any('canFire', player) === false) return;
      if (pressed & Buttons.MELEE) melee(room, player);
      if (pressed & Buttons.LETHAL) startThrow(room, player, 'lethal');
      else if (pressed & Buttons.TACTICAL) startThrow(room, player, 'tactical');
    });

    room.bus.on('reload', ({ player, empty }) => onReload(room, player, empty));
    // Scavenger Pro: grenades back from a resupply pack, up to the carry cap.
    room.bus.on('perks.resupply', ({ player, lethal, tactical }) => {
      if (player.alive) refillEquipment(room, player, lethal, tactical);
    });

    room.bus.on('death', ({ victim }) => {
      dropCooked(room, victim);
      const x = wext(victim);
      x.shells = null;
      x.flashedUntil = x.stunnedUntil = 0;
    });

    room.bus.on('tick', ({ dt }) => {
      if (room.phase !== 'playing') return;
      for (const p of room.players.values()) {
        if (!p.ext.weapons) continue;
        updateThrow(room, p);
        updateShells(room, p);
      }
      updateNades(room, dt);
      updateTomahawks(room, dt);
    });

    // Concussion: slower movement and aiming while it lasts.
    room.modifiers.add('speedMultiplier', (p) => {
      const a = stunnedAmount(room, p);
      return a > 0 ? 1 - 0.45 * a : undefined;
    }, 'weapons.concussion');
    room.modifiers.add('adsMultiplier', (p) => {
      const a = stunnedAmount(room, p);
      return a > 0 ? 1 + a : undefined;
    }, 'weapons.concussion');
    // A gun in each hand (Akimbo, Dual Wield): no sights to aim down (the effective def has `noAds`).
    room.modifiers.add('canAds', (p) => (p.weapons[p.slot]?.def.noAds ? false : undefined), 'weapons.noAds');
  },
};

export default feature;
