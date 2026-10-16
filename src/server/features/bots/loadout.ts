/**
 * What bots carry and what they're called. Loadouts are picked from whatever the defs hold at the
 * time (the weapons / perks-streaks areas fill them in), so new guns show up in bot hands without
 * changes here. Wager modes force their own loadouts through `beforeSpawn`, which bots go through
 * like everyone else.
 */
import { ATTACHMENT_BY_ID } from '../../../shared/defs/attachments';
import { attachmentSlotsFor } from '../../../shared/frontend/loadout-rules';
import { KILLSTREAKS } from '../../../shared/defs/killstreaks';
import { PERKS } from '../../../shared/defs/perks';
import { WEAPONS, type WeaponClass, type WeaponDef } from '../../../shared/defs/weapons';
import { DEFAULT_LOADOUTS, type Loadout } from '../../../shared/loadout';

/** How bots like each primary class (weights scaled by skill rating where noted). */
const PRIMARY_WEIGHT: Partial<Record<WeaponClass, (rating: number) => number>> = {
  ar: () => 5,
  smg: () => 4,
  lmg: () => 1.2,
  shotgun: (r) => 1 + r,
  sniper: (r) => 0.3 + r * 1.2,
};

const SECONDARY_WEIGHT: Partial<Record<WeaponClass, (rating: number) => number>> = {
  pistol: () => 5,
  launcher: (r) => 0.4 + r * 0.6,
};

function weighted<T>(items: T[], weight: (t: T) => number, rnd: () => number): T | undefined {
  const ws = items.map(weight);
  const total = ws.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return items[0];
  let x = rnd() * total;
  for (let i = 0; i < items.length; i++) {
    x -= Math.max(0, ws[i]!);
    if (x <= 0) return items[i];
  }
  return items.at(-1);
}

/** One attachment, or two with Warlord (`slots` 2), like a player's class (the spawn trims to the same). */
function pickAttachments(def: WeaponDef, rnd: () => number, slots: number): string[] {
  const options = def.attachments.filter((a) => ATTACHMENT_BY_ID.has(a));
  if (!options.length || rnd() < 0.35) return [];
  const first = options[Math.floor(rnd() * options.length)]!;
  const slot = ATTACHMENT_BY_ID.get(first)!.slot;
  const rest = options.filter((a) => a !== first && ATTACHMENT_BY_ID.get(a)!.slot !== slot);
  const second = rest.length && rnd() < 0.4 ? rest[Math.floor(rnd() * rest.length)]! : null;
  return second && slots > 1 ? [first, second] : [first];
}

/** A random but sensible class for a bot of overall skill `rating` (0..1). */
export function chooseBotLoadout(rating: number, rnd: () => number = Math.random): Loadout {
  const base = DEFAULT_LOADOUTS[0]!;
  const primaries = WEAPONS.filter((w) => w.slot === 'primary' && PRIMARY_WEIGHT[w.class]);
  const secondaries = WEAPONS.filter((w) => w.slot === 'secondary' && SECONDARY_WEIGHT[w.class]);
  const primary = weighted(primaries, (w) => PRIMARY_WEIGHT[w.class]!(rating), rnd);
  const secondary = weighted(secondaries, (w) => SECONDARY_WEIGHT[w.class]!(rating), rnd);
  const perks: string[] = [];
  for (const tier of [1, 2, 3] as const) {
    const list = PERKS.filter((p) => p.tier === tier);
    if (list.length) perks.push(list[Math.floor(rnd() * list.length)]!.id);
  }
  // Three streaks, cheaper ones more often for weaker bots.
  const streaks = [...KILLSTREAKS].sort((a, b) => a.kills - b.kills);
  const chosen: string[] = [];
  const pool = [...streaks];
  while (chosen.length < 3 && pool.length) {
    const pick = weighted(pool, (k) => 1 / (1 + Math.max(0, k.kills - 3) * (1.2 - rating)), rnd)!;
    chosen.push(pick.id);
    pool.splice(pool.indexOf(pick), 1);
  }
  chosen.sort((a, b) => (streaks.find((k) => k.id === a)?.kills ?? 0) - (streaks.find((k) => k.id === b)?.kills ?? 0));
  const lethals = DEFAULT_LOADOUTS.map((l) => l.lethal).filter((x): x is string => !!x);
  const tacticals = DEFAULT_LOADOUTS.map((l) => l.tactical).filter((x): x is string => !!x);
  return {
    name: 'Bot',
    primary: primary ? { weapon: primary.id, attachments: pickAttachments(primary, rnd, attachmentSlotsFor(perks)), camo: 'none' } : { ...base.primary },
    secondary: secondary ? { weapon: secondary.id, attachments: [], camo: 'none' } : { ...base.secondary },
    perks,
    killstreaks: chosen,
    lethal: lethals.length ? lethals[Math.floor(rnd() * lethals.length)]! : base.lethal,
    tactical: tacticals.length ? tacticals[Math.floor(rnd() * tacticals.length)]! : base.tactical,
  };
}

/** Callsigns for bots (no real people, no franchise characters). */
export const BOT_NAMES = [
  'Viper', 'Nomad', 'Brick', 'Ratchet', 'Echo', 'Blitz', 'Patch', 'Gunny', 'Moss', 'Rook', 'Juno', 'Kodiak',
  'Havoc', 'Dutch', 'Mako', 'Spud', 'Fuse', 'Tinman', 'Boone', 'Dagger', 'Sarge', 'Lynx', 'Ozzie', 'Pike',
  'Rocco', 'Shank', 'Tusk', 'Vance', 'Wolfie', 'Yeti', 'Zulu', 'Bishop', 'Cobra', 'Diesel', 'Flint', 'Grit',
  'Hex', 'Ivan', 'Jinx', 'Knox', 'Lefty', 'Mojo', 'Nails', 'Ox', 'Puck', 'Quill', 'Rusty', 'Sketch',
];

/** A name not used in the room yet (suffixes a number when all are taken). */
export function pickBotName(taken: Iterable<string>, rnd: () => number = Math.random): string {
  const used = new Set(taken);
  const free = BOT_NAMES.filter((n) => !used.has(n));
  if (free.length) return free[Math.floor(rnd() * free.length)]!;
  for (let i = 2; ; i++) {
    const n = `${BOT_NAMES[Math.floor(rnd() * BOT_NAMES.length)]!} ${i}`;
    if (!used.has(n)) return n;
  }
}
