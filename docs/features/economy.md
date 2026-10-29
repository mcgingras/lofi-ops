# Economy: CoD Points, store, camos, wager matches

Owner: economy. Branch `feature/economy`.

## What's in it

| Piece | Where |
|---|---|
| Earning rules, ante tiers, payouts, the 4 wager ModeDefs, wager mode data | `src/shared/defs/economy.ts` |
| 16 camos as texture recipes (Woodland, Dusty, Desert, Digital, Tiger, Berlin, Warsaw, Siberia, Yukon, Flora, Blossom, Red Tiger, Gold, Ice, Dragon + None), plus the MW2 collection (`MW2_CAMOS`, 8) | `src/shared/defs/camos.ts` |
| MW2 camo per-weapon challenge rules (`weaponCamoProgress`, `camoFitsWeapon`, `mw2CamoProgress`, `mw2CamosUnlockedBetween`) | `src/shared/defs/camo-unlocks.ts` |
| Store catalog, reticles, emblem backgrounds, ownership keys, purchase/gate rules, class enforcement (pure, shared) | `src/shared/defs/store.ts` |
| Wire types (RPCs, feature pushes, `results.ext.economy`) | `src/shared/defs/economy-net.ts` |
| Crossbow + ballistic knife defs (wager only) | `src/shared/defs/wager-weapons.ts` |
| Crossbow bolt and ballistic knife blade projectiles, blade pickups | `src/server/features/economy/projectiles.ts` |
| Server feature: RPCs, CP at match end, `economy.grant`, spawn-time ownership check | `src/server/features/economy/{index,earn,shop,ledger,types}.ts` |
| Wager matchmaking, bot backfill, escrow, payouts, live HUD state | `src/server/features/economy/wager.ts` |
| Wager mode rules | `src/server/features/economy/modes/{oitc,gungame,sharpshooter,sticks,common}.ts` |
| Client: camo recipes + `camoPreview`, STORE screen, WAGER screen (buy-in, record), HUD widgets, wager results card + sounds (`wager-results.ts`), wager viewmodels, bolt/tomahawk views, third-person camo | `src/client/features/economy/*` |
| Tests | `tests/camos-mw2.test.ts` and `tests/camos-mw2-paint.client.test.ts` (MW2 collection), `tests/economy.test.ts` (rules), `tests/economy-wager.test.ts` (modes incl. Sticks and Stones ammo, bolts, blades, tomahawk, bankrupt payouts; escrow, bots; room-level), `tests/economy-wager-bots.test.ts` (stakes against bots, pot maths, placements with bots in the money, forfeits, guard rails, 2-human rules, crash recovery), `tests/economy.integration.test.ts`, `tests/economy-wager-bots.integration.test.ts` (a solo OITC wager against bots end to end) and `tests/sticks.integration.test.ts` (real server + sockets) |

## Earning CoD Points (BO1-like)

Every normal match pays each human (`codPointsBreakdown`): 100 for completing (scaled by the share of the match played), 0.1 CP per score point, +100 for winning, FFA podium +75/50/25, best streak 5/10/15 => +50/100/200; floor 25, cap 2,000. Bots never earn. Rooms with `persist: false` pay nothing. The breakdown goes to the player as the `economy.award` push (HUD toast) and into `results.ext.economy.awards[playerId]`. Wager modes pay only through the pot.

Everything that changes CP goes through `ledger.ts`, which keeps `profile.ext.economy` = `{ earned, spent, wagerWon, wagerLost, escrow, history (last 30), equipped { reticle, emblem }, lastMatch, wagerHistory (last 10 settled wagers: mode, ante, place of entrants, payout, net, forfeit) }` plus `stats.codPointsEarned/Spent`, `stats.wager.matches/wins/inMoney/forfeits`.

## Store (screen `store`, menu item "Store")

