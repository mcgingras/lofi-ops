# Sound effects manifest (provenance record)

Every file below is **CC0 / public domain** (no attribution required, commercial use allowed). Licence
evidence was checked on each page: Freesound's licence box reads "Creative Commons 0"; Kenney pack
pages say "License: Creative Commons CC0"; OpenGameArt pages show the CC0 box; the Free Firearm Sound
Library (FFSL, Still North Media) is CC0 on OpenGameArt and on its archive.org item.

Freesound files are the no-login HQ preview MP3s (~128 kbps), which is plenty for the lo-fi pipeline
(resample to ~22 kHz, light bitcrush). FFSL files are single WAVs fetched from inside the archive.org zip:

`FFSL = https://archive.org/download/the-free-firearm-sound-effects-library-by-still-north-media/Prepared%20SFX%20Library.zip/Prepared%20SFX%20Library%2F`

**How it ships.** `npx tsx scripts/sfx-fetch.ts` downloads exactly the URLs in the tables below (nothing
else; the raw files stay outside the repo, default folder in `scripts/sfx-sources.ts`, override with
`SFX_RAW`). `npx tsx scripts/sfx-build.ts --manifest` cuts the files in `assets/sfx/` from them with ffmpeg
following the recipes in `src/shared/defs/sfx-recipes.ts` (trim to the attack, fade, mono, 22050 Hz,
pitch/EQ, slap-back on the dry FFSL near mics, loudness-normalise through a limiter, light bitcrush,
MP3 mono 22.05 kHz) and refreshes the **Shipped as** column: which output files came from each source.
Downloaded 2026-10-07: all 74 URLs succeeded on the first try, so no variant substitutions were needed.

## Gunshots

