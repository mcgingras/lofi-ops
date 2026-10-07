# Perks and killstreaks (area: perks-streaks)

BO1-faithful perks (three tiers, Pro versions) and killstreaks (pick three, Hardline-aware), server-authoritative, with client visuals, sounds, HUD and a radar minimap. Bots use streaks on their own, scaled by their `streakUse` skill, so a bot-backfilled lobby plays the same as a full one.

Code lives in the pre-made feature folders (`perks` and `killstreaks`, already listed in `src/server/features/index.ts` and auto-imported on the client):

```
src/shared/defs/perks.ts                  PerkDef x15, PERK_TUNING, PERK_PRO_CHALLENGES (ChallengeDef[])
src/shared/defs/killstreaks.ts            KillstreakDef x14 (+targeting/air/hp), CARE_PACKAGE_WEIGHTS, KS_ENTITY kinds
src/shared/defs/perks-streaks-protocol.ts RPC + feature message types (declaration-merged into protocol.ts)
src/server/features/perks/                index (modifiers, stamina, challenges, public lists), laststand, scavenger, common
src/server/features/killstreaks/          index (buttons, RPCs, wiring), api (bot API), state (ladder), world (per-room ctx),
                                          skill, streaks/{radar,airstrike,mortar,package,turrets,heli,vehicles,dogs}
src/client/features/perks/                footstep filter, last stand, scavenger packs, perk list, state (my loadout/pro)
src/client/features/killstreaks/          models, renderers, textures, sounds, fx, hud, radar, control, store
tests/perks.test.ts, tests/killstreaks.test.ts, tests/perks-streaks.integration.test.ts (+ helpers)
```

## Perks

| tier | perk | effect | Pro |
|---|---|---|---|
| 1 | Lightweight | speed x1.07 | no fall damage (`damageTaken` 0 for `fall`) |
| 1 | Flak Jacket | `explosive` damage x0.65 | `fire` damage 0 (napalm ground fire); `grenadeFuseReset` key |
| 1 | Scavenger | every death drops a `perks_pack`; an enemy with Scavenger walking over it gets a mag of reserve per weapon | spawn with +2 mags; emits `perks.resupply {lethal:1, tactical:1}` |
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
| care_package | Care Package | 5 | designate a spot; Chinook drops a crate (crushes); hold USE: owner 0.5 s, team 1.25 s, enemy 3 s; random streak or ammo |
| napalm | Napalm Strike | 5 | designate; jet runs along your facing; 3 canisters (7 m) + 8 s burning ground (`fire` 30/s) |
| sentry_gun | Sentry Gun | 6 | placed in front; turns to nearest visible enemy, spins up, 8 rounds/s; 90 s; 450 hp |
| mortar | Mortar Team | 6 | designate 3 spots; red ring warning, 2 shells per spot from 2.6 s |
| attack_helicopter | Attack Helicopter | 7 | flies in, patrols, minigun bursts at the nearest visible enemy; 60 s; 1500 hp; airspace max 3 helis |
| valkyrie | Valkyrie Rockets | 7 | (simplified) two rockets in turn, steered by your view (rocket cam); impact / proximity / FIRE / fuse detonates |
| blackbird | Blackbird | 8 | like the Spy Plane but live with facing arrows on the radar; cannot be shot down |
| rolling_thunder | Rolling Thunder | 8 | designate; B-52 carpet-bombs 14 bombs along your facing through the spot |
| chopper_gunner | Chopper Gunner | 9 | you work its explosive cannon from the air (camera in the seat, FIRE shoots); your body stays put and dying ends it; 2000 hp |
| attack_dogs | Attack Dogs | 11 | 8 dogs, 3 at a time, from your spawn side, hunt the nearest enemy and bite (55); 60 s; 80 hp each |

Rules: kills toward streaks reset on death; streak kills don't count (`isStreakWeapon`); each picked streak is earned once per life at its cost (Hardline: -1); earned streaks wait in `ready` until called and survive deaths until match end. Calling needs you alive and not already driving one.

**Controls.** `4` (STREAK button): call the selected streak; targeted ones (`point`, `line`, `points`) arm a designator (weapon lowered, HUD reticle): press `4` again at each spot (mortar: three). `5` cycles the selection (RPC `killstreaks.select`). Designating cancels on weapon switch, death or after 15 s. While designating or driving, core firing is refused (the feature holds `swapEnd`), and while driving the body's speed is 0.

**Everything targets bots like players.** All AI target selection iterates `room.players` (bots included); all damage goes through `room.damage` / `room.radiusDamage` with `means: 'killstreak'` (napalm ground fire `fire`) and `weapon` = streak id, credited to the owner. Every `fire` event (bots' `room.fire` too) is ray-tested against enemy hardware, so bots can shoot down helicopters and destroy sentries; destroying hardware gives score and emits `killstreaks.destroyed`.

## API for the bots area (`src/server/features/killstreaks/api.ts`)

```ts
import { callKillstreak, readyKillstreaks, suggestTarget, enemyStreakTargets, isDrivingStreak, isDesignating, killstreakState } from '../killstreaks/api';
readyKillstreaks(bot)                              // ['uav', 'napalm']
callKillstreak(room, bot, 'napalm', { target, yaw })   // { ok: true } | { ok: false, reason: 'not_ready'|'dead'|'busy'|'no_target'|'airspace_full'|'phase'|'unknown' }
suggestTarget(room, bot, 'mortar', skill)          // { target, targets, yaw } aimed at enemy clusters, error shrinks with skill
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
- `docs/CONTRACTS.md` (documents both), `NOTICE` (Blockyard attribution for the mortar pattern and rule shapes).

## Not done / simplified

- Valkyrie is simplified (no launcher weapon; two auto-launched guided rockets).
- Care Packages hold streaks or ammo only (no Death Machine / Grim Reaper weapons). Crates have no collision.
- Ghost Pro's hidden red name tag is not applied (core `core.names` widget); `perks.public.ghostPro` lists the ids for whoever replaces it.
- No mantle in core, so Marathon Pro's faster mantle is a description only; no penetration in core yet (`penetrationMultiplier` is for the weapons area).
- Dogs steer straight at targets with stuck-hops and hotspot detours (no nav graph); once the bots area has a nav graph they can use it.
