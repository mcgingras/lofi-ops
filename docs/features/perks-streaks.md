# Perks and killstreaks (area: perks-streaks)

BO1-faithful perks (three tiers, Pro versions) and killstreaks (pick three, Hardline-aware), plus MW2's Tactical Nuke, server-authoritative, with client visuals, sounds, HUD and a radar minimap. Bots use streaks on their own, scaled by their `streakUse` skill, so a bot-backfilled lobby plays the same as a full one.

Code lives in the pre-made feature folders (`perks` and `killstreaks`, already listed in `src/server/features/index.ts` and auto-imported on the client):

```
src/shared/defs/perks.ts                  PerkDef x15, PERK_TUNING, PERK_PRO_CHALLENGES (ChallengeDef[])
src/shared/defs/killstreaks.ts            KillstreakDef x15 (+targeting/mapPick/air/hp/countsStreakKills/noWager), CARE_PACKAGE_WEIGHTS, KS_ENTITY kinds
src/shared/defs/nuke.ts                   Tactical Nuke timeline (NUKE) and pure maths: phases, countdown number, shockAt, white-out, slow motion, cloud growth
src/shared/defs/tactical-map.ts           tactical map: STRIKE footprints/timings, validateMapTarget, yawFromDrag, strikeFootprint, rate-limit bucket
src/shared/defs/perks-streaks-protocol.ts RPC + feature message types (declaration-merged into protocol.ts)
src/server/features/perks/                index (modifiers, stamina, challenges, public lists), laststand, scavenger, common
src/server/features/killstreaks/          index (buttons, RPCs, wiring), api (bot API), state (ladder), world (per-room ctx),
                                          mapmode (radio / tactical map), skill, streaks/{radar,airstrike,mortar,package,turrets,heli,vehicles,dogs,nuke}
src/client/features/perks/                footstep filter, last stand, scavenger packs, perk list, state (my loadout/pro)
src/client/features/killstreaks/          models, renderers, textures, sounds, fx, hud, radar, control, store,
                                          tacmap (map mode), tacmap-logic (placement, no DOM), overhead (satellite picture), radio,
                                          nuke (laptop, countdown HUD, flash, cloud), nuke-logic (no DOM)
tests/perks.test.ts, tests/killstreaks.test.ts, tests/perks-streaks.integration.test.ts (+ helpers),
tests/tacmap.test.ts, tests/tacmap.integration.test.ts, tests/tacmap.client.test.ts, tests/nuke.test.ts, tests/nuke.client.test.ts
```

Sounds: `killstreaks/sounds.ts` holds the synthesized `ks_*` voices; the recorded versions (radio static, squelch and roger beep, jet / prop / rotor, sentry fire (the chopper gunner `ks_gunner` borrows it), rocket launch, incoming-mortar rush, explosions, dog bark / bite) are bindings in `src/shared/defs/sfx-recipes.ts`; streak ready (`ks_ready`) and enemy streak inbound (`ks_alarm`) are restrained synthesized radio cues (`sfx-cues.ts`), not the old walkie chirp and klaxon. `ks_buzz` (RC-XD motor) and `ks_fire` (napalm crackle) stay synthesized (no recording in the manifest).

## Perks

