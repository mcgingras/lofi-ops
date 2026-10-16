# Progression

XP, levels 1-50 with BO1-style ranks, prestige 1-15 with procedurally drawn pixel emblems, unlock gating enforced at spawn, a large generated challenge set, the combat record, the Barracks screen, HUD popups and an end-of-match XP summary API.

Works in bot-filled lobbies: bots never earn anything (they have no profile), but killing a bot is worth `BOT_KILL_XP_MULT` (1.0) of a human kill, so a lobby that runs on bot backfill still progresses its humans.

## Files

| file | what |
|---|---|
| `src/shared/defs/progression.ts` | XP curve, `XP_SOURCES`, medal constants, `OBJECTIVE_XP` / aliases / labels, `RANKS` + `rankFor`, prestige (`canPrestige`, `applyPrestige`, `PRESTIGE_NAMES`), `progressionExt(profile)`, `MatchXpSummary` + `matchSummaryFor(results, playerId)` |
| `src/shared/defs/unlocks.ts` | unlock table (`unlockTable`, `unlocksAtLevel`), `isUnlocked`, `gateLoadout`, `classForSelection`, `classSlots`, `syncUnlocks`, `EQUIPMENT_UNLOCKS`, `FEATURE_UNLOCKS`, `CLASS_SLOT_LEVELS`, `UNLOCK_LEVEL_OVERRIDES`, `UNLOCK_RULES` |
| `src/shared/defs/challenges.ts` | `ChallengeDef` (extended), generated `CHALLENGES`, `registerChallenges`, `CHALLENGE_SOURCES`, `challengeList` / `challengeById` / `challengesForMetric`, progress rules (`advanceChallenge`, `progressMetric`, `tiersDone`...) |
| `src/shared/defs/progression-messages.ts` | `RpcMap` / `FeatureMessages` augmentation (shared so both sides are typed) |
| `src/server/features/progression/` | `index.ts` (RPCs), `tracker.ts` (per-room rules), `rules.ts` (`enterPrestige`), `events.ts` (bus events + `PlayerExt`) |
| `src/client/features/progression/` | `api.ts` (state + summary API), `hud.ts` (widgets), `barracks.ts` + `barracks.css` (screen + menu item), `emblems.ts` (pixel emblems / rank insignia) |
| `tests/progression.test.ts`, `tests/progression.integration.test.ts` | rules + room-level tests; real-server socket test |

## Rules

**XP** (live, as it happens; `profile.xp` / `level` update mid-match and level-ups pop immediately):

| source | XP |
|---|---|
| kill / headshot / assist | 100 / +50 / 50 |
| longshot (bullet, 35 m+) | +50 |
| first blood, revenge, comeback (kill after 3+ deaths), buzzkill (end a 3+ streak) | 100, 50, 50, 50 |
| double / triple / multi (3 s window) | 50 / 100 / 150 |
| every 5-kill streak | 100 x (streak / 5) |
| objective (`objective` event) | `OBJECTIVE_XP[kind]` (capture 200, plant/defuse 500, HQ 300, confirm 100...) or `data.xp` |
| match end | complete 100 (30 s+ played), 1 XP / s played (cap 900 s), win 500, FFA 1st/2nd/3rd 300/200/100 |
| challenges | per tier, from the def (plus CoD Points) |

Only humans with a profile, only while `playing` (match-end bonuses excepted), only in rooms with `persist: true` (private customs earn nothing). Reason `aborted` skips match bonuses.

**Levels**: 800 + 1050 (L-1) XP per level, 1,274,000 total at 50. Rank titles Private ... Commander (`rankFor`).

**Prestige** (`progression.prestige` RPC from the Barracks, level 50, not during a live match): resets level, XP, level unlocks and per-weapon attachment progress (`ext.progression.weaponKills`). Keeps CoD Points, `challengeProgress`, `stats`, `owned`, classes (re-gated at spawn). Grants `prestige_N` in `unlocks` and `owned`, selected for display (`ext.progression.emblem`, change with `progression.setEmblem`).

