# Blackout (feature area: `blackout`)

A 100-player last-man-standing mode in the style of Black Ops 4's Blackout: one human (or a few)
and bots, 100 in all, drop from a plane onto one big island stitched together from the classic
maps. Everyone starts with a knife, loots guns, armour, heals, ammo and grenades from the floor,
and stays inside a shrinking circle. There are no respawns, and the last one alive wins.

```
src/shared/defs/blackout.ts        BLACKOUT tuning, GLIDE (drop physics), circle timeline (buildCircles,
                                   circleState, phaseTimes), the plane (planePath, planeAt), loot rolls
                                   (rollLoot, rarities, ammo types), placementXp, wire types
src/shared/maps/blackout.ts        the island: BLACKOUT_TOWNS, importTown (cut a town out of a map),
                                   terrainTiles (open ground around the towns), buildBlackout
src/server/features/blackout/      index (feature: mode, bot brain, RPCs), rules (ModeRules), game (the
                                   match: plane, drop, circle, armour, heals, places, far fights, LOD),
                                   loot, interest (snapshot filters), brain (bot brain: the goal stack),
                                   nav (the island's navigation: town grids + open-ground grid), state
src/client/features/blackout/      store, hud (HUD widgets, big map, core wraps), world (plane, loot,
                                   circle wall, chutes, cameras, soldier culling), menu
tests/blackout.test.ts             rules, physics, loot, interest, a 100-player room on a time budget
tests/blackout-reach.test.ts       reachability: no invisible walls, the open ground and every town
                                   walkable from the drop zone, nothing the source maps reach is lost
tests/blackout-bots.test.ts        bot behaviour: a seeded match (idle, stuck, circle deaths), the goal
                                   stack, commitment, routes, giving up unreachable goals
tests/blackout-harness.ts          a Blackout room with fake sockets (tests and the scripts)
tests/blackout-metrics.ts          bot-time metrics (idle, stuck, still, goal kinds, deaths by cause)
scripts/blackout-bench.ts          server benchmark: tick ms, snapshot bytes, memory over a match
scripts/blackout-sim.ts            bot behaviour over a seeded bots-only match (the metrics above)
```

## Playing it

- Main menu: **Blackout** (100 players, solo), or **Multiplayer → Quick Play → Blackout (100)**.
  Both call `blackout.solo`: a private lobby that starts as soon as you are in, with bots filling
  it to 100. The `blackout` playlist also works through matchmaking (`DEFAULT_TARGET_PLAYERS.blackout`
  = 100).
- Keys: **Space** jumps from the plane, and in freefall it opens the chute (it opens by itself at
  38 m). **WASD** steers. **F** (USE) picks up a gun: it goes into an empty slot first, else it
  swaps for the gun in your hand. Ammo, armour, heals and frags are taken by walking over them.
  **4** heals: a med kit when you are badly hurt (or have no bandages), else a bandage. You can't
  fire or sprint while healing. **M** shows the big map (tap to toggle, hold to peek). After death,
  **F** watches the next player and **Esc** leaves.
- The mode def is `blackout` in `CORE_MODES`: FFA, no respawn, no score or time limit, 100 players.
  Only the `blackout` map lists the mode, and the other maps leave it out.

## Rules

