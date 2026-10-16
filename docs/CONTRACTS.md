# Lo-Fi Ops: core contracts

What the core gives every feature area, and exactly how to plug in. Read `docs/DESIGN.md` first (the why); this file is the how. If you must change a contract here, change this file in the same commit and say so in your report.

```
npm run dev        server (tsx watch, :8080) + Vite (:5173, proxies /ws and /api); .claude/launch.json 'dev' for the preview tool
npm run build      typecheck (server + client tsconfigs) then vite build -> dist/client
npm run typecheck
npm test           vitest: unit + headless integration (real server on a random port)
npm start          serves dist/client and the game server on one port (PORT, default 8080, bound to 0.0.0.0); this is also what the Docker image runs (docs/DEPLOY.md)
```

Env: `PORT` (default 8080), `HOST` (default `0.0.0.0`), `DATA_DIR` (default `./data`; the SQLite file is `DATA_DIR/lofi.db`), `LOFI_DB` (explicit sqlite path, overrides `DATA_DIR`), `GIT_SHA` (optional, appended to the reported version). HTTP: `GET /healthz` (alias `/api/health`) returns `{ok, rooms, players, bots, version, uptimeSec, draining}` (503 while shutting down), `GET /api/rooms`. SIGINT/SIGTERM shut down gracefully: joins refused, profiles saved, sockets closed with code 1012 (clients retry), exit within 8 s. Deployment: `docs/DEPLOY.md` (Fly.io).

## 0. Rules of the road

- Everything is TypeScript strict, ESM, extensionless relative imports, `import type` for types (`verbatimModuleSyntax`).
- `src/shared` is pure: no DOM, no Node APIs. The client tsconfig has no Node types and the server tsconfig has no DOM, so a violation fails `npm run typecheck`.
- You own your folders: `src/server/features/<area>/`, `src/client/features/<area>/`, your defs file(s), your maps, your tests. Core files (`protocol.ts`, `events.ts`, `room.ts`, `combat.ts`, `sim.ts`, `main.ts`) are extended through the hooks below, not edited. If you truly need a core change, keep it minimal and call it out.
- Namespacing: your feature id (`perks`, `killstreaks`, `progression`, `economy`, `frontend`, `bots`, `modes`, `weapons`, `pickups`) prefixes your RPC ids, feature messages, custom events, `profile.ext` key and modifier ids: `killstreaks.call`, `profile.ext.economy`.
- Extending core types is done by **declaration merging** from your own folder (examples in each section). The `declare module` path is relative to the file you write it in.

## 1. Feature registration (server)

Each area has a pre-made folder `src/server/features/<area>/index.ts` that default-exports a `Feature`; `src/server/features/index.ts` already lists all of them, so you never edit the list.

```ts
// src/server/features/perks/index.ts
import type { Feature } from '../../feature';
import type { PlayerState } from '../../player';

const has = (p: PlayerState, id: string) => !!p.loadout?.perks.includes(id);

const feature: Feature = {
  id: 'perks',
  setup(api) {
    // Once per server: RPCs, mode rules, weapon behaviours.
    api.rpc.handle('perks.list', () => ({ ids: ['lightweight'] }));
  },
  room(room) {
    // Once per room (after mode rules, before the first match starts): bus + modifiers.
    room.modifiers.add('speedMultiplier', (p) => (has(p, 'lightweight') ? 1.07 : undefined), 'perks.lightweight');
    room.modifiers.add('streakCostOffset', (p) => (has(p, 'hardline') ? -1 : undefined), 'perks.hardline');
  },
};
export default feature;
```

`ServerApi` (`src/server/feature.ts`): `lobby`, `store`, `rpc`, `registerMode(id, factory)`, `registerWeaponBehavior(idOrClass, behavior)`, `sessions()`, `log(msg)`.

## 2. Room events (the per-room bus)

`room.bus.on(name, handler, { priority? })` returns an unsubscribe function. Handlers run synchronously, high priority first; a throwing handler is logged and skipped. `room.bus.emit(name, payload)` for your own events. Payload types: `src/shared/events.ts` (`RoomEvents<P>`, the server uses `P = PlayerState`).

| event | payload | notes |
|---|---|---|
| `playerJoin` | `{ player }` | humans and bots; bots: attach `player.brain` here |
| `playerLeave` | `{ player, reason }` | `disconnect`/`left`/`kicked`/`closed` |
| `beforeSpawn` | `{ player, loadout, point }` | **mutable**: replace `loadout` (unlock checks, wager loadouts) or set `point` |
| `spawn` | `{ player, point }` | |
| `beforeDamage` | `DamageInfo & { cancel }` | **mutable**: change `amount`, or `cancel = true` |
| `damage` | `DamageInfo & { health }` | after health dropped; `health` is what's left |
| `death` | `{ victim, attacker, weapon, headshot, distance, assisters, part, means, victimStreak, attackerStreak, penetrated? }` | `penetrated`: a bullet kill through a wall; stats (kills/deaths/assists/streak) are already updated |
| `fire` | `{ player, weapon, origin, dir, hits[], end, walls? }` | one per trigger pull; `hits[].penetrated`, `walls` = entry/exit points of the walls the first pellet went through |
| `reload` | `{ player, weapon, empty }` | |
| `weaponSwitch` | `{ player, slot, weapon }` | |
| `buttons` | `{ player, pressed, released, buttons }` | edge-triggered bits (`Buttons` in `shared/input.ts`): melee, lethal, tactical, streak, use |
| `objective` | `{ kind, team, player, data? }` | emitted by modes/features |
| `phase` | `{ phase, prev }` | `lobby`/`countdown`/`playing`/`ended` |
| `matchStart` | `{ time }` | reset your per-match state here |
| `matchEnd` | `{ results }` | mutate `profile`s and `results.ext.<you>` here; core saves profiles right after |
| `tick` | `{ dt, time, tick }` | every 60 Hz tick, after players moved |
| `scoreChange` | `{ team, player, delta, reason, teamScores }` | |

`DamageInfo = { victim, attacker, amount, weapon, part: 'head'|'torso'|'legs'|null, means, from, distance }`, `means` = `bullet | melee | explosive | fire | fall | world | killstreak | suicide | <string>`.

Adding an event:

```ts
// src/server/features/killstreaks/events.ts
declare module '../../../shared/events' {
  interface RoomEvents<P> {
    'killstreaks.earned': { player: P; id: string };
  }
}
export {};
// ...then: room.bus.emit('killstreaks.earned', { player, id: 'uav' });
```

Timers (room time, pause with the room): `room.schedule(sec, fn)` and `room.every(sec, fn)` return a cancel function.

## 3. Modifiers (core consults them)

`room.modifiers.add(key, fn, id?)` returns a remover; re-adding the same `id` replaces it. Return `undefined` for "no opinion". Keys (`src/server/modifiers.ts`):

| key | signature | combine | consulted by |
|---|---|---|---|
| `speedMultiplier` | `(p) => number` | product | movement params (sent to the client for prediction) |
| `sprintMultiplier` | `(p) => number` | product | movement |
| `damageTaken` | `(victim, info) => number` | product | `damage()` |
| `damageDealt` | `(attacker, info) => number` | product | `damage()` |
| `reloadMultiplier` | `(p) => number` | product | reload time |
| `adsMultiplier` | `(p) => number` | product | ADS time (movement) |
| `swapMultiplier` | `(p) => number` | product | weapon switch time |
| `sprintOutMultiplier` | `(p) => number` | product | sprint-to-fire delay |
| `spreadMultiplier` | `(p) => number` | product | hitscan spread |
| `penetrationMultiplier` | `(p) => number` | product | bullet penetration depth, human shots (Hardened 2; section 13) |
| `regenDelayMultiplier` | `(p) => number` | product | health regen delay (5 s) |
| `maxHealthMultiplier` | `(p) => number` | product | at spawn (hardcore 0.3) |
| `streakCostOffset` | `(p) => number` | sum | for the killstreaks feature to read |
| `radarVisible` | `(target, viewer) => boolean` | any false wins, else any true | minimap (`snap.radar`) |
| `radarJammed` | `(viewer) => boolean` | same | `snap.jammed` |
| `canSprint` | `(p) => boolean` | same (false = no sprint) | movement params (`me.params.canSprint`): sprint stamina / Marathon, last stand, driving a streak |
| `useClaimed` | `(p) => boolean` | same | weapon pickups: true = another USE action owns the key here (care package in reach, S&D plant/defuse, last stand / revive, driving a streak, a turret in hand or your own placed turret in reach); pickups stand aside until USE is let go. Register one for any new hold-USE action |

