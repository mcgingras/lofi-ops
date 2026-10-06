# Lo-Fi Ops: core contracts

What the core gives every feature area, and exactly how to plug in. Read `docs/DESIGN.md` first (the why); this file is the how. If you must change a contract here, change this file in the same commit and say so in your report.

```
npm run dev        server (tsx watch, :8787) + Vite (:5173, proxies /ws and /api)
npm run build      typecheck (server + client tsconfigs) then vite build -> dist/client
npm run typecheck
npm test           vitest: unit + headless integration (real server on a random port)
npm start          serves dist/client and the game server on one port (PORT, default 8787)
```

Env: `PORT`, `LOFI_DB` (sqlite path, default `data/lofi.db`).

## 0. Rules of the road

- Everything is TypeScript strict, ESM, extensionless relative imports, `import type` for types (`verbatimModuleSyntax`).
- `src/shared` is pure: no DOM, no Node APIs. The client tsconfig has no Node types and the server tsconfig has no DOM, so a violation fails `npm run typecheck`.
- You own your folders: `src/server/features/<area>/`, `src/client/features/<area>/`, your defs file(s), your maps, your tests. Core files (`protocol.ts`, `events.ts`, `room.ts`, `combat.ts`, `sim.ts`, `main.ts`) are extended through the hooks below, not edited. If you truly need a core change, keep it minimal and call it out.
- Namespacing: your feature id (`perks`, `killstreaks`, `progression`, `economy`, `frontend`, `bots`, `modes`, `weapons`) prefixes your RPC ids, feature messages, custom events, `profile.ext` key and modifier ids: `killstreaks.call`, `profile.ext.economy`.
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
| `death` | `{ victim, attacker, weapon, headshot, distance, assisters, part, means, victimStreak, attackerStreak }` | stats (kills/deaths/assists/streak) are already updated |
| `fire` | `{ player, weapon, origin, dir, hits[], end }` | one per trigger pull |
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
| `regenDelayMultiplier` | `(p) => number` | product | health regen delay (5 s) |
| `maxHealthMultiplier` | `(p) => number` | product | at spawn (hardcore 0.3) |
| `streakCostOffset` | `(p) => number` | sum | for the killstreaks feature to read |
| `radarVisible` | `(target, viewer) => boolean` | any false wins, else any true | minimap (`snap.radar`) |
| `radarJammed` | `(viewer) => boolean` | same | `snap.jammed` |

Read them yourself with `room.modifiers.mul(key, ...args)`, `.sum(...)`, `.any(...)`. Radar default when nobody votes: enemies who fired an unsuppressed weapon in the last 1.5 s. A UAV returns `true` for enemies of its owner's team; Ghost returns `false` from its own `radarVisible` only when the target isn't revealed by firing (so the two compose).

New key:

```ts
declare module '../../modifiers' {
  interface ModifierMap { meleeRangeMultiplier: (p: PlayerState) => number | undefined }
}
```

## 4. Per-player feature state

`PlayerState` (`src/server/player.ts`) has `id, name, isBot, session, profile, team, alive, health, maxHealth, move (MoveState), yaw, pitch, buttons, loadout, weapons[], slot, stats {kills,deaths,assists,score,headshots,streak,bestStreak}, respawnAt, brain, ext`.

```ts
declare module '../../player' {
  interface PlayerExt { killstreaks?: { earned: string[]; kills: number } }
}
room.bus.on('death', ({ attacker }) => { if (attacker) (attacker.ext.killstreaks ??= { earned: [], kills: 0 }).kills++; });
```

Room API features use: `room.players` (Map), `humans()`, `bots()`, `isEnemy(a,b)`, `canDamage(a,b)`, `enemiesOf(p)`, `addBot({name, team, loadout})`, `removePlayer(id)`, `spawn(p, point?)`, `damage(info)`, `kill(victim, attacker, how)`, `radiusDamage(center, radius, max, min, {attacker, weapon, means})`, `fire(p, {dir, time?})` (bots), `addTeamScore(team, n, reason)`, `addPlayerScore(p, n, reason)`, `endMatch(reason)`, `world` (CollisionWorld: `raycast`, `lineOfSight`, `groundBelow`, `free`), `map` (MapData), `mode` (ModeDef), `time`, `phase`, `entities`, `send(p, msg)`, `broadcast(msg)`, `sendFeature(p | null, id, data)`.

**Entities** (killstreak vehicles, dogs, packages, flags): `room.entities.add({ kind, x, y, z, yaw, owner?, team?, s?, data? })` returns the entity (with `id`); move it in a `tick` handler; `remove(id)`. Everything except `data` goes out in each snapshot as `EntitySnap`; the client renders by `kind`.

