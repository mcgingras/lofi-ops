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
                                   loot, interest (snapshot filters), brain (bot brain), state
src/client/features/blackout/      store, hud (HUD widgets, big map, core wraps), world (plane, loot,
                                   circle wall, chutes, cameras, soldier culling), menu
tests/blackout.test.ts             rules, physics, loot, interest, a 100-player room on a time budget
tests/blackout-harness.ts          a Blackout room with fake sockets (tests and the scripts)
scripts/blackout-bench.ts          server benchmark: tick ms, snapshot bytes, memory over a match
scripts/blackout-sim.ts            bot behaviour over a bots-only match
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
| Plane | Everyone spawns aboard (`rules.spawnPoints` = the line's start). The line is random per match and seeded: it crosses the island and passes within a third of the half-size of the centre. It flies at 150 m and 18 m/s, about 30 s to cross. The doors open after 2 s. Anyone still aboard is pushed out 2 s before the end. While aboard you are alive, can't be hurt, and fly with the plane: `glide` all zeros keeps the velocity, so the client predicts it exactly. |
| Drop | Jumping keeps the plane's heading at up to 14 m/s. In freefall gravity is 22, the fall is capped at 44 m/s, and you steer at up to 16 m/s. The chute opens at 38 m above the ground, or earlier with Space (above 8 m). It brakes the fall to 6 m/s and steers at up to 11 m/s. Touching the ground lands you. No shooting or ADS in the air. |
| Loadout | A knife in both slots. No perks, streaks or equipment. The slots fill from the floor. |
| Loot | Spots on the map's floors, about one per 75 m² of town, indoors first and 2.5 m apart, plus about 90 on open ground. Each gets an item with 82 % chance, so about 640 items per match, capped at 1100 loot entities. Rolls are 45 % weapons: rarity common / rare / legendary (60/30/10) with 0 / 1 / 2 attachments, and a 3 % Ray Gun chance on legendary rolls. The rest are items: ammo by type (pistol, smg, rifle, sniper, shells), armour level 1-3, bandages, med kits and frags. Guns are `pickups_weapon` drops that never expire (`setPickupRules(room, { keep, cap })`). Items are `blackout_loot` entities. The dead drop their other gun, a heal and their vest. |
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
prefixed per town, then deduplicated by look. Brushes crossing the cut are clipped (plain boxes) or
dropped (ramps, turned boxes, invisible clips, walls taller than 5 m: the arena walls). Brushes
tagged `perimeter` or `roof` are dropped too. Where a cut has no floor at all (Summit's mountaintop
stands in the void), open ground fills it (`holes`).

| town | from | at (x, z) |
|---|---|---|
| Nuketown | nuketown (the two houses and the cul-de-sac) | (-150, -175) |
| Rust | rust (the whole yard and the tower) | (175, -175) |
| Firing Range | firingrange | (-175, 30) |
| Summit | summit (control room, gallery, tower) | (15, -170) |
| Hanoi | hanoi (the prison and the street) | (165, 45) |
| Terminal | terminal (security, shops, the plane) | (30, 180) |
| Scrapyard | scrapyard | (-150, 180) |
| Launch | launch (the rocket pad), the island's centre | (0, 10) |
| Yard | yard (the original look prototype) | (-60, -85) |
| Nacht | nacht (the bunker and the airfield) | (170, 190) |

Between the towns lie flat tiles at y = 0, which exactly partition the island minus the town
rectangles (`terrainTiles`, at most 64 m, under the collision ray grid's "big solid" size). There
are also 22 hills (a plateau and four 1:4 ramps), about 70 rocks, about 160 trees (a trunk
cylinder and a drawn-only canopy that hides you from bots like a bush), and roads from each town to
Launch (flat decals).

Rendering: `MapData.chunk` (96 m) splits the merged meshes per chunk, and `MapData.drawDistance`
(200 m) culls chunks beyond it. The fog (55-185 m by day) hides the cut, and in the air
(plane, freefall) the fog and the draw distance grow with height. `MaterialDef.segment` makes
open ground tessellate coarser for vertex lighting. The bake buckets lights and ground-AO solids by
cell (same result, much faster on a map with 300 lights and 8000 solids).

Tests: `tests/maps-traps.test.ts` floods the island region by region (`size: 'huge'`): each town
with 12 m of open ground around it, plus six patches of open ground. Anything that leaves a region
counts as a way back. `tests/zfight.test.ts` covers it like any map. `tests/bots.unit.test.ts`'s
all-maps nav grid check skips it, because its bots don't use a nav grid.

## Bots (`brain.ts`)

The bots feature gives Blackout bots this brain through `registerBotBrain('blackout', factory)`
(new hook in `bots/hooks.ts`; the roster then skips the default brain's nav grid). Skill, variance,
names and backfill work as usual.

- **Drop.** At the start each bot picks a landing spot (a loot spot nobody else picked, or open
  ground) and jumps where the plane passes nearest it, a few seconds early. It glides there.
- **Plan** (every 0.35 s near a human, 0.5 s far away):
  1. The circle first. When outside the zone, or outside the next one when it is about to move,
     it heads for a point inside.
  2. Late game, 30 % of bots are campers that hold a spot for 15-35 s.
  3. Otherwise the best loot within 45 m: guns while a slot is empty or the gun is better
     (`gunValue`: rarity, class, ammo), and items it can use. Another floor costs extra. Loot
     another bot is heading for is skipped, and loot it couldn't reach or take is ignored for 45 s.
  4. Otherwise it roams to a hotspot or a point inside the circle.
- **Steering.** No nav grid: the island is too big for it, at 0.5 m cells it would be millions of
  cells. Probe rays at knee and chest height turn the bot around walls and make it jump low ones;
  a turn sticks for 0.6 s. A stuck bot jumps, sidesteps, and after four tries gives the goal up.
- **Level of detail.**
  - Bots within 120 m of a human, or of the player a dead human watches, are "near". They
    perceive every 50 ms with the bots feature's rules (FOV, line of sight through `sight.ts`,
    the noticing time) and fight through the aim controller (`aim.ts`: reaction, spring, sway,
    recoil, flinch) with real hitscan `room.fire`.
  - Far bots plan and probe less, and never trace shots. Fights between far bots are resolved by
    the game every 0.5 s (`farFights`). Each far bot on the ground picks the nearest far bot
    within 45 m. The pair decides to fight 28 % of the time (near bots 20 %), re-rolled with one cached line of
    sight check every 2 s. Damage is the gun's damage at that range x fire rate x a hit chance
    falling with distance and growing with aim skill, credited as a real kill. Ammo is spent. A
    knife hits within 2 m on 4 % of the checks. Nobody fights in their first 4 s on the ground.
- **Fairness.** Bots only fight whom they see, humans are not preferred, and at most three bots
  engage the same human at once unless that human shot them (`MAX_ON_HUMAN`, `game.engagedOn`).
- **Healing.** A bot with nothing in sight and under 60 % health heals.

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
  The far-fight line-of-sight cache is cleared past 4000 pairs.
- **Client.**
  - Soldiers beyond 70 m are one instanced box; beyond 160 m they are not drawn.
  - Map chunks are culled beyond the draw distance.
  - Loot items are a box and a glow.
- **Measured.** `npx tsx scripts/blackout-bench.ts` (1 fake human + 99 bots, a whole match) and
  `tests/blackout.test.ts` "a full room" (40 s on a CI budget). The numbers are in the report of
  the commit that added this file (tick ms, snapshot bytes, memory).

## Core touch points (minimal, called out)

- `src/shared/movement.ts`: `MoveParams.glide` (air physics while not on the ground). Absent means
  the old physics, unchanged.
- `src/server/room.ts`: `room.moveParamsHook` (merged into `moveParamsFor`) and `room.interest`
  (`players` / `ents` / `shots` filters per viewer). Both are cleared by `setMode`.
- `src/server/sim.ts`: `moveParamsFor` merges `room.moveParamsHook(p)`.
- `src/shared/maps/types.ts`: `MapData.chunk`, `MapData.drawDistance`, `MaterialDef.segment`.
- `src/shared/defs/maps.ts`: `MapDef.size` gains `'huge'`. The BO maps' "every mode" list leaves
  Blackout out.
- `src/client/render/mapbuilder.ts` / `bake.ts`: chunked meshes, distance culling (`drawBoost`),
  per-material segments, bucketed bake.
- Pickups: `setPickupRules(room, { keep, cap, slotFor, bots })` (`pickups/state.ts`).
- Bots: `registerBotBrain(modeId, factory)` (`bots/hooks.ts`, used in `roster.attachBrain`).
- Frontend: the `blackout` playlist, and the Quick Play button starts `blackout.solo`.

## Simplified / not done

- No vehicles, no Mystery Box spawn (the Ray Gun can lie on the floor instead), no backpacks or
  attachment loot of its own (attachments come on the gun by rarity), no perk or equipment loot
  beyond frags.
- Spectating is a chase camera behind the watched player (no first-person view through their eyes).
- Bots have no nav grid: they steer, and indoors they can be clumsy (stairs, doors). Far fights
  are statistical.
- Healing doesn't stop when you are hit (BO4's did not either for bandages). It does stop you
  firing and sprinting.
- The map's towns are cuts of the original maps. Some buildings cut at the rectangle's edge stand
  open on that side.