| Sound | Recording (author) | File | Size | Shipped as |
|---|---|---|---|---|
| AR (M16, Commando, FAMAS, AUG) | AR-15 near, D_32P (FFSL) | `FFSL` + `AR-15%2FD_32P.wav` | 5.9 MB | `gun_ar_a`, `gun_ar_b` |
| AR variant | Colt M4A1 (areniporgen) | https://cdn.freesound.org/previews/737/737569_15072041-hq.mp3 | 53 KB | `gun_ar_c` |
| AK-47, Galil | AK-47 near, C_28P (FFSL) | `FFSL` + `AK-47%2FC_28P.wav` | 7.2 MB | `gun_ak_a`, `gun_ak_b`, `gun_ak_c`, `gun_ak_d` |
| AK variant | AK47 Shot (LeMudCrab) | https://cdn.freesound.org/previews/163/163457_2263027-hq.mp3 | 15 KB | `gun_ak_e` |
| SMG (MP5K, AK-74u, MPL) | Carl Gustav M45 near, G_31P (FFSL) | `FFSL` + `Carl%20Gustav%20M45%2FG_31P.wav` | 5.3 MB | `gun_smg_a`, `gun_smg_b`, `gun_smg_c` |
| SMG variant | FN P90 (areniporgen) | https://cdn.freesound.org/previews/740/740896_15072041-hq.mp3 | 94 KB | not shipped |
| RPK | Clean Machine Gun Burst (qubodup) | https://cdn.freesound.org/previews/482/482122_71257-hq.mp3 | 41 KB | `gun_rpk_a` |
| L96A1 | Tikka T3 bolt near, W_29P (FFSL) | `FFSL` + `Tikka%2FW_29P.wav` | 5.6 MB | `gun_sniper_a`, `gun_sniper_b` |
| L96A1 variant | Sniper Shot in Field (qubodup) | https://cdn.freesound.org/previews/855/855606_71257-hq.mp3 | 36 KB | `gun_sniper_c` |
| Dragunov | Sniper Shot (LeMudCrab) | https://cdn.freesound.org/previews/163/163460_2263027-hq.mp3 | 17 KB | `gun_dragunov_a` |
| Olympia | Shotgun Shot 01, Beretta 687 (LilMati) | https://cdn.freesound.org/previews/405/405504_6142149-hq.mp3 | 58 KB | `gun_olympia_a` |
| Olympia variant | Shotgun Shot (LeMudCrab) | https://cdn.freesound.org/previews/163/163455_2263027-hq.mp3 | 17 KB | `gun_olympia_b` |
| Stakeout, SPAS-12 | Benelli Nova near, O_21P (FFSL) | `FFSL` + `Nova%2FO_21P.wav` | 3.9 MB | `gun_shotgun_a`, `gun_shotgun_b` |
| SPAS-12 variant | Shotgun Shot 03 (LilMati) | https://cdn.freesound.org/previews/473/473846_6142149-hq.mp3 | 48 KB | `gun_spas_a` |
| M1911 | Pistol Shot, Colt 1911 (LeMudCrab) | https://cdn.freesound.org/previews/163/163456_2263027-hq.mp3 | 13 KB | `gun_m1911_a` |
| M1911 variant | Colt 1911 (areniporgen) | https://cdn.freesound.org/previews/740/740897_15072041-hq.mp3 | 47 KB | `gun_m1911_b` |
| ASP | ASP Pistol (areniporgen) | https://cdn.freesound.org/previews/734/734061_15072041-hq.mp3 | 51 KB | `gun_asp_a` |
| ASP variant | 9mm pistol shot (michorvath) | https://cdn.freesound.org/previews/427/427592_3094998-hq.mp3 | 39 KB | `gun_asp_b` |
| Python | S&W 642 .38 near, V_27P (FFSL) | `FFSL` + `Smith%20%26%20Wesson%20642%2FV_27P.wav` | 6.0 MB | `gun_python_a`, `gun_python_b` |
| Grenade launcher | Grenade Launcher (LeMudCrab) | https://cdn.freesound.org/previews/163/163458_2263027-hq.mp3 | 12 KB | `gun_gl_a` |
| Grenade launcher variant | M203 (qubodup) | https://cdn.freesound.org/previews/162/162402_71257-hq.mp3 | 11 KB | `gun_gl_b` |
| Suppressed pistol | Springfield 1911 suppressed (areniporgen) | https://cdn.freesound.org/previews/827/827945_15072041-hq.mp3 | 18 KB | `sup_pistol_a` |
| Suppressed pistol/SMG | SIG P226 suppressed (areniporgen) | https://cdn.freesound.org/previews/828/828790_15072041-hq.mp3 | 49 KB | `sup_pistol_b`, `sup_pistol_c`, `sup_pistol_d` |
| Suppressed rifle/sniper | Tac-50 suppressed (areniporgen) | https://cdn.freesound.org/previews/737/737570_15072041-hq.mp3 | 77 KB | `sup_rifle_a` |
| Suppressed SMG | Silenced SMG burst (qubodup) | https://cdn.freesound.org/previews/740/740120_71257-hq.mp3 | 12 KB | `sup_smg_a` |
| Distant gunfire | AR-15 mid distance, D_24P (FFSL) | `FFSL` + `AR-15%2FD_24P.wav` | 3.7 MB | `gun_distant_a`, `gun_distant_b` |
| Distant variant | Distant Gunfire 3 (qubodup) | https://cdn.freesound.org/previews/855/855244_71257-hq.mp3 | 54 KB | not shipped |

## Weapon handling and equipment

