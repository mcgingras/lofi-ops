# maps-bo: Nuketown and Firing Range

Low-poly recreations of two Black Ops 1 maps as `MapData`, registered in `src/shared/defs/maps.ts` (`inspiredBy` set, so they can be renamed for any public release).

| id | name | size | time presets | brushes |
|---|---|---|---|---|
| `nuketown` | Nuketown | small (75 x 51 m playable) | `noon` Desert Noon (default), `dusk` | ~500 |
| `firingrange` | Firing Range | medium (78 x 90 m playable, irregular) | `morning` Jungle Morning (default), `evening` | ~930 rendered + ~2600 collision slices |

Screenshots (taken in the dev client with a free camera): `docs/features/maps-bo/*.jpg`.

## Nuketown (`src/shared/maps/nuketown.ts`)

A model-home cul-de-sac on the test range. The green house (west, team 0) and the yellow house (east, team 1) face each other across one street. The two lots are the same plan turned half round the middle of the street (`MapKit` `rot180`), so the sides are exactly fair.

- **Houses:** two storeys (upper floor 3.3 m), front door to the street, back door to the backyard, living room and kitchen split by an arch, stairs along the north wall up to two bedrooms, upstairs windows over the street (the classic window-to-window sightline) and over the backyard. Window holes are sightlines only (1.4 m tall, so you can't climb through).
- **Garages:** open onto the driveway, with a door into the living room. A car sits on each driveway.
- **Street:** the school bus on the west side at the south end (the bus lane runs down its side), the pickup towing a camper in the turning circle at the north end, a station wagon and a sedan in the middle, street lamps, chain-link and a road barrier across both street ends.
- **Yards:** front lawns behind 0.9 m white picket fences (jumpable; bullets and sight pass), backyards behind privacy fences where each team spawns, side yards round both ends of each house as the flanks (shed, kiddie pool, swing frame, hedges).
- **Mannequins** on the lawns, in the living rooms and kitchens, at an upstairs window, in the backyards and the street.
- **Backdrop:** desert out to the horizon, the NUKETOWN sign, power poles along the road, the test-site tower with its beacon, a bunker mound, two rings of mountain silhouettes.
- Lights: `house` (interiors), `porch`, `street` groups; dusk turns them all on.

## Firing Range (`src/shared/maps/firingrange.ts`)

Rebuilt from the BO1 minimap/overhead and the Black Ops 6 remaster's tac maps (same layout);
the layout, callouts, scale, distances and sources are in `docs/maps/firingrange-reference.md`,
overheads in `docs/maps/overhead/firingrange-overhead*.png`.

- **Outline:** the original's irregular playable area (78 x 90 m), clipped cell by cell
  (`FIRING_RANGE_OUTLINE`), with fences and a jungle wall outside every edge.
- **Road** (north spawn stub) and the **Showers** block (NW); the **Shoot House** (L, turned 24
  degrees: two-storey bar along the Dirt Road, upper floor 3.2 m, stairs inside, the one-storey
  west room's roof is a balcony) with its **covered shed** (roof 2.75 m, crates to climb, the view
  down the Dirt Road); the **Dirt Road** round the north edge to the red **Storage** shed.
- **Crossroads** under the wooden **Tower** (platform 4.6 m, ladder = steep clip ramp on the west
  face), jeep and sandbags; the long **Office** hall on the west side (turned -20 degrees, porch
  north); **building 7** south of the junction.
- The impassable **hill** in the middle and the smaller **outcrop** south of it (terraced rock
  with palms); the sandy path between them leads to the **Garage** (building 3, roll-up door to
  the **Range** courtyard, east spawn). The Range's firing line looks out over target lanes
  beyond the fence (scenery).
- South: the walk-through **container** (Containers), the concrete **Bunker** on the edge (turned
  20 degrees, benches along the slits, stairs to its roof, sandbag parapet), the south yard and
  the Depot walkway to the Garage porch.
- Turned buildings: the `Frame` helper renders boxes with `ry` and collides them as axis-aligned
  slices inside each wall, long enough to keep the solid count down while neighbouring slices
  overlap through the wall, plus caps at every run end (doors, windows, corners). Stairs inside
  turned buildings are short solid steps.
- Lights: `lamp` group (inside every building, the Tower, the Range); on at evening.

## Mode data (both maps)

- `spawns.teams[0|1]`: 8 to 10 each (Nuketown backyards; Firing Range: the Road stub and the Range courtyard). `spawns.ffa`: 14 to 18 spread round the map, including upper floors. Kill Confirmed and wagers use these.
- `objectives.dom`: A (team 0 side), B (middle, equidistant), C (team 1 side).
- `objectives.sd`: sites A and B on the defenders' (team 1 / east) side; `modeSpawns.sd.attackers` (west) and `.defenders` (east) by role. Nuketown: A in the yellow garage, B by the pickup in the turning circle. Firing Range: A west of the Office, B inside the Garage (the BO6 sites); attackers spawn on the Road, defenders in the south yard.
- `objectives.hq`: 9 Headquarters points per map (Nuketown: street, both houses, garages, side yards; Firing Range: crossroads, Bunker, Shoot House, Office, Garage, Showers, building 7, Storage, Dirt Road).
- `hotspots`: 13 to 16 bot roam targets per map (include upper floors, the Tower platform and the Bunker roof).
- `MapDef.modes` = every registered mode id (`MODES`), so objective modes and wagers list these maps as soon as they are registered.

## Textures

Recipes in `src/client/render/recipes/`: `bo-common.ts` (`bo_concrete bo_planks bo_wood bo_carpaint bo_glass bo_mannequin bo_fabric bo_rock bo_sandbag`), `nuketown.ts` (`nt_sand nt_grass nt_asphalt nt_siding nt_trim nt_roof nt_floor nt_plaster nt_brick nt_picket nt_woodfence nt_bus nt_busWin nt_sign nt_mountains nt_skyNoon nt_skyDusk`), `firingrange.ts` (`fr_dirt fr_grass fr_jungle fr_tin fr_bark fr_logs fr_target fr_foliage fr_bush fr_lane1..4 fr_sign fr_hills fr_skyMorning fr_ply fr_corr fr_block fr_frondTop fr_frondSide`). Also reuses the Yard/core ids `paint fence steel rubber lamp hazard crate barrel container2 skyDusk`. Siding, roof, plaster, car paint and fabric are neutral and tinted per material.

New CC0 Poly Haven photos (512 px) in `assets/textures/`: `weathered_plank_siding grey_roof_01 dry_ground_rocks leafy_grass asphalt_02 plank_flooring painted_plaster_wall dirt sparse_grass forest_leaves_02 bark_brown_02 aerial_rocks_02`.

## Authoring kit (`src/shared/maps/bo-kit.ts`)

`MapKit` collects brushes, decals, props and lights through an optional transform (`with('rot180' | 'mirrorX', fn)`), plus:
`wall(axis, a0, a1, c, y0, h, t, mat, holes)` (door/window holes), `stairs(...)` (visual steps that stop bullets + one invisible `stairs`-tagged clip ramp players walk), `groundWithHoles` (trenches), `perimeter(bounds)` (tall `perimeter` clips just inside the bounds), `clip`, `trim`, `mannequin`, `backdropRing` (alpha silhouette cards with few segments, so a horizon costs a handful of vertices in the bake), `spawn`/`v`/`yaw` helpers.

## Tests

- `tests/maps-bo.test.ts`: registry and texture/photo coverage; kit unit tests (wall holes, rot180, stairs, ground holes); per map: spawns (count, on ground, free, inside), spawn spread, objective layout (dom/sd/hq, S&D sites away from attackers, Dom B equidistant), a flood fill through the real `stepMove` proving every spawn, objective, hotspot and the upper floors are reachable, closed bounds (no reachable node outside; sprint-and-jump outwards in 16 directions stays in); scripted walks across each map (Nuketown: through both houses, up and down stairs; Firing Range: Road to the crossroads through the Shoot House and up the Tower ladder, the Shoot House stairs and balcony, the Office end to end and the Bunker stairs, the Dirt Road through Storage, the Range and the Garage back to the crossroads, the crate climb onto the covered shed); turned walls are closed (rays from inside each turned building); signature sightlines (street, window-to-window; Tower over the crossroads, the hill splitting the map, the Office hall, the Range lanes, the Bunker roof, the Dirt Road from the shed roof).
- `tests/maps-bo.integration.test.ts`: real server, real sockets: quick-play TDM on Nuketown and TDM/FFA on Firing Range, spawn on a map spawn, sprint around, stay alive and in bounds.
- `tests/maps-bo-nav.ts`: `floodFill` and `walkRoute` helpers (bots or other map owners can reuse them).

## Integration notes

- **Core change (minimal):** `MapData.modeSpawns?` added in `src/shared/maps/types.ts` (optional; documented in CONTRACTS section 9). Modes: for S&D read `map.modeSpawns?.sd?.attackers / defenders`, fall back to `map.spawns.teams`.
- **modes:** objective point ids/kinds as above; radius is the capture/plant radius suggestion (Dom 3 m, S&D 1.6 m, HQ 2.5 to 3.5 m). Objective `y` is the floor height (all Firing Range objectives are on the ground; Nuketown upstairs 3.3).
- **bots (lobby backfill):** both maps ship `hotspots`; clip ramps on stairs (and the Tower ladder, and the solid steps of turned stairs) are tagged `stairs`, jumpable picket clips `fence-low` (0.9 m, bullets and sight pass), bounds clips `perimeter` (Firing Range's outline and the clips over its rocks). Doorways are at least 1.1 m wide and 2.2 m tall, windows are not traversable. The flood-fill helper in `tests/maps-bo-nav.ts` shows the walkable graph the movement code allows; a nav graph built the same way covers both maps in about 2 s each.
- **frontend:** map ids `nuketown`, `firingrange` for map vote / previews; time preset ids above (`settings.time` = `map` uses the default).
- **maps-mw2:** `MapKit` is shareable; texture ids are prefixed (`nt_`, `fr_`, `bo_`) to avoid clashes.
- Map files are big data builders; `getMapData` caches them. Bake size: the backdrop uses silhouette cards (`backdropRing`), not ramps, because the renderer subdivides brush faces about every 1.1 m.
- **Core change (perf, behaviour unchanged):** `CollisionWorld.raycast` walks a 4 m grid of solid footprints (nearest cells first, stopping past the best hit) instead of testing every solid. Firing Range has ~3000 solids; its evening bake dropped from ~4.4 s to ~0.3 s, and bots' line-of-sight checks get the same speed-up on every map. `tests/collision.test.ts` checks it against testing every solid on every map.
- `scripts/map-overhead.ts` now also draws invisible solids that stop players and bullets (the collision of turned buildings), render-only turned boxes as rotated outlines, `perimeter` clips in dark red (the playable outline), and ramp arrows (the ramp keys were wrong).