**Unlocks** (`isUnlocked(profile, kind, id, weapon?)`):

- weapons / perks / killstreaks: the def's `unlockLevel` (owners decide), overridable in `UNLOCK_LEVEL_OVERRIDES`;
- attachments: `AttachmentDef.unlockKills` kills with that weapon since the last prestige;
- lethal/tactical: `EQUIPMENT_UNLOCKS` (frag 1, concussion 1, flashbang 1, semtex 6, willy pete 9, nova 12, decoy 15, tomahawk 18; ids must match `defs/equipment.ts`); ids not listed are never gated, and only equipment with a def appears in the Barracks table;
- Pro perks (`pro:<perk>`): the perk's Pro challenge (`PerkDef.pro.challenge`) completed;
- Create-a-Class at level 4 (`feature:createAClass`), wager matches at 7 (`feature:wager`), prestige at 50;
- custom class slots at 4, 10, 20, 30, 40, plus one each at prestige 2, 4, 6, 8, 10 (`classSlots`); each is a class on top of the 3 defaults (`usableClassCount`), and Create-a-Class uses the same count.

`profile.unlocks` is kept in sync (`syncUnlocks`) and only progression-managed ids are added/removed; anything else other areas put there is left alone.

**Gating at spawn**: a `beforeSpawn` handler at priority 100 picks the class (`classForSelection`: default class by index before Create-a-Class, else the profile's own class if the slot is usable) and runs `gateLoadout`: locked weapons fall back to the default class weapon, locked attachments/perks/killstreaks are dropped, locked equipment becomes null. The client gets `progression.locked` with the reasons. Bots and `player.nextLoadout` (forced) loadouts are not class-replaced; forced loadouts set by lower-priority handlers (wager modes at the default priority 0) run after and win.

**Challenges**: ~46 at the moment on this branch (it grows automatically as other areas fill their defs): career (21), per mode (wins, kills, matches, MVP or top 3, plus the objective templates in `MODE_CHALLENGE_TEMPLATES` for TDM, FFA, DOM, S&D, HQ, KC, OITC, Gun Game, Sharpshooter, Sticks and Stones; generated only for modes present in `MODES`), per weapon (kills x5 tiers, headshots x4, each attachment), per weapon class, per killstreak (earned, kills), and a generic Pro challenge per perk. Progress survives prestige; each tier pays once.

**Combat record** (`profile.stats`, written by progression in addition to core's kills/deaths/wins/... keys): `shots`, `hits`, `weapon.<id>.kills|headshots|shots|hits` (core does not write the per-weapon keys despite the comment in `profile.ts`, so progression owns them), `longshots`, `firstBloods`, `revenges`, `doubleKills`, `tripleKills`, `meleeKills`, `streaksEarned`, `obj.<kind>`, `mode.<id>.obj.<kind>`, `mode.<id>.timePlayed`, `mode.<id>.bestStreak`.

## Wire

RPCs: `progression.prestige {}` -> Profile; `progression.setEmblem {emblem|null}`; `progression.checkLoadout {loadout}` -> `{loadout, violations}`; `progression.lastMatch {}` -> `MatchXpSummary | null`.

Pushes: `progression.xp {gains, xp, level, prestige}` (batched per tick), `progression.levelUp {level, prestige, rank, unlocks}`, `progression.unlocked {items}`, `progression.challenge {id, name, tier, tiers, xp, codPoints}`, `progression.summary MatchXpSummary`, `progression.locked {violations}`.

## Client

- Barracks: `navigate('barracks', { tab: 'levels' | 'prestige' | 'challenges' | 'record' })`, also works with `openOverlay('barracks')`. Main menu item `progression.barracks` (order 40).
- HUD widgets: `progression.ticker` 26 (+XP near the crosshair), `progression.xpbar` 42 (bottom edge), `progression.popups` 75 (promotion / challenge / unlock / locked, waits for the map title card), `progression.matchxp` 86 (one-line XP result in the `ended` phase).
- Pixel art: `emblems.ts` exports `prestigeEmblemPixels(n)`, `rankPixels(level)`, `badgePixels(level, prestige)`, `drawPixels(g, px, x, y, scale)` (HUD canvas) and `pixelCanvas(px, cssSize)` (DOM).

## Integration notes for other areas

- **modes** (end-of-match screen): read `matchSummaryFor(match.results, match.myId)` from `shared/defs/progression` (the summary is in `results.ext.progression[playerId]` before `matchEnd` goes out), or `onMatchSummary(fn)` / `lastMatchSummary()` from `src/client/features/progression/api.ts`. Summary = `{ total, xpBefore, xpAfter, levelBefore, levelAfter, prestige, lines: [{key,label,count,xp}], challenges: [{id,name,before,after,goal,tiersDone,tiers,completedTiers,xp,codPoints}], unlocked, codPoints }`. If you draw your own XP line, `unregisterHudWidget('progression.matchxp')`.
  Emit objectives as `room.bus.emit('objective', { kind, team, player, data })` with kinds `capture`, `defend`, `neutralize`, `assist_capture` (DOM), `plant`, `defuse`, `carrier_kill`, `last_alive`, `round_win` (S&D), `hq_capture`, `hq_destroy`, `hq_defend` (HQ), `confirm`, `deny` (KC). Aliases like `flag_capture`, `bomb_plant`, `kc_confirm` are accepted. The modes feature's own kinds (`dom.capture`, `sd.plant`, `hq.destroy`, `kc.confirm`, Infected's `infected.infect` / `survive` / `last_alive` / `outlast` / `final_stand`...) are aliased too, and its announcements (`sd.pickup`, `sd.drop`, `hq.online`... in `OBJECTIVE_IGNORED`) pay nothing. Pass `data: { xp: 0 }` for events that should not pay XP.
- **economy** (wagers): kinds `promote`, `humiliate` (Gun Game), `bankrupt` (Sticks and Stones), `survive` (OITC). To gate store purchases, push into `UNLOCK_RULES` (e.g. return `false` for weapons not yet bought, or `true` to sell early); challenge CoD Points are added to `profile.codPoints` directly by progression. Bots never earn CP from challenges (no profile). Use `featureUnlocked(profile, 'wager')` if wager matches should need level 7.
- **perks-streaks**: export `PERK_PRO_CHALLENGES: ChallengeDef[]` from `defs/perks.ts` (ids = each `PerkDef.pro.challenge`, add `grants: 'pro:<perk>'`); it is folded in automatically and replaces the generic "50 kills with the perk" challenge. Check Pro with `isUnlocked(profile, 'pro', perkId)` or `profile.unlocks.includes('pro:<perk>')`. Killstreaks earned are derived from `death.attackerStreak` vs the loadout's `KillstreakDef.kills` + `streakCostOffset`; do not also report `streak_earned`. For other metrics, emit `room.bus.emit('progression.metric', { player, metric: 'streak_called', killstreak: 'napalm' })` and XP with `room.bus.emit('progression.xp', { player, amount, label: 'SPY PLANE ASSIST' })`. Killstreak kills should use `means: 'killstreak'` and `weapon: <killstreak id>` so the per-streak challenges count them.
- **weapons**: unlock levels come from your `WeaponDef.unlockLevel` and attachment `unlockKills`; every new weapon/attachment gets challenges automatically. Keep `DEFAULT_LOADOUTS` level-1 legal or gating will strip items.
- **frontend**: show the Barracks via the menu item; in create-a-class use `isUnlocked` / `lockReason` / `classSlots(profile)` / `hasCreateAClass(profile)` for locks, or ask the server with `progression.checkLoadout`. Before Create-a-Class (level 4) the server uses the default classes regardless of edits.
- **bots**: nothing required; bots are skipped for XP, challenges, gating and summaries.

## Known gaps

- Prestige emblems/rank badges are not shown in the roster/scoreboard (core widget); `RosterEntry` already carries `level` and `prestige`, so `badgePixels(level, prestige)` can be drawn there by whoever owns the scoreboard.
- Weapon level-ups (BO1 had none; MW2 did) and contracts are not implemented.
