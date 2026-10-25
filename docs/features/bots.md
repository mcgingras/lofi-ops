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
| `src/server/features/bots/aim.ts` | the aim controller and the noticing time, as pure functions |
| `src/server/features/bots/sight.ts` | what a bot can see and shoot through: collision plus the map's drawn geometry (occluders), and the body points it looks for |
| `src/server/features/bots/roles.ts` | roles, lanes, goal claims, chase limits and the team path-usage grid (pure) |
| `src/server/features/modes/spawns.ts` | spawn scoring (owner: modes) and `recentSpawns`, which bots read to stay off the enemy's spawn |
| `src/server/features/bots/skill.ts` | settings validation, per-bot variance, skill rating |
| `src/server/features/bots/loadout.ts` | bot classes picked from the current defs (primaries wear an MW2 camo about two times in three, from what a pretend headshot record growing with skill would have opened: `pickBotCamo`; about one bot in four or five carries a machine pistol, sometimes with its one attachment, Akimbo included, rolled from a generator seeded off the last draw so seeded callers' streams don't shift), and bot callsigns |
| `src/server/features/bots/hooks.ts` | `registerBotGoal`, `registerBotStreakHandler`, `registerBotModeStyle`, `registerBotStyle` (per-bot style for modes whose players play different roles: Infected) |
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
  - `reactionMs`: the reaction before the aim moves, drawn per engagement (×0.7–1.3: 230–430 ms for regular), plus the noticing time (below). Re-acquiring a target next to the last one halves it.
  - `aimErrorDeg`: the aim quality. It sets the start error (×0.3–0.65, plus 4–12 % of the swing, mostly along it: an over- or undershoot), how fast that error settles (tau 0.12–0.52 s), the residual sway (`0.1e + 0.025e²` degrees of smoothed noise), the spring damping (weaker = more overshoot), the tracking lag and how much of it is led.
  - `turnSpeedDeg`: the max angular velocity (never exceeded) and the spring's stiffness; acceleration is bounded too, so turns ease in.
  - `headshotBias`: chance (×0.6) to go for the head in an engagement; otherwise centre mass with a per-engagement offset across the torso.
  - `fovDeg`: the vision cone. Nothing outside it is seen; someone within 2.5 m is noticed from any side in about 0.35 s.
  - `hearingRange`: unsuppressed gunfire within this range; footsteps of someone running (25 %) or sprinting (40 % of it), unless they have Ninja (`silentFootsteps`); Ninja Pro (`hearingMultiplier`) widens it.
  - `strafe`: strafe frequency, crouch spam and the occasional hop.
  - `burstControl`: burst length at range, pause between bursts, and the share of the recoil kick it pulls down (×0.85).
  - `objectivePlay`: chance of following a mode goal, and of rolling the objective role.
  - `streakUse`: how likely and how soon it uses an earned streak.
  - `aggression`: chasing, flanking, how far forward it roams, sprinting, how long it holds an angle, retreating when hurt, and the role mix.
  - `weaponPickup`: how far a dry bot looks for a gun on the floor (`4 + 22 × weaponPickup` m; 0 = never). Read by the pickups feature (`src/server/features/pickups/bots.ts`, docs/features/pickups.md), which walks it there through a `registerBotGoal('*')` goal.
