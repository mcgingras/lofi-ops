# Frontend: menus, lobbies, create-a-class

Owner: frontend. Lobbies can always run: if not enough humans join, empty slots fill with bots, and the bot skill can be tuned per lobby.

## What's built

**Main menu** (`menu` screen, replaces the core one). This is a CoD-style left nav:
- **Multiplayer**
  - **Quick Play** playlists: TDM, FFA, Domination, S&D, Headquarters, Kill Confirmed. A playlist whose mode isn't registered yet shows "Coming soon". Each row shows how many people are playing.
  - **Wager Matches** opens the `wager` screen.
  - **Play with Bots** opens a private lobby with bots on.
  - **Private Match**.
  - **Join a party**: type a lobby code or paste an invite link.
- **Create a Class**.
- **Barracks** opens the `barracks` screen.
- **Store** opens the `store` screen.
- Feature `registerMenuItem` entries (any id not starting with `core.`), except the ones this menu already covers: `modes.*` (Quick Play playlists, which would bypass matchmaking), `bots.play`, `economy.wager`, `economy.store` and `progression.barracks`.
- **Settings**.

If a screen owned by another area (`barracks`, `store`, `wager`) isn't registered yet, a placeholder screen (`frontend.soon`) shows instead.

**Per-game lobby** (`lobby` screen, shown as an overlay over the match screen while the room is in its `lobby` phase, so the map loads behind it):
- Player list: emblem slot, level, name, Host and Ready tags, ping, and team colour. Grey "Bot (joins at start)" rows show how many bots will fill.
- Mode and map, the lobby code and a **Copy invite link** button (`#/lobby?code=XXXXXX`).
- Status line, for example "Waiting for players... starting with bots in 12s" (from `MATCHMAKING_WAIT_SEC`) or "Match starting in 5s".
- **Matchmade lobbies:**
  - Map vote: two maps plus Random. The most votes wins; a tie goes to the earliest option.
  - Ready button. When every human is ready, the wait shortens to a 5 s countdown.
  - A full lobby (humans reach the target) starts a 10 s countdown.
- **Private lobbies:**
  - The host controls mode, map, score limit, time limit and bot settings, then presses **Start**.
  - Everyone else sees the same controls read-only.
  - The creator becomes host. When the host leaves, host passes to the next human by join order.
- **Bot settings editor** for `LobbyBotSettings`:
  - fill toggle and target players
  - difficulty presets: Recruit, Regular, Hardened, Veteran, Custom
  - a slider for every `BotSkill` knob, using `BOT_SKILL_RANGES`. Moving any knob switches to Custom, starting from the preset you were on.
  - variance, and an overall skill bar.
- Class select and Leave.