| tier | perk | effect | Pro |
|---|---|---|---|
| 1 | Lightweight | speed x1.07 | no fall damage (`damageTaken` 0 for `fall`) |
| 1 | Flak Jacket | `explosive` damage x0.65 | `fire` damage 0 (napalm ground fire); `grenadeFuseReset` key |
| 1 | Scavenger | every death drops a `perks_pack`; an enemy with Scavenger walking over it gets a mag of reserve per weapon (separate from the dropped guns of the pickups feature) | spawn with +2 mags; emits `perks.resupply {lethal:1, tactical:1}` |
| 1 | Ghost | `radarVisible` false (unless firing an unsuppressed gun) vs Spy Plane / Blackbird | `streakTargetable` false for helicopters, gunner AI, sentries (dogs and RC-XD still find you) |
| 1 | Hardline | `streakCostOffset` -1 | owner's first USE on their landed Care Package rerolls it |
| 2 | Hardened | `penetrationMultiplier` 2 | `killstreakDamageDealt` x1.5, `flinchMultiplier` 0.5 |
| 2 | Scout | `holdBreathMultiplier` 2 | `swapMultiplier` 0.5 |
| 2 | Steady Aim | `spreadMultiplier` 0.65 while not ADS | `sprintOutMultiplier` 0.5, `meleeSpeedMultiplier` 0.7 |
| 2 | Sleight of Hand | `reloadMultiplier` 0.5 | `adsMultiplier` 0.5 |
| 2 | Warlord | `attachmentSlots` 2 (mul; base 1) | `lethalCountOffset` +1, `tacticalCountOffset` +1 |
| 3 | Tactical Mask | `stunDurationMultiplier` 0.35 | enemies you stun (`perks.stunned` event) show on your radar for the stun |
| 3 | Marathon | sprint stamina x2 | unlimited sprint |
| 3 | Ninja | `silentFootsteps`; remote footsteps silent on clients | enemy footsteps x1.8 for you; `hearingMultiplier` 1.8 |
| 3 | Second Chance | a lethal bullet/knife hit (not a headshot) puts you in last stand: 30 hp, pistol, crawl, no regen, 10 s, then the downer gets the kill | 15 s, and a teammate holding USE for 2 s revives you (+50 score) |
| 3 | Hacker | enemy hardware (sentry, SAM, crate, RC-XD) marked red in the world and on your radar | hold USE 2 s next to an enemy sentry/SAM to take it over; taking an enemy Care Package booby-traps it instead |

**Sprint stamina (everyone).** BO1 sprint runs out: 5 s (Marathon 10 s, Pro unlimited), regains 1 s/s, needs 1.2 s before sprinting again. Enforced through the new core `canSprint` modifier, so client prediction follows (`me.params.canSprint`). Tune in `PERK_TUNING`.

