# Weapons

Guns, attachments, equipment (grenades), the knife, viewmodels, third-person models, sounds and the sniper scope. The numbers are scaled from Black Ops 1 to 100 health.

## What's in

**Weapons** (`src/shared/defs/weapons.ts`):

| class | weapons |
|---|---|
| Assault rifles | M16 (3-round burst at 937 rpm, 200 ms between bursts), FAMAS (full auto, 800 rpm, 30/20 damage, light kick), AK-47, Commando, Galil, AUG |
| SMGs | MP5K, AK74u, MPL |
| LMG | RPK |
| Snipers | L96A1 (bolt action, 70 dmg; x1.5 head and upper chest = one-shot at any range; x1.1 lower chest, x1 limbs = two shots; 350 ms ADS, so you can quickscope it; sway, hold breath), Dragunov (semi-auto, headshot one-shot) |
| Shotguns | Olympia (double barrel, 2 shells, 8 pellets, one-shot up close, reloads both shells at once), Stakeout (pump, loads shell by shell), SPAS-12 (semi-auto, loads shell by shell) |
| Pistols | M1911, Python, ASP |
| Not selectable | `knife` (slot `melee`), `gl` (slot `attachment`: the underbarrel launcher) |

Each weapon has: damage falloff, hit-part multipliers (with an optional `lowerTorso`), rpm, fire mode, magazine and reserve, reload times (plus `shellReload` timings for shotguns), ADS time, sprint-out time, move speed, spread, recoil, unlock level, price and blurb. Use `LOADOUT_WEAPONS` for create-a-class lists. `shotsToKill`, `timeForRounds`, `ttkMs` and `cycleSec` give stat bars and bots the same maths the server uses.

**Attachments** (`attachments.ts`): red dot, reflex, ACOG (zooms differently on snipers and drops the scope overlay there), variable zoom (snipers: 4.5x / 7x / 10x), suppressor (keeps you off the radar, range x0.7), extended mag, dual mag (reloads x0.72), grip (recoil x0.6), grenade launcher, rapid fire (SMGs), dual wield (pistols: double mag and rate, no ADS), speed reloader (Python). Each weapon's `attachments` list sets what fits it. On top of that you get one per slot (optic, muzzle, underbarrel, magazine, other) and **one in total** (BO1 rules). `validAttachments(def, ids, max)` and `canAttach(def, id, others, max)` are the shared rule. Every attachment has `unlockKills` (kills with that weapon) and `price`.

**Equipment** (`equipment.ts`): Frag (cook it by holding G, it bounces, a 3 s fuse, and it blows up in your hand if you hold it too long), Semtex (sticks to surfaces and players), Flashbang (blinds and deafens anyone who can see it, more when they face it; teammates are spared), Concussion (slows movement x0.55 at full strength, and slows ADS). You carry 1 lethal and 2 tacticals. The knife (V/E) lunges up to 3.2 m inside a 32° cone and kills in one hit. It has a 0.9 s cooldown, and the gun stays lowered for 0.75 s after a swing.

## How it works

Server (`src/server/features/weapons/`):
- `beforeSpawn` trims attachments to `1 + attachmentSlotsOffset`. `spawn` hands out the equipment (pushing `weapons.equip` to the player) and, for a primary with `gl`, adds weapon slot 2 (`gl`).
- Button edges call `melee()` on MELEE and `startThrow()` on LETHAL/TACTICAL. While the knife recovers or a throw is in progress, the server sets `p.swapEnd`, so core refuses to fire ("switching").
- Projectiles are room entities of kind `weapons.nade` (`s.e` = equipment id or `gl`, `s.k` = 1 when stuck). They are simulated each tick by `projectile.ts` (gravity, swept raycast, bounce, friction, sticking). Explosions go through `room.radiusDamage` (linear falloff, line of sight, self damage on). Then `weapons.boom` is broadcast.
- The GL round has to fly 8 m to arm. Before that, a direct hit does 60 impact damage and anything else is a dud.
- Shotgun shell reloads: the `reload` event retimes `reloadEnd` to open + shells + close (+ pump when the tube was empty). Shells go in one at a time, and holding FIRE cancels the reload once at least one shell is in.
- Core changes: burst cadence and the lower-torso multiplier now live in core `fire()`.