- No new knobs were needed, so the lobby sliders are unchanged. Preset reactions stay at recruit 900 ms, regular 550, hardened 320, veteran 180 (the agent's shorter values made regular bots kill a still target faster than before, against playtest feedback that bots were too deadly); the reaction now is only one part of the time to first shot.

### Aim controller (aim.ts)

The bot's view comes out of a controller a person's hand could produce; nothing snaps.

- **Reaction:** frozen for the drawn reaction after it notices a target.
- **Acquisition:** each axis is a damped spring toward the point it means to hit: natural frequency `7 + turnSpeedDeg/35` rad/s, damping `0.5–0.8` by aim quality (weaker bots overshoot and correct), angular velocity ≤ `turnSpeedDeg`, angular acceleration ≤ `turnSpeedDeg × (8–14)`. Pitch is 0.7× as stiff as yaw, so the path curves.
- **Start error:** offset from the target, decaying while it tracks (first shots miss more).
- **Tracking:** the target angle goes through a lagged estimate (50–150 ms) with a velocity estimate; the bot leads 50–90 % of its own lag, so strafers are trailed and reversals throw it off.
- **Sway:** two-octave value noise, scaled by the situation.
- **Situation multiplier** on error and sway: `(1 + d/150) × (1 + min(0.8, 0.05 × lateral m/s)) × (1 + 0.8 × moving × (1 − 0.6 × ADS)) × (1 + 0.6 × hip)`.
- **Recoil:** each shot kicks the view exactly like the client (`WeaponDef.recoil × 0.6 × (1 − 0.35 × ADS)`, random horizontal plus the weapon's steady `drift`, if any), recovering at the weapon's recovery speed (35 % while spraying). The bot pulls down `0.85 × burstControl` of it and doesn't notice the rest. Server spread applies as for players.
- **Flinch:** being hit knocks the view ~2.5° (× `flinchMultiplier`, so Hardened Pro halves it) and adds re-acquisition error.
- **Firing:** it fires when its view (minus the recoil it ignores) is within a body-width tolerance of the point it *means* to hit. It can't see its own error, so accuracy follows skill. It also needs a line of fire (see Walls below): it sees the target this tick, and a bullet from its eye would reach that point.
- **Looking around** (walking, noises, grenades) uses the same spring with relaxed limits.

### Perception

- **Seeing:** enemies inside the FOV with line of sight (chest, or their eyes over cover) build up a noticing meter. The time to notice is `(0.04 + 0.22 × reaction) × (1 + d/40) × (1 + 1.5 × (off/halfFov)²)`, halved for someone firing and ×0.35 for someone who just hurt it. Out of sight, the meter drains at 1.5 per second.
- **Line of sight** (`sight.ts`) is collision's `sight` mask *and* the map's drawn geometry: a bot can't see through anything that is drawn opaque, even where collision lets sight through (see Walls).
- **Keeping a target:** checked every tick. While the target is in view, the bot aims at it where it is. On the first tick it isn't, the bot stops firing and holds its aim on the last point it saw. After `LOST_GRACE` (0.25 s) it lets the target go and falls back to the last-seen position (look, chase, flank or hold). A target seen again within the grace is followed without a new reaction; after that, noticing it again costs the noticing time and a full reaction.
- **Being shot from outside the FOV:** like a player's damage indicator, it knows the direction and turns that way (with the controller), but still has to see the shooter.
- **Hearing and radar** only turn it or send it somewhere. Neither lets it engage or fire.

### Walls: seeing and shooting through cover

Playtest report: "I keep dying through walls from the bots. They shouldn't be able to see me, then instantly snap on and kill me through a wall." Each way this could happen, and what holds now (`tests/bots.walls.test.ts`):

1. **Drawn cover with no collision for sight or bullets.** Many props are drawn opaque but collide less than they look, or not at all:
   - render-only boxes: Rust's tanker, truck and pickup, Terminal's counter panel, Firing Range's sheds and truck, Nuketown's crates;
   - boxes drawn turned over smaller, unturned collision (the corners poke out);
   - couches and mannequins that stop bullets but not the `sight` channel;
   - bushes.

   A bot that trusted collision saw straight through them, and its bullets went through the render-only ones. Fix: `sight.ts` builds, per map, every drawn box (and non-colliding cylinder) that collision doesn't already cover for sight, as the turned box the renderer draws.
   - See-through materials (glass, fences, lattices, railings, nets, alpha cut-out cards) are skipped.
   - Foliage hides you but doesn't stop bullets. Other occluders at least 20 cm thick count as bullet-proof.
   - A segment that starts inside an occluder isn't blocked by it (from inside a bush you can see out).
   - The bot sees a point only if collision's `sight` mask and the occluders both leave the line clear.
2. **Firing without a line of fire.** The bot used to fire whenever its view was on the target. It checked only sight, and not even that on perception ticks. Behind bullet-proof glass (sight passes, bullets don't) or a couch, it emptied magazines into the cover. Now it fires only when both hold:
   - it sees the target this tick;
   - a bullet from its eye would reach the aim point (collision's `bullets` mask plus the bullet-stopping occluders).

   Each shot is also traced first (`combat.traceShot`, with the same spread seed that `room.fire` then uses). The shot is held if any pellet would hit someone through drawn bullet-proof geometry. There is no suppressive fire at a last-known position.
3. **Penetration.** Human shots go through thin walls (docs/CONTRACTS.md section 13, `shared/penetration.ts`); a bot's never do. Its bullets stop on anything with `bullets` collision, whatever the weapon, so it can't hurt anyone through a wall: its line of fire checks (`botCanHit`, and the traced shot) are unchanged and ignore penetration, and a player behind a thin wooden wall is neither seen nor shot at, though that player's own shots come through (`tests/penetration.test.ts`). Only brushes marked `bullets: false` let a bot's bullets through, at full damage:
   - thin plank and board walls (Estate's boathouse, Afghan's shack, Firing Range's ply boards);
   - fences and foliage;
   - Hanoi's wooden rails.

   No thick wall, concrete, rock or plain map brush is marked that way. A bot doesn't shoot at what it can't see behind them either.
4. **Target memory.** The bot used to aim at the target's live position behind a wall, and record it as last seen, for up to 50 ms (until the next perception tick). Now see "Keeping a target" above: it stops firing on the first tick the target is out of view and aims at the last point it saw.
5. **Server timing.** Bot shots (`room.fire` with no `time`) used to be checked against the lag-compensation history's newest frame, which is the previous tick. That is up to 17 ms behind, so you could be hit where you had just been. A shot at the present now uses live positions. Human shots still rewind to the shooter's view time.
6. **Re-acquiring after hiding.** Out of sight the noticing meter drains at 1.5 per second. A dropped target needs the noticing time again plus a full reaction (0.7-1.3 × `reactionMs`). If you were hidden for more than a second, the first shot after you peek again takes at least that. In the sim below the fastest was 0.23 s for veterans and 0.62 s for regulars. Only a target lost for less than `LOST_GRACE` is followed straight away, as a person holding the angle would.
7. **Head over cover.** The "head over cover" sight check used the centre of the head, 2 cm above a standing player's eye and 8 cm above a crouched one's. A bot could see you over a wall you couldn't see over. It now uses your eyes, so it sees you over cover exactly when you could see it, and in that case it aims at your eyes.

**Peek sim** (`npx tsx scripts/bots-walls.ts`, `tests/bots-walls.ts`): a bot against a scripted player who hides behind cover and peeks out 1-2.5 m, over and over, 40 s per spot. Spots:
- the six covers of the synthetic cover box;
- 6 wall spots on each of Nuketown, Rust, Terminal, Firing Range and Estate;
- 3-4 drawn-cover spots on each of those maps.

Shares of the player's deaths to bot bullets, and bot shots:

| | before | after |
|---|---|---|
| killing ray crossed bullet-stopping collision | 0 % everywhere | 0 % |
| player fully behind collision on the server when hit | 0 % | 0 % |
| killing ray crossed drawn bullet-stopping geometry (drawn-cover spots) | Rust 77-78 %, Terminal 52-78 %, Firing Range 46-54 %, Estate 24-36 %, Nuketown 7-16 % | 0 % |
| killing ray crossed drawn bullet-stopping geometry (elsewhere) | cover box 38-48 %, wall spots 0-14 % | 0 % |
| bot shots at a player fully hidden from bullets | 107-119 per 240 s on the cover box (the glass and the couch), 7-12 at Nuketown's couches | 0 |
| fastest first shot after a peek, after more than 1 s hidden | 0.02 s (it had seen through drawn cover all along) | regular 0.62 s, veteran 0.23 s |

**Latency.**
- **On the server**, a bullet can hit your trailing shoulder while your camera (at the centre of your body, 0.3 m from its edge) is already behind the corner.
- **On your screen** you are further behind cover still. Your client predicts you ahead of the server by about RTT + 17 ms: the round trip, plus input batching (half a 60 Hz slot on average), plus the wait for the next server tick (half a tick on average).
- **From Colorado to Fly's dfw** (RTT 30-40 ms) that is about 52 ms: 0.26 m walking, 0.37 m sprinting, 0.14 m crouched.

In the sim, the player ducks back the instant it is hit. Share of deaths where the player couldn't see the bot when the kill reached their screen:

| RTT | after the fixes | before |
|---|---|---|
| 35 ms | 2.4 % (also 2.4 % when the bullet hit, so latency adds about nothing) | 30.3 % (25.8 % when the bullet hit, mostly drawn cover) |
| 80 ms | 4.9 % | |
| 150 ms | 9.8 % | |

Nothing in the server adds avoidable delay. Inputs are applied on the next tick, `hurt` and `died` go out at once (ws sockets are no-delay), and bot shots no longer lag a tick. Two client presentation effects remain (see Known limits):
- remote players are drawn `INTERP_DELAY_MS` (100 ms) in the past while damage arrives at once, so a bot's turn toward you shows about 100 ms after its bullets land;
- remote shots (tracers, sound) ride the 20 Hz snapshots, up to 50 ms after the damage.

### Spawns (owner: modes, `features/modes/spawns.ts`)

- **Hard filters:** an enemy within 12 m (including 1.5 s of their movement) costs −150, and an enemy who can see the point (within 60 m) costs −100. A point that fails either is never picked while a clean one exists.
- **Danger:**
  - enemies within 40 m looking toward the point (±40°): up to −18;
  - enemies who would see the spawner's first 3.5 m out: −30;
  - deaths within 10 m in the last 8 s: up to −20 each.
- **Distance:** + nearest enemy (capped at 45 m) × 0.8, or × 1.2 in FFA.
- **Teammates:** +6 if one is 4–20 m away. Never on top of anyone.
- **Mode preference:**
  - TDM: −0.3 × the distance from the team's recent spawns (its side), and +0.3 × the distance from the enemies' centre. When the enemy pushes into a side, that side fails the filters, so the team spawns across the map (a flip), and the side follows.
  - DOM: near owned flags.
  - HQ: 12–22 m from the HQ.
  - S&D: fixed role spawns.
- **No spawn protection:** BO1 had none, and a no-damage window lets someone win a fight they lost. Good selection is the fix.

### Roles and spreading (roles.ts)

- **Per life, a role:**
  - `lane`: the weight is 1.
  - `flanker`: 0.25 + 0.6 × aggression. Takes an outer lane and pushes deep.
  - `hunter`: 0.3 + 0.6 × aggression. Goes to fights, noises and radar contacts.
  - `objective`: objective modes only, 0.4 + 1.4 × objectivePlay. Objective intent +0.35.
  - `camper`: 0.04 + 0.12 × (1 − aggression). Holds a hotspot for 8–22 s, but for at most 2 s anywhere that overlooks the enemy's recent spawns.
- **Lanes:** three bands across the spawn-to-spawn axis. A bot takes the lane fewest teammates hold, or (30 %) joins a lane with exactly one teammate to make a pair; never a third.
- **Spreading:**
  - Roam goals score lower near teammates' claimed goals.
  - A* adds up to +105 % cost on 4 m tiles teammates' paths cross (`PathUsage`).
  - When two teammates already chase or investigate a spot, the rest flank or hold.
- **Spawn camping:** roam points within 18 m of the enemy's recent spawns score −8 each.
- **Habits:**
  - Within 16 m of a recent enemy fight or a noise, it walks (no sprint), ADS, and checks that way.
  - It retreats to cover when low on health unless the enemy is in its face.
  - It reloads behind cover when dry.
- **Objectives:**
  - Goals with priority ≥ 0.85 are always taken: plant with the bomb, defuse, a dropped bomb, a threatened flag, an enemy tag within ~13 m.
  - KC enemy tags are worth `0.98 − d/100` (within 50 m). Own tags (deny) are worth `0.4 − d/40`, and only within 12 m.

- **Measured** (`npx tsx scripts/bots-metrics.ts`): an AK-47 duel on a flat range against a target that doesn't shoot back, 40 trials. Times are from first sighting.

| difficulty | 10 m still: first shot / TTK | 25 m strafing: first shot / TTK / killed < 0.6 s | hit % in the first 0.5 s (25 m still) |
|---|---|---|---|
| recruit | 1.05 s / 1.48 s | 1.24 s / 2.13 s / 0 % | 16 % |
| regular | 0.69 s / 0.92 s | 0.68 s / 1.63 s / 0 % | 40 % |
| hardened | 0.54 s / 0.70 s | 0.58 s / 1.27 s / 0 % | 53 % |
| veteran | 0.44 s / 0.63 s | 0.41 s / 1.10 s / 15 % | 54 % |

### Navigation (nav.ts)

- **Cells.** The grid has 0.5 m columns. Each column gets one cell per surface a body fits on: the highest top under the footprint, with standing room above. This handles stair treads narrower than the footprint, ramps (via `topAt`), container tops and so on.
- **Links.** Each cell links to its 8 neighbours:
  - `walk`: up to the step height, with no corner cutting on diagonals.
  - `jump`: up to about 0.98 m, with headroom.
  - `drop`: up to 4.5 m, one way, only where the whole fall is clear (no drops through an upper floor).
- **Reachable set.** Cells that can be reached from the spawns and can get back to them are marked `core`; roaming only picks core cells.
- **Doors.** Doorways are just gaps a body fits through. There are no openable doors yet; if a map adds them as brushes, a rebuild hook would be needed (`navFor` caches per `MapData`).
- **Cost.** On the Yard the grid has 13k cells, builds in about 120 ms once per map (shared by every room), and a cross-map A* takes about 0.4 ms.
- **Search budget:**
  - A* uses a 1.3× weighted heuristic, so paths are a few percent longer but searches expand far fewer cells. The limit is 60k cells (long detours like Afghan's fit).
  - A goal cell that failed isn't searched again for the next 400 searches.
  - Each room runs at most 3 searches and 24k expanded cells per tick. Further goals wait (`pathPending`) for a later tick.
- **Following a path.** Bots string-pull (walk straight to the farthest cell they can reach in a line), advance along the path monotonically, jump at jump links, and get unstuck by jumping first and then re-planning.

### Brain behaviour (brain.ts)

- **Perception at 20 Hz**, staggered between bots (the current target is checked every tick): see Perception above. It hears gunfire and footsteps. It knows about enemies the radar shows it (`radarVisible` modifier returning true, which is the UAV hook); a radar contact is a place to go, never something to shoot at.
- **Fighting:**
  - The aim model above.
  - Holding a Mystery Box wonder weapon, it fights by that weapon's rules (`src/server/features/weapons/wonder/bots.ts`, `wonderBotStyle` / `wonderBotDecision`): its preferred range and ADS distance replace the class style; the Thundergun holds fire outside its blast (11 m) and swaps to the other gun past 16 m, Winter's Howl outside 18 m and past 24 m (and back up close); the Scavenger hangs back scoped and swaps away inside 8 m; the Baby Gun fires inside 28 m; the Wave Gun zaps up close and aims (the Wave Gun shot) past 20 m; the Ray Gun's and Scavenger's bolts lead a moving target for it. A shrunk enemy (Baby Gun) is aimed at low, at its tiny body. Frozen solid by Winter's Howl, or swelling under the Wave Gun, a bot stands with its aim held and never fires (`botFrozen` from the weapons feature); partial frost slows its reactions and turning and shakes its aim (`botSkillMultiplier` / `botSkillOffset`).
  - Bursts for auto and burst weapons; paced shots for semi, bolt and pump.
  - ADS by range, depending on weapon class.
  - Holds its class's preferred range (closer for aggressive bots).
  - Strafes and crouch-spams, and won't strafe off ledges.
  - Switches to the sidearm when dry up close (under 12 m, or anywhere with no spare rounds), or reloads. Holding a machine pistol it goes back to the primary (and reloads it there) once the target is past `MP_BACK_TO_PRIMARY` (16 m), and it fights with one from the hip, pushing in (`CLASS_STYLE.machinepistol`: 6 m, never ADS).
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
  - `registerBotStyle(modeId, (room, bot) => Partial<BotModeStyle> | null)` overrides it per bot (the brain reads `botStyleFor(room, bot)`). Two optional flags: `kite` (in a fight never close in, back away from anyone inside 4 m) and `throwAtRange` (lob the lethal at a target in sight 6-18 m away, on half the chances, every 5-8 s, the arc scattered by `aimErrorDeg`). A melee-happy bot with nothing to shoot goes in instead of backing off to cover. Infected uses all of it (docs/features/modes.md).
  - Modes with `ModeDef.teamsByRules` (Infected) own their teams: the roster never re-teams or balances bots there.
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
  - `tests/bots.unit.test.ts`: skill, nav (Yard plus a stairs/ramp/crate fixture), loadouts.
  - `tests/bots.aim.test.ts`: the aim controller. It covers the reaction draw and frozen hand, max angular velocity and ease-in, flick times, bounded overshoot and correction, sway, trailing a strafer, flinch, recoil, looking around, and the noticing time and FOV gate.
  - `tests/spawns.test.ts`: spawn scoring. It never picks a point in enemy view when a hidden one exists, rules out points near enemies and with recent deaths, and spawns FFA players far from everyone.
  - `tests/bots.roles.test.ts`: the role mix, lane spreading and pairs, lanes on a real map, claims and chase limits, and path usage rerouting A*.
  - `tests/bots.sim.test.ts` (with `tests/bots-sim.ts`): seeded sims with metric thresholds. Regular bots kill a 25 m strafer in under 0.6 s ≤ 10 % of the time. On Nuketown TDM, spawn deaths are < 8 % and packs of 3+ < 20 %. KC confirms ≥ denies.
  - `tests/bots.room.test.ts`: walking across the Yard, climbing stairs and a ramp, kills, accuracy by difficulty, hearing, backfill, replacement, retire at next death, matchmaking wait, Play with bots, custom and live skill, lobby phase, goals hook.
  - `tests/bots.integration.test.ts`: real sockets: playWithBots, roster, status push, host-only settings, bots moving, a kill.
  - `tests/bots.walls.test.ts` (with `tests/bots-walls.ts`): walls.
    - Covers: the synthetic cover box (concrete, render-only wall, bullet-proof glass, thin planks, a couch, a turned crate), and seeded cover spots on Nuketown, Rust, Terminal, Firing Range and Estate (behind collision, and behind drawn geometry only).
    - The bot never notices, fires at or hurts a player behind cover, standing, crouched or firing (it hears and turns). Behind glass it sees but holds fire.
    - No bot weapon gets a bullet through bullet-stopping cover; human shots don't get through the glass or the concrete either; thin planks let them through.
    - Also: target memory, the grace, bot shots at live positions (human shots still rewind), the reaction after more than 1 s hidden, and radar steering without firing.
    - The peek sim: 0 deaths through collision or drawn cover, 0 shots at a hidden player, and no first shot within 0.7 × the veteran reaction after more than 1 s hidden.
  - Fixture map: `tests/bots-fixtures.ts`.

## Known limits / next steps

- **Small-map FFA.** 8 players on Rust or Nuketown leave no safe spawn 40–60 % of the time (an enemy within 12 m or in sight everywhere), so 10–19 % of spawns still die within 3 s. Fewer FFA players on the small maps (6) would fix it more than scoring can.
- **S&D plants.** Planting rose from 1 per 17 rounds to 6 per 15, but Highrise still sees none: rounds end by elimination before the carrier reaches a site. Carriers could wait for escorts or take the less contested site.
- **Pace** is unchanged: about 100 kills per 3 min in 12-bot TDM on small maps.
- There is no arc compensation for crossbow or tomahawk projectiles.
- **Map data (owner: maps).** Drawn props without bullet collision still let *human* bullets through what looks solid. Bots now neither see nor shoot through them. Examples:
  - Rust's tanker (brushes 439 and 440), truck (438) and pickup (447);
  - Terminal's counter panel (208) and several aluminium props (459-463);
  - Firing Range's corrugated sheds (221, 222) and truck (3501);
  - Nuketown's crates (153, 423), and its couches and mannequins (bullets stop, sight passes);
  - Estate's trim and plaster pieces.

  `occludersFor(map).list` in `sight.ts` (`stops: true`) lists them per map. Giving them `bullets` (and `sight`) collision would fix it for everyone. The bake's shadow rays use the `sight` mask, so adding sight collision also changes their shadows.
- **Second Chance bleed-out** (perks): a downed player who crawls behind cover and bleeds out is killed by `room.kill(p, killer, { means: ls.means })`. The kill is credited to the bot, with its weapon icon and `means: 'bullet'`, so it reads as a kill through a wall. A distinct means (for example `'bleedout'`) would make that clear.
- **Client presentation** (core netcode): a bot's turn is drawn 100 ms late (`INTERP_DELAY_MS`) while its damage is immediate, and remote tracers and gunshots wait for the next 20 Hz snapshot. Two changes would make a bot's snap look like what it is: draw remote shots at the interpolation time (or send them with `hurt`), and shorten the interpolation delay (30 Hz snapshots, about 70 ms).
- The nav grid is static per map. It needs a rebuild if maps gain destructible or openable geometry.