- Weapons: unlock by `WeaponDef.unlockLevel`, then cost `price ?? 1,500`. Attachments: bought per weapon (`att.<weapon>.<att>`), need the weapon usable, plus `unlockKills` (weapon kills stat) if set; `price ?? 1,000`. Camos: level/prestige gate + price (Gold level 44, 50,000; Ice prestige 1; Dragon prestige 3). Reticles and emblem backgrounds: level/prestige + price, then `economy.equip`.
- Starter items are free: everything in `DEFAULT_LOADOUTS`, camo `none`, reticle `dot`, background `plain`, any def priced 0.
- Camos are bought once and work on every weapon (simplified from BO1's per-weapon camos); the per-weapon choice is `WeaponLoadout.camo`.
- The MW2 collection is the exception; see **MW2 camos** below. Any camo check goes through `canUseCamo(profile, camo, weapon)` (`store.ts`).
- Prestige: level gates apply again after a prestige (BO1); prestige-gated items stay open at higher prestige.
- The server validates every purchase (`economy.buy`), checks the balance at the moment of spending and saves immediately.
- Screen layout (BO1 style: a gun list grouped by class, then each gun's page with its attachments; Camos / Reticles / Emblems tabs) is described in `frontend.md` under **Store**. The browsing model is `src/shared/frontend/store-browse.ts`; the rules above are unchanged.
- **Spawn-time check** (`beforeSpawn`, priority -50, humans, non-wager modes): weapons/attachments/camos the profile can't use are replaced (weapon -> starter weapon for that slot, attachment dropped, camo -> none) with a one-time notice. Switch off with `economyConfig.enforceOwnership = false` (`src/server/features/economy/shop.ts`) if a sandbox playlist needs it.

## MW2 camos

Modern Warfare 2's eight camos as their own collection (`MW2_CAMOS` in `camos.ts`, ids `mw2_*`, `collection: 'mw2'`), shown under an **MW2** heading in the store's Camos tab, on each primary's gun page, and in the Create-a-Class camo picker. They sit next to the global camos with the same names (Woodland, Desert, Digital, Red Tiger) but are separate ids, labelled "Woodland (MW2)" (`camoName`) and painted with MW2's patterns.

Unlocks are MW2's (CoD Wiki "Weapon Camouflage", MW2 section, and "Call of Duty: Modern Warfare 2 Challenges"): per weapon, primaries only (MW2 had no camos on secondaries), free once unlocked, never sold.

| Camo | MW2 unlock (with that gun) | Pattern (`paint.ts`) |
|---|---|---|
| Desert | default | `erdl`: tan base, khaki and brown brush strokes, light sand flecks |
| Arctic | default | `splinter`: white with light / mid grey slanted shards and dark flecks |
| Woodland | Expert I: 5 headshots | `erdl`: ERDL leaves, light green base, dark green and tan leaves, black branches |
| Digital | Expert II: 15 headshots | `marpat`: pixel clusters on a 2 px grid, greys (MW2's darker MARPAT) |
| Urban | Expert III: 30 headshots | `erdl`: grey base, faded red and white leaves, black branches |
| Blue Tiger | Expert IV: 75 headshots | `tigerstripe`: two blues, light base, dark ragged stripes in rows |
| Red Tiger | Expert V: 150 headshots | `tigerstripe`: deep red, bold black stripes, a darker red under-stroke |
| Fall | Expert VI: 250 headshots | `fall`: autumn foliage, brown base, rust patches, black twigs, orange / yellow / rust leaves and black leaf shadows |

- The record is the combat record the progression tracker keeps: `stats['weapon.<id>.headshots']` (and `.kills`; `WeaponCamoChallenge` supports a kill count too, none of MW2's camos use one, MW2's kill challenges unlocked attachments). It is never reset, so unlocked camos stay unlocked (MW2 reset them on prestige; we don't).
- The tracker pushes `progression.unlocked` ("AK-47 Woodland (MW2)", detail "Expert I") on the kill that crosses a threshold.
- Rules: `canUseCamo` (store.ts) for `enforceLoadout` (spawn), `economy.setCamo` (checks the slot's gun; errors say what's missing: "camo locked: 5/15 AK-47 headshots") and Create-a-Class (`itemLock` / `validateLoadout`, so `frontend.saveLoadout` rejects locked ones with "Woodland (MW2) camo is locked (4/5 AK-47 headshots)").
- Not in `storeCatalog()`; `economy.buy` of `camo.mw2_*` is `unknown`.
- Bots: `pickBotCamo` (bots/loadout.ts) gives a bot's primary an MW2 camo about two times in three, from those a pretend headshot record (growing with skill) would have opened.
- Pack Rat puts your slot's camo on a picked-up gun, MW2 camos included (the gun is a primary, so it fits).
- Recipes are procedural (no downloads): each `camo.mw2_*` texture is the painted pattern (64 px lo-fi base) and, for the photo look, the pattern at 0.8 over a Poly Haven fabric photo with a CSS filter, through the developer like the other camos.

## Wager matches (screen `wager`, menu item "Wager Match")

Modes (FFA, registered from the feature setup, ModeDefs in `WAGER_MODES`):

- **One in the Chamber** `oitc`: M1911 with 1 bullet, no reserve; any bullet hit kills; every kill +1 bullet; knife (melee button); 3 lives, then eliminated (no respawn). Last player standing wins; on time, survivors rank by lives then score, the eliminated by how long they lasted. +50 per kill, +10 to survivors per elimination.
- **Gun Game** `gungame`: ladder `GUN_GAME_LADDER_INTENT` filtered to weapons that exist (so it grows when the weapons area ships its roster; 20 rungs today, as in BO1; the HK21 is left out of the intent so the RPK stays the one LMG rung). Kill = next gun immediately; knife kill demotes the victim (no promotion); suicide demotes. First kill on the last rung ends the match.
- **Sharpshooter** `sharpshooter`: everyone gets the same random gun (classes ar/smg/lmg/sniper/shotgun/pistol/machinepistol), swapped for all every 45 s. Kills in a life stack: 2 = faster reload + x2, 3 = tighter spread, 4 = speed + x3, 6 = sprint + x4. +50 x multiplier per kill.
- **Sticks and Stones** `sticks` (BO1): everyone has the crossbow with explosive bolts (**6**: 1 loaded + 5), the ballistic knife (**2** blades: 1 + 1) and **one tomahawk**; no tacticals, no scavenging, no ammo for kills. Running dry is the point: blades and the tomahawk are picked back up from where they landed.
  - Crossbow: a projectile with drop (60 m/s). A player hit takes 50 (BO1's direct impact) and the bolt **sticks to them**; after a 1.5 s fuse (beeping, blinking red tip) it explodes: the stuck player always dies, everyone within 4 m takes 200-75 (the shooter too). A world hit sticks to the surface and explodes the same way, so you can shoot the ground next to someone. The victim gets `economy.stuck` (red frame and a flashing STUCK!). Kills are `weapon: 'crossbow'` (`means: 'impact'` for a killing direct hit, `'explosive'` for the blast).
  - Ballistic knife: the spring fires the blade (32 m/s, a visible arc) for a flat 250 on any body hit (one hit, BO1). A blade stays where it lands for 60 s: stuck in a wall (`s.k = 1`), or on the floor at the victim's body (`s.k = 2`). Anyone holding a ballistic knife takes it by walking within 1 m or holding USE within 2 m, up to 2 (an empty knife is loaded on the spot, otherwise it goes to reserve; BO2's `_ballistic_knife.gsc` has no owner check). The knife (melee button) still stabs with it in hand.
  - Tomahawk: the weapons feature's lethal (hold to raise, release to throw, bounces, retrievable; see weapons.md). Sticks only forces it into the class.
  - Points (BO1): 100 for a crossbow, blade or other kill, 25 for a knife, **10 for a tomahawk, which bankrupts the victim** (score to 0). Any suicide (your own bolt, falling) bankrupts you. `economy.bankrupt {victim, attacker, lost}` goes to everyone: the victim sees BANKRUPTED, the thrower HUMILIATION, everyone else a feed line. Payouts rank by the reduced score.
  - HUD: the ammo counter reads "6 BOLTS" / "2 BLADES" with a pip per round, NO AMMO when dry (never RELOAD without reserve), the tomahawk hint ("HOLD [G]" / "PICK IT UP").
  - Bots: the bots' own throw logic presses LETHAL (the tomahawk leaves on release), their usual melee-happy / rush style for `sticks`, and a goal registered from economy (`registerSticksBotGoals` through `bots/hooks.ts` `registerBotGoal`) sends a bot to the nearest blade or tomahawk it can use, urgently when it is out of bolts and blades. A bot's bolt / blade launch is lifted to land on whatever its aim ray meets (they don't lead for drop themselves).
- All wager modes: one-hit knife on the melee button (`wagerMelee`), wager-forced weapons (custom classes ignored), no class grenades (lethal and tactical cleared at `beforeSpawn`, priority -20; Sticks sets its tomahawk after that).

### Stakes against bots

One rule for every staked wager, solo or not: **the house covers each bot's ante; the humans' antes are escrowed.**

- **Entrants** = the humans who paid the ante at the start + the bots in the room at the start (bots that join during the countdown count too; bots that join mid-match, and late-joining humans, don't).
- **Pot** = ante x entrants. Only the humans' real CP is debited and held in escrow; the bots' share is virtual house money.
- **Places paid** = min(3, entrants - 1), split 100% / 65-35 / 50-30-20 (BO1's top three), by the mode's final ranking among the entrants still in, bots included. Rounding goes to 1st. A bot that places in the money keeps nothing: its share goes back to the house (`results.ext.economy.wager.house`).
- Example, 1 human + 5 bots at Big Spender (1,000): pot 6,000; 1st 3,000 (+2,000 net), 2nd 1,800 (+800), 3rd 1,200 (+200), 4th-6th 0 (-1,000). If a bot wins and the human is 2nd, the human gets 1,800 and 4,200 goes back to the house.
- **Bot skill is not scaled by the tier**: wager bots play at the lobby's own difficulty (preset or custom, with its variance) on every tier, the same as practice. The buy-in screen and the lobby card show it ("Opponents: Regular").
- **Practice** (ante 0) stays free: no escrow, no payout, bots or not. A lone human with bot fill off (one entrant) also plays practice.
- **Server-authoritative**: placement comes from the mode's `rank()` on the server and payouts from `wagerPayouts`; the client only sends `economy.wagerQueue { mode, ante, bots }`, and the ante is checked against the balance when queueing and again when it is debited at the start (`debit` never goes below 0; someone who can't pay is kicked before the match).

Flow (`economy.wagerQueue { mode, ante, bots }` -> join the returned room via the match screen):

1. **Lobby.** Rooms are matched by mode + ante. The match starts when full, when someone sends `economy.wagerStart` (2+ humans, or bot fill on), or after `MATCHMAKING_WAIT_SEC` (20 s). Practice tier starts after 3 s. Rematch after 12 s.
2. **Bots.** With `fill` on, empty slots up to `targetPlayers` become bots (`room.options.botFill`, core backfill: humans who join replace bots). The lobby's `LobbyBotSettings` (preset or custom skill, variance) are clamped with `sanitizeBots` and each bot gets `player.ext.wager.skill` (jittered by variance with `WagerManager.random`, seedable in tests). With the bots feature loaded, wager lobbies hand it the settings with `configureRoomBots(room, bots, { managed: false })` (economy keeps the count) and each bot's brain plays at exactly its `ext.wager.skill`.
3. **Escrow at match start.** Each human pays the ante into `profile.ext.economy.escrow`; the debit and the escrow are one row write (`store.save`), so a crash leaves both or neither. Can't pay => kicked. Nobody staked, fewer than `WAGER_MIN_ENTRANTS` (2) entrants, or the Practice tier => practice. In a custom lobby whose bots the bots feature adds during the countdown, the entrant check waits for play.
4. **Leaving.**
   - During the countdown, or when the room closes (server shutdown): refunded.
   - Mid-match: **forfeit**. The ante stays in the pot, the leaver can't place, the loss is booked (`wagerLost`, `stats.wager.forfeits`, a `forfeit` record) and the profile saved at once with the escrow cleared, so a crash afterwards can't refund it.
   - **Solo (one staked human): a forfeit is final.** No void, no refund, not even when the emptied room closes. Disconnecting counts as leaving.
   - **2+ staked humans: the original rule stays.** If leavers drop the staked humans below `WAGER_MIN_HUMANS` (2), the wager is void and every ante (forfeits too) is refunded; a server shutdown also refunds forfeits.
5. **Payout at match end.** As above. `results.ext.economy.wager` = `{ ante, pot, practice, staked, entrants, payouts, lines (per staked human: ante/payout/net), placings (every entrant still in, bots too), house, forfeits }`; each staked human gets an `economy.award` push ("In the money (#2 of 6)"), a `wagerHistory` record, and an immediate save.
6. **Crash safety (the Fly volume holds `/data/lofi.db`, SQLite in WAL mode).** Any escrow still in the database belongs to a match that died with the process, so **at boot** `WagerManager.recoverEscrows()` scans `store.idsWithExt('$.economy.escrow')` and refunds each one ("Server restarted mid-wager: ante refunded"). A graceful drain (SIGINT, `kill_timeout` 10 s) closes the rooms first, which refunds through `onClosed`. The sweeper still refunds any escrow whose match is gone (every 5 s for connected sessions, and on wager RPCs). Forfeits are never refunded by a restart (their escrow was cleared when they left); a settled payout and its escrow clear are one save, so it can't be paid twice.

### Screens

- **Buy-in (`wager` screen).** Balance, your stake, the balance after the buy-in, the pot (ante x players, players = the bot fill target), the payout table for that lobby size (place, payout, net, a dashed cut line above the first unpaid place), "Opponents: <difficulty>" and "IN THE MONEY: top N of M". Tiers you can't afford are disabled and the button reads "Buy in: 1,000 CP" (disabled above your balance). Under the Low Roller ante (`MIN_STAKE`) only Practice is open, with `EARN_CP_HINT`. The open-lobbies list shows each lobby's opponents. Below: **Your wager record** (played, won, in the money, net CP, last 5 results).
- **Lobby card** (HUD `economy.lobby`): ante and pot, players, start countdown, "OPPONENTS: REGULAR BOTS", your stake ("HOUSE COVERS THE BOTS") and the payout table.
- **In match**: `economy.wager` (pot and stake, IN THE MONEY #n +CP / OUT OF THE MONEY #n TOP 3 PAID), and with Tab held `economy.board` beside the scoreboard: every entrant's projected payout by rank with the IN THE MONEY cut line.
- **End of match**: the summary's wager card (`registerSummaryCard('economy.wager')`): IN THE MONEY / OUT OF THE MONEY, placed #n of N, ante, payout, won/lost, new balance, the placings with the cut line and what went back to the house. A coin chime (`economy.cash`) or a low buzz (`economy.bust`) plays when the payout arrives, next to the `economy.award` toast.
- **Barracks record tab**: Wagers won (of played), Wagers in the money, Wager net CP.

HUD: `economy.lobby` (lobby card: mode, ante/pot, stake, players, start countdown, opponents, who's in), `economy.wager` (pot, stake + IN THE MONEY #n +CP / OUT OF THE MONEY / PRACTICE WAGER), `economy.board` (Tab: the money by rank), `economy.mode` (lives, gun rung, swap timer + bonus, tomahawk hint), `economy.award` (CP toast), `economy.splash` (BANKRUPTED / HUMILIATION, STUCK!), `economy.reticle` (equipped reticle while aiming through an optic).

## RPCs and pushes

```
economy.state {}                                  -> EconomyState
economy.buy { item: '<ownership key>' }           -> { codPoints, owned, item }   errors: level|prestige|weapon|kills|challenge|funds|owned|unknown
economy.equip { kind: 'reticle'|'emblem', id }    -> { equipped }
economy.setCamo { loadout, slot, camo }           -> { loadouts }   (canUseCamo with the slot's gun: ownership, or the MW2 challenge)
economy.wagerQueue { mode, ante, bots? }          -> { roomId, practice }   errors: funds (with the balance and EARN_CP_HINT)|busy|bad_request
economy.wagerList {}                              -> { rooms: WagerRoomSummary[] }
economy.wagerStart {}                             -> { ok }
push economy.wager (WagerHud), economy.mode (WagerModeHud), economy.award { reason, lines, total, codPoints },
     economy.bankrupt { victim, attacker, lost } (everyone), economy.stuck { by, fuse }, economy.blade { total }
room events: economy.grant { player, amount, reason, kind? }, economy.payout { player, profileId, amount, rank }
```

## Integration notes for other areas

- **progression**: pay challenge CoD Points with `room.bus.emit('economy.grant', { player, amount: def.codPoints, reason: 'Challenge: ' + def.name, kind: 'challenge' })`; don't touch `profile.codPoints` directly. Prestige can keep `owned` (CP purchases persist; level gates re-apply).
- **frontend**: camo picker uses `CAMOS` + `camoPreview(id, size)` and `canUse(profile, keyOf.camo(id))` (or call `economy.setCamo`). `itemPreview(storeItem)`, `drawReticle`, `drawEmblemBackground` are exported from `src/client/features/economy/index.ts`. Loadout saving should run `enforceLoadout` or leave it to the spawn check. Wager entry is the `wager` screen; a custom lobby in a wager mode can set stakes via `wagersFor(room)?.setWagerAnte(room, ante, bots)` (otherwise it's practice). If you replace the main menu, keep rendering `menuItems` (Wager Match 30, Store 60).
- **bots**: wager lobbies use core `botFill`; bots in a staked wager are entrants whose ante the house covers (no profile, nothing escrowed, their winnings go back to the house); read the lobby settings with `wagerRoomInfo(room)` (`src/server/features/economy/index.ts`) or `player.ext.wager.skill` on each bot. Wager awareness: `player.ext.wager` has `lives`, `out`, `gunLevel`; tomahawks are `player.ext.weapons.lethal === 'tomahawk'` / `lethalN`; weapons are forced by the mode (bots just fire what they hold); melee = `Buttons.MELEE` press, tomahawk = `Buttons.LETHAL` press then release (the throw leaves on release). Sticks and Stones retrieval is a `registerBotGoal('sticks', ...)` from economy; no bots files were changed for it.
- **weapons**: crossbow/ballistic_knife are added to `WEAPONS` only if you don't define those ids (if you do, yours win and the economy's bolt behaviour isn't registered). Gun Game and Sharpshooter pick up your roster automatically. The wager knife is a separate one-hit melee bound to the melee button in wager modes only; a global melee of yours composes (a dead victim can't die twice). Store prices come from `WeaponDef.price` / `AttachmentDef.price` (defaults 1,500 / 1,000).
- **modes / maps**: wager rooms pick maps from `mapsForMode(<wager id>)`, falling back to `mapsForMode('ffa')`; add wager ids to a map's `modes` to dedicate it.

No code was copied from Potrock's Blockyard for this area (its source has no wager modes); the room/RPC patterns follow this repo's core, so NOTICE is unchanged.
