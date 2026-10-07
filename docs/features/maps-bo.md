# maps-bo: Nuketown and Firing Range

Low-poly recreations of two Black Ops 1 maps as `MapData`, registered in `src/shared/defs/maps.ts` (`inspiredBy` set, so they can be renamed for any public release).

| id | name | size | time presets | brushes |
|---|---|---|---|---|
| `nuketown` | Nuketown | small (75 x 51 m playable) | `noon` Desert Noon (default), `dusk` | ~500 |
| `firingrange` | Firing Range | medium (93 x 77 m playable) | `morning` Jungle Morning (default), `evening` | ~500 |

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

A jungle clearing of red dirt, the Cuban training range.

- **Firing lanes** run east from the **shooting booths** (tin roof, partitions, waist-high counters with lane numbers) to the **target berm** (log faces). Plywood pop-up targets on frames at four distances, each behind a low concrete pit (cover). The lanes are the long sightline; the berm shields the east spawn.
- **Range cabin** (north): two storeys (3.2 m), stairs inside and out, a balcony, and a **catwalk** east to the **NE guard tower** (platform 3.2 m, stairs down the east side).
- **Trench** (south-east, floor -1.0 m) with sandbag parapets and log revetments, ramps in from the west and north, leading into the concrete **bunker** with firing slits over the lanes and a back door/ramp east.
- **SW guard tower** (platform 4.0 m), the **NW tin shed**, a jeep, fuel drums, crates, sandbag walls, target racks, chain-link along the north edge.
- **Tree line:** trunks inside the playable area collide; a ring of canopy trees, foliage walls and jungle hill silhouettes beyond the clip.
- Lights: `lamp` group (booths, cabin, towers, bunker, shed); on at evening.

## Mode data (both maps)

- `spawns.teams[0|1]`: 8 each (backyards / west and east ends). `spawns.ffa`: 14 spread round the map, including upper floors. Kill Confirmed and wagers use these.
- `objectives.dom`: A (team 0 side), B (middle, equidistant), C (team 1 side).
- `objectives.sd`: sites A and B on the defenders' (team 1 / east) side; `modeSpawns.sd.attackers` (west) and `.defenders` (east) by role. Nuketown: A in the yellow garage, B by the pickup in the turning circle. Firing Range: A in the bunker, B in the cabin.
- `objectives.hq`: 9 Headquarters points per map (street/lanes, both house floors or cabin floors, garages/bunker, side yards, towers).
- `hotspots`: 13 bot roam targets per map (include upper floors, catwalk, trench).
- `MapDef.modes` = every registered mode id (`MODES`), so objective modes and wagers list these maps as soon as they are registered.

## Textures

Recipes in `src/client/render/recipes/`: `bo-common.ts` (`bo_concrete bo_planks bo_wood bo_carpaint bo_glass bo_mannequin bo_fabric bo_rock bo_sandbag`), `nuketown.ts` (`nt_sand nt_grass nt_asphalt nt_siding nt_trim nt_roof nt_floor nt_plaster nt_brick nt_picket nt_woodfence nt_bus nt_busWin nt_sign nt_mountains nt_skyNoon nt_skyDusk`), `firingrange.ts` (`fr_dirt fr_grass fr_jungle fr_tin fr_bark fr_logs fr_target fr_foliage fr_bush fr_lane1..4 fr_sign fr_hills fr_skyMorning`). Also reuses the Yard/core ids `paint fence steel rubber lamp hazard crate barrel skyDusk`. Siding, roof, plaster, car paint and fabric are neutral and tinted per material.

New CC0 Poly Haven photos (512 px) in `assets/textures/`: `weathered_plank_siding grey_roof_01 dry_ground_rocks leafy_grass asphalt_02 plank_flooring painted_plaster_wall dirt sparse_grass forest_leaves_02 bark_brown_02 aerial_rocks_02`.

## Authoring kit (`src/shared/maps/bo-kit.ts`)

`MapKit` collects brushes, decals, props and lights through an optional transform (`with('rot180' | 'mirrorX', fn)`), plus:
`wall(axis, a0, a1, c, y0, h, t, mat, holes)` (door/window holes), `stairs(...)` (visual steps that stop bullets + one invisible `stairs`-tagged clip ramp players walk), `groundWithHoles` (trenches), `perimeter(bounds)` (tall `perimeter` clips just inside the bounds), `clip`, `trim`, `mannequin`, `backdropRing` (alpha silhouette cards with few segments, so a horizon costs a handful of vertices in the bake), `spawn`/`v`/`yaw` helpers.

## Tests

- `tests/maps-bo.test.ts`: registry and texture/photo coverage; kit unit tests (wall holes, rot180, stairs, ground holes); per map: spawns (count, on ground, free, inside), spawn spread, objective layout (dom/sd/hq, S&D sites away from attackers, Dom B equidistant), a flood fill through the real `stepMove` proving every spawn, objective, hotspot and the upper floors are reachable, closed bounds (no reachable node outside; sprint-and-jump outwards in 16 directions stays in); scripted walks across each map (through both houses, up and down stairs, catwalk and tower, trench and bunker, cabin stairs, SW tower); signature sightlines (street, window-to-window, lanes, berm, bunker slit).
- `tests/maps-bo.integration.test.ts`: real server, real sockets: quick-play TDM on Nuketown and TDM/FFA on Firing Range, spawn on a map spawn, sprint around, stay alive and in bounds.
- `tests/maps-bo-nav.ts`: `floodFill` and `walkRoute` helpers (bots or other map owners can reuse them).

## Integration notes

- **Core change (minimal):** `MapData.modeSpawns?` added in `src/shared/maps/types.ts` (optional; documented in CONTRACTS section 9). Modes: for S&D read `map.modeSpawns?.sd?.attackers / defenders`, fall back to `map.spawns.teams`.
- **modes:** objective point ids/kinds as above; radius is the capture/plant radius suggestion (Dom 3 m, S&D 1.6 m, HQ 2.5 to 3.5 m). Objective `y` is the floor height (the bunker is -1.0, cabin upper 3.2, Nuketown upstairs 3.3).
- **bots (lobby backfill):** both maps ship `hotspots`; clip ramps on stairs are tagged `stairs`, jumpable picket clips `fence-low` (0.9 m, bullets and sight pass), bounds clips `perimeter`. Doorways are at least 1.1 m wide and 2.2 m tall, windows are not traversable. The flood-fill helper in `tests/maps-bo-nav.ts` shows the walkable graph the movement code allows; a nav graph built the same way covers both maps in about 2 s each.
- **frontend:** map ids `nuketown`, `firingrange` for map vote / previews; time preset ids above (`settings.time` = `map` uses the default).
- **maps-mw2:** `MapKit` is shareable; texture ids are prefixed (`nt_`, `fr_`, `bo_`) to avoid clashes.
- Map files are big data builders; `getMapData` caches them. Bake size: the backdrop uses silhouette cards (`backdropRing`), not ramps, because the renderer subdivides brush faces about every 1.1 m.