| Sound | Recording (author) | File | Size | Shipped as |
|---|---|---|---|---|
| Bolt | Mosin Nagant bolt (rammbostein) | https://cdn.freesound.org/previews/267/267895_4174990-hq.mp3 | 59 KB | `mech_bolt` |
| Pump | Shotgun rack (Krovi) | https://cdn.freesound.org/previews/613/613801_2338259-hq.mp3 | 22 KB | `mech_pump` |
| Break open | toy double-barrel uncocked (JumboSizedFish, OGA) | https://opengameart.org/sites/default/files/toy-double-barrel-shotgun-uncocked.wav | 88 KB | `mech_break_open` |
| Break close | toy double-barrel cocked (JumboSizedFish, OGA) | https://opengameart.org/sites/default/files/toy-double-barrel-shotgun-cocked.wav | 74 KB | `mech_break_close` |
| Shell casings | empty shells hitting ground (Metrolynn) | https://cdn.freesound.org/previews/620/620929_6493174-hq.mp3 | 46 KB | `mech_brass_a`, `mech_brass_b` |
| Mag out | pistol magazine removed (serøutōnin--deprivəd) | https://cdn.freesound.org/previews/719/719243_7157894-hq.mp3 | 16 KB | `mech_magout_a` |
| Mag in | Inserting Magazine (morganpurkis) | https://cdn.freesound.org/previews/379/379977_5937039-hq.mp3 | 21 KB | `mech_magin_a`, `mech_shell` |
| Reload (full) | M16 empty reload (serøutōnin--deprivəd) | https://cdn.freesound.org/previews/725/725397_7157894-hq.mp3 | 174 KB | `mech_magout_b`, `mech_magin_b`, `mech_charge_a` |
| Reload (short) | Assault Rifle Reload (qubodup) | https://cdn.freesound.org/previews/815/815879_71257-hq.mp3 | 43 KB | `mech_magout_c`, `mech_magin_c`, `mech_charge_b`, `mech_handle` |
| Knife swing | Small Knife Whoosh (Shamewap) | https://cdn.freesound.org/previews/389/389690_6861640-hq.mp3 | 33 KB | `foley_knife` |
| Knife hit | Slicing through flesh (NeoSpica) | https://cdn.freesound.org/previews/504/504615_7704891-hq.mp3 | 24 KB | `foley_stab` |
| Grenade pin (stand-in ping) | M1 Garand clip ping (serøutōnin--deprivəd) | https://cdn.freesound.org/previews/725/725398_7157894-hq.mp3 | 29 KB | `foley_pin` |
| Grenade bounce | Dropped metal tin (RossBell) | https://cdn.freesound.org/previews/389/389420_5103176-hq.mp3 | 39 KB | `foley_bounce` |
| Frag explosion | EOD Explosion (qubodup) | https://cdn.freesound.org/previews/855/855798_71257-hq.mp3 | 42 KB | `boom_frag_a` |
| Frag variant | Grenade Explosion (unfa) | https://cdn.freesound.org/previews/609/609587_1038806-hq.mp3 | 112 KB | `boom_frag_b` |
| Flashbang | CTS 7290 flashbang (areniporgen) | https://cdn.freesound.org/previews/693/693421_15072041-hq.mp3 | 24 KB | `boom_flash` |
| Ear ringing | Ear Ringing (dbdarby) | https://cdn.freesound.org/previews/365/365956_3131006-hq.mp3 | 160 KB | `ui_ring` |
| Dry fire | Ruger 10/22 dry fire (serøutōnin--deprivəd) | https://cdn.freesound.org/previews/725/725402_7157894-hq.mp3 | 15 KB | `mech_dryfire_a` |
| Dry fire variant | Glock 17 trigger (qubodup) | https://cdn.freesound.org/previews/842/842748_71257-hq.mp3 | 8 KB | `mech_dryfire_b` |

## Player, UI

| Sound | Recording (author) | File | Size | Shipped as |
|---|---|---|---|---|
| Footsteps (concrete, grass, wood), body impacts | Kenney Impact Sounds pack | https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip | 801 KB | `foley_hurt_b`, `step_concrete_0`-`4`, `step_grass_0`-`4`, `step_wood_0`-`4`, `step_carpet_0`-`4`, `step_metal_1`-`2` |
| Footsteps (metal) | Boots on hollow metal (BlondPanda) | https://cdn.freesound.org/previews/778/778437_8927049-hq.mp3 | 18 KB | `step_metal_0` |
| Hit / hurt thud | Bullet Blood 4 (JustInvoke) | https://cdn.freesound.org/previews/138/138481_758593-hq.mp3 | 8 KB | `foley_hurt_a` |
| Hitmarker tick, UI clicks, objective jingles | Kenney Interface Sounds pack | https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip | 835 KB | `ui_tick_a`, `ui_tick_b`, `ui_good`, `ui_bad` |

## Killstreaks