**One name per contract.** A key is declared once, by the feature that reads it, and every other feature registers it under that exact name: a key registered under a name nobody reads compiles and silently does nothing (Warlord once registered `attachmentSlots` while weapons read `attachmentSlotsOffset`). `tests/modifier-keys.test.ts` fails when any registered key has no `.mul/.sum/.any` reader. The weapons feature's keys are listed in section 13 (perks registers Warlord, Warlord Pro, Tactical Mask, Steady Aim Pro and Scout through them). The perks feature declares the keys bots and killstreaks read (`src/server/features/perks/common.ts`): `flinchMultiplier` (mul), `silentFootsteps` (any), `hearingMultiplier` (mul), `streakTargetable(target, kind)`, `killstreakDamageDealt(attacker, kind)`. A modifier read at `beforeSpawn` must take the event's loadout as an argument: `p.loadout` (and so `hasPerk`) is still the previous life's there. See docs/features/perks-streaks.md.

The bots feature adds skill modifiers (declared in `src/server/features/bots/impair.ts`): `botSkillMultiplier(bot, knob)` (mul) and `botSkillOffset(bot, knob)` (sum) change a `BotSkill` knob (the brain plays with `effectiveSkill`: knob x product + sum, clamped to `BOT_SKILL_RANGES`, recomputed every tick), and `botFrozen(bot)` (any; true = no movement, no fire, aim held this tick). The Glitch killstreak uses all three on the glitched side's bots.

Read them yourself with `room.modifiers.mul(key, ...args)`, `.sum(...)`, `.any(...)`. Radar default when nobody votes: enemies who fired an unsuppressed weapon in the last 1.5 s. A UAV returns `true` for enemies of its owner's team; Ghost returns `false` from its own `radarVisible` only when the target isn't revealed by firing (so the two compose).

New key:

```ts
declare module '../../modifiers' {
  interface ModifierMap { meleeRangeMultiplier: (p: PlayerState) => number | undefined }
}
```

## 4. Per-player feature state

`PlayerState` (`src/server/player.ts`) has `id, name, isBot, session, profile, team, alive, health, maxHealth, move (MoveState), yaw, pitch, buttons, loadout, weapons[], slot, slotLock, stats {kills,deaths,assists,score,headshots,streak,bestStreak}, respawnAt, brain, ext`.

Weapon slots: every spawn puts slot 0 (the primary) in hand. A feature that switches a player's slot itself mid-life (Second Chance's pistol, a revive) calls `forceSlot(room, p, slot)` (`combat.ts`): it switches and sets `p.slotLock = { slot, until }` (1.5 s), so input commands that still ask for the old slot (sent before the client heard) are ignored until one asks for the forced slot. Push the slot to the client so it follows (Second Chance does it in `perks.lastStand`).

```ts
declare module '../../player' {
  interface PlayerExt { killstreaks?: { earned: string[]; kills: number } }
}
room.bus.on('death', ({ attacker }) => { if (attacker) (attacker.ext.killstreaks ??= { earned: [], kills: 0 }).kills++; });
```

Room API features use: `room.players` (Map), `humans()`, `bots()`, `isEnemy(a,b)`, `canDamage(a,b)`, `enemiesOf(p)`, `addBot({name, team, loadout})`, `removePlayer(id)`, `spawn(p, point?)`, `damage(info)`, `kill(victim, attacker, how)`, `radiusDamage(center, radius, max, min, {attacker, weapon, means})`, `fire(p, {dir, time?, shot?})` (bots; without `time` the shot is at the present and hits where players are now, no rewind), `addTeamScore(team, n, reason)`, `addPlayerScore(p, n, reason)`, `endMatch(reason, results?)`, `endLock` (below), `world` (CollisionWorld: `raycast`, `lineOfSight`, `groundBelow`, `free`), `map` (MapData), `mode` (ModeDef), `time`, `phase`, `entities`, `send(p, msg)`, `broadcast(msg)`, `sendFeature(p | null, id, data)`.

**Entities** (killstreak vehicles, dogs, packages, flags): `room.entities.add({ kind, x, y, z, yaw, owner?, team?, s?, data? })` returns the entity (with `id`); move it in a `tick` handler; `remove(id)`. Everything except `data` goes out in each snapshot as `EntitySnap`; the client renders by `kind`.

**Bots**: set `player.brain = { think(room, self, dt) { return { buttons, yaw, pitch, weaponSlot } } }` (runs every tick through the same movement as humans; return `null` to idle), and call `room.fire(self, { dir })` to shoot (rate/ammo/sprint rules apply). Navigation: build from `room.map.brushes` / `room.world`. `RoomOptions.botFill` keeps humans + bots at N. Bots obey player rules end to end: they aim through the bots feature's aim controller (`src/server/features/bots/aim.ts`: reaction, bounded turn rate, sway, player-equivalent recoil, flinch via the `flinchMultiplier` modifier) and perceive only by FOV + line of sight with a noticing time, hearing (gunfire, footsteps; `silentFootsteps` / `hearingMultiplier` respected) and `radarVisible`. Their line of sight is collision's `sight` mask plus the map's drawn geometry (`src/server/features/bots/sight.ts`: a render-only or turned box hides you from a bot as it does on screen); hearing and radar only turn or steer them. They fire only while they see the target and a bullet would reach the aim point (`bullets` mask plus drawn bullet-stopping geometry), and they hold any shot whose traced pellets (`traceShot`) would hit someone through drawn cover. Bot brains are in `docs/features/bots.md`.

## 5. RPC and feature messages

Client -> server: `{ t: 'rpc', id: '<area>.<name>', data, rid? }`. With `rid` the server answers `{ t: 'rpcResult', rid, ok, data? , error? }`.

```ts
// setup(api)
api.rpc.handle('economy.buy', (ctx, data) => {
  const item = (data as { item?: unknown } | null)?.item;          // untrusted: validate!
  if (typeof item !== 'string') throw new RpcError('bad_request', 'item required');  // import { RpcError } from '../../rpc'
  const prof = ctx.session.profile;                                  // ctx.room / ctx.player may be null (menus)
  prof.codPoints -= 100; api.store.save(prof);
  return { codPoints: prof.codPoints };
});
```

Server -> client: `session.sendFeature(id, data)` or `room.sendFeature(player | null, id, data)` sends `{ t: 'feat', id, data }`.

Typing both (shared, so the client gets the types):

```ts
declare module '../../../shared/protocol' {
  interface RpcMap { 'economy.buy': { req: { item: string }; res: { codPoints: number } } }
  interface FeatureMessages { 'killstreaks.earned': { id: string } }
}
```

Core RPCs: `core.profile` -> Profile, `core.setName {name}` -> Profile. Core push: `core.notice {text}`.

## 6. Core protocol (summary; source of truth `src/shared/protocol.ts`)

Client: `hello {token?, name?, version}` (first message; the server replies `welcome {sessionId, token, profile, defaultLoadouts}`; keep `token` in localStorage), `quickplay {mode, map?}`, `joinRoom {roomId}`, `leaveRoom`, `listRooms {mode?}`, `input {cmds: InputCmd[]}`, `fire {seq, time, origin, dir, shot}`, `selectLoadout {index}`, `rpc`, `ping {t0}`.

Server: `welcome`, `joined {roomId, you, mode, map, team, phase, tickRate, snapshotRate, time, timeLimit, scoreLimit}` (also re-sent on map change), `left`, `rooms`, `roster {players}`, `snap` (20 Hz), `killfeed` (`pen`: through a wall), `hit` (hitmarker, to shooter; `pen`: through a wall), `hurt` (to victim, with direction), `died`, `spawned {x,y,z,yaw,loadout}`, `score {teams, players}`, `phase {phase, time, endsAt}`, `matchEnd {results}`, `profile {profile}` (after match end), `feat`, `rpcResult`, `pong {t0, time}`, `error {code, message}`.

Netcode contract for the client:

