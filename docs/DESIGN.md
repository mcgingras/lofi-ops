# Lo-Fi Ops: design

A browser multiplayer FPS that recreates the best of Black Ops 1 / MW2-era Call of Duty, rendered in a photo-textured low-poly style. Private hobby project (working title).

This document is the contract every contributor (human or agent) builds against. If you need to change a contract, update this file in the same change and say so in your report.

## 1. Pillars

1. **Feels like 2010 CoD.** Fast time-to-kill, snappy ADS, hitscan, killstreaks, perks, create-a-class, prestige grind, wager matches.
2. **Looks like the reference prototypes.** See `reference/yard-lab.html` (the look we approved) and `reference/turntable.html` (the texture "developer"). Photo textures (Poly Haven, CC0, in `assets/textures/`) reduced to a 16-colour adaptive palette in YCoCg with a 4×4 crosshatch pattern dither at 75%, baked into the texture. Unlit-ish shading with baked vertex lighting, closest-pixel sampling with nearest-mipmap for distance, no anti-aliasing, 360p internal render upscaled with nearest. Pixel HUD drawn at render resolution (Silkscreen font). The PS1 look (vertex snap, affine warp, screen dither) stays available as a settings toggle.
3. **Server-authoritative netcode** modelled on Potrock's Call of Blocky (MIT, reference checkout at `REF_BLOCKYARD`, see §9): client prediction + reconciliation for the local player, interpolation for others, lag-compensated hitscan.
4. **Bots everywhere.** Every mode is playable solo with bots; lobbies backfill with bots.

## 2. Stack

- Node 24, TypeScript (strict), single npm package.
- Client: Vite, three.js `0.170.x` (npm). No UI framework; DOM + canvas, small helpers.
- Server: Node `http` + `ws`. Run with `tsx` in dev.
- Persistence: `node:sqlite` (built in, no native deps). One file `data/lofi.db`.
- Tests: `vitest`. Headless integration tests spin up the real server in-process and connect fake clients.
- Scripts: `npm run dev` (server + vite together), `npm run build`, `npm run typecheck`, `npm test`, `npm start` (serve built client + server on one port).
- New dependencies: allowed only if small and pure JS; list any you add in your report.

## 3. Layout and ownership

```
src/shared/            pure TS, no DOM, no Node APIs; imported by both sides
  constants.ts         tick rates, physics constants, team ids
  protocol.ts          every client<->server message + codec
  movement.ts          deterministic player movement (prediction uses the same code)
  collision.ts         brush world, AABB sweeps, raycasts, hitboxes
  events.ts            typed server-side event names + payloads (see §6)
  defs/                data definitions + registries (see §7)
    weapons.ts attachments.ts perks.ts killstreaks.ts modes.ts maps.ts
    progression.ts challenges.ts camos.ts economy.ts
  maps/<id>.ts         one file per map (brush data + spawns + lights + props)
src/server/
  index.ts             http + ws entry, static files in prod
  lobby.ts             playlists, matchmaking, per-game lobbies, map vote
  room.ts              one match instance: tick loop, players, snapshots
  sim.ts               authoritative simulation step
  lagcomp.ts           hitbox history + rewind
  combat.ts            firing, damage, death, respawn
  modes/<id>.ts        mode rules (TDM, FFA, DOM, S&D, wagers...)
  features/<area>/     perks, killstreaks, progression, challenges, economy, bots
  store.ts             sqlite profile store
src/client/
  main.ts              boot, routing between menus and match
  net.ts               socket, prediction, reconciliation, interpolation
  render/              renderer, look pipeline, texture developer, baked lighting, map builder
  game/                local player, viewmodel, effects, audio
  hud/                 pixel HUD (canvas at render res)
  menus/               main menu, lobby, create-a-class, barracks, store, settings
  features/<area>/     client side of each feature
assets/textures/       Poly Haven photos (512px JPG)
reference/             approved prototypes, read-only
docs/                  this file, CONTRACTS.md (written by core), per-feature notes
tests/                 vitest unit + headless integration
```