| Sound | Recording (author) | File | Size | Shipped as |
|---|---|---|---|---|
| Radio static | Radio Static (JovianSounds) | https://cdn.freesound.org/previews/524/524204_9561949-hq.mp3 | 124 KB | `ks_static` |
| Radio confirm | Walkie talkie beep (SEF7) | https://cdn.freesound.org/previews/701/701326_15203576-hq.mp3 | 18 KB | `ks_confirm` |
| Target marked | Roger beep (bruce965) | https://cdn.freesound.org/previews/321/321906_1755779-hq.mp3 | 9 KB | `ks_mark` |
| Streak ready | Walkie talkie power on (SEF7) | https://cdn.freesound.org/previews/701/701327_15203576-hq.mp3 | 19 KB | `ks_ready` |
| Call in (laptop) | Keyboard typing (zrrion) | https://cdn.freesound.org/previews/685/685984_2686637-hq.mp3 | 180 KB | not shipped |
| Call in (radio) | Radio squelch (JovianSounds) | https://cdn.freesound.org/previews/524/524205_9561949-hq.mp3 | 12 KB | `ks_call` |
| Jet flyby | Jet Plane Flyby (qubodup) | https://cdn.freesound.org/previews/189/189446_71257-hq.mp3 | 411 KB | `ks_jet` |
| Prop plane | Small propeller plane (straget) | https://cdn.freesound.org/previews/403/403316_7707368-hq.mp3 | 422 KB | `ks_prop` |
| Helicopter rotor loop | UH-60 hover loop (qubodup) | https://cdn.freesound.org/previews/854/854493_71257-hq.mp3 | 61 KB | `ks_rotor_a`, `ks_rotor_b` |
| Sentry / heli gun | 50 Cal MG (qubodup) | https://cdn.freesound.org/previews/239/239138_71257-hq.mp3 | 66 KB | `ks_sentry_a`, `ks_sentry_b`, `ks_sentry_c` |
| Chopper gunner | Phalanx CIWS burst (qubodup) | https://cdn.freesound.org/previews/163/163119_71257-hq.mp3 | 139 KB | `ks_gunner` |
| Rocket launch | HIMARS launch (qubodup) | https://cdn.freesound.org/previews/854/854476_71257-hq.mp3 | 132 KB | `ks_launch` |
| Mortar whistle | Incoming mortar (Zagge28) | https://cdn.freesound.org/previews/241/241840_4404989-hq.mp3 | 39 KB | `ks_whistle` |
| Big explosion | Big Explosion (qubodup) | https://cdn.freesound.org/previews/741/741173_71257-hq.mp3 | 198 KB | `boom_big` |
| Medium explosion | Medium Blast (Kinoton) | https://cdn.freesound.org/previews/516/516914_2247456-hq.mp3 | 119 KB | `boom_medium` |
| Dog bark | Single Dog Bark (kwahmah_02) | https://cdn.freesound.org/previews/277/277058_4486188-hq.mp3 | 7 KB | `ks_bark` |
| Dog bite | Growling Dog 2 (SpaceJoe) | https://cdn.freesound.org/previews/483/483190_6150892-hq.mp3 | 44 KB | `ks_bite` |
| Dog growl layer | Low dog growl (randbsoundbites) | https://cdn.freesound.org/previews/829/829986_16968183-hq.mp3 | 24 KB | not shipped |
| Alarm | Klaxon (jameswrowles) | https://cdn.freesound.org/previews/514/514982_3874107-hq.mp3 | 39 KB | `alert_klaxon` |
| Jammer buzz | Sound interference (Breviceps) | https://cdn.freesound.org/previews/445/445105_9159316-hq.mp3 | 50 KB | not shipped |
| Jammer buzz (long) | Signal jammer (qubodup) | https://cdn.freesound.org/previews/855/855899_71257-hq.mp3 | 283 KB | not shipped |

## Modes

| Sound | Recording (author) | File | Size | Shipped as |
|---|---|---|---|---|
| Match start horn | Industrial Air Horn (mcpable) | https://cdn.freesound.org/previews/131/131930_1542102-hq.mp3 | 59 KB | `alert_horn` |
| Bomb beep | Bomb Countdown Beeps (snakebarney) | https://cdn.freesound.org/previews/138/138108_1572282-hq.mp3 | 49 KB | `alert_beep` |
| Pickup blip | item-pickup-v1 (DeltaCode) | https://cdn.freesound.org/previews/678/678384_3271378-hq.mp3 | 7 KB | `ui_pickup` |

## Totals

- 7 FFSL WAVs: 37.7 MB
- 65 Freesound previews + 2 OpenGameArt WAVs: 4.3 MB
- 2 Kenney zips: 1.6 MB
- **Total download: about 43.6 MB.** Without the FFSL WAVs (using each gun's Freesound variant instead): about 6 MB.

Shipped after processing: 115 MP3 files, about 554 KB in `assets/sfx/`. Not shipped (no game hook or no
clean single shot): the P90 burst, keyboard typing, both jammer buzzes, the dog growl layer and the
distant-gunfire variant.

## Gaps

- No CC0 recordings exist for each specific gun (FAMAS, AUG, Galil, MPL, SPAS-12...). Guns share a class
  recording with pitch/EQ variations so they still sound distinct.
- The break-action open/close is a toy shotgun, pitched down a fourth (rate 0.75).
- No real grenade pin pull; the metallic clip ping is the stand-in.
- No recordings for the RC-XD motor (`ks_buzz`), napalm fire (`ks_fire`), the crossbow or the ballistic knife:
  the first two stay synthesized, the wager specials borrow a snap / spring clack from the handling recordings.
