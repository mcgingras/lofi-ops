# Weapons

Guns, attachments, equipment (grenades), the knife, viewmodels, third-person models, sounds and the sniper scope. The numbers are scaled from Black Ops 1 to 100 health.

## What's in

**Weapons** (`src/shared/defs/weapons.ts`):

| class | weapons |
|---|---|
| Assault rifles | M16 (3-round burst at 937 rpm, 200 ms between bursts), FAMAS (full auto, 800 rpm, 30/20 damage, light kick), AK-47, Commando, Galil, AUG; from MW2: ACR, M16A4 |
| SMGs | MP5K, AK74u, MPL |
| LMG | RPK |
| Snipers | L96A1 (bolt action, 70 dmg; x1.5 head and upper chest = one-shot at any range; x1.1 lower chest, x1 limbs = two shots; 350 ms ADS, so you can quickscope it; sway, hold breath), Dragunov (semi-auto, headshot one-shot); from MW2: Intervention |
| Shotguns | Olympia (double barrel, 2 shells, 8 pellets, one-shot up close, reloads both shells at once), Stakeout (pump, loads shell by shell), SPAS-12 (semi-auto, loads shell by shell) |
| Pistols | M1911, Python, ASP |
| Not selectable | `knife` (slot `melee`), `gl` (slot `attachment`: the underbarrel launcher) |

Each weapon has: damage falloff, hit-part multipliers (with an optional `lowerTorso`), rpm, fire mode, magazine and reserve, reload times (plus `shellReload` timings for shotguns), ADS time, sprint-out time, move speed, spread, recoil, unlock level, price and blurb. Use `LOADOUT_WEAPONS` for create-a-class lists. `shotsToKill`, `timeForRounds`, `ttkMs` and `cycleSec` give stat bars and bots the same maths the server uses.

**Attachments** (`attachments.ts`): red dot, reflex, ACOG (zooms differently on snipers and drops the scope overlay there), variable zoom (snipers: 4.5x / 7x / 10x), suppressor (keeps you off the radar, range x0.7), extended mag, dual mag (reloads x0.72), grip (recoil x0.6), grenade launcher, rapid fire (SMGs), dual wield (pistols: double mag and rate, no ADS), speed reloader (Python). Each weapon's `attachments` list sets what fits it. On top of that you get one per slot (optic, muzzle, underbarrel, magazine, other) and **one in total** (BO1 rules). `validAttachments(def, ids, max)` and `canAttach(def, id, others, max)` are the shared rule. Every attachment has `unlockKills` (kills with that weapon) and `price`.

**Equipment** (`equipment.ts`): Frag (cook it by holding G, it bounces, a 3 s fuse, and it blows up in your hand if you hold it too long), Semtex (sticks to surfaces and players), Flashbang (blinds and deafens anyone who can see it, more when they face it; teammates are spared), Concussion (slows movement x0.55 at full strength, and slows ADS). You carry 1 lethal and 2 tacticals. The knife (V/E) lunges up to 3.2 m inside a 32° cone and kills in one hit. It has a 0.9 s cooldown, and the gun stays lowered for 0.75 s after a swing.

### MW2 additions (Intervention, ACR, M16A4)

Numbers come from MW2's multiplayer weapon files (`cheytac_mp`, `masada_mp`, `m16_mp`, as dumped by the IW4x / H2M communities) cross-checked with the Call of Duty Wiki pages. They're mapped the way the BO1 guns are: damage as is (both games use 100 health), ranges in inches / 39.4, times in ms, starting reserve as is. Mobility, hip spread and recoil become this game's single numbers, scaled against the BO1 guns of the same class.

| | Intervention | ACR | M16A4 |
|---|---|---|---|
| MW2 source | 70 dmg, x1.5 head / neck / chest, x1.1 stomach, x1 limbs; 50 ms fire + 850 ms rechamber (65 rpm); 5 rds, starts 5+15; reload 2.27 / 3.87 s; ADS 400 ms; sprint-out 300 ms; kick 30-85 pitch, centre speed 500; idle sway 40-60 (the dumps disagree); level 4 (the wiki lists 5+10 starting ammo; the weapon file says 20 in total) | 30-20 dmg at 1800-2300 in; x1.4 head; 789 rpm; 30 rds, starts 30+60 (max 30+180); reload 2.03 / 2.36 s; ADS 250 ms; kick 20-40 pitch, centre speed 1500 ("extremely low"); level 48 | 40-30 dmg at 1500-2000 in; x1.4 head; 3-round burst, 64 ms between rounds + 200 ms cooldown (937.5 rpm in the burst, 459 overall); 30 rds, starts 30+60; reload 2.03 / 2.36 s; ADS 250 ms; 90% move speed; kick 30-60 pitch; level 40 |
| Here | 70 dmg, x1.5 head and upper chest, x1.1 lower chest, x1 limbs (one shot to the upper body at any range); 65 rpm bolt; 5+15; 2270 / 3870 ms; ADS 400; sprint-out 300; move x0.9; hip 11; recoil 5 / 1.4 / 6; sway 1.15, 4 s breath; swap 700; zoom 4.5 | 30-20 at 46-58 m; 789 rpm; 30+60; 2030 / 2360 ms; ADS 250; sprint-out 300; move x0.9; hip 3.2; recoil 0.42 / 0.14 / 17 (the lowest AR) | 40-30 at 38-51 m; burst 3 at 937 rpm, 264 ms from the last round to the next burst; 30+60; 2030 / 2360 ms; ADS 250; sprint-out 300; move x0.9; hip 3.6; recoil 0.68 / 0.3 / 14 |
| Unlock / price | level 4 / 2000 CP | level 48 / 3000 CP | level 40 / 3000 CP |

