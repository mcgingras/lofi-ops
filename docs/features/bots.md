# Bots

Owner: bots. Covers DESIGN.md section 8a (hard requirement): every lobby runs with bots when not enough humans join, and bot skill is tunable (presets, or every knob by hand).

## What's built

| file | what |
|---|---|
| `src/shared/defs/bots.ts` | `BotSkill`, presets, `LobbyBotSettings`, `DEFAULT_TARGET_PLAYERS`, `MATCHMAKING_WAIT_SEC`, `skillFor` (core seed), plus the wire types `BotsState`, `PlayWithBotsReq` and the `RpcMap` / `FeatureMessages` merges |
| `src/server/features/bots/index.ts` | the Feature: a `RoomBots` controller per room, and the RPCs `bots.get`, `bots.setSettings`, `bots.playWithBots` |
| `src/server/features/bots/api.ts` | server API for other areas (see Integration) |
| `src/server/features/bots/roster.ts` | per-room controller: backfill, replace, retire, team balance, brains, event wiring, `results.ext.bots` |
| `src/server/features/bots/nav.ts` | nav grid generated from map brushes, plus A* |
| `src/server/features/bots/brain.ts` | the `player.brain`: perception, fighting, roaming, objectives, lethals, streaks |
| `src/server/features/bots/aim.ts` | the aim model, as pure functions |
| `src/server/features/bots/skill.ts` | settings validation, per-bot variance, skill rating |
| `src/server/features/bots/loadout.ts` | bot classes picked from the current defs, and bot callsigns |
| `src/server/features/bots/hooks.ts` | `registerBotGoal`, `registerBotStreakHandler`, `registerBotModeStyle` |
| `src/client/features/bots/index.ts` | `botsClient` (typed RPC helpers), the `bots.setup` screen with the "Play with Bots" menu item, and the `bots.wait` HUD widget |

### Lobby rules (roster.ts)

- **Settings per room.** Every room starts with `DEFAULT_LOBBY_BOTS` (regular difficulty, variance 0.15). `targetPlayers` comes from `DEFAULT_TARGET_PLAYERS[mode]`, capped at the room size, and follows mode changes until someone sets it.
- **Backfill.** At every match start (the countdown phase, or play when there is no countdown) the room is topped up to `targetPlayers` with bots. Teams are balanced: bots get re-teamed while everyone is still dead. Bots are therefore spawned and visible during the frozen countdown.
- **Matchmaking wait.** Rooms that start when they are created (quick play, `autoStart: true`) wait `MATCHMAKING_WAIT_SEC` (20 s) from creation before the first backfill. Clients get `bots.status.fillAt`, and the HUD shows "WAITING FOR PLAYERS / BOTS JOIN IN N".
- **A human leaves mid-match:** a bot joins on the leaver's team straight away.
- **A human joins mid-match:** a bot on the newcomer's team is marked as retiring. It keeps playing until its next death, then leaves 1.2 s later; a bot that is already dead leaves at once. If the core kicks a bot because the room is full, teams more than one apart are evened up by moving a bot to the other team at its next death.
- **Back to the lobby phase:** bots leave, and come back at the next start.
- **Fill off, or a lower target:** extra bots retire, live ones at their next death.
- Changing settings mid-match takes effect at once: bots are added or retired, and every bot's skill is recomputed.
- **Names.** Bots get callsigns (`pickBotName`); bots added by core backfill (`botFill`, named "Bot 7") are renamed on join.
- **Bots never earn CoD Points or XP** because they have no profile. `matchEnd` adds `results.ext.bots = { bots, humans, difficulty, practice }`; `practice` is true for a wager mode with bots in it.

### Skill

- Presets and custom skill come from `skillFor(settings)`.
- **Variance.** Each bot has fixed random rolls (`player.ext.bots.rolls`), so it keeps its personality when the host changes difficulty. At variance 1, a knob moves up to ±35 % of its slider range. 60 % of that jitter is shared "form" (a good-day bot is better at everything) and 40 % is per knob. Results are always clamped to `BOT_SKILL_RANGES`.
- **Where each knob is used:**
  - `reactionMs`: delay before the aim moves after first spotting a target.
  - `aimErrorDeg`: the first swing's error. It shrinks while tracking (tau 0.25 to 1.15 s) down to a wobble of about 30 % of `aimErrorDeg`, so weak bots keep missing. The bot fires when its crosshair reaches the point it *means* to hit, so accuracy really does follow skill.
  - `turnSpeedDeg`: limits yaw and pitch speed.
  - `headshotBias`: chance to aim for the head, rolled per engagement.
  - `fovDeg`: spotting cone.
  - `hearingRange`: unsuppressed gunfire within this range makes the bot investigate.
  - `strafe`: strafe frequency, crouch spam and the occasional hop.
  - `burstControl`: burst length at range and recoil climb per shot (vertical recoil × (1 − burstControl)).
  - `objectivePlay`: chance of following a mode goal.
  - `streakUse`: how likely and how soon it uses an earned streak.
  - `aggression`: chasing, flanking, how far forward it roams, sprinting, how long it holds an angle, and retreating to cover when hurt.
