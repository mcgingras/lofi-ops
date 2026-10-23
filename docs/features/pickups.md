# Weapon drops and pickups (area: pickups)

Pick up other players' guns, as in Black Ops 1 / MW2: when you run dry, grab what the last guy dropped.

```
src/shared/defs/pickups.ts        PICKUP tuning, PICKUP_ENTITY, DropSnapState, canDropWeapon, dropScore / pickDropTarget (shared target maths), wire types
src/server/features/pickups/      index (feature: death drop, USE hold, walk-over ammo, round clear), drops (spawn, fall, despawn/cap, swap, ammo), bots, state
src/client/features/pickups/      index (prompt widget, notices, corpse gun hiding, USE priority mirror), model (dropped gun renderer)
tests/pickups.test.ts             rules level (rooms stepped tick by tick)
tests/pickups.integration.test.ts real server + sockets (drop, swap, reach, weapon stats, bot pickup)
```

## Rules

| what | how |
|---|---|
| Drop on death | The gun in the victim's hands (the primary if they had the underbarrel launcher up, the pistol in last stand) drops at the body with its magazine, reserve, attachments, camo and launcher rounds. It leaves the hands ~1 m up with a little toss, tumbles and spins down, and lies flat on its side. Completely empty guns (0 + 0) don't drop. Only `primary` / `secondary` weapons drop (`canDropWeapon`; no knife, launcher slot or wager-only guns). |
| Life and cap | `PICKUP.lifeSec` 45 s, then it's gone (a Mystery Box wonder weapon: `WONDER_DROP_LIFE_SEC` 20 s). At most `PICKUP.maxPerRoom` 16 per room: the oldest goes first. A new S&D round clears them (`modes.roundStart`); a new match clears all entities anyway. |
| Prompt | Within `PICKUP.radius` 1.6 m (feet to gun, ±1.4 m height) with line of sight: "HOLD F TO SWAP FOR <GUN>" (the USE key from `useKey()`), with its attachments and ammo under it, and a fill bar while you hold. If several are in reach the one nearest the crosshair wins (score = distance + 2 × angle off the crosshair), then the nearest. |
| Swap | Hold USE `PICKUP.holdSec` 0.25 s. The gun in your hand is replaced (slot kept, so a primary can end up in your pistol slot as in CoD); you take its ammo, yours drops where you stand with its ammo, and the new gun comes up over its swap time. Then USE must be let go before another swap, and the gun you just put down can't be taken back by you for `PICKUP.reswapSec` 1 s (covers lag gaps where the server sees USE go up). Not while the launcher slot is up. |
| Same weapon | You never carry two of the same gun (same weapon id; attachments don't matter): no prompt. Walking over it (`PICKUP.ammoRadius` 1.1 m) takes its rounds into that gun's reserve up to the max (`max(def.reserve, current)`) and removes it; if you're full it stays. |
| Launcher | A gun with the `gl` attachment brings the launcher slot (and its rounds) with it; giving it up removes the slot. |
| Wagers | No drops (`room.mode.wager`). |
| Scavenger | Separate: Scavenger's `perks_pack` still drops for every death (perks feature, unchanged). |

### USE priority

USE is shared. Objectives and crates win over guns, and a hold that started on one of them never turns into a swap:

- Server: core modifier key `useClaimed(p) => boolean` (`src/server/modifiers.ts`). Registered by killstreaks (a landed care package within `CRATE_REACH`, driving a streak, the tactical map), modes S&D (`SdRules.canUseObjective`: the carrier in a site, a defender in defuse reach of the planted bomb, anyone mid plant/defuse) and perks (down in last stand; next to a downed Pro teammate you can revive). While it says true, pickups ignore USE and require a release.
- Client: `useClaimedLocally(match)` mirrors it (crate in reach / being taken, `ksClient.state.control|map`, last stand, the S&D plant/defuse conditions from `modes.state`) and hides the swap prompt, so the crate prompt (`killstreaks.crates`) and the S&D hints never show at the same time as ours. Same screen spot as the crate prompt.

New USE actions elsewhere: register `room.modifiers.add('useClaimed', (p) => inReach(p) ? true : undefined, '<area>.<thing>')`.

## Server

- `death` (playing phase, drops enabled): `dropOnDeath`. `tick`: `updateDrops` (fall: gravity 18, horizontal stop on a wall, land on `world.groundBelow`; despawn), human USE holds (`updateHumanUse`: `useTarget` → `swapBlocker` → `swapFor`), walk-over ammo every 6 ticks, bots.
- Validation in `swapBlocker(room, p, drop, {slot?})`: playing phase, alive, drop exists and landed, slot 0/1, not a weapon you carry, not just dropped by you, USE not claimed, in reach, line of sight from the eye (`players` mask). Weapon stats always come from the server's `WEAPON_BY_ID` + `effectiveWeapon` (`makeWeapon`); only ids, ammo and camo are copied.
- Pack-a-Punch (killstreak, a timed buff on the player): `spawnDrop` always drops the plain gun, its own camo back and its ammo clamped to the normal magazine and reserve; a buffed player who takes a gun gets it packed by the killstreaks feature.
- Entities: kind `pickups_weapon`, `s = { w, a, c, l, m, r, o }` (weapon, attachments csv, camo, landed, mag, reserve, who dropped it); server data in `entity.data` (`DropData`).
- Events (declared in drops.ts): `pickups.dropped {player, weapon, entity, reason}`, `pickups.swapped {player, taken, dropped, slot}`, `pickups.ammo {player, weapon, amount}`. A swap of the gun in hand also emits core `weaponSwitch`.
- Feature messages: `pickups.swapped {taken, dropped, slot}`, `pickups.ammo {weapon, amount}` (to the player).

### Bots (bots.ts)

Kept simple. Every 0.5 s a bot checks `ammoNeed`: 2 = both guns empty, 1 = primary under a magazine with a weak sidearm. If it needs ammo, its `weaponPickup` skill is > 0 (new knob in `BotSkill`, `src/shared/defs/bots.ts`: recruit 0.2, regular 0.5, hardened 0.75, veteran 0.9; 0 = never) and, unless bone dry, no enemy within 30 m has eyes on it, it picks the nearest worthwhile gun within `4 + 22 × weaponPickup` m (a copy of a gun it's short on, or a different gun with at least two of its magazines). A `registerBotGoal('*')` goal (priority 0.95 dry / 0.7 low, sprint) walks it there; once in reach it "holds USE" for 0.35 s and swaps its emptiest gun (bots don't need to switch to it first). Copies are taken by walking over them.

## Stats and challenges

No special hook needed: progression credits kills to the `attacker` with `death.weapon`, so a kill with a picked-up gun counts for the picker's `weapon.<id>.kills` / attachment progress / weapon challenges and never for the gun's previous owner (`tests/pickups.integration.test.ts` checks both).

## Client

- `registerEntityRenderer('pickups_weapon')`: the weapons area's `GUNS` builders via `Kit` (same model, attachments and camo as the viewmodel and third-person gun) at third-person scale (0.7), on its side, resting on the floor; tumbles while `s.l` is false, eases flat on landing; `makeLookMaterial({dyn:true})` + `setDynLight` from `map.lightAt` every 0.25 s.
- `pickups.prompt` HUD widget (order 8), notices for ammo taken, a sound on swap.
- `pickups.corpses` match hook: a dead remote soldier whose gun is on the floor (`s.o`) stops holding it (its `aim` child groups are hidden until it respawns).
- `game/match.ts` (core, small): when the server replaces the gun in the current slot, the local prediction drops pending shots / reload for it and raises the new gun over its own swap time.

Wonder weapons (Mystery Box): a bot with full guns (`ammoNeed` 0) still walks to a dropped wonder weapon within `14 × (0.5 + weaponPickup)` m it doesn't carry, when no enemy watches (`chooseWonderDrop`, goal priority 0.6).

## Not done / simplified

- "Same weapon" means same id (BO1/MW2 treat different attachment combos as different guns).
- No dropped-gun glint or outline; guns are only the world model.
- Bots don't weigh guns by class or range preference, only ammo.