Feature areas own their folders (`src/*/features/<area>/`, their defs file, their maps, their tests). Shared core files (`protocol.ts`, `events.ts`, `room.ts`, `main.ts`) are touched only through the extension points in §6–§7. If a feature truly needs a core change, keep it minimal and call it out.

## 4. Simulation and netcode

- Server sim tick: **60 Hz**. Snapshot send rate: **20 Hz** (delta against last acked snapshot when practical; full snapshots acceptable at first).
- Client sends input commands at frame rate, batched ≤60 Hz: `{seq, dt, buttons, yaw, pitch, weaponSlot}`. Server applies inputs in order with the same `movement.ts`.
- Local player: predict with `movement.ts`, keep unacked inputs, reconcile on snapshot (snap if error > 0.5 m, otherwise smooth).
- Remote players: interpolate 100 ms behind.
- Hitscan: client sends `fire {seq, time, origin, dir}`; server rewinds hitboxes to the shooter's view time (clamped to 250 ms), raycasts world first then hitboxes (head ×multiplier, torso, limbs), applies damage with range falloff.
- Movement feel (BO1-ish): walk 5.0 m/s, sprint 7.2 m/s (sprint blocks firing, sprint-out delay), ADS move ×0.6, crouch, prone optional, jump 1.1 m, step height 0.45 m, no air control beyond 30 %, slide not required. Eye height 1.6 m standing.
- Player hitbox: capsule-ish AABB 0.6 × 1.8 m for movement; separate head/torso/legs boxes for hits.

## 5. Worlds and the look