| what | how |
|---|---|
| Plane | Everyone spawns aboard (`rules.spawnPoints` = the line's start); during the countdown the plane is already there and you watch from behind it (the client gets your stage before play starts). The line is random per match and seeded: it crosses the island and passes within a third of the half-size of the centre. It flies at 150 m and 18 m/s, about 30 s to cross. The doors open after 2 s. Anyone still aboard is pushed out 2 s before the end. While aboard you are alive, can't be hurt, and fly with the plane: `glide` all zeros keeps the velocity, so the client predicts it exactly. |
| Drop | Jumping keeps the plane's heading at up to 14 m/s. In freefall gravity is 22, the fall is capped at 44 m/s, and you steer at up to 16 m/s. The chute opens at 38 m above the ground, or earlier with Space (above 8 m). It brakes the fall to 6 m/s and steers at up to 11 m/s. Touching the ground lands you. No shooting or ADS in the air. |
| Loadout | A knife in both slots. No perks, streaks or equipment. The slots fill from the floor. |
| Loot | Spots on the map's floors, about one per 75 m² of town, indoors first and 2.5 m apart, plus about 90 on open ground. Each gets an item with 82 % chance, so about 640 items per match (the benchmark seed: 644), capped at 1100 loot entities. Rolls are 45 % weapons: rarity common / rare / legendary (60/30/10) with 0 / 1 / 2 attachments, and a 3 % Ray Gun chance on legendary rolls. The rest are items: ammo by type (pistol, smg, rifle, sniper, shells), armour level 1-3, bandages, med kits and frags. Guns are `pickups_weapon` drops that never expire (`setPickupRules(room, { keep, cap })`). Items are `blackout_loot` entities. The dead drop their other gun, a heal and their vest. |
| Armour | 50 points per level. It soaks 65 % of bullet, blast, knife and fire damage while it lasts, but never the circle's. |
| Health | 100, no regeneration (`regenDelayMultiplier` 1e6). Bandage: +25 over 2.5 s, carry 6. Med kit: +100 over 5 s, carry 2. |
| Circle | It starts covering the whole island, then runs 7 phases of wait-then-shrink over 13.1 min: radii 210, 135, 85, 52, 30, 14, 0 m; damage 1, 2, 4, 6, 9, 13, 20 HP/s; 30 HP/s once closed. Each next circle lies inside the last, its centre seeded. Damage is applied once a second to everyone outside. |
| Places | A death or a leave places you at the number still alive plus one. When one is left, they win (place 1) and the match ends 1.5 s later. If the last ones die in the same moment, the last to go wins. Results are sorted by place (`results.ext.blackout = { places, winner, total }`). |
| XP | The progression `objective` event `blackout.placement` carries `data.xp = placementXp(place)`: 1500 for the win, 600 top 5, 400 top 10, 200 top 25, 100 top 50, else 50. Kills pay as usual. |
| Spectating | After death you watch your killer, or the nearest player alive. F (`blackout.spectate {next: true}`) cycles through the players alive. If the one you watch dies, you follow their killer. Interest management follows whoever you watch. |

## Map (`shared/maps/blackout.ts`)

The island is 512 x 512 m (x, z in [-256, 256]). Invisible `perimeter` walls stand at the shore up
to 210 m, and the sea is drawn beyond them. Ten towns are cut out of the existing maps (`importTown`):
brushes, decals, props and lights inside a cut rectangle are moved into place, and material ids are
prefixed per town, then deduplicated by look. What the import does with the source map:

- Brushes crossing the cut are clipped (plain boxes) or dropped (ramps, turned boxes, invisible
  clips, walls taller than 5 m: the arena walls). Things standing on the floor that cross the cut by
  no more than 1.2 m (stairs, crates) are kept whole: cutting stairs dropped them, and the floor
  they lead to could not be reached (Scrapyard's north deck).
- Brushes tagged `perimeter` or `roof` are dropped, and so are invisible players-only clips taller
  than 5 m anywhere in the cut: the source maps' out-of-bounds walls (Terminal's tarmac edge, a
  20 m wall across the town; Scrapyard's corner pocket).
- Zombies doors and debris (`gate`) are left out: the doorways stand open.
- Window clips (`clip` tag, above the floor) go, and `TownDef.open` boxes remove the brushes wholly
  inside them: Nacht's bunker (zombies climb in through its windows; players never could) gets four
  ground-floor doorways from the field.
- Where a cut has no floor at all (Summit's mountaintop stands in the void), open ground fills it
  (`holes`).

| town | from | at (x, z) |
|---|---|---|
| Nuketown | nuketown (the two houses and the cul-de-sac) | (-150, -175) |
| Rust | rust (the whole yard and the tower) | (175, -175) |
| Firing Range | firingrange | (-175, 30) |
| Summit | summit (control room, gallery, tower) | (15, -170) |
| Hanoi | hanoi (the prison and the street) | (165, 45) |
| Terminal | terminal (security, shops, the plane) | (30, 180) |
| Scrapyard | scrapyard (the cut takes in the office stairs) | (-150, 178.75) |
| Launch | launch (the rocket pad), the island's centre | (0, 10) |
| Yard | yard (the original look prototype) | (-60, -85) |
| Nacht | nacht (the bunker, with doorways, and the airfield) | (170, 190) |

**Open ground.** Flat tiles at y = 0 partition the island minus the town rectangles out to 10 m
from the shore (`terrainTiles`, at most 64 m), then a 10 m sand beach and a sand slope (drawn only)
into the sea. Every tile and hill is one material, `ground`:

- Textured in world space (`MaterialDef.worldUV`: upward faces take x, z as UVs), so it runs on
  seamlessly across tiles of any size, at 4 m a texture tile like the classic maps' grass; 2 m
  segments for the vertex lighting.
- Grass with a slow colour drift (`vary`), turning to dirt (`blend`) where the map's `blendMask`
  says: pads round every town (10 m feather), tracks 5 m wide from every town to Launch, and a fringe
  before the beach. The mask is evaluated per vertex, a world-space noise breaks it up, and the edge
  is a stipple fixed in world space (no shimmer).
- The old look was a 64 m checkerboard of two grasses, dirt tiles round the towns and flat road
  strips (one quad each) that ran through hills and over town floors.

**Hills** (about 20): a plateau, four 1:4 ramps and four corner fans of ramp strips stepping down at
most 0.35 m (under the step height), so they read as mounds and can be walked up from anywhere (no
vertical faces). About 70 rocks (sunk 0.3 m into the ground) and about 160 trees (a trunk cylinder
and two leaf blocks, drawn only; foliage hides you from bots). Hills, rocks and trees keep off the
towns, the tracks and the beach.

Rendering: `MapData.chunk` (96 m) splits the merged meshes per chunk, and `MapData.drawDistance`
(200 m) culls chunks beyond it. The fog (55-185 m by day) hides the cut, and in the air
(plane, freefall) the fog and the draw distance grow with height. The circle's wall fades in only
within about 150 m of its edge: the first circle stands out past the sea, and its additive band
across the whole horizon read as a pink sky with a hard edge. The bake buckets lights and
ground-AO solids by cell (same result, much faster on a map with 300 lights and 8000 solids).

**Reachability** (`tests/blackout-reach.test.ts`): no invisible players-only clip taller than 5 m
and no gates; the ground under several plane lines stands on walkable open ground; every free spot
at ground level between the towns belongs to the one connected open ground (no walled-off pocket),
and every hill top can be walked up to; every town has more than 20 portals onto that open ground,
over 99 % of its ground-floor cells are reachable from outside and back, and less than 60 m² of what
its source map's own spawns can walk to inside the cut is lost (what remains: a Firing Range roof
and a few ledges reached by jumps outside the cut); 150 random routes all succeed. Found and fixed:
Terminal's and Scrapyard's out-of-bounds walls, Nacht's closed bunker, Scrapyard's dropped stairs
(north deck) and its office stairs outside the cut. `tests/maps-traps.test.ts` still floods the
island region by region with the real movement code (no pits), and `tests/zfight.test.ts` covers it
like any map. `tests/bots.unit.test.ts`'s all-maps nav grid check skips it: its bots use `nav.ts`.

## Bots (`brain.ts`, `nav.ts`)

The bots feature gives Blackout bots this brain through `registerBotBrain('blackout', factory)`
(new hook in `bots/hooks.ts`; the roster then skips the default brain's nav grid). Skill, variance,
names and backfill work as usual.

- **Drop.** At the start each bot picks a landing spot (a ground-floor loot spot nobody else
  picked, or open ground) and jumps where the plane passes nearest it, a few seconds early. It
  glides there.
- **A goal at all times**, from a priority stack (`decide`, every 0.35 s near a human, 0.5 s far):
  1. `heal`: hurt (under 75 %, or under 40-45 % while under fire or outside the zone) with heals and
     nobody shooting at it. It heals standing inside the zone, walking on outside it.
  2. `circle`: outside the safe zone, or outside the next one with too little time to walk in
     (~1.3 x the straight distance at 5.5 m/s, plus 25 s). It heads for an indoor loot spot (or a
     point) well inside, and keeps going until well inside.
  3. `loot`: under-equipped (no gun, under two magazines, no vest or no heals): the best item in
     reach (140 m without a gun, 90 m otherwise) inside the zone, not claimed by another bot.
     Well-equipped bots still pick up what is within 8-14 m.
  4. `fight`: a visible enemy. Near bots perceive and fight with the aim controller (an unarmed bot
     keeps running for a gun unless the enemy is within 7 m). Far bots in a far fight hold their
     ground facing the foe (unarmed ones keep looting).
  5. `hunt` (phase 3 on, half the time): move up on the nearest player within 70 m.
  6. `cover` then `hold`: a building or cover spot inside the next circle (indoor loot spots first,
     late in the match near other players), held crouched for 10-25 s (6-12 s late), then another.
- **Commitment.** A goal is replaced only by one of higher priority, when it is done, or when it
  fails (timed out, the loot gone or claimed, no route, stuck). Failed targets are ignored for a
  minute, so a bot never dithers between goals or walks at a wall twice.
- **Navigation** (`nav.ts`, shared per MapData):
  - `TownNav`: each town plus 8 m of open ground round it gets the bots feature's 0.5 m walking
    grid rules (walk within a step, jump up to 0.98 m with headroom, drop up to 4.5 m), built a
    slice at a time (`buildTownGrid`, ~3 ms a tick while the plane flies) straight into typed
    arrays: about 80 bytes a cell. Core cells are those reachable from the open ground round the
    town and back; portals are core cells 3-7 m outside the town.
  - `GroundNav`: the open ground as a 2 m grid at ground level (a body 0.75 m wide must fit, so
    rocks and trunks block; up 0.7 m a cell at most), only the connected part.
  - `IslandNav.route`: town grid to a portal, the open-ground grid to a portal of the goal's town,
    town grid to the goal. The ten towns and the ground take about 33 MB; the whole island at 0.5 m
    as one NavGrid would be millions of cells (the old reason for having none).
  - Routes are rationed per tick by expanded cells (12000, ~3 ms; a search that runs out gets a
    tick to itself with five times that). No route means the goal is unreachable: given up.
  - Following: near bots string-pull (the farthest of the next few waypoints in a clear line, every
    0.25 s); far bots walk waypoint to waypoint. Jumps where the grid's link is a jump.
  - Stuck: no progress toward the next waypoint for 1.5 s: jump and sidestep; the second time,
    re-route; the fourth, give the goal up. Stranded where no route leaves (a roof or gantry it
    glided onto, a slot between blocks; there is no fall damage): walk off toward the nearest
    reachable cell at or below its feet.
- **Level of detail.**
  - Bots within 120 m of a human, or of the player a dead human watches, are "near". They
    perceive every 50 ms with the bots feature's rules (FOV, line of sight through `sight.ts`,
    the noticing time) and fight through the aim controller (`aim.ts`: reaction, spring, sway,
    recoil, flinch) with real hitscan `room.fire`.
  - Far bots decide less often, never string-pull and never trace shots. Fights between far bots
    are resolved by the game every 0.5 s (`farFights`). Each far bot on the ground picks the nearest
    far bot within 32 m (plus 6 m a phase from phase 3). The pair decides to fight with
    `fightOdds(phase)`: 28 % (near bots 20 %) up to phase 1, then 15 points more a phase, up to
    85 % (75 %), re-rolled with one cached line of sight check every 2 s. Damage is the gun's damage
    at that range x fire rate x a hit chance falling with distance and growing with aim skill,
    credited as a real kill. Ammo is spent. A knife hits within 2 m on 4 % of the checks. Nobody
    fights in their first 4 s on the ground.
- **Fairness.** Bots only fight whom they see, humans are not preferred, and at most three bots
  engage the same human at once unless that human shot them (`MAX_ON_HUMAN`, `game.engagedOn`).

**Measured** (`npx tsx scripts/blackout-sim.ts --seed=N`, bots only, whole match; idle = no goal or
the old random roam point, stuck = wants to move but went under 0.75 m in 2 s, still = standing
without fighting, healing or holding; per seed 1 / 2 / 3 / 7):

| | idle | stuck | still | circle deaths | match length |
|---|---|---|---|---|---|
| before (random roam, probe-ray steering) | 42 / 52 / 50 / 55 % | 16.0 / 13.2 / 14.1 / 11.5 % | 20 / 16 / 17 / 14 % | 29 / 9 / 18 / 14 | 789 / 710 / 649 / 545 s |
| after (goal stack, island grids) | 0.0 / 0.1 / 0.1 / 0.1 % | 0.9 / 1.1 / 1.5 / 1.2 % | 2.9 / 2.6 / 3.4 / 2.4 % | 0 / 0 / 0 / 0 | 491 / 531 / 522 / 513 s |

## Performance

The server runs at 60 Hz with 20 Hz snapshots, as in every mode.

- **Interest management** (`room.interest`, a new core hook):
  - Each human's snapshot carries the players within 140 m of their focus (nearest first, at most
    40), the entities within 45 m, and the plane. The focus is themselves, or the player they
    spectate. Scavenger packs are left out.
  - Shots go out only within 140 m.
  - The alive count and the circle go in `blackout.state` (every 0.5 s, and when your state or the
    alive count changes).
- **Bot level of detail**, above.
- **Memory.** Loot is bounded by its spots plus `maxLoot`. Death drops cap themselves the same way.
  The far-fight line-of-sight cache is cleared past 4000 pairs. The bot navigation grids are typed
  arrays, about 33 MB, built once per process and shared by every Blackout room.
- **Client.**
  - Soldiers beyond 70 m are one instanced box; beyond 160 m they are not drawn.
  - Map chunks are culled beyond the draw distance.
  - Loot items are a box and a glow.
- **Measured** (`npx tsx scripts/blackout-bench.ts`: 1 fake human + 99 bots, a whole match, Apple-silicon laptop):
  - Tick, the same run of the old and the new code back to back on a busy laptop (load average ~30, other work running): 0.86 ms on average over the whole match (old: 0.84), p95 3.2 (2.6), p99 6.0 (4.1), worst 131 ms (14). On a quieter run: 0.66 (0.65), p95 2.5 (2.0), worst 76 ms (19). The first 30 s cost more, 3.3-4.1 ms (old: 1.5-2.1): the town grids are built then, about 1.7 ms a tick in ~3 ms slices (the slowest slice ~23 ms; built in one go per town they took up to 580 ms), and the worst ticks fall there. The grids are built once per server process, from the lobby and the countdown on. After that the brains cost about what the old ones did: route searches are rationed, far bots don't string-pull. Blackout's own per-tick work is 0.01-0.1 ms after the drop; the rest is the core simulation of 100 bodies and the other features.
  - Snapshots to the human: 4.4-10.5 KB each, 87-205 KB/s. Join and kill bursts come on top: the 100-player `roster` is about 400 KB once at the start, and `score` is about 6 KB per kill (core broadcasts).
  - Memory: RSS about 425 MB (the old code: 380 MB): the navigation grids are about 33 MB of typed arrays. The V8 heap swings 100-250 MB with garbage collection; the live heap is about 70-90 MB, of which about 37 MB is map data.
  - On a loaded machine (load average 300) the same run averaged 5-11 ms with 300-900 ms spikes. A shared vCPU is closer to that than to the laptop, so a 1 GB shared-cpu-2x or a performance-1x is recommended for this mode (docs/DEPLOY.md is unchanged).
  - Client: headless Chrome with SwiftShader (software GL) draws Blackout at 11-14 fps, the same as Nuketown in FFA on the same setup (13 fps). Up to about 1200 chunk meshes are visible, against 87 on Nuketown, so a real GPU's draw-call budget is the thing to watch.
  - `tests/blackout.test.ts` "a full room" times 40 s of a 100-player match against a CI budget (average under 20 ms).

## Core touch points (minimal, called out)

- `src/shared/movement.ts`: `MoveParams.glide` (air physics while not on the ground). Absent means
  the old physics, unchanged.
- `src/server/room.ts`: `room.moveParamsHook` (merged into `moveParamsFor`) and `room.interest`
  (`players` / `ents` / `shots` filters per viewer). Both are cleared by `setMode`.
- `src/server/sim.ts`: `moveParamsFor` merges `room.moveParamsHook(p)`.
- `src/shared/maps/types.ts`: `MapData.chunk`, `MapData.drawDistance`, `MaterialDef.segment`,
  `MaterialDef.worldUV` / `blend` / `vary`, `MapData.blendMask` (`BlendShape`, `blendAt`).
- `src/shared/defs/maps.ts`: `MapDef.size` gains `'huge'`. The BO maps' "every mode" list leaves
  Blackout out.
- `src/client/render/mapbuilder.ts` / `bake.ts`: chunked meshes, distance culling (`drawBoost`),
  per-material segments, bucketed bake, the `blend` vertex attribute for blended materials.
- `src/client/render/shader.ts`: world-space UVs on upward faces (`worldUV`), a second texture
  blended by the attribute and world noise with a stippled edge (`USE_BLEND`), base colour drift.
- `src/client/render/textures.ts`: `bindTexture(material, id, uniform = 'tMap')` keeps any number of
  texture uniforms per material bound (the blend texture is `tBlend`).
- Bots: the Blackout brain builds its navigation on `bots/nav.ts`'s exported helpers (`freeAt`,
  `groundAt`, `JUMP_UP`, `MAX_DROP`, `NAV_CELL`); the bots feature itself is unchanged.
- Pickups: `setPickupRules(room, { keep, cap, slotFor, bots })` (`pickups/state.ts`).
- Bots: `registerBotBrain(modeId, factory)` (`bots/hooks.ts`, used in `roster.attachBrain`).
- Frontend: the `blackout` playlist, and the Quick Play button starts `blackout.solo`.

## Simplified / not done

- No vehicles, no Mystery Box spawn (the Ray Gun can lie on the floor instead), no backpacks or
  attachment loot of its own (attachments come on the gun by rarity), no perk or equipment loot
  beyond frags.
- Spectating is a chase camera behind the watched player (no first-person view through their eyes).
- Far fights are statistical. Bots don't use doors, vehicles or grenades in Blackout, and the open
  ground grid is coarse (2 m): near bots smooth it with line checks, far bots walk it cell to cell.
- Healing doesn't stop when you are hit (BO4's did not either for bandages). It does stop you
  firing and sprinting.
- The map's towns are cuts of the original maps. Some buildings cut at the rectangle's edge stand
  open on that side (a way in, not a wall). The ground is flat between hills: collision has boxes
  and ramps only, so there is no rolling heightfield.
