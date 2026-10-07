/**
 * Server side of the 'weapons' feature area. See docs/features/weapons.md.
 *
 *   setup: the underbarrel grenade launcher behaviour (weapon id `gl`).
 *   room:  attachment count (1 + `attachmentSlotsOffset`, Warlord) at `beforeSpawn`; equipment and
 *          the GL slot at `spawn`; knife / lethal / tactical on button edges; projectiles, cooking
 *          and shell-by-shell reloads every tick; concussion slows movement and ADS.
 *
 * Bots: call `melee(room, bot)` / `startThrow(room, bot, 'lethal')` directly (or press the MELEE /
 * LETHAL / TACTICAL buttons), read `flashedAmount` / `stunnedAmount` to blind/slow their brains.
 */
import { BASE_ATTACHMENT_SLOTS, validAttachments } from '../../../shared/defs/attachments';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { Buttons } from '../../../shared/input';
import { registerWeaponBehavior, type WeaponBehavior } from '../../combat';
import type { Feature } from '../../feature';
import { makeWeapon } from '../../player';
import { dropCooked, equipAtSpawn, launchGrenade, startThrow, stunnedAmount, updateNades, updateThrow } from './equipment';
import { melee } from './melee';
import { onReload, updateShells } from './reload';
import { wext } from './state';

export { melee, meleeTarget } from './melee';
export { startThrow, flashedAmount, stunnedAmount, explode, spawnNade } from './equipment';
export type { WeaponsExt } from './state';

const GL_BEHAVIOR: WeaponBehavior = {
  fire(room, player, _weapon, shot) {
    launchGrenade(room, player, shot.origin, shot.dir);
  },
};

const feature: Feature = {
  id: 'weapons',
  setup(api) {
    api.registerWeaponBehavior('gl', GL_BEHAVIOR);
  },
  room(room) {
    // Idempotent: also here so rooms built without the app (unit tests) get the launcher.
    registerWeaponBehavior('gl', GL_BEHAVIOR);
    // BO1: one attachment per weapon; Warlord-style perks add slots through the modifier.
    room.bus.on(
      'beforeSpawn',
      (ev) => {
        const max = BASE_ATTACHMENT_SLOTS + Math.max(0, Math.round(room.modifiers.sum('attachmentSlotsOffset', ev.player)));
        for (const slot of ['primary', 'secondary'] as const) {
          const w = ev.loadout[slot];
          const def = WEAPON_BY_ID.get(w?.weapon ?? '');
          if (w && def) w.attachments = validAttachments(def, w.attachments, max);
        }
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
      if (pressed & Buttons.MELEE) melee(room, player);
      if (pressed & Buttons.LETHAL) startThrow(room, player, 'lethal');
      else if (pressed & Buttons.TACTICAL) startThrow(room, player, 'tactical');
    });

    room.bus.on('reload', ({ player, empty }) => onReload(room, player, empty));

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
  },
};

export default feature;