**Create a Class** (`create-a-class` screen):
- Classes: progression's `usableClassCount` (the 3 default classes plus one slot each at levels 4, 10, 20, 30, 40 and prestige 2, 4, 6, 8, 10), the same count the spawn honours. Editing needs Create-a-Class (level 4); before that the screen is read-only and `frontend.saveLoadout` returns `locked`. You can add new classes and rename them, and **Equip** one for the next spawn (`frontend.selectClass` refuses classes the spawn would not use).
- Primary and attachments. You get one attachment, or two with Warlord or any perk def with `attachmentSlots`. Only one attachment per attachment slot type.
- Camo per weapon (economy's `CAMOS`), secondary with one attachment, lethal, tactical, one perk per tier, and three killstreaks sorted by kill count.
- Locked items are greyed out and show what unlocks them ("Level 12", "30 kills with FAMAS (4/30), then 1,000 CP in the Store", "Store: 500 CP"...). Weapons, attachments and camos the store sells must be bought (economy's `canUse`), because the economy's spawn check would otherwise swap them out.
- Live 3D turntable of the weapon. It uses the real viewmodel builder, attachments and camo, look materials, and a low-res render upscaled with nearest filtering. Drag it to spin.
- Stat bars: damage, range, fire rate, accuracy, mobility. Hovering a weapon, attachment or camo shows the change in green or red.
- Every edit is validated locally with the server's rules and then saved.

**In-match class picker** (`class-picker` overlay): press **B** (rebindable) at any time in a match. On the death screen a HUD hint (`frontend.classHint`) shows the key and the class picked for the next spawn.

**Settings** (`settings` screen, replaces the core one), in four tabs:
- **Graphics** (tab id `video`): Retro strength preset with an Advanced panel (resolution, palette, dither, vertex snap, texture warp, fog distance, texture filter, photo/drawn textures; see `retro.md`), FOV, grade, time of day, FPS.
- **Controls**: sensitivity, ADS sensitivity, invert, crouch toggle.
- **Key bindings**: rebind every action and the class key. Backspace resets one, and there is a Reset all.
- **Audio**: master volume and a test sound.

## Server (`src/server/features/frontend/`)

- `manager.ts`, `LobbyManager`: lobbies on top of core `lobby.ts`. Lobby rooms are created with `{ autoStart: false, onEnd: 'lobby', countdownSec: 5 }`. The manager keeps:
  - codes
  - host
  - ready flags
  - the vote
  - limits
  - bot settings
  - wait and countdown timers. These run in room time on a `room.every(0.25)` timer.
- **Matchmaking:**
  - It picks the fullest open matchmade lobby for the playlist, preferring ones still in the lobby phase. If none has room, it creates one.
  - Lobbies already in a match can be picked too (join in progress: core swaps a bot out).
  - A ticket reserves the slot for 10 s, so two people don't get the last place.
- **Starting a match:**
  1. Resolve the vote.
  2. Apply the limits: `room.mode` becomes a copy of the ModeDef with the lobby's limits, and `joined` is re-sent.
  3. Hand the bots over (see below).
  4. Call `room.startMatch()`.
- **After the results:** the room returns to `lobby`, bots are removed, and a new vote and wait begin.
- `loadouts.ts`: `frontend.saveLoadout` validates and saves, and `frontend.selectClass` picks the class for the next spawn. A `beforeSpawn` handler (priority 100) caps attachments, keeps one perk per tier and sorts streaks, whatever path the loadout came from.
- Shared rules: `src/shared/frontend/`:
  - `lobby.ts`: codes, vote, bot settings validation, limits, status line.
  - `loadout-rules.ts`: unlocks, validation, stat bars.
  - `playlists.ts`
  - `equipment.ts`
  - `protocol.ts`: RPC and push types.

RPCs (types in `shared/frontend/protocol.ts`):

| RPC | What it does |
|---|---|
| `frontend.playlists` | Playlists with player counts |
| `frontend.matchmake {playlist}` | Returns `{roomId, code}` |
| `frontend.createPrivate {mode?, map?, bots?}` | Returns `{roomId, code}` |
| `frontend.resolveCode {code}` | Accepts a code or an invite URL; returns `{roomId, code}` |
| `frontend.state` | The caller's current lobby state |
| `frontend.vote {option}` | Map vote |
| `frontend.ready {ready}` | Ready flag |
| `frontend.configure {mode?, map?, limits?, bots?}` | Host only |
| `frontend.start` | Host only |
| `frontend.ping {rtt}` | The client reports its own round trip (the server has no RTT of its own) |
| `frontend.saveLoadout {index, loadout}` | Validates and saves a class |
| `frontend.selectClass {index}` | Picks the class for the next spawn |

Push: `frontend.lobby` (the full `LobbyState`) goes to every human in the room on every change, and every 2 s in the lobby phase (for pings).

The client joins a lobby by getting a ticket and then calling `navigate('match', { room: roomId })`. The core match screen joins the room, and `lobby-client.ts` opens and closes the lobby overlay as the phase changes.

## Integration notes

**bots**:
- At match start the frontend sets `room.options.botFill = settings.fill ? targetPlayers : 0` and calls `room.fillBots()`. Core then backfills with teams balanced, removes a bot when a human joins (on `addHuman`) and adds one when a human leaves. Treat `botFill` as the count; don't add bots on top (core trims extras).
- The frontend hands the settings over in three ways. Use whichever suits:
  1. Room event `frontend.botSettings { settings, skill, starting, host }`, declared in `manager.ts`. It fires on every host change and at start, with `starting: true` just before the bots are added.
  2. A call to your `bots.setSettings` RPC through `api.rpc.dispatch` (as the host's session, with `ctx.room`), when you registered it. The data is a plain `LobbyBotSettings`. The frontend does **not** declare `bots.*` in `RpcMap`, so your declaration won't conflict.
  3. `getLobbyBotSettings(room)`, exported from `src/server/features/frontend/index.ts`.
- If you'd rather replace bots "at their next death" than have core swap them immediately, keep `botFill` as the count and do the swap in your feature. Apply `settings.variance` per bot.
- Bots in the `lobby` phase: the frontend removes all bots when a room returns to the lobby.

**progression**:
- The lobby emblem slot shows `profile.ext.progression.emblem` (a string) if set, otherwise `prestige_<n>`.
- The unlock rule is permissive for perks, killstreaks and equipment: unlocked if the id is in `profile.unlocks` or `profile.owned`, or the def's level is met. Weapons, attachments and camos that the store sells follow the economy (`canUse`: starter, or bought and its gate met), so Create-a-Class never offers something the spawn would replace.
- A `barracks` screen id is expected.

**economy**:
- Priced camos need to be in `profile.owned`.
- `wager` and `store` screen ids are expected.
- Wager modes are hidden from the private lobby mode list.

**perks**:
- Warlord is recognised by id `warlord`, or by any PerkDef with `attachmentSlots: number`. The total is capped at 2, matching core `sanitizeLoadout`.

**weapons/perks**:
- `src/shared/frontend/equipment.ts` builds the lethal and tactical list the menu offers from the weapons area's `src/shared/defs/equipment.ts` (frag, semtex, flashbang, concussion), so new throwables added there show up in create-a-class automatically.

**modes**:
- Playlists `dom`, `sd`, `hq` and `kc` light up automatically once those ids are in `MODE_BY_ID`.
- Maps come from `mapsForMode(mode)`, falling back to `yard`.
- Custom score and time limits work by replacing `room.mode` with a copy of the def, so rules must read `room.mode.scoreLimit` (as core TDM and FFA do), not `MODE_BY_ID`.

**Key bindings**:
- Stored in `settings.ext.frontend.binds` (action to `KeyboardEvent.code`) and applied to core `KEYMAP`.

## Core files touched

- `src/client/main.ts` and new `src/client/features.ts`: this fixes the feature load order. Vite hoists `import.meta.glob(..., { eager: true })` imports to the top of the importing file, so feature folders were evaluated *before* the core screens, and core's `menu` and `settings` won over feature replacements, against CONTRACTS section 12. The glob now lives in `features.ts`, imported after the core screens.
- `docs/CONTRACTS.md`: one line noting the above.

## Tests

- `tests/frontend-rules.test.ts`:
  - codes and invite-URL parsing
  - vote options and tally
  - bot settings validation and custom skill clamping
  - limits and playlists
  - loadout unlocks and validation, with an injected catalog (Warlord, tiers, locked items, killstreak order) and stat bars
- `tests/frontend-lobby.test.ts`, driving `LobbyManager` directly:
  - matchmaking, reservations
  - the 20 s wait then backfill to 12 with balanced teams
  - ready shortcut, join in progress / leave replacement
  - return to lobby
  - map vote, private host, codes, host migration
  - configure (mode, limits, custom bots), with the hand-off to `bots.setSettings` and the room event
  - fill off
  - codes forgotten on close
- `tests/frontend.integration.test.ts`, through the real server and sockets:
  - private lobby via invite URL, host-only configure, start with tuned bots and new limits in `joined`
  - quick play wait, then bots plus a vote
  - create-a-class save, validation and select

The lobby, bot tuning, start, matchmade backfill, class picker, create-a-class saving, key rebinding and invite link were also checked in a real browser with `?devlook=1`.