- **Intervention vs L96A1**: the same kill profile on purpose (the wiki and the weapon file agree on MW2's 70 x1.5). The Intervention cycles its bolt in 0.92 s (L96: 1.46 s) and reloads a partial mag faster, and its 300 ms sprint-out means a quickscope out of a sprint lands at the same 400 ms as the L96 (ADS runs during sprint-out). Standing still it scopes in 50 ms slower, and it kicks harder, sways more, holds its breath for less time and carries 15 spare rounds instead of 20.
- **ACR**: a long-range laser. Four shots out to 46 m (the AK-47 is three to 30 m, so it loses up close), almost no kick, quick reloads.
- **M16A4 vs M16**: the BO1 `m16` stays as it was. The M16A4 holds its one-burst kill further (38 m against 30 m) but drops to 30 damage sooner (51 m against 55 m), waits longer between bursts (264 ms against 200 ms: 459 rpm against 549 rpm overall), has a faster empty reload (2.36 s against 2.63 s), a slower sprint-out (300 against 250 ms), moves at x0.9, carries 60 spare rounds instead of 120 and has no Dual Mag. The model is a flat-top: no carry handle, a full-length top rail with a flip-up rear sight (folded under an optic, which sits on the rail), a square quad-rail handguard and the long A2 stock. It also has its own name, voice (pitch 0.98, darker EQ) and unlock (level 40).
- **Attachments** (BO1 set, MW2 lists): Holographic Sight becomes the Reflex Sight; Red Dot, ACOG, Silencer (Suppressor), Extended Mags and the M203 (Grenade Launcher) map directly; the Intervention's Thermal Scope becomes the Variable Zoom. MW2's FMJ, Shotgun and Heartbeat Sensor have no equivalent here and are left out; Dual Mag and Grip never existed on these MW2 guns. Extended Mags is the usual x1.5 (MW2 doubled the Intervention to 10; here it's 8).
- **Models** (`gunkit.ts`): Intervention: fluted barrel (dark ribs in the flutes), big muzzle brake, round free-float handguard with a folded bipod, long rail with an oversized scope, skeleton stock with cheek riser and monopod, bolt on the right (the L96 bolt animation). ACR: chamfered upper, faceted tan handguard, forward charging handle, flip-up sights, angular folding stock, polymer mag. All three build through the shared kit, so third-person, dropped guns, the killcam viewmodel and the Create-a-Class preview follow automatically.
- **Elsewhere**: bots pick them through the class weights; Sharpshooter rotates them by class; the Gun Game ladder lists the M16A4 after the M16, the ACR after the AUG and the Intervention before the L96A1 (20 shipped rungs, as in BO1). Weapon challenges, attachment unlocks and store items are generated as for every gun.
- **Sounds**: `WEAPON_SHOTS` entries (Intervention on the sniper pool, pitch 0.95; ACR and M16A4 on the AR pool, pitch 1.03 / 0.98, each with its own EQ) and synth fallbacks (`VOICES` in `sounds.ts`). No new audio files.

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
- `sounds.ts`: a synthesized voice per weapon (`shot.<id>`, `shot.<id>.sup`), plus bolt, pump, shell, mag, knife, pin, bounce, explosion, flashbang and ring sounds. These are the fallbacks: the recorded versions (`WEAPON_SHOTS` and `SFX_BINDINGS` in `src/shared/defs/sfx-recipes.ts`, files in `assets/sfx/`) take over once loaded. Guns share class recordings (FFSL near mics and Freesound previews) with per-weapon pitch, EQ, gain and variant pools; suppressed guns use the suppressed recordings.
- `scope.ts`: the pixel scope overlay (it replaces `core.scope`), sway (hold Shift to steady it, with a breath meter and an out-of-breath penalty), variable zoom (X or middle mouse while scoped), and local mechanical sounds: mag out / mag in at 20% / 68% of the reload, the charging handle (`weapons.charge`) at 86% of a reload that started empty, Olympia break open / close (`weapons.break` / `weapons.breakclose`), bolt and pump after the shot, and now and then brass hitting the floor (`weapons.brass`).
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
- `tests/weapons-mw2.test.ts` covers the MW2 guns: numbers and the differences from the L96A1 / M16, TTKs, the M16A4 burst cadence and one-burst kill and the Intervention's upper-chest one-shot (and its bolt) through a Room, unlock levels, store items, challenges, the Gun Game ladder, sound bindings and bot picks. `tests/weapons-mw2-models.client.test.ts` builds their models with every attachment and a camo.
- `tests/weapons.integration.test.ts` runs over real sockets: equipment push, a knife kill (killfeed `knife`), a thrown frag seen in snapshots and exploding, and a Stakeout chosen through the profile reloading shell by shell.