Client (`src/client/features/weapons/`):
- `gunkit.ts`: procedural low-poly builders for every model id, plus optics (open tubes, so sight pictures stay visible), suppressor, grip, launcher, extended and dual mags, and dual-wield pistols. First-person and third-person models are built from the same code.
- `viewmodels.ts`: hands and sleeves, knife and grenade actions, and per-family animation: magazine swap, L96 bolt cycle (after each shot and around reloads), pump rack, shell feeding, Olympia break-action, revolver cylinder, pistol slide.
- `worldmodels.ts`: puts the weapon model in each remote soldier's hands (hiding `Soldier.gun`) and moves the muzzle to match. Remotes swing their arms when they knife or throw.
- `sounds.ts`: a synthesized voice per weapon (`shot.<id>`, `shot.<id>.sup`), plus bolt, pump, shell, mag, knife, pin, bounce, explosion, flashbang and ring sounds.
- `scope.ts`: the pixel scope overlay (it replaces `core.scope`), sway (hold Shift to steady it, with a breath meter and an out-of-breath penalty), variable zoom (X or middle mouse while scoped), and local mechanical sounds.
- `equipment.ts`: grenade models, blast glow, puffs and shake, the flashbang whiteout (a Bayer-dithered fade drawn as HUD pixels), concussion wobble and slower look, the equipment counter (bottom right), and the grenade danger indicator.

Controls: 1/2 switch weapons, **3** switches to the underbarrel launcher (or use the wheel), V/E knife, G lethal (hold to cook a frag), Q tactical, Shift while scoped to hold breath, X or middle mouse to change zoom.

## Integration notes

- **perks-streaks**: Warlord is `room.modifiers.add('attachmentSlotsOffset', (p) => has(p, 'warlord') ? 1 : undefined, 'perks.warlord')`. Tactical Mask is `tacticalMultiplier` (return e.g. 0.3). Scavenger-style refills can use `equipmentCountOffset` or write `player.ext.weapons.lethalN` and then call `sendEquip` (exported from `equipment.ts`). Flak Jacket should check `info.means === 'explosive'` with `weapon` in `frag | semtex | gl` in `damageTaken`. Sleight of Hand goes through `reloadMultiplier`, which shell reloads respect.
- **progression / economy**: use `LOADOUT_WEAPONS` with `unlockLevel` and `price`, and `ATTACHMENTS` with `unlockKills` (per-weapon kills) and `price`. Attachment challenges can listen to `death` (`weapon` is the base weapon id, `knife`, `frag`, `semtex` or `gl`) and `weapons.tactical`. The AK-47 stays at level 1 because core's `DEFAULT_LOADOUTS` use it.
- **frontend**: the create-a-class builder should filter with `LOADOUT_WEAPONS` and `canAttach(def, id, current, 1 + extraSlots)`, and use `LETHALS` / `TACTICALS` for the equipment pickers. Weapon and attachment `blurb` give you menu text, and `shotsToKill` / `ttkMs` give you stat bars. Key rebinding: `KEYMAP.Digit3 = 'weapon3'`.
- **bots**: a bot shoots with `room.fire`. Burst, bolt and pump cadence is enforced on the server, so a bot can just fire every tick. It knifes by pressing `Buttons.MELEE` or calling `melee(room, bot)`, and throws with `Buttons.LETHAL` / `TACTICAL` or `startThrow(room, bot, 'lethal')`. Holding LETHAL cooks a frag. Your brain can read `flashedAmount(room, bot)` / `stunnedAmount(room, bot)` (0..1) to blind or slow the bot, and `meleeTarget(room, bot)` to decide when to knife. All of these are exported from `src/server/features/weapons/index.ts`. To use the launcher, set `weaponSlot: 2` when `bot.weapons.length === 3`. Grenade entities (`room.entities.byKind('weapons.nade')`) are there for danger avoidance.
- **pickups**: dead players drop the gun in hand and anyone can swap for it (docs/features/pickups.md). The dropped gun uses `GUNS` / `Kit` / `FURNITURE` from `src/client/features/weapons/gunkit.ts` with its attachments and camo; a swap rebuilds the `gl` slot (slot 2) to follow the gun that carries the launcher.
- **modes / economy wagers**: grenade counts are rebuilt at every spawn from `player.loadout.lethal/tactical`. Set those in `beforeSpawn` (e.g. `null` for Sticks and Stones variants). Remote weapons render without attachments, because snapshots only carry the weapon id.
- Core files touched (all small): `server/combat.ts`, `shared/ballistics.ts`, `shared/loadout.ts` (default classes now have grenades), `client/game/{match,controls,viewmodel,audio}.ts`, `client/render/models/{viewmodels,soldier}.ts`, `docs/CONTRACTS.md`.

## Tests

- `tests/weapons.test.ts` covers TTK tables per weapon and range, pellet one-shots, M16 burst cadence through the server, the L96 upper/lower chest split, knife lunge, range, cone and cooldown, frag falloff, walls and cooking, semtex sticking, flash and concussion, Stakeout shell reload and cancel, attachment rules and the Warlord slot, the GL slot and arming, equipment sanitising, and projectile physics.
- `tests/weapons.integration.test.ts` runs over real sockets: equipment push, a knife kill (killfeed `knife`), a thrown frag seen in snapshots and exploding, and a Stakeout chosen through the profile reloading shell by shell.