- Maps are **brush lists** (axis-aligned boxes, optional yaw for props that don't collide precisely, ramps for stairs) plus props, spawns, objective points and lights. Same data drives collision (server + client) and rendering.
- Renderer: brushes → meshes with world-scaled UVs (see `worldUV` in the yard prototype), baked per-vertex lighting from map lights + sun/moon + AO with shadow rays (port `bakeAt` from the yard prototype), fog, sky dome.
- Textures go through the "developer" (`quantize16`, `photoify`, `fromPhoto` recipes in the yard prototype) at load time; cache results in IndexedDB keyed by texture+recipe hash.
- Dynamic objects (players, viewmodel) use a per-object light sampled from the bake at their position.
- Blender glTF props can be added later; keep the map format open to `{ kind: 'gltf', url }` props.

## 6. Server extension points (events)

Core emits typed events on a per-room bus; features subscribe in their `register(room)` function. Minimum set:

`playerJoin, playerLeave, spawn, death {victim, attacker, weapon, headshot, distance, assisters}, damage {victim, attacker, amount, weapon, part}, fire, reload, objective {kind, team, player}, matchStart, matchEnd {results}, tick {dt}, scoreChange`.

Features may also register: per-player modifiers (`speedMultiplier`, `damageTaken`, `reloadMultiplier`, `adsMultiplier`, `radarVisible`, ...) through a small modifier registry that core consults, and RPC handlers for feature-specific client messages (namespaced, e.g. `killstreak.call`).

Client side: `registerScreen(id, mount)`, `registerHudWidget(id, draw)`, and a feature message handler registry for namespaced server messages.

## 7. Definitions and registries (shared/defs)

Each file exports a typed array + `byId` map. Core seeds each with one or two entries so everything type-checks; feature owners fill them in.

- `WeaponDef { id, name, class: 'ar'|'smg'|'lmg'|'sniper'|'shotgun'|'pistol'|'launcher'|'special', damage: {near, far, nearRange, farRange}, multipliers: {head, torso, limb}, rpm, mode: 'auto'|'semi'|'burst'|'bolt'|'pump', burst?, pellets?, magazine, reserve, reloadMs, reloadEmptyMs, adsMs, sprintOutMs, moveMult, spread: {hip, ads, move}, recoil: {vertical, horizontal, recovery}, unlockLevel, attachments: string[], model: string }`
- `AttachmentDef { id, name, slot: 'optic'|'muzzle'|'underbarrel'|'magazine'|'other', modifiers: Partial<...>, unlockKills?, model? }`
- `PerkDef { id, name, tier: 1|2|3, description, pro: {description, challenge}, unlockLevel }`
- `KillstreakDef { id, name, kills, description, unlockLevel, kind: 'passive'|'called'|'controlled' }`
- `ModeDef { id, name, teams: boolean, scoreLimit, timeLimitSec, respawn: boolean, wager?: {ante, payouts[]}, playlist }`
- `MapDef { id, name, inspiredBy, build(): MapData, modes: string[], sizes: 'small'|'medium'|'large' }`
- Progression: levels 1–50 with XP table, prestige 0–15 (prestige resets level and unlocks, keeps CoD points and challenge records, grants an emblem), XP sources (kill 100, headshot +50, assist 50, objective, match bonus, challenges).
- `ChallengeDef { id, name, mode?: string, weapon?: string, metric, goal, tiers?, xp, codPoints? }` — challenges per game mode and per weapon feed XP and CoD Points.
- `CamoDef { id, name, price | unlock, recipe }` — skins are texture recipes run through the developer.
- Economy: CoD Points earned per match and from challenges, spent on weapons/attachments/camos/emblems and wager antes.

## 8. Feature areas (one agent each in the fan-out)

1. **maps-bo**: Nuketown, Firing Range (BO1), plus the existing Yard.
2. **maps-mw2**: Rust, plus one more MW2 map if time allows (Scrapyard or Terminal section).
3. **weapons**: FAMAS, L96A1 (with scope), AK-47, Olympia (2 shells, pellets) plus a BO1 starter set (M16 burst, MP5K, AK74u, Galil, Commando, Spas-12, M1911/Python, knife). Attachments (red dot, reflex, ACOG, variable zoom, suppressor, extended mag, dual mag, grip, grenade launcher stub). Low-poly viewmodels, sounds, scope overlay, recoil, ADS.
4. **perks-streaks**: BO1 three-tier perks with Pro versions; killstreaks UAV, Counter-UAV, RC-XD, Care Package, Napalm, Mortar Team, Attack Helicopter, Sentry Gun, Attack Dogs; pick 3 in loadout; HUD.
5. **progression**: XP, levels 1–50, prestige 1–15 with emblems, per-mode and per-weapon challenges that award XP, Barracks screen to view all levels/prestiges/unlocks/challenges, combat record.
6. **economy**: CoD Points, store, camos/skins (texture recipes), wager matches (One in the Chamber, Gun Game, Sharpshooter, Sticks and Stones) with antes and top-3 payouts.
7. **frontend**: main menu, playlists, per-game lobby (player list, map vote, countdown, bot backfill), create-a-class / loadout builder with attachments, perks, streaks, camos; settings (look, sensitivity, FOV, audio).
8. **bots**: nav graph from brushes, behaviours (roam, engage, objective play), difficulty tiers, use loadouts/perks/streaks, wager-mode aware.
9. **modes**: Team Deathmatch and FFA polish, Domination, Search and Destroy, Headquarters, Kill Confirmed; end-of-match summary (scoreboard, XP breakdown, challenge progress).

## 9. References

- `REF_BLOCKYARD` = `/Users/michaelgingras/Library/Application Support/Claude/scratch-workspaces/d20cb7e9-1e85-4bd4-90e5-fc4c621b0940/e04bba9d-c970-458b-9bdc-220b4299ec65/scratch-2026-10-06-91bab5/blockyard` (MIT, © Patrick Blais). Useful: `src/platform/host/{room,server,state}.ts`, `src/platform/net/{protocol,codec,delta}.ts`, `src/platform/sim/{movement,hitscan,hitboxes}.ts`, `src/games/callofblocky/{server,match,perks,progression,bots,modes,weapons}.ts`, `src/games/callofblocky/streaks/`. Borrow freely; keep an attribution line in `NOTICE` for copied code.
- `reference/yard-lab.html`: approved look, shader, baking, HUD, viewmodel, soldier model, photo recipes.
- `reference/turntable.html`: quantizer/dither settings.

## 10. Quality bar

- `npm run typecheck`, `npm test`, `npm run build` stay green on every handoff.
- Each feature ships unit tests for its rules and at least one headless integration test exercising it through the server.
- No placeholder art left in shipped paths without a TODO naming the owner area.
- Real gun names are fine. Map names are recreations for private play; keep `inspiredBy` in MapDef so we can rename for any public release.