**Bots**: set `player.brain = { think(room, self, dt) { return { buttons, yaw, pitch, weaponSlot } } }` (runs every tick through the same movement as humans; return `null` to idle), and call `room.fire(self, { dir })` to shoot (rate/ammo/sprint rules apply). Navigation: build from `room.map.brushes` / `room.world`. `RoomOptions.botFill` keeps humans + bots at N.

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

Server: `welcome`, `joined {roomId, you, mode, map, team, phase, tickRate, snapshotRate, time, timeLimit, scoreLimit}` (also re-sent on map change), `left`, `rooms`, `roster {players}`, `snap` (20 Hz), `killfeed`, `hit` (hitmarker, to shooter), `hurt` (to victim, with direction), `died`, `spawned {x,y,z,yaw,loadout}`, `score {teams, players}`, `phase {phase, time, endsAt}`, `matchEnd {results}`, `profile {profile}` (after match end), `feat`, `rpcResult`, `pong {t0, time}`, `error {code, message}`.

Netcode contract for the client:

- `InputCmd {seq, dt, buttons, yaw, pitch, weaponSlot}`; quantise yaw/pitch with `quantizeAngle` before using them locally (the server does). Send at frame rate, batched (<= 64 cmds per message), `dt` <= 0.05.
- Predict with `stepMove(world, state, buttons, yaw, dt, snap.me.params)` from `shared/movement.ts`; `world = buildCollisionWorld(getMapData(mapId))`. On each `snap`: take `snap.me.move`, drop inputs with `seq <= snap.ack`, replay the rest; snap if the error > `RECONCILE_SNAP_M` (0.5 m) else smooth. Reset on `spawned`.
- Remote players: interpolate `snap.players` `INTERP_DELAY_MS` (100 ms) behind, in room time (`snap.time`).
- Shots: on each trigger pull send `fire` with `seq` = last input seq sent, `time` = the room time you are rendering remote players at, `origin` = your eye, `dir` = aim before spread, `shot` = a per-pull counter. The server applies spread with `spreadDirection(dir, spreadDegrees(...), shotSeed(hashString(playerId), shot, pellet))` (`shared/ballistics.ts`), so the client can draw the same tracer. Firing is refused while sprinting / within sprint-out, reloading, switching, out of ammo (auto-reload), or faster than the weapon's rpm.
- `PlayerSnap.f` bits: `PlayerFlags` (ALIVE, CROUCH, SPRINT, ADS, GROUND, RELOADING, FIRING, SWITCHING).

Codec: JSON behind `Codec`; `setCodec()` swaps it on both sides.

## 7. Definitions (src/shared/defs)

Each file exports a typed array and a `*_BY_ID` map (`indexById` throws on duplicates). Owners fill them in; keep ids stable (profiles store them).

| file | exports | owner |
|---|---|---|
| `weapons.ts` | `WeaponDef`, `WEAPONS`, `WEAPON_BY_ID` (seeded: `ak47`, `m1911`) | weapons |
| `attachments.ts` | `AttachmentDef`, `ATTACHMENTS`, `effectiveWeapon(def, ids)` (seeded: `reddot`, `extmag`) | weapons |
| `perks.ts` | `PerkDef`, `PERKS` (seeded: lightweight, hardline (T1), steady_aim (T2)) | perks-streaks |
| `killstreaks.ts` | `KillstreakDef`, `KILLSTREAKS` (seeded: `uav` "Spy Plane", 3) | perks-streaks |
| `modes.ts` | `ModeDef`, `CORE_MODES` (tdm 75 kills / ffa 30 kills, 10 min), `MODES` = core + `WAGER_MODES` | modes |
| `economy.ts` | `CP_REWARDS`, `STARTING_COD_POINTS`, `DEFAULT_PRICES`, `WAGER_MODES`, `codPointsForMatch` | economy |
| `maps.ts` | `MapDef {id, name, inspiredBy, build, modes, size}`, `MAPS`, `getMapData(id)` (cached), `mapsForMode` | maps-bo, maps-mw2 |
| `progression.ts` | `MAX_LEVEL` 50, `MAX_PRESTIGE` 15, `XP_TABLE`, `levelForXp`, `xpForLevel`, `addXp`, `canPrestige`, `applyPrestige`, `XP_SOURCES` | progression |
| `challenges.ts` | `ChallengeDef`, `CHALLENGES` (seeded: `tdm_kills`) | progression |
| `camos.ts` | `CamoDef {recipe: CamoRecipe | null}`, `CAMOS` (seeded: `none`) | economy |

Also shared: `loadout.ts` (`Loadout`, `DEFAULT_LOADOUTS`, `sanitizeLoadout` = structural only, no unlock checks), `profile.ts` (`Profile`, `newProfile`, `bumpStat`), `ballistics.ts`, `collision.ts`, `movement.ts`, `math.ts` (`viewDir`: yaw 0 looks down -z).