**Pro.** A perk is Pro when `profile.challengeProgress[<perk>_pro] >= goal` (or the profile's `unlocks` contains `<perk>_pro`). The perks feature counts its own `perks.*` metrics and writes `challengeProgress` directly (humans only), emits `perks.progress`, and pushes a "X Pro unlocked" notice. Bots: set `player.ext.perks.allPro = true` to give a bot every Pro (e.g. for hardened/veteran). RPC `perks.pro` returns `{ pro, progress }` for create-a-class.

## Killstreaks

| id | name | kills | how it works |
|---|---|---|---|
| uav | Spy Plane | 3 | plane orbits 30 s; `radarVisible` true for your enemies (client shows 2 s sweep pings); 700 hp |
| rcxd | RC-XD | 3 | drive it (movement keys + view yaw, chase cam); FIRE/STREAK detonates (6 m, 260); 30 s fuse; 40 hp, harmless when shot |
| counter_uav | Counter-Spy Plane | 4 | `radarJammed` for your enemies (static on their radar) 30 s; 700 hp |
| sam_turret | SAM Turret | 4 | placed in front; homing missiles (1000 dmg) at enemy aircraft in 160 m, 8 missiles, 60 s; 450 hp |
| care_package | Care Package | 5 | designate a spot; Chinook drops a crate (crushes); hold USE: owner 0.5 s, team 1.25 s, enemy 3 s; random streak or ammo. Waypoint over your side's crates (enemy crates within 20 m), "HOLD F FOR CARE PACKAGE" once in reach (`CRATE_REACH`). A crate in reach claims USE (`useClaimed`), so the weapon swap prompt and swap stand aside |
| napalm | Napalm Strike | 5 | tactical map: spot + direction; F-4 releases ~4 s after the call; 3 canisters (7 m) + 8 s burning ground (`fire` 30/s) |
| sentry_gun | Sentry Gun | 6 | placed in front; turns to nearest visible enemy, spins up, 8 rounds/s; 90 s; 450 hp |
| mortar | Mortar Team | 6 | tactical map: 3 spots; red ring warning, 2 rounds per spot from 3 s, 3.5 m blast radius (BO1: ~7 m across) |
| attack_helicopter | Attack Helicopter | 7 | tactical map: patrol point; flies in, orbits it (14 m), minigun bursts at the nearest visible enemy; 60 s; 1500 hp; airspace max 3 helis |
| valkyrie | Valkyrie Rockets | 7 | (simplified) two rockets in turn, steered by your view (rocket cam); impact / proximity / FIRE / fuse detonates |
| blackbird | Blackbird | 8 | like the Spy Plane but live with facing arrows on the radar; cannot be shot down |
| rolling_thunder | Rolling Thunder | 8 | tactical map: spot + direction; B-52 carpet-bombs 14 bombs (4 m apart) through the spot, ~7 s out |
| chopper_gunner | Chopper Gunner | 9 | you work its explosive cannon from the air (camera in the seat, FIRE shoots); your body stays put and dying ends it; 2000 hp |
| attack_dogs | Attack Dogs | 11 | 8 dogs, 3 at a time, from your spawn side, hunt the nearest enemy and bite (55); 60 s; 80 hp each |
| nuke | Tactical Nuke (MW2) | 25 | laptop, 10 s countdown for everyone, then everyone dies and the match ends as a win for your side (below); killstreak kills count toward it; not in wagers; unlock level 25 |

Rules: kills toward streaks reset on death; streak kills don't count (`isStreakWeapon`) except toward streaks with `countsStreakKills` (the nuke reads `countAll`, every kill this life); each picked streak is earned once per life at its cost (Hardline: -1); earned streaks wait in `ready` until called and survive deaths until match end. Calling needs you alive and not already driving one. Streaks with `noWager` (the nuke) are dropped from the ladder in wager modes and `callKillstreak` answers `disabled` there (`streakAllowedIn`).

## Tactical Nuke (MW2)

Reference: the Call of Duty Wiki "Tactical Nuke" page (MW2 section) and MW2 footage. 25 kills in a row (24 with Hardline), unlocked at level 10 in MW2 (25 here). Once called, a ten-second countdown shows on every screen with a siren; the bomb lands off the map; the battlefield goes white, time slows, every killstreak explodes and every player dies, nearest to the blast first; the match is a win for the caller's side whatever the score, and scores freeze from the call. It can't be shot down or stopped.

- **Kill counting (option in the defs).** `KillstreakDef.countsStreakKills` (default false = the BO1 rule). The nuke sets it to **true**: MW2 counted every kill toward the nuke, and 25 gun kills in a row against bots is a very long ask; the BO1 streaks still ignore streak kills. Set it to false on the nuke's def for the strict rule. The ladder push carries `countAll` so the HUD fills the nuke's (compact, grouped by five) pips with every kill.
- **Call-in.** STREAK with the nuke selected (`targeting: 'none'`) calls it at once (`streaks/nuke.ts`): the caller's weapon is down for `NUKE.laptopSec` (1.5 s) while their first-person laptop opens and they press the arming key; then the 10 s countdown. One `ks_nuke` entity sits at the blast point (`blastPoint`: map centre + half extent + 110 m in a random direction) with `s = { a: countdown start, d: detonation, n/f: nearest/farthest distance of the map from the blast, o: owner id }` (no `owner` field, so core doesn't remove it if the caller leaves; it is not in the active's entity list, so it stays through the results until the next match start). A second nuke while one is inbound: `nuke_active`.
- **Match end lock.** The call sets core's `room.endLock = 'nuke'`: team/player score changes are ignored and only `endMatch('nuke')` can end the match, so no score, time or round limit (S&D) beats the bomb.
- **Detonation** (`d`): every other killstreak is finished (blast effects, no announcements), nobody respawns (`respawnAt = null`), movement slows (`speedMultiplier` `nukeTimeScale`, down to x0.35 for 4.5 s; no sprint). From `d + 2 s` the shockwave kills each living player when it reaches them (`shockAt(dist)`: nearest at +2 s, farthest at +4 s), `room.kill(p, caller, { weapon: 'nuke', means: 'nuke' })` (kills credited to the caller; the caller and team mates die too, uncredited). At `d + 5.5 s`: `room.endMatch('nuke', nukeResults(...))` = the mode's own results with `winnerTeam` = the caller's team (FFA: winners = the caller, placed first). It still goes off if the caller dies or leaves (`Active.keepOnLeave`).
- **No killcams.** `means: 'nuke'` is in `NO_DEATHCAM_MEANS` and the modes feature skips the final killcam when `results.reason === 'nuke'`.
- **XP, challenges.** Calling emits `progression.xp` ("TACTICAL NUKE", 2,500 XP) and every streak call emits `progression.metric` `streak_called {killstreak}`; `ks_nuke_called` ("End Game", 1/5/10 calls) counts it. `ks_nuke_earned` / `ks_nuke_kills` come from the generic per-streak challenges. CoD Points, XP and challenges run through the normal match end.
- **Bots** earn it like players and call it through the same API (`callKillstreak(room, bot, 'nuke')`, automatic use calls the highest streak first). Bot loadouts can pick it (rarely for weak bots).
- **Client** (`nuke.ts`, maths in `nuke-logic.ts`): the caller's laptop in first person (rugged olive case, red warning screen, gloved hand on the key, drawn over the world like the radio); a countdown for everyone ("TACTICAL NUKE INCOMING", the number, a line per side: mine / friendly (with the caller's name) / enemy, then "IMPACT IN 3..1") plus the generic "Friendly / Enemy Tactical Nuke inbound" announcement; at detonation the screen washes to white through the post pass (`renderer.white`, before the dither), eases down to a washed-out view of a low-poly mushroom cloud (cap, crown, glowing under-ring, stem, condensation ring, dust base, smoke texture from a greyed photo; white-hot to fire to ash) and an expanding dust wall (the shockwave), slow mouse look and camera shake; white again when the shockwave reaches you (or kills you), held until the results, whose reason reads "TACTICAL NUKE". A nuke death shows no "killed by / respawn" card.
- **Sound** (reused ids, nothing new while the sound rework is in flight): the bomb beep (`modes.beep`) once per countdown second, `ks_bigboom` slightly lowered (rate 0.9, low-pass 900 Hz) at detonation and again (rate 0.94) when the shockwave reaches you. Big pitch-downs were dropped after the sound rework: they read as cartoonish.