- Measured hit rate per shot in 4v4 Yard TDM (120 s simulated): recruit 0.04, regular 0.17, hardened 0.29, veteran 0.45.

### Navigation (nav.ts)

- **Cells.** The grid has 0.5 m columns. Each column gets one cell per surface a body fits on: the highest top under the footprint, with standing room above. This handles stair treads narrower than the footprint, ramps (via `topAt`), container tops and so on.
- **Links.** Each cell links to its 8 neighbours:
  - `walk`: up to the step height, with no corner cutting on diagonals.
  - `jump`: up to about 0.98 m, with headroom.
  - `drop`: up to 4.5 m, one way, only where the whole fall is clear (no drops through an upper floor).
- **Reachable set.** Cells that can be reached from the spawns and can get back to them are marked `core`; roaming only picks core cells.
- **Doors.** Doorways are just gaps a body fits through. There are no openable doors yet; if a map adds them as brushes, a rebuild hook would be needed (`navFor` caches per `MapData`).
- **Cost.** On the Yard the grid has 13k cells, builds in about 120 ms once per map (shared by every room), and a cross-map A* takes about 0.4 ms.
- **Following a path.** Bots string-pull (walk straight to the farthest cell they can reach in a line), advance along the path monotonically, jump at jump links, and get unstuck by jumping first and then re-planning.

### Brain behaviour (brain.ts)

- **Perception at 20 Hz**, staggered between bots. A bot sees enemies inside its FOV with line of sight to the chest, or to the head over cover. It always notices anyone touching it or who just hurt it. Far targets in peripheral vision are noticed less often by weaker bots. It hears gunfire. It knows about enemies the radar shows it (`radarVisible` modifier returning true, which is the UAV hook).
- **Fighting:**
  - The aim model above.
  - Bursts for auto and burst weapons; paced shots for semi, bolt and pump.
  - ADS by range, depending on weapon class.
  - Holds its class's preferred range (closer for aggressive bots).
  - Strafes and crouch-spams, and won't strafe off ledges.
  - Switches to the sidearm when dry up close, or reloads.
  - Backs off to a cover cell out of the enemy's sight to reload or heal (less aggressive bots).
  - Presses MELEE when touching an enemy.
- **After a fight:** chases or flanks to the last-seen spot (aggression), or holds the angle. It throws its lethal if the loadout has one: it aims an arc and presses LETHAL. Then it tops up its magazine.
- **Roaming:**
  - Goals in this order: a forced goal, then a mode objective, then chase, then a heard noise, then a radar contact, then a spawn-aware roam point.
  - Roam points are hotspots and random reachable cells, scored toward recent fights and the enemy half. Points near the bot's own spawn score low, and anything within 14 m of the enemy spawn scores very low (no spawn camping).
  - Sprints the long stretches; lingers at a roam point for a while.
- **Wager awareness** (`botModeStyle`):
  - `oitc`: conserves ammo, so it only fires steady, ADS'd, tightly aimed shots; with no ammo left it rushes in and knifes.
  - `gungame`: rushes, likes melee.
  - `sticks`: rushes, conserves ammo, likes melee.
  - `sharpshooter`: normal play.
  - Gun Game progression and forced wager loadouts need nothing extra: the brain reads whatever weapon is in hand every tick.
- **Killstreaks:** when the bot's streak reaches the cost of a streak in its loadout (with the `streakCostOffset` modifier applied), it presses STREAK (or calls the registered handler) after a delay set by `streakUse`.
- **Loadouts** are picked from `WEAPONS`, `ATTACHMENTS`, `PERKS` and `KILLSTREAKS` as they stand at runtime. Snipers and shotguns get likelier with skill. Each bot uses one perk per tier and three streaks.

## How to use it

- **Players:** main menu → **Play with Bots**. Pick a mode, a map, the player count (you plus bots), and a difficulty: a preset, or Custom with every knob as a slider under "Bot skill". Set variance, then **Start match**. The setup is remembered in localStorage (`lofi.bots.setup`). Quick Play rooms backfill on their own after 20 s.
- **RPCs** (typed through `RpcMap`):
  - `bots.get { roomId? }` returns `BotsState`.
  - `bots.setSettings { roomId?, settings }` returns `BotsState`. Only the host of a private room may call it (the creator, otherwise the longest-present human). Errors: `not_host`, `not_allowed` (matchmade room), `unknown_room`.
  - `bots.playWithBots { mode, map?, ...LobbyBotSettings }` returns `{ roomId }`. The client then does `navigate('match', { room: roomId })`; `botsClient.playWithBots` does both.