Wager modes: economy appends to `WAGER_MODES` in `economy.ts` and registers rules from its feature `setup` (`api.registerMode('oitc', factory)`), so `modes.ts` stays the modes owner's.

## 8. Mode rules (src/server/modes)

```ts
export interface ModeRules {
  id: string;
  setup(room): void;                         // subscribe to room.bus (death -> score)
  reset?(room): void;                        // each match start
  assignTeam?(room, p): Team | null;         // default: smaller team / null
  spawnPoints?(room, p): SpawnPoint[];       // default: map.spawns.teams[team] or .ffa
  respawnDelay?(room, p): number | null;     // default: 3 s if mode.respawn, null = wait for round
  checkEnd?(room): reason | null;            // on score change + every second
  results?(room, reason): MatchResults;      // default: standardResults
}
registerMode('dom', () => domRules());       // modes/index.ts or a feature setup
```

Rules' bus handlers and modifiers are tagged with the rules object, so `room.setMode()` drops them cleanly. Time limits are enforced by core (`mode.timeLimitSec`). Results go out as `matchEnd` with `MatchResults {roomId, mode, map, reason, winnerTeam, winners, teamScores, players: PlayerResult[], durationSec, ext}`.

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
  objectives: Record<string, ObjectivePoint[]>;  // 'dom' A/B/C, 'sd' sites, 'hq'... { id, x, y, z, radius, team? }
  times: TimePreset[]; defaultTime;              // sky recipe id, sun/amb/fog, light group intensities
  hotspots?: Vec3[];                             // bot roam targets
}
```

- min/max are the collision AABB. `ry` only rotates the rendered box (x/z extents swapped when |sin ry| > 0.5, like the prototype). `collide: false` = trim (no players/bullets/sight); per-channel overrides make fences (`players: true, bullets: false, sight: false`) and clips (`noRender: true`).
- UVs: world-scaled metres x `uvMul` (prototype `worldUV`), or `uv: 'raw'` for 0..1 per face. Renderer subdivides ~1 segment per 1.1 m for vertex lighting.
- `buildCollisionWorld(map)` (cached) gives the `CollisionWorld` for server, prediction, bots and the bake's shadow rays (`sight` mask).
- `tests/collision.test.ts` checks every registered map: spawns on the ground, free and in bounds; every material referenced exists.

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

Room flow controls for the frontend's real lobbies: `room.setMap(id)`, `room.setMode(id)` (lobby phase), `room.startMatch()`, `room.returnToLobby()`, `room.endMatch(reason)`, `room.phase`, `room.summary()`. A per-game lobby = `createRoom({ autoStart: false, onEnd: 'lobby', countdownSec: 10, botFill })` + your own RPCs for map vote / ready / start.

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

Loaded at `hello` (`session.profile`, also `player.profile` in a room). Mutate it on the server; core saves it at match end (after `matchEnd` handlers), when leaving a room and on disconnect, and sends the owner a `profile` message after match end. Save immediately yourself (`api.store.save(profile)`) for menu purchases. No schema migrations needed: add fields under `ext.<you>` or new `stats` keys.

## 12. Client extension points (src/client/registry.ts)

```ts
registerScreen('barracks', (root, params) => { root.append(...); return () => root.replaceChildren(); });
registerHudWidget('killstreaks', (g, w, h, dt) => { /* draw at render resolution */ }, order);
onFeature('killstreaks.earned', (data) => { ... });   // typed by FeatureMessages
```

The client stage wires these into routing (`main.ts`), the pixel HUD and `net.ts`. Client feature code lives in `src/client/features/<area>/`.

## 13. Weapon behaviours

Hitscan is the default for every weapon. For projectiles, melee or anything else:

```ts
api.registerWeaponBehavior('launcher', {
  fire(room, player, weapon, shot) {   // ammo/rate/sprint already validated, ammo consumed
    room.entities.add({ kind: 'rocket', x: shot.origin.x, y: shot.origin.y, z: shot.origin.z, yaw: player.yaw, owner: player.id, data: { dir: shot.dir } });
  },
});
```

## 14. Tests

`tests/fake-client.ts` (`FakeClient.connect(url, name)`, `.send`, `.input(buttons, yaw, pitch)`, `.waitFor(type, pred)`) and `startServer({ port: 0, dbPath: ':memory:', staticDir: null, log: () => {} })` give you headless integration tests through the real server; `tests/integration.test.ts` is the example (two clients, a kill, killfeed and score). For rules-level tests drive a room directly: `new Lobby({ store: new Store(':memory:'), features: [yourFeature], log: () => {}, autoTick: false }).createRoom({...})` and call `room.step()` (see `tests/room.test.ts`).
