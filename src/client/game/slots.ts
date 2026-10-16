/**
 * Which weapon slot the local player asks for each frame (pure, unit-tested): the slot goes out in
 * every input command and the server switches to it.
 *
 * Every life starts on the primary (CoD; the server's spawn puts slot 0 in your hands). While dead,
 * and in the gap between the `spawned` message and the first snapshot that shows you alive, the
 * client asks for slot 0 too. It used to follow the dead body's slot there, so the first commands
 * after a respawn carried the old secondary and the server switched straight back to it.
 */

/** The slot every life starts on: the primary. */
export const SPAWN_SLOT = 0;

/**
 * The slot to send this frame: `want` (a key, the wheel, Y) when it may switch now, the current one
 * otherwise, and `SPAWN_SLOT` while dead. `switched` is true when a switch starts this frame.
 */
export function frameSlot(o: { slot: number; want: number; alive: boolean; playing: boolean; weapons: number }): { slot: number; switched: boolean } {
  if (!o.alive) return { slot: SPAWN_SLOT, switched: false };
  if (o.playing && o.want !== o.slot && o.want >= 0 && o.want < o.weapons) return { slot: o.want, switched: true };
  return { slot: o.slot, switched: false };
}

/**
 * The weapon the first-person viewmodel shows: the one in the slot you ask for, or, when the server
 * changed your weapons under you (a mode handing out its own class, the Infected knife, a last-stand
 * pistol) and that slot no longer exists, the primary. Never null while you hold anything, so the
 * viewmodel never keeps showing a gun you no longer have. `model` is the weapon def's model id.
 */
export function heldWeapon<W extends { id: string; attachments: string[]; camo: string }>(weapons: readonly W[] | undefined, slot: number, modelOf: (id: string) => string | undefined): { slot: number; weapon: W; model: string } | null {
  if (!weapons?.length) return null;
  const s = slot >= 0 && slot < weapons.length ? slot : SPAWN_SLOT;
  const weapon = weapons[s]!;
  return { slot: s, weapon, model: modelOf(weapon.id) ?? weapon.id };
}