- `InputCmd {seq, dt, buttons, yaw, pitch, weaponSlot}`; quantise yaw/pitch with `quantizeAngle` before using them locally (the server does). Send at frame rate, batched (<= 64 cmds per message), `dt` <= 0.05.
- Predict with `stepMove(world, state, buttons, yaw, dt, snap.me.params)` from `shared/movement.ts`; `world = buildCollisionWorld(getMapData(mapId))`. On each `snap`: take `snap.me.move`, drop inputs with `seq <= snap.ack`, replay the rest; snap if the error > `RECONCILE_SNAP_M` (0.5 m) else smooth. Reset on `spawned`.
- Remote players: interpolate `snap.players` `INTERP_DELAY_MS` (100 ms) behind, in room time (`snap.time`).
- Shots: on each trigger pull send `fire` with `seq` = last input seq sent, `time` = the room time you are rendering remote players at, `origin` = your eye, `dir` = aim before spread, `shot` = a per-pull counter. The server applies spread with `spreadDirection(dir, spreadDegrees(...), shotSeed(hashString(playerId), shot, pellet))` (`shared/ballistics.ts`), so the client can draw the same tracer. Firing is refused while sprinting / within sprint-out, reloading, switching, out of ammo (auto-reload), or faster than the weapon's rpm.
- Weapon slot in commands: the client sends slot 0 while dead and from the `spawned` message on (`frameSlot` / `SPAWN_SLOT` in `client/game/slots.ts`), matching the server's spawn on the primary; it used to follow the dead body's slot, so the first commands after a respawn switched back to the secondary.
- `PlayerSnap.f` bits: `PlayerFlags` (ALIVE, CROUCH, SPRINT, ADS, GROUND, RELOADING, FIRING, SWITCHING, PRONE, MANTLE); `stanceFlags(move)` gives the stance bits (killcam frames use it too).
- Movement state (`MoveState`, shared `movement.ts`):
  - It includes prone (`prone`, `proneT` 0 up..1 down, `proneHeld`, `dive`) and a mantle in progress (`mantle: { t, dur, from, to, over } | null`). Copy it with `copyMoveState`, which is deep.
  - `moveBusy(move)` means the weapon is down (mantling, diving, mid stance change). The server refuses shots with `reason: 'stance'`.
  - Helpers: `eyeHeight`, `bodyHeight`, `stanceOf` (`'stand' | 'crouch' | 'prone'`; prone once `proneT >= 0.5`), `moveHitboxes(move, yaw)`, `movePose(move, yaw)`.
  - `MoveParams.canMantle` / `canProne` default to true. They are false for bodies that borrow player movement: RC-XD, dogs.
  - Details: docs/features/movement.md.

Codec: JSON behind `Codec`; `setCodec()` swaps it on both sides.

## 7. Definitions (src/shared/defs)

Each file exports a typed array and a `*_BY_ID` map (`indexById` throws on duplicates). Owners fill them in; keep ids stable (profiles store them).