- **Push** `bots.status` (a `BotsState`) goes to everyone in the room when settings or counts change. `editable` is set per recipient.
- **Env:** `LOFI_BOTS=off` stops default rooms from managing bots. Rooms configured explicitly through `configureRoomBots` still work.

## Integration notes for other areas

**Wired at integration (main):**
- Mode objectives: `objectives.ts` registers a `'*'` goal source that maps the modes area's `bestObjective(room, bot)` (DOM flags, HQ, S&D bomb/plant/defuse, Kill Confirmed tags) to a `BotGoal` (`stay` -> `hold`, `holdUse` -> `Buttons.USE`, priority >= 0.8 sprints).
- Frontend lobbies: on the room event `frontend.botSettings` the room's controller stops managing the count (`managed = false`; the frontend's core `botFill` owns it) and takes the lobby's settings for skill. The frontend's `bots.setSettings` call now sends `{ roomId, settings }`.
- Tests: `tests/bots.areas.test.ts`.

- **frontend:**
  - For per-game lobbies, call `configureRoomBots(room, settings, { hostId: session.id })` right after `createRoom({ autoStart: false, ... })`. Then call `bots.setSettings` from your lobby UI: preset picker, custom sliders from `BOT_SKILL_RANGES`, fill toggle, target count. Backfill happens when you `startMatch()`.
  - Don't also pass `RoomOptions.botFill`: when `botFill > 0`, core owns the bot count, and this feature only adds brains.
  - The `bots.setup` screen and the `bots.play` menu item (order 25) are a working stand-in. Replace the screen id, or `menuItems.delete('bots.play')`, if your lobby covers it.
  - `botsClient.status` and `onStatus` give `fillAt` for a "starting with bots in N" lobby timer.
- **modes:**
  - `registerBotGoal(modeId, (room, bot, ctx) => ({ at, radius, hold, priority, holdButtons, sprint }) | null)`.
  - `priority` 1 means urgent (for example, a planted bomb). `holdButtons` (such as `Buttons.USE`) are held inside the radius, for plant, defuse or capture.
  - The highest-priority goal from the mode's sources and the `'*'` sources wins. Bots follow it with a probability set by `objectivePlay`.
  - For rounds without respawn (S&D), backfilled bots join at match start. A bot replacing a leaver mid-round waits for the next round, like a human would.
- **economy:**
  - Read `results.ext.bots.practice` (or call `roomHasBots(room)`) to pay nothing for wagers with bots.
  - Wager loadouts forced in `beforeSpawn` apply to bots too.
  - `registerBotModeStyle(id, { conserveAmmo, meleeHappy, rush })` tunes bots for new wager modes.
- **killstreaks:**
  - By default a bot presses `Buttons.STREAK` once when it earns a streak.
  - For smarter use (aiming the RC-XD, choosing the care package drop spot), set `registerBotStreakHandler((room, bot, id) => handled)`.
  - A UAV that returns true from `radarVisible` already makes bots investigate the enemies it reveals.
- **weapons:**
  - Bots knife by pressing `Buttons.MELEE` and throw lethals by pressing `Buttons.LETHAL` (only when `loadout.lethal` is set), so anything you hang on those button edges works for bots.
  - Projectile weapons work through `room.fire`. There is no arc compensation yet beyond grenade throws.
  - New weapon classes fall back to AR handling (`CLASS_STYLE` in brain.ts).
- **maps:** nothing is required. `hotspots` in `MapData` attract roaming. Keep spawns on reachable ground: unreachable cells are pruned from the spawns.
- **Tests:**
  - `tests/bots.unit.test.ts`: skill, aim, nav (Yard plus a stairs/ramp/crate fixture), loadouts.
  - `tests/bots.room.test.ts`: walking across the Yard, climbing stairs and a ramp, kills, accuracy by difficulty, hearing, backfill, replacement, retire at next death, matchmaking wait, Play with bots, custom and live skill, lobby phase, goals hook.
  - `tests/bots.integration.test.ts`: real sockets: playWithBots, roster, status push, host-only settings, bots moving, a kill.
  - Fixture map: `tests/bots-fixtures.ts`.

## Known limits / next steps

- **Pace.** 8 regular bots on the Yard trade kills fast: about 85 kills in 2 min, which reaches the TDM limit of 75 in under 2 min. Tune `aggression` defaults or the roam weights in `Brain.roamPoint` if matches feel too short.
- **Grenades** need the weapons area to implement `LETHAL`. **Killstreaks** need perks-streaks to handle `STREAK`.
- There is no arc compensation for crossbow or tomahawk projectiles.
- The nav grid is static per map. It needs a rebuild if maps gain destructible or openable geometry.