**Controls.** `4` (STREAK button): call the selected streak. The Care Package (`targeting: 'point'`) arms a designator (weapon lowered, HUD reticle): press `4` again where you aim; it cancels on weapon switch, death or after 15 s. Sentry Gun and SAM Turret are placed in front of you. Napalm, Mortar Team, Rolling Thunder and the Attack Helicopter (`targeting: 'map'`) open the **tactical map** (below). `5` cycles the selection (RPC `killstreaks.select`). While designating, holding the radio or driving, core firing is refused (the feature holds `swapEnd`); holding the radio or driving, the body's speed is 0.

## Tactical map (BO1 radio targeting)

What Black Ops did (Call of Duty Wiki pages for Napalm Strike, Rolling Thunder, Mortar Team, Attack Helicopter; gameplay footage, e.g. "Black Ops | Power of the Rolling Thunder" on YouTube): the player calls these in "via a radio" (a handset comes up in the right hand), and an overhead map of the level is laid over the view: a translucent panel with the map name in a black header, a lettered/numbered grid (A1..E5, labels in each cell's top-left), friendly arrows, a prompt bar at the bottom ("Press A to call in Rolling Thunder" / "B Back"). Napalm and Rolling Thunder: position the target and adjust the angle of entry (PC: hold the left mouse button and turn the mouse), shown as orange chevrons along the run; Napalm releases about 4 s after the call, Rolling Thunder about 7 s. Mortar Team: three locations selected one after another, then a delay, two rounds on each, explosions about seven metres across. Attack Helicopter: you designate an area and it hovers near it. MW2's laptop (Precision Airstrike, rotatable arrow) is the secondary reference.

Ours:
- **Open.** STREAK with a map streak selected: the server opens map mode (`ks.map`, pushed as `killstreaks.state.map {id, until}`), spawns a `ks_radio` entity on the caller and holds them still (`speedMultiplier` 0, no sprint, weapon down). The client raises a handset in first person (`radio.ts`, drawn over the world), cuts to the feed with ~0.3 s of static, and shows the map. Other players see the soldier with the rifle slung low and a handset at the ear (`ks_radio` renderer poses the remote soldier). The attack helicopter's radio does not open with a full airspace.
- **Picture.** `overhead.ts` renders the real map straight down with our renderer (orthographic camera over `map.bounds`, same baked lighting and developed textures, sky/fog/wobble off) at the panel's pixel size, then a satellite treatment (a little desaturated, green-grey tint, contrast, scanlines, vignette). Cached per map + time preset + size, re-taken as photos finish developing. The panel sits over a 3-in-4 screen-door of the world (BO1's translucency in our pixel look) with the map name, streak name and a timer in the header, grid with per-cell labels, compass N, rolling feed noise, prompts and the cursor's grid reference in the footer.
- **Shown.** You (yellow arrow with facing), team mates (blue arrows), enemies only when your radar lists them (`snap.radar`: Spy Plane / Blackbird / unsuppressed fire; nothing when jammed), friendly streaks already up (helicopters with their patrol ring, mortar marks, napalm fire, planes, sentry `S`, SAM `A`, crates, dogs, RC-XD).
- **Cursor.** Pointer-lock mouse deltas (1 screen pixel = 1 displayed map pixel), WASD/arrows, gamepad left stick / d-pad; clamped to the bounds. In `?devlook=1` (no real pointer lock) the cursor follows the absolute mouse position, so a real click or drag on the map works.
- **Placement** (`tacmap-logic.ts`, pure): Napalm / Rolling Thunder: press at the target, drag to swing the run (arrow + chevrons + the burn/bomb circles to scale), release to call in; Q/E or the right stick rotate, Enter/Space/A tap confirms at the cursor; the default direction is your facing. Mortar Team: three numbered marks with their 3.5 m blast circles, right click / Backspace / X removes the last, the third confirms. Attack Helicopter: one click picks the patrol point (14 m ring). Esc, STREAK or gamepad B cancels and keeps the streak; dying, the 30 s timeout, changing selection or losing pointer lock also put it away.
- **Server.** RPC `killstreaks.mapTarget {id, points: [x, z][], yaw?}` (`mapmode.ts`): token-bucket rate limit (4 burst, 2/s), the streak must be ready and its map open, then `validateMapTarget` (right count, finite numbers, inside the bounds with 0.5 m slack then clamped 1 m in, finite yaw for line strikes wrapped to (-PI, PI]); the strike logic is unchanged (`callKillstreak` with the chosen targets and yaw). `killstreaks.mapCancel {}` puts the radio away. `killstreaks.call` answers `use_map` for map streaks (no crosshair fallback); the bot API's `callKillstreak` also has no crosshair fallback for them (the helicopter defaults to the map centre).
- **Bots** never open the map: `suggestTarget` aims at clusters of enemies they know about (on their radar or in sight), guessing with twice the error when they know nobody, and passes a run direction along the cluster.
- **Dev:** `window.__lofi.tacmap` (devlook builds): `state()`, `moveTo(x, z)`, `rotate(d)`, `press()`, `release()`, `undo()`, `cancel()`, `screenOf(x, z)` (client pixels of a world point for real clicks). Grant streaks with `killstreaks.cheat` (server with `LOFI_CHEATS=1`).