| file | exports | owner |
|---|---|---|
| `weapons.ts` | `WeaponDef` (optional `projectile`: no local hitscan tracer; `ammoNoun`: the HUD counts loaded + spare as "N BOLTS"), `WEAPONS`, `WEAPON_BY_ID`, `LOADOUT_WEAPONS` (create-a-class picks; `knife` and `gl` have slots `melee` / `attachment`), `shotsToKill`, `ttkMs`, `cycleSec` | weapons |
| `attachments.ts` | `AttachmentDef` (`unlockKills`, `price`), `ATTACHMENTS`, `effectiveWeapon(def, ids)`, `validAttachments(def, ids, max)`, `canAttach`, `BASE_ATTACHMENT_SLOTS` (1) | weapons |
| `equipment.ts` | `EquipmentDef`, `EQUIPMENT` (frag, semtex, tomahawk, flashbang, concussion), `LETHALS`, `TACTICALS`, `MELEE`, `GL_ROUND`, `NADE_ENTITY`, `TOMAHAWK` / `TOMAHAWK_ENTITY` (`weapons.tomahawk`, `s.k` = 1 once retrievable), cook maths shared by the server fuse and the HUD (`COOK`, `cookLeft`, `cookWarning`, `cookTickTimes`, `cookTicksBetween`), weapons feature messages (incl. `weapons.retrieve`, `weapons.cook {e, seq, fuse}`: the pin came out on input `seq`) | weapons |
| `perks.ts` | `PerkDef`, `PERKS` (BO1's 15 plus Pack Rat (T2) and Tracker (T3)), `PERK_TUNING`, `PERK_PRO_CHALLENGES` | perks-streaks |
| `tracker.ts` | Tracker perk: `TRACKER` tuning (25 m, 0.4 s samples, 0.7 m stride, 24 prints a message, 3.5 s fade), `packTracks` / `unpackTracks` (0.1 m and 256-step yaw quantisation), `printAlpha`, push `perks.tracks {f}` (to the Tracker player only) | perks-streaks |
| `pack-rat.ts` | Pack Rat perk: `PACK_RAT` tuning (USE hold x0, switch x0.6, picked-up raise 30%) | perks-streaks |
| `glitch.ts` | Glitch killstreak: `GLITCH` tuning (20 s, bot skill changes, stutter, screen effects), `glitchHits`, `glitchStrength`, `glitchSkill`, push `killstreaks.glitch {active: [{owner, team, until}]}` | perks-streaks |
| `killstreaks.ts` | `KillstreakDef` (`targeting`: `marker` for the Care Package's thrown canister, `mapPick`, `marks`, `countsStreakKills`, `noWager`...), `KILLSTREAKS` (BO1's 14 + the original Glitch at 10 (`defs/glitch.ts`) + MW2's Tactical Nuke at 25; `valkyrie` is a `marker` drop whose crate holds the launcher; `sentry_gun` / `sam_turret` are `place`: carried, then put down, `defs/turret-place.ts`), `KS_ENTITY` (incl. `sentry` = `ks_sentry`: `s.b` placed facing, `s.t` id of the player it tracks, `s.a` 1 once it may fire, `s.f` firing, `s.st` stunned, `s.h` hacked, `s.c` 1 while carried with `s.v` 1 on a good spot; `sam` = `ks_sam` the same `s.c` / `s.v` / `s.b` / `s.st` / `s.h`), (incl. `marker` = `ks_marker`, the canister: `s.k` 1 settled, `s.sm` smoke start, `s.v` 0 when the drop moved; `rocket` = `ks_rocket`, a Valkyrie rocket: `s.p` pitch, `s.v` speed, `s.f` fuel, `s.b` boosting, `s.w` feed white; `launcher` = `ks_launcher` on a player holding the launcher), `streakAllowedIn` | perks-streaks |
| `care-marker.ts` | Care Package marker, shared by the server and the client's throw preview: `MARKER` tuning, `markerLaunch`, `markerStep` / `simulateMarker` (per tick at TICK_DT), `resolveDrop` (where the crate can come down: bounds, open sky, roof limit, walls, with the walk-back fallback), `groundTop`, `roofLimit` | perks-streaks |
| `valkyrie.ts` | Valkyrie Rockets (BO1 TV-guided missile): `VALKYRIE` tuning, `VALKYRIE_LAUNCHER` (the ready-list id of the launcher from its crate), flight maths shared by the server and the rocket cam (`rocketLaunch`, `stepRocket`, `turnRateAt`, `steerToward`, `clampLead`, `rocketOutOfBounds`, `signalWhite`, `bankRoll`, `dirAngles`) | perks-streaks |
| `sentry.ts` | Sentry Gun: `SENTRY` tuning (60 s, 500 hp, bullet / explosive scales, arming, acquisition, turn rate, arc, bursts, damage and accuracy falloff, stuns) and pure maths (`angleDiff`, `inSentryArc`, `sentryTurn`, `sentryDamage`, `sentryHitChance`) | perks-streaks |
| `turret-place.ts` | carry-to-place for the Sentry Gun and SAM Turret, shared by the client's preview and the server's check: `TURRET_PLACE` (distance ahead, footprint, step, tilt, move scale, pickup reach), `turretPlacement(world, map, feet, yaw)` -> `TurretSpot {x, y, z, yaw, valid, reason}`, `PLACE_REASON_TEXT` | perks-streaks |
| `nuke.ts` | Tactical Nuke timeline `NUKE` (laptop 1.5 s, countdown 10 s, shockwave +2..+4 s, match end +5.5 s) and pure maths (`nukePhase`, `countdownNumber`, `shockAt`, `nukeWhite`, `nukeTimeScale`, `cloudGrowth`, `blastPoint`) | perks-streaks |
| `tactical-map.ts` | tactical map (BO1 radio targeting): `STRIKE` footprints/timings, `validateMapTarget`, `yawFromDrag`, `strikeFootprint`, `MAP_MODE` | perks-streaks |
| `perks-streaks-protocol.ts` | killstreak/perk RPCs and pushes, incl. `killstreaks.mapTarget {id, points, yaw?}`, `killstreaks.mapCancel`, `KillstreakStateMsg.map`, `KillstreakStateMsg.marker` (holding the Care Package canister), `KillstreakStateMsg.launcher {left, ready, fired}` (holding the Valkyrie launcher), `KillstreakStateMsg.carry {id, moved}` (carrying a Sentry Gun / SAM Turret to place it; `moved` = a placed one picked back up), `KillstreakStateMsg.control.hold` (the rocket cam holding on the blast), `perks.lastStand.slot` (the slot a revive put back) | perks-streaks |
| `modes.ts` | `ModeDef` (optional `teamsByRules`: the rules own teams, so lobby/bot balancing leaves them alone; `teamNames` for HUDs, read with `teamNamesFor(mode, TEAM_NAMES)`), `CORE_MODES` (tdm 75 kills / ffa 30 kills / dom 200 / sd 4 rounds / hq 250 / kc 65 / infected 10 min), `MODES` = core + `WAGER_MODES`, `MODE_TUNING`, `MODE_XP` | modes |
| `infected.ts` | Infected (MW3): `INFECTED` tuning (9 s pick, sweep, speed, First Infected armour), `INFECTED_XP`, `SURVIVOR_LOADOUT` / `INFECTED_LOADOUT` / `FIRST_INFECTED_LOADOUT`, `LAST_SURVIVOR_WEAPON`, `INFECTED_TEAMS` (0 Survivors, 1 Infected), `InfectedStatePayload` (`modes.state.infected`) | modes |
| `modestate.ts` | modes wire types (`modes.state`, `modes.event`, `modes.killcam`, `modes.deathcam`), `MatchSummaryExt` (`results.ext.modes`), `MODE_ENTITY` kinds | modes |
| `deathcam.ts` | per-death killcam: `DEATHCAM` timing, `deathcamWindow(at, respawnAt)` (clip cut so it ends by the respawn), `DeathcamPayload` / `KillerCard` (`modes.deathcam`, sent only to the victim; `cam.track` = a camera path to ride, `CamTrack` / `packTrack`: a Valkyrie kill rides its rocket), `packClip` / `unpackClip`, `NO_DEATHCAM_MEANS` (fall, world, suicide, nuke) | modes |
| `economy.ts` | `CP_REWARDS`, `STARTING_COD_POINTS`, `DEFAULT_PRICES`, `codPointsForMatch` / `codPointsBreakdown` (score, win, podium, streak, time share), `ANTE_TIERS` (0/10/1,000/10,000), `wagerPayouts`, `WAGER_MODES` (oitc, gungame, sharpshooter, sticks), wager mode data (`STICKS` points, `BOLT` / `BLADE` projectile tuning, `BOLT_ENTITY` `economy.bolt` / `BLADE_ENTITY` `economy.blade`) | economy |
| `store.ts` | `RETICLES`, `EMBLEM_BACKGROUNDS`, `storeCatalog()`, ownership keys `keyOf.*` (`weapon.<id>`, `att.<weapon>.<att>`, `camo.<id>`, `reticle.<id>`, `emblem.<id>` in `profile.owned`), `lockReason`, `canUse`, `purchase`, `enforceLoadout` | economy |
| `economy-net.ts` | economy RPC / feature message types (`economy.*`), `EconomyResultsExt` (`results.ext.economy`) | economy |
| `wager-weapons.ts` | `crossbow` (1 + 5 bolts), `ballistic_knife` (1 + 1 blades), both projectile weapons, appended to `WEAPONS` at load unless the weapons area defines those ids; `WAGER_ONLY_WEAPONS` | economy |
| `maps.ts` | `MapDef {id, name, inspiredBy, build, modes, size}`, `MAPS`, `getMapData(id)` (cached), `mapsForMode` | maps-bo, maps-mw2 |
| `progression.ts` | `MAX_LEVEL` 50, `MAX_PRESTIGE` 15, `XP_TABLE`, `levelForXp`, `xpForLevel`, `addXp`, `canPrestige`, `applyPrestige`, `XP_SOURCES` | progression |
| `challenges.ts` | `ChallengeDef`, `CHALLENGES` (seeded: `tdm_kills`) | progression |
| `pickups.ts` | weapon drops and pickups: `PICKUP` tuning (reach, hold time, life, room cap), `PICKUP_ENTITY` (`pickups_weapon`, `s = {w,a,c,l,m,r,o}`), `canDropWeapon`, `pickDropTarget` / `dropScore` (the same target maths on both sides), `pickups.swapped` / `pickups.ammo` messages; see docs/features/pickups.md | pickups |
| `camos.ts` | `CamoDef {price, unlock, tier, recipe: CamoRecipe | null}`, `CAMOS` (16: Woodland ... Gold, Ice, Dragon); client texture `camo.<id>`, picker swatch `camoPreview(id)` from `src/client/features/economy` | economy |

`collision.ts`: `free(x, y, z, r?, h?)` and `groundBelow(x, z, fromY, drop, r?)` take any radius (their defaults are `PLAYER.radius` / `PLAYER.height`; the parameters used to be typed as those literals).

Also shared: `projectile.ts` (`stepBody`, `throwVelocity`: thrown-object flight, used by the server's grenades and the Care Package canister, and by the client to predict a throw), `loadout.ts` (`Loadout`, `DEFAULT_LOADOUTS`, `sanitizeLoadout` = structural only, no unlock checks), `profile.ts` (`Profile`, `newProfile`, `bumpStat`), `ballistics.ts`, `collision.ts`, `movement.ts`, `math.ts` (`viewDir`: yaw 0 looks down -z).

Wager modes: economy appends to `WAGER_MODES` in `economy.ts` and registers rules from its feature `setup` (`api.registerMode('oitc', factory)`), so `modes.ts` stays the modes owner's. CoD Points for challenges: emit the room event `economy.grant { player, amount, reason, kind: 'challenge' }` instead of changing `profile.codPoints` (details: `docs/features/economy.md`).

## 8. Mode rules (src/server/modes)

```ts
export interface ModeRules {
  id: string;
  setup(room): void;                         // subscribe to room.bus (death -> score)
  reset?(room): void;                        // each match start
  assignTeam?(room, p): Team | null;         // default: smaller team / null
  spawnPoints?(room, p): SpawnPoint[];       // default: map.spawns.teams[team] or .ffa; return a short ranked list (core pickSpawn picks among them)
  respawnDelay?(room, p): number | null;     // default: 3 s if mode.respawn, null = wait for round
  checkEnd?(room): reason | null;            // on score change + every second
  results?(room, reason): MatchResults;      // default: standardResults
}
registerMode('dom', () => domRules());       // modes/index.ts or a feature setup
```

The modes feature registers tdm/ffa/dom/sd/hq/kc/infected from its `setup` (`src/server/features/modes/`, see `docs/features/modes.md`); core's own tdm/ffa in `src/server/modes` remain the fallback. Bots read objective goals from `src/server/features/modes/bots.ts` (`bestObjective(room, bot)`); a mode can also register goals and a per-bot play style with the bots hooks (`registerBotGoal(modeId, fn)`, `registerBotStyle(modeId, (room, bot) => Partial<BotModeStyle>)`; Infected does both, `src/server/features/modes/infected-bots.ts`). Infected (`teamsByRules`) moves players between teams itself: team 0 Survivors, team 1 Infected, re-asserted at every spawn; its results set `winnerTeam` by who is left, and `teamScores` carry the live counts. Dynamic spawns score candidates with `scoreSpawns` / `spawnCandidates` (`src/server/features/modes/spawns.ts`): never next to an enemy (12 m, with 1.5 s of their movement projected) or in an enemy's sight when a clean point exists; enemies facing a point, enemies who would see its first steps, recent deaths and a nearby teammate also count; TDM prefers the team's current side, which flips when the enemy pushes in; DOM/HQ add their own preference; S&D keeps its fixed role spawns. No spawn protection (BO1 had none). `recentSpawns(room, team)` exposes where a team has been spawning (bots stay away from the enemy's). Core `pickSpawn` applies the same hard filters for modes without rules. Rules' bus handlers and modifiers are tagged with the rules object, so `room.setMode()` drops them cleanly. Time limits are enforced by core (`mode.timeLimitSec`). Results go out as `matchEnd` with `MatchResults {roomId, mode, map, reason, winnerTeam, winners, teamScores, players: PlayerResult[], durationSec, ext}`. Reasons: `score`, `time`, `rounds`, `forfeit`, `aborted`, and `nuke` (Tactical Nuke: the caller's team / FFA the caller wins; no final killcam).

## 9. MapData (src/shared/maps/types.ts)

One file per map: `src/shared/maps/<id>.ts` exporting `build<Name>(): MapData`, plus one line in `defs/maps.ts`. `maps/yard.ts` is the worked example (a 1:1 port of the prototype's `buildYard`), and the authoring helpers mirror the prototype: `box(w,h,d,mat,x,y,z,{ry, collide, uv, hide...})`, `wallDecal`, `flatDecal`, `cylinder`, `light`.

```ts
interface MapData {
  id; name;
  bounds: AABB;                                  // leaving it (2 m slack) kills
  materials: Record<string, MaterialDef>;        // { texture: recipeId, uvMul?, tint?, emissive?, side?, bake?, fog?, affine? }
  brushes: Brush[];                              // { min, max, mat, ramp?: '+x'|'-x'|'+z'|'-z', ry? (visual), collide?, players?, bullets?, sight?, noRender?, hide?: Face[], faceMats?, uv?: 'world'|'raw', tag? }
  decals: Decal[];                               // render-only quads: { kind: 'wall'|'flat', w, h, x, y, z, ry?, mat, uv?, seg? }
  props: Prop[];                                 // cylinder (collides by default) | glow sprite | gltf (later)
  lights: MapLight[];                            // { x, y, z, color, radius, group } baked into vertex colours
  spawns: { teams: [SpawnPoint[], SpawnPoint[]]; ffa: SpawnPoint[] };   // { x, y, z, yaw }
  objectives: Record<string, ObjectivePoint[]>;  // 'dom' A/B/C, 'sd' sites A/B (team = defenders' spawn index), 'hq' rotation points; { id, x, y, z, radius, team? }. Missing kinds are derived from spawns (modes feature)
  modeSpawns?: Record<string, Record<string, SpawnPoint[]>>;  // per-mode role spawns: modeSpawns.sd.attackers / .defenders (fallback: spawns)
  times: TimePreset[]; defaultTime;              // sky recipe id, sun/amb/fog, light group intensities
  hotspots?: Vec3[];                             // bot roam targets
}
```

- min/max are the collision AABB. `ry` only rotates the rendered box (x/z extents swapped when |sin ry| > 0.5, like the prototype). `collide: false` = trim (no players/bullets/sight); per-channel overrides make fences (`players: true, bullets: false, sight: false`) and clips (`noRender: true`).
- UVs: world-scaled metres x `uvMul` (prototype `worldUV`), or `uv: 'raw'` for 0..1 per face. Renderer subdivides ~1 segment per 1.1 m for vertex lighting.
- `buildCollisionWorld(map)` (cached) gives the `CollisionWorld` for server, prediction, bots and the bake's shadow rays (`sight` mask).
- `tests/collision.test.ts` checks every registered map: spawns on the ground, free and in bounds; every material referenced exists.
- Objective conventions (maps-bo maps follow them; modes read them): `objectives.dom` = A/B/C (A nearest team 0's spawns), `objectives.sd` = sites A/B (S&D roles swap between halves, so use `modeSpawns.sd.attackers` / `.defenders`, which `SdRules.roleSpawns` reads with a fallback to the team spawn side; `team: 1` on a site only marks the default defenders), `objectives.hq` = the rotation of Headquarters points. Kill Confirmed and wagers use `spawns`. Brush `tag`s from `maps/bo-kit.ts`: `stairs` (invisible clip ramps players climb), `fence-low` (0.9 m jumpable clips), `perimeter` (bounds clips), useful for bot nav.
- **Mantling** (jump at a ledge, sill or low wall):
  - Anything players collide with can be climbed if its top is at most 1.5 m above the floor in front of it and there's 1.0 m of room above it. Deep tops are climbed onto; tops ≤ 0.5 m deep are vaulted.
  - Never climbed: invisible player clips (`noRender` + players only; `Solid.clip`) and brushes tagged `perimeter`, `roof`, `clip`, `glass`. Clips in the way also stop the climb, so a map keeps players off a roof or out of a window with a players-only clip above it (tag `roof`).
  - Window openings need 1.0 m above the sill.
  - `buildCollisionWorld` solids carry `clip` and `tag`. The walk floods in the map tests mantle (`tests/maps-mw2-walk.ts`).
- `maps/bo-kit.ts` (`MapKit`) is an optional authoring helper: walls with door/window holes, stairs, ground with holes, half-turn symmetric lots (`with('rot180', ...)`), backdrop silhouette rings.

Texture recipe ids used by the Yard (the client texture developer must provide them, names = prototype `TX` keys): `ground warehouse steel shutter hazard lamp num01 num02 num03 winRow door exit shed fence container0..container5 hut hutWin tank yellow rubber crate pallet barrel barrier paint`, skies `skyNight skyGrey skyDusk`. `none` is for invisible clip brushes.

## 10. Lobby API (src/server/lobby.ts)

```ts
api.lobby.createRoom(opts: RoomOptions): Room
api.lobby.quickPlay(session, { mode, map? }): Room   // fullest open public room, else a new one
api.lobby.join(session, roomId): Room                // throws LobbyError('unknown_room'|'room_full'|'room_closed')
api.lobby.leave(session, reason?)
api.lobby.list({ mode?, includePrivate? }): RoomSummary[]
api.lobby.get(roomId); api.lobby.onRoomCreated(fn); api.lobby.onRoomClosed(fn)

interface RoomOptions {
  mode; map?; name?; id?; maxPlayers?; private?;
  autoStart?: boolean;      // default true (quick play). false = stays in 'lobby' phase
  countdownSec?: number;    // frozen countdown before play (default 0)
  postMatchSec?: number;    // results screen (default 10)
  onEnd?: 'rotate' | 'lobby' | 'close';   // default 'rotate' (next map, play again)
  botFill?: number;         // keep humans + bots at N
  closeWhenEmpty?: boolean; // default true (5 s after the last human leaves)
  persist?: boolean;        // save profiles at match end (default true)
}
```

Room flow controls for the frontend's real lobbies: `room.setMap(id)`, `room.setMode(id)` (lobby phase), `room.startMatch()`, `room.returnToLobby()`, `room.endMatch(reason, results?)`, `room.phase`, `room.summary()`.

`room.endLock` (reason | null): a feature that has decided how the match ends sets it (the Tactical Nuke sets `'nuke'` when called). While set, `addTeamScore` / `addPlayerScore` do nothing (scores freeze) and `endMatch` ignores every other reason (score, time, rounds), so only `endMatch(endLock, results)` ends the match. Cleared at each `startMatch()`. A per-game lobby = `createRoom({ autoStart: false, onEnd: 'lobby', countdownSec: 10, botFill })` + your own RPCs for map vote / ready / start.

## 11. Profile store (src/server/store.ts)

node:sqlite, one row per profile (`data/lofi.db`). Guest identity: the server creates a random token on first `hello`; the client stores it in `localStorage` (`lofi.token`) and sends it back; only its SHA-256 is stored.

```ts
interface Profile {
  id; name; xp; level; prestige; codPoints;
  unlocks: string[];                       // item ids
  loadouts: Loadout[]; selectedLoadout: number;
  challengeProgress: Record<string, number>;
  stats: Record<string, number>;           // core: kills deaths assists headshots matches wins losses score timePlayed bestStreak, mode.<id>.<stat>
  owned: string[];                         // camos, emblems, store items
  ext: Record<string, unknown>;            // feature-private: ext.progression, ext.economy...
  createdAt; updatedAt;
}
```

Loaded at `hello` (`session.profile`, also `player.profile` in a room). Mutate it on the server; core saves it at match end (after `matchEnd` handlers), when leaving a room and on disconnect, and sends the owner a `profile` message after match end. Save immediately yourself (`api.store.save(profile)`) for menu purchases. No schema migrations needed: add fields under `ext.<you>` or new `stats` keys. One account open in two tabs (same token) gets the same live `Profile` object in both sessions, so writes from either never overwrite the other; still never keep a stale copy of a profile across awaits (re-read `session.profile`). Economy code should still check balances at the moment it spends.

## 12. Client (src/client)

```
main.ts            boot: styles, Renderer, settings wiring, core screens, auto-imports, router, socket
router.ts          navigate(id, params) / back(params) / openOverlay(id) over registerScreen (hash routes: #/settings)
registry.ts        ALL client extension points (below)
state.ts           client.renderer, currentMatch()
settings.ts        settings (localStorage `lofi.settings`), updateSettings, onSettings, lookPreset
net.ts             net (socket singleton) + MatchNet (one room's netcode)
netcode/           predict.ts, interp.ts, clock.ts: pure, unit-tested in tests/netcode.test.ts
render/            renderer.ts (low-res target + post + HUD composite), shader.ts, textures.ts (registry +
                   developer queue + IndexedDB), developer.ts (quantize16/photoify/fromPhoto), bake.ts,
                   mapbuilder.ts (MapData -> meshes, bake per time preset), recipes/*.ts, models/
game/              match.ts (the session + frame loop), controls.ts, viewmodel.ts, remotes.ts, effects.ts, audio.ts
                   (+ sfx-mix.ts: variation/voice-cap/distance helpers, surfaces.ts: footstep surfaces)
                   slots.ts (pure: the weapon slot sent each frame, `frameSlot`, `SPAWN_SLOT`)
                   controller: gamepad.ts (shared pad module), pad.ts (pure mapping/maths), prompts.ts (HUD key
                   labels), aim-assist.ts (pure); see "Controller" below and docs/features/controller.md
hud/               hud.ts, widgets.ts (core widgets), draw.ts (pixel helpers)
menus/             main-menu.ts, settings.ts, match-screen.ts, dom.ts (`h()`), menus.css, padnav.ts (pad focus nav)
features/<area>/   your client code; every features/*/index.ts is auto-imported (import.meta.glob), no list to edit
                   (via features.ts, imported by main.ts after the core screens so features can replace them)
```

Dev console: `window.__lofi.client.match` (dev builds only).

Driving the game from an automated browser (dev builds only): open `http://localhost:5173/?devlook=1`. To drive it as a controller instead, override `navigator.getGamepads` in the page (no devlook needed: any pad press deploys). Pointer lock is replaced by drag-to-look: click the canvas to "lock", drag to look, click without dragging to fire a short tap, Esc to "unlock" (pause menu). Key and click taps are held for at least 120 ms so synthetic presses reach a frame. Scripted helpers live at `window.__lofi.input`: `lock()`, `unlock()`, `hold(action | 'fire' | 'ads', ms)` (actions are `KEYMAP` names: `forward`, `sprint`, `scores`...), `look(dYaw, dPitch)`, `state()`. A hidden tab or browser pane throttles `requestAnimationFrame`, so only the visible tab moves smoothly; drive the other client headlessly (FakeClient) if you need two active players.

### Registries (`registry.ts`)

```ts
registerScreen('barracks', (root, params) => { root.append(h('div', {}, 'hi')); return () => {}; });
navigate('barracks', { tab: 'prestige' });                 // router.ts; core screens: menu, settings, match
registerMenuItem({ id: 'progression.barracks', label: 'Barracks', order: 40, action: () => navigate('barracks') });
registerHudWidget('killstreaks.list', (g, w, h, dt) => { const m = currentMatch(); ... }, 45);
unregisterHudWidget('core.compass');
onFeature('killstreaks.earned', (data) => { ... });        // typed by FeatureMessages; returns unsubscribe
registerEntityRenderer('rcxd', (e, match) => ({ object: mesh, update(e, dt) {}, dispose() {} }));
registerMatchHook('perks.ui', { start(match) { return cleanup; }, frame(match, dt) {} });
registerFootstepFilter('perks.ninja', (playerId, volume) => volume);   // remote footstep volume (0 = silent)
registerAimAssistGate('frontend.lobby', (match) => true);  // false = no controller aim assist in this match
registerSightBlocker('weapons.smoke', (a, b) => false);    // true = something (smoke) blocks sight a -> b for aim assist
registerButtonFilter('killstreaks.valkyrie', (match, buttons) => buttons); // rewrite this frame's outgoing Buttons bits (after pause masking)
```

- Screens: `mount(root, params)` returns an optional unmount. Replacing a core id (`menu`) replaces the core screen; feature folders load after core, so the last registration wins. `params.overlay === '1'` when shown with `openOverlay` over a match; use `back(params)` for a Back button.
- Menu items: the core menu renders every `registerMenuItem` sorted by `order` (core: TDM 10, FFA 20, Settings 90). A frontend menu should render `menuItems` too so other features' entries keep showing.
- HUD widgets draw at render resolution (`w x h`, 240..720 lines) onto a transparent canvas that the post pass composites wherever alpha > 0.5, so draw opaque pixels only. Use `hud/draw.ts`: `unit(h)`, `txt(g, s, x, y, size, color, align)`, `rect`, `box`, `HUD_COLORS`, `clock`, `blink`. Core widgets are `core.<name>` with orders listed at the top of `hud/widgets.ts` (names 5, damage 10, scope 15, crosshair 20, hitmarker 25, compass 30, health 40, ammo 41, score 50, killfeed 55, status 60, title 70, death 80, phase 85, scoreboard 90, aimDebug 98, fps 99); re-register an id to replace it. `txt` draws `↑ ↓ ← →` as pixel arrows (Silkscreen has none), for controller prompts.
- Entities: one view per `EntitySnap.id`; core adds `object` to the scene and moves it to the smoothed position/yaw unless `update` returns `false`. Light it with `makeLookMaterial({ texture, dyn: true })` + `setDynLight(mats, match.map!.lightAt(x, y, z))`.
- Match hooks: `start` runs when a match's map is ready (again after a map change), `frame` every frame before rendering.

### Match (`game/match.ts`, read via `currentMatch()`)

`myId`, `me` (MeSnap), `myTeam`, `isEnemy(id)`, `nameOf(id)`, `roster` (Map<id, RosterEntry>), `scores`, `teamScores`, `phase`, `phaseEndsAt`, `results`, `killfeed`, `notices`, `death`, `alive`, `serverTime` (room time now), `netRtt`, `weapon(slot?)` (EffectiveWeapon), `ammo(slot?)` (the HUD's reload / NO AMMO hint comes from `ammoHint` in `hud/ammo-hint.ts`: never RELOAD without reserve), `reloadProgress()`, `raiseProgress()`, `yaw`/`pitch` (with recoil), `spread`, `time` (local secs), `map` (MapScene: `map`, `time` preset, `lightAt`, `world`, `root`, `sky`), `renderer` (`scene`, `cam`, `vmScene`, `gl`, `damage` 0..1 red overlay, `white` 0..1 white-out in the post pass before the dither (Tactical Nuke flash; whoever sets it resets it), `feed` 0..1 camera-feed look (monochrome, scanlines, grain, also over `white`; the Valkyrie rocket cam; whoever sets it resets it), the Glitch killstreak's `glitch` 0..1 (torn rows, half resolution, banding with a Bayer dither, grain) and `glitchBurst` 0..1 (channel split, noise lines), `snapBoost` / `warpBoost` (vertex snap in internal px and affine warp raised above the player's setting) and `holdFrame` (keep last frame's world: a dropped frame); whoever sets them resets them), `remotes.views` (interpolated soldiers: x, y, z, yaw, alive, team...), `effects` (`puff(kind, at, normal)`, `tracer(a, b)`), `controls` (`isHeld(action)`, `consume(action)`, `locked`, `virtualLock`, `enabled`, `triggerHeld`, `adsHeld`; key map `KEYMAP` in controls.ts; keyboard, mouse and controller merged), `aimDebug` (last aim assist result), `net` (MatchNet: `predictor`, `interp`, `lastSnap`, `world`).

`controls.enabled = false` hands the input to a feature (the killstreaks tactical map does this): no buttons go out, mouse look, mouse buttons, devlook drag taps and the wheel are ignored, key releases still register. Set it back to `true` when done.

Feature buttons: held keys go out as `Buttons` bits (G lethal, Q tactical, 4 streak, V/E melee, F use; on a controller LB tactical, RB lethal, D-pad up streak, R3 melee, hold X use); the server sees edges in the `buttons` room event.

Stance: `CROUCH` and `PRONE` are held-state bits that the client latches.
- Keyboard: Z toggles prone. C from prone crouches, Space or Shift stands, and crouch or prone while sprinting dives.
- Pad: B tap crouches and B hold goes prone. B while sprinting dives, and A stands.
- `controls.stanceHint` is set by the match each frame from the predicted body. It drives the dive and lets a refused prone go. See docs/features/movement.md. Rebind by assigning `KEYMAP[code] = action` (frontend owns key settings); keys that are not game buttons (menus, streak selection) can use plain `keydown` listeners while `controls.locked`, but also consume the matching controller press: `controls.consume('streakNext' | 'streakPrev' | 'weaponNext' | 'equipment')` (D-pad right/left, Y, D-pad down; these are `Action`s too, so keys can be bound to them).

### Controller (Gamepad API)

The whole controller path is client-side: it produces the same `Buttons` bits and view angles as the keyboard and mouse, so prediction, netcode and every feature work unchanged. Details and the layout: `docs/features/controller.md`.

```ts
import { gamepad, PadEdges, PAD, padDown, inputDevice, onDeviceChange, rumble, noteUsePrompt } from '../../game/gamepad';
gamepad.snapshot();                  // active pad: { id, buttons: number[] (0..1), axes: number[] } | null (standard mapping)
gamepad.onFrame((s, prev) => {});    // once per animation frame, for menus/overlays
const edges = new PadEdges(); edges.prime(); edges.update().has(PAD.X);   // presses since last call
inputDevice();                       // 'kbm' | 'pad' (last used); <body data-input> follows it
rumble('explosion', 0.7);            // 'fire' | 'hit' | 'explosion'; no-op unless the pad is in use and Vibration is on

import { promptKey, actionGlyph, registerPromptKey } from '../../game/prompts';
txt(g, `HOLD ${promptKey('use')} TO DEFUSE`, ...);               // "HOLD F" / "HOLD [X]"
txt(g, `${promptKey('streak', { brackets: true })} NAPALM`, ...); // "[4] NAPALM" / "[↑] NAPALM"
registerPromptKey('classMenu', () => keyFor('classMenu'));        // keyboard code for a feature-owned prompt action
```

- **One label function.** Every HUD prompt that names a key goes through `promptKey(action)` (keyboard label from `KEYMAP`, so rebinding updates it; Xbox glyphs on the pad). `useKey()` in `hud/waypoints.ts` is `promptKey('use')` plus `noteUsePrompt()`: call it only while a USE prompt is actually drawn, because that tells the pad that X is tap-to-reload / hold-to-use here.
- **Who reads the pad.** The match controls (`Controls.update(dt)`, every frame from the match loop) while the game is engaged and `controls.enabled`; menu navigation (`menus/padnav.ts`) whenever a DOM screen or overlay has the input; a feature that sets `controls.enabled = false` (the tactical map) reads the pad itself through `gamepad` and nobody else acts on it. Buttons held when the game takes the pad back count only after they are released.
- **Engaging without the mouse.** A pad can't take pointer lock, so `controls.requestLock()` with the pad as the last-used device engages a "virtual" lock (`controls.virtualLock`); Start (or Esc) releases it; a click on the canvas upgrades to real pointer lock. Any pad press on the match screen's deploy banner engages.
- **Menus.** padnav focuses the visible screen's buttons/selects/inputs by spatial navigation; A clicks, B clicks a visible `[data-pad-back]` element or sends the Escape key the screens already handle, LB/RB click the neighbouring `[role=tab]`. Give a screen's cancel/continue button `data-pad-back` if it has no Escape handler.
- **Aim assist** (`game/aim-assist.ts`, pure): applied by the match to the controller's look only, never to the mouse. Targets are `remotes.views` that are alive enemies with world line of sight (`world.lineOfSight(.., 'sight')`) and no registered sight blocker. Gates: Settings (`settings.aimAssist`), `registerAimAssistGate` (the frontend's lobby rule). Debug overlay: `?aimdebug=1`.
- **Settings keys** (core `settings.ts`): `padSensitivity` (1..10), `padInvertY`, `padDeadzone` (0.05..0.3), `padVibration`, `aimAssist` ('off' | 'light' | 'standard').

### Net (`net.ts`)

```ts
import { net } from '../../net';
net.on('snap', (m) => { ... });                            // any ServerMessages type; returns unsubscribe
const res = await net.rpc('economy.buy', { item: 'camo_tiger' });   // typed by RpcMap; rejects on error/timeout
net.profile;  net.on('profile', ...);  net.serverTime();  net.rtt;  net.onStatus((s) => ...)  // idle|connecting|waking|online|offline
net.quickplay('tdm'); net.joinRoom(id); net.leaveRoom();   // the match screen does this for you: navigate('match', { room: id })
```

When the server replaces the gun in the current slot (a weapon pickup, a wager handing out the next gun), `Match` drops the predictions for the old gun and raises the new one over its swap time.

Netcode as built: inputs every frame (split to <= 50 ms), sent in batches at <= 60 Hz; prediction with `stepMove` and `snap.me.params`, replay of unacked inputs on each snapshot, error eased (snap past 0.5 m); remotes drawn 100 ms behind the quickest snapshot delivery, extrapolated up to 100 ms; `fire.time` = that render time; spread tracer uses the server's seed (`hashString(myId)`). Ammo, reload and weapon switch are predicted until the server acks the input that caused them.

### Rendering extension

```ts
registerTexture('nuke_house', { w: 64, h: 64, draw(g, w, h, R) { ... }, photos: ['brick_wall'], photo: (c) => c.fromPhoto('brick_wall', { filter: 'sepia(.3)' }) });
registerViewmodel('famas', (c) => { const gm = c.mat('gunmetal', { rep: 0.25 }); c.box(...); return { muzzle, hip, ads }; });
registerPropBuilder('gltf', (prop, ctx) => object3d);      // render custom MapData prop kinds
sfx.register('dogbark', (ctx) => audioBuffer); sfx.play('dogbark', { at: { x, y, z } });
sfx.registerSample('dogbark', { files: ['ks_bark'], pitchJitter: 0.03, maxVoices: 4 });   // recorded variants (assets/sfx/<file>.mp3)
```

- Sounds: an id can have a synthesized voice (`sfx.register`) and recorded variants (`sfx.registerSample(id, SfxBinding)`). Recordings load lazily (fetch + decodeAudioData, cached) after the first user gesture; until an id's files have decoded, or if they fail, its synth voice plays (or `binding.fallback`'s), so nothing goes silent. The game's recordings are declared in `src/shared/defs/sfx-recipes.ts`: `SFX_RECIPES` (how `scripts/sfx-build.ts` cuts each file from the approved raw downloads in docs/audio/sfx-manifest.md, or renders a radio cue from `sfx-cues.ts`) and `SFX_BINDINGS` (id -> variants, gain, pitch, EQ, pitch/volume jitter, `maxVoices`), registered by `audio.ts` itself. Ids that stay synth-only are listed in `SFX_SYNTH_ONLY`; `tests/sfx.client.test.ts` fails on an id that is in neither. To add one: add a recipe + binding, run `npx tsx scripts/sfx-build.ts --manifest` (also writes `sfx-credits.ts`), check it with `npx tsx scripts/sfx-audit.ts`, commit `assets/sfx/`. Keep processing conservative (tested): no echo/bitcrush/reverse, build-time pitch within 3%, per-weapon rate within 6%, per-shot jitter within 3% / 1.5 dB.
- `sfx.play(id, { at, volume, rate, lowpass, range })`: positional sounds go to the world bus and darken with distance (`airLowpass`); `range: 'far'` uses a long-range panner. Each play picks a variant (no back-to-back repeat) and varies pitch/volume slightly; each id has a voice cap (oldest fades out) and there are 48 voices overall. Master: volume x make-up -> gentle glue compressor -> safety limiter. No ducking. `sfx.ensureLoaded(id)` loads an id's files now (the Settings sound test uses it).
- `sfx.gunshot(weaponId, at?, suppressed?)`: `shot.<id>` / `shot.<id>.sup` recordings (per-weapon variant pools, gentle EQ and a rate within +-6% over shared class recordings, `WEAPON_SHOTS`); remote shots get a gentle distance low-pass and, from ~40 m (`DISTANT_FROM` in `sfx-mix.ts`), crossfade (equal power) from the near recording to `shot.distant`, which has fully replaced it by ~90 m. Suppressed shots never get the distant layer.
- Footsteps: `stepSound(map, x, y, z)` (`game/surfaces.ts`) picks `step.<surface>` (concrete, grass, dirt, wood, metal, carpet) from the texture recipe id of the brush under the feet.

- Texture recipes: one id per MapData material texture. Put a map's recipes in `src/client/render/recipes/<map>.ts` (auto-imported). `draw` is the lo-fi/PS1 version (posterised, also the instant fallback); `photo` is the developed look (`'auto'` photoifies the drawing, `'sky'`, `'small'`, `'none'`, or a function using `c.fromPhoto(id, {w,h,tile,filter,over})`, `c.photoify`, `c.photo(id)`, `c.rr`); list photo ids in `photos` (files in `assets/textures/<id>.jpg`). Results are cached in IndexedDB by recipe source hash. Unknown ids render magenta and warn once.
- Camos: register recipes named `camo.<camoId>`; viewmodel builders receive it as `c.camo`.
- Viewmodels: `WeaponDef.model` picks the builder (fallback `ak47`); `c.attachments` lists attachment ids to model.
- Look materials: `makeLookMaterial({ texture, uvMul|rep, tint, emissive, side, bake, fog, affine, dyn })`.

Settings: `settings.<key>` + `updateSettings`; feature settings go under `settings.ext.<area>` (declaration-merge `SettingsExt` in `settings.ts`).

## 13. Weapon behaviours

Hitscan is the default for every weapon: each pellet goes through the walls it can (below) and is stopped by the next one (`bullets` mask), then by the nearest hitbox before that.

Hitboxes:
- `playerHitboxes(feet, stance, yaw)`, where `stance` is `'stand' | 'crouch' | 'prone'` or the old `crouched` boolean.
- A prone body lies along `yaw`, with the head at the movement position and the legs 1.6 m behind. Its parts are turned boxes that `rayHitboxes` tests exactly (`hb.local`); the `head` / `torso` / `legs` AABBs bound them.
- Use `moveHitboxes(p.move, p.yaw)` for a live player and `poseHitboxes(pose)` for a recorded one. Lag compensation poses carry `prone` and `yaw`.
- Fully prone shooters get `stanceSpread` (×0.65) on top of `spreadMultiplier`. Brushes marked `bullets: false` (thin boards, fences, foliage) let every bullet through at full damage; anything else with `bullets` collision is a wall for the penetration rules below. Human shots rewind targets to the shooter's view time (`HitboxHistory`, at most `MAX_REWIND_MS`); a shot at the present (bots: `room.fire` without `time`) uses live positions. `traceShot(room, p, origin, dir, shot, poses?)` (combat.ts) traces a trigger pull's pellets without firing (no ammo, no damage), with the same spread seed as `fire`; each `Pellet` carries the `walls` it went through, the damage `keep` and the falloff `range`.

Penetration (`src/shared/penetration.ts`, pure, used by the server's `traceShot` and the client's predicted impacts; BO1-flavoured, kept small):
- **Human shots only.** A bot's bullets stop on the first wall (`p.isBot`): bots fire only when they see the target and the path is clear (`bots/sight.ts`), so a bot never hurts anyone through a wall.
- **Type per weapon** (`WeaponDef.penetration`, default by class like BO1's `penetrateType`): `small` pistols and SMGs, `medium` ARs and LMGs, `large` snipers, `pellet` shotgun pellets, `none` launchers, the knife and anything with a `WeaponBehavior`. The type is a depth: the most wood one wall may be (`PENETRATION.depth`: pellet 4 cm, small 15 cm, medium 30 cm, large 45 cm).
- **Walls.** A wall's thickness is the ray's entry-to-exit distance through the solid (`raySpan` in collision.ts); solids that touch or overlap along the ray (within 2 cm) are one wall. Each metre is weighted by the material (`penetrationMaterial(map, mat)`, by texture name then material id, unknown = masonry): soft (plaster, drywall, fabric) ×0.5, sheet metal ×0.5, wood ×1, masonry (concrete, brick, block, facade, tile) ×10, solid (rock, stone, earth, sand, sandbags, steel, beams, stairs, tanks, bullet-stopping glass, clips, glTF collision boxes) never. A wall heavier than the depth stops the bullet.
- **Rules.** At most `PENETRATION.maxWalls` (2) walls per bullet. Each wall keeps ×0.75 of the damage when paper thin, down to ×0.5 at the depth limit (`wallKeep`); walls multiply. After each wall every metre counts double for damage falloff and for the weapon's range (`effectiveDistance`). An AR through a 25 cm Nuketown house wall keeps ×0.54; nothing goes through a concrete wall or rock.
- **Hardened**: the `penetrationMultiplier` modifier (core key, product; the perks feature registers ×2 for Hardened, BO1 `perk_bulletPenetrationMultiplier`) multiplies the depth, so the same wall also costs less damage.
- **Flags.** `DamageInfo.penetrated` (every pellet that hit went through a wall), the `hit` message's `pen` (hitmarker bracket), `death.penetrated` and the `killfeed` message's `pen` (killfeed icon). The `fire` event's `walls` and `ShotSnap.x` carry the first pellet's entry and exit points (impact puffs on both sides for everyone, and the killcam's `DeathcamShot.pen`).

For projectiles, melee or anything else:

```ts
api.registerWeaponBehavior('launcher', {
  fire(room, player, weapon, shot) {   // ammo/rate/sprint already validated, ammo consumed
    room.entities.add({ kind: 'rocket', x: shot.origin.x, y: shot.origin.y, z: shot.origin.z, yaw: player.yaw, owner: player.id, data: { dir: shot.dir } });
  },
});
```

Weapons-area extensions (see `docs/features/weapons.md`):

- `WeaponBehavior` stays as above. Burst cadence (`mode: 'burst'`, `burst`, `burstDelayMs`) is enforced in core `fire()`; torso hits below the torso middle use `multipliers.lowerTorso` when a weapon defines it (`isLowerTorso` / `partMultiplier(w, part, lower)` in `ballistics.ts`).
- Modifier keys the weapons feature reads (declared in `weapons/state.ts`): `attachmentSlotsOffset(p, loadout)` (sum, extra PRIMARY attachment slots, read at `beforeSpawn` with the loadout being spawned; Warlord returns 1), `equipmentCountOffset(p, 'lethal' | 'tactical')` (sum, spawn count and refill cap; Warlord Pro returns 1), `tacticalMultiplier(victim)` (product, flash/concussion strength and duration; Tactical Mask 0.35), `meleeSpeedMultiplier(p)` (product, knife cooldown/recovery; Steady Aim Pro 0.7), `holdBreathMultiplier(p)` (product, scope breath, sent as `weapons.equip.breath`; Scout 2). Weapons listens to `perks.resupply` (Scavenger Pro grenades).
- Room events: `weapons.thrown {player, equipment}`, `weapons.retrieved {player, equipment}` (a tomahawk picked back up), `weapons.tactical {player, victim, equipment, amount, duration}` (Tactical Mask Pro listens), `weapons.melee {player, victim}`, `weapons.detonated {player, equipment, effect, x, y, z, radius, max, min}` (equipment went off: frag, semtex, launcher round `gl`, flashbang, concussion; the killstreaks feature hurts hardware with it and stuns turrets). Economy adds `economy.boltStuck {player, victim}` and `economy.bladePickup {player}`.
- Lethals and tacticals are raised on the LETHAL / TACTICAL press and thrown when the button is released (a one-tick press throws right after the 0.35 s wind-up); cookable ones (frag) burn their fuse while held. Bots that pulse the button are unaffected; a bot that holds it keeps the grenade up.
- Client: `ViewmodelSpec.animate(state)` (runs after the rig placed the group; `reload: 'none'` skips the generic dip) and `ViewmodelRig.action(kind, dur, hold?)` (`hold` keeps the last pose until another action or `endAction()`; `currentAction` reads it). The weapons feature plays `ready:<equipment>` (held) on the press and `release:<equipment>` on release; `actionHands(c, gunRoot, hip)` (weapons client) gives any viewmodel the knife and throwing hands; `Soldier.gun` (the default rifle group, hidden by the weapons feature's third-person models); `sfx.gunshot` plays a registered `shot.<weaponId>` voice when present; key `Digit3` = action `weapon3` (slot 2, the underbarrel launcher).

## 14. Tests

`tests/fake-client.ts` (`FakeClient.connect(url, name)`, `.send`, `.input(buttons, yaw, pitch)`, `.waitFor(type, pred)`) and `startServer({ port: 0, dbPath: ':memory:', staticDir: null, log: () => {} })` give you headless integration tests through the real server; `tests/integration.test.ts` is the example (two clients, a kill, killfeed and score). For rules-level tests drive a room directly: `new Lobby({ store: new Store(':memory:'), features: [yourFeature], log: () => {}, autoTick: false }).createRoom({...})` and call `room.step()` (see `tests/room.test.ts`).

`tests/playtest.client.test.ts` covers respawn, health regen, prediction holding under steady input (the browser's `MatchNet` reconciling every snapshot), lag compensation against a sprinting target (with a no-rewind control shot) and match end on the score limit, all over real sockets. `tests/controller.client.test.ts` drives a fake `Gamepad` (`setPadSource` in `game/gamepad.ts`) through the real `Controls` into a real `MatchNet` against the server; the pure controller maths and aim assist are in `tests/pad.test.ts` and `tests/aim-assist.test.ts`. Tests that import browser modules (`src/client/net.ts` and friends) must be named `tests/**/*.client.test.ts`: the root tsconfig skips them and `tsconfig.tests-client.json` typechecks them with the DOM lib (part of `npm run typecheck`). Note that `FakeClient.waitFor` also matches messages already received: filter by `time` or message index when waiting for a second `spawned`, a later `snap`, etc.