**Everything targets bots like players.** All AI target selection iterates `room.players` (bots included); all damage goes through `room.damage` / `room.radiusDamage` with `means: 'killstreak'` (napalm ground fire `fire`) and `weapon` = streak id, credited to the owner. Every `fire` event (bots' `room.fire` too) is ray-tested against enemy hardware, so bots can shoot down helicopters and destroy sentries; destroying hardware gives score and emits `killstreaks.destroyed`.

## API for the bots area (`src/server/features/killstreaks/api.ts`)

```ts
import { callKillstreak, readyKillstreaks, suggestTarget, enemyStreakTargets, isDrivingStreak, isDesignating, killstreakState } from '../killstreaks/api';
readyKillstreaks(bot)                              // ['uav', 'napalm']
callKillstreak(room, bot, 'napalm', { target, yaw })   // { ok: true } | { ok: false, reason: 'not_ready'|'dead'|'busy'|'no_target'|'airspace_full'|'phase'|'unknown' }
suggestTarget(room, bot, 'mortar', skill)          // { target, targets, yaw } aimed at clusters of known enemies, error shrinks with skill
knownEnemies(room, bot)                            // enemies on its radar or in line of sight (90 m)
enemyStreakTargets(room, bot)                      // [{ entity, kind, streak, x, y, z, air, hp }] to shoot at
isDrivingStreak(bot)                               // RC-XD / gunner / rockets running (the AI drives them for bots)
```

- **Automatic use (default):** bots call their own streaks. `player.ext.killstreaks.botStreakUse` (0..1) or `player.ext.bots.skill.streakUse` sets how soon (1.5 s at 1.0, up to ~15 s at 0) and how well (target error, holding a SAM for enemy air and a Counter-Spy Plane for enemy radar, not driving an RC-XD with an enemy in its face). Without either, the lobby default preset (`regular`, 0.6) applies. Set `ext.killstreaks.manual = true` to take over and call `callKillstreak` yourself.
- **Driven streaks for bots** are flown by the feature: RC-XD drives at the nearest enemy and blows up close (skill: steering error, detonate distance), Valkyrie rockets home on enemies, the Chopper Gunner aims at visible enemies with skill-scaled error.
- **Second Chance for bots:** while `player.ext.perks.lastStand` is set, return `weaponSlot: 1` from the brain (the server switches to the pistol, but a brain that keeps sending 0 flips it back).
- **Hearing:** read `room.modifiers.any('silentFootsteps', target)` (Ninja) and `room.modifiers.mul('hearingMultiplier', bot)` when bots react to footsteps.

## Integration notes for other areas

- **weapons:** read `room.modifiers.mul('attachmentSlots', p)` (1 normally, 2 with Warlord) when enforcing attachment counts (the perks feature does not trim loadouts); `lethalCountOffset` / `tacticalCountOffset` (sum) for grenade counts; `penetrationMultiplier`, `holdBreathMultiplier`, `meleeSpeedMultiplier`, `flinchMultiplier`, `grenadeFuseReset`. Emit `room.bus.emit('perks.stunned', { victim, attacker, kind, duration })` when a flash/concussion/gas hits (multiply the duration by `stunDurationMultiplier` yourself); listen to `perks.resupply` to refill grenades. Explosive grenades should use `means: 'explosive'` (Flak Jacket) and fire `means: 'fire'`.
- **progression:** fold `PERK_PRO_CHALLENGES` into `CHALLENGES`. Their metrics (`perks.*`) are counted by the perks feature straight into `profile.challengeProgress[id]` (don't count them again); award XP when they cross `goal`. Listen to `perks.progress` if you want toasts. XP for streak kills / destroying hardware: `death.means === 'killstreak'` and `killstreaks.destroyed`.
- **frontend:** create-a-class uses `perksOfTier(t)` and `KILLSTREAKS` (3 picks; `sanitizeLoadout` already limits). Show Pro via RPC `perks.pro`. Key bindings: STREAK is `Digit4` (core `KEYMAP`), cycling is a plain `Digit5` listener in `client/features/killstreaks/control.ts`. Core killfeed prints non-bullet weapons upper-cased (`ATTACK_HELICOPTER`); a nicer name map can use `KILLSTREAK_BY_ID.get(weapon)?.name`.
- **modes:** streaks reset at `matchStart`; everything ends at the `ended`/`lobby` phase. Wager modes that should have no streaks can give loadouts with `killstreaks: []` in `beforeSpawn`.
- **economy:** `PerkDef.price` / `KillstreakDef.price` are hints; nothing here spends CoD Points.
- **Dev testing:** start the server with `LOFI_CHEATS=1` to enable RPC `killstreaks.cheat { id?, bots? }` (grant a ready streak, add enemy bots), e.g. from the console: `await __lofi.net.rpc('killstreaks.cheat', { id: 'attack_helicopter', bots: 4 })`. Never set it in production.

## Core files touched (minimal extension points)

- `src/server/modifiers.ts` + `src/server/sim.ts`: new `canSprint` modifier key, consulted by `moveParamsFor` (sprint stamina / Marathon, last stand, driving streaks).
- `src/client/registry.ts` + `src/client/game/remotes.ts`: `registerFootstepFilter(id, fn)` / `footstepVolume(playerId, volume)` so Ninja can silence remote footsteps.
- `src/client/game/controls.ts`: `Controls.enabled = false` now also ignores mouse buttons, devlook drag taps and the wheel (it already zeroed buttons and look), so the tactical map can own the mouse.
- `src/client/render/mapbuilder.ts`: `MapScene.sky` is public (hidden for the top-down capture).
- `docs/CONTRACTS.md` (documents both), `NOTICE` (Blockyard attribution for the mortar pattern and rule shapes).
- Tactical Nuke: `src/server/room.ts` `endLock` (scores freeze, only `endMatch(endLock)` ends the match; cleared at match start); `src/client/render/renderer.ts` `white` (post-pass white-out uniform); `src/shared/defs/deathcam.ts` (`'nuke'` in `NO_DEATHCAM_MEANS`); `src/server/features/modes/index.ts` (no final killcam on reason `nuke`); `src/client/features/modes/summary-data.ts` (reason label); `src/shared/defs/challenges.ts` (`ks_nuke_called`).

## Not done / simplified

- Tactical map: the picture is the whole `map.bounds` (BO1 cut out just the playable area with a white outline); BO1's translucent panel is a 3-in-4 screen-door over the world here; planes start far outside the map (to match BO1's release times) so they only show on the map once over it; no announcer voice lines (HUD text as before).

- Valkyrie is simplified (no launcher weapon; two auto-launched guided rockets).
- Tactical Nuke: other players don't see the caller's laptop (no third-person pose); no announcer voice (HUD lines only); in FFA the caller always wins (MW2 withheld the win when an enemy had more kills); Last Stand doesn't save you from it (MW2's Last Stand / Final Stand did).
- Care Packages hold streaks or ammo only (no Death Machine / Grim Reaper weapons). Crates have no collision.
- Ghost Pro's hidden red name tag is not applied (core `core.names` widget); `perks.public.ghostPro` lists the ids for whoever replaces it.
- No mantle in core, so Marathon Pro's faster mantle is a description only; no penetration in core yet (`penetrationMultiplier` is for the weapons area).
- Dogs steer straight at targets with stuck-hops and hotspot detours (no nav graph); once the bots area has a nav graph they can use it.
