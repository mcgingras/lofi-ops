# maps-mw2: Rust, Scrapyard, Terminal

Three low-poly recreations of Modern Warfare 2 maps, built as plain `MapData` (brushes, ramps,
decals, props, lights, spawns, objectives, time presets). Each one is registered in
`src/shared/defs/maps.ts` with `inspiredBy`, so it shows up in quick play and map rotation for
every mode it supports. Each one can also run a full lobby of bots (see "Bots" below).

| id | name | size | play space | default time | other presets |
|---|---|---|---|---|---|
| `rust` | Rust | small | 48.6 x 49.6 m | `day` (sandstorm) | `dusk`, `night` |
| `scrapyard` | Scrapyard | medium | 51 x 80 m (true scale, see `docs/maps/scrapyard-reference.md`) | `overcast` | `dusk`, `night` |
| `terminal` | Terminal | medium | ~72 x 50 m | `day` (clear afternoon) | `overcast`, `dusk` |

Screenshots (headless Chrome, dev server, free camera) are in `docs/features/maps-mw2/*.jpg`:
an overview plus three close-ups per map. Rust was rebuilt from references; its shots, overhead
renders and the reference write-up are in `docs/maps/rust/` and `docs/maps/rust-reference.md`.

## What is in each map

**Rust.** This is a faithful layout recreation, built from the MW2 minimap and the MWIII remaster's
tac maps. `docs/maps/rust-reference.md` has the sources, the callouts and the measurements.

- **The tower** stands just north-east of the centre and has three levels:
  - the ground floor is a dark maze (a west passage, a north tunnel, the north-east room and the
    ladder well);
  - the middle deck is at 4.4 m;
  - the small top deck is at 8.4 m.
- **Ways up the tower:**
  - a ship ladder from the raised platform on the south face (1.8 m, with its own stair down to the
    sand) up to the middle deck;
  - a second ship ladder from the middle deck to the top;
  - the exhaust chute, which rises from the sand east of the tower straight up to the top deck.
- **The pipeline** is a 2 m pipe you can walk along, running down the west side. It rises out of the
  sand at the north-west spawn and branches east at 4.4 m into the middle deck (you can walk under the
  branch). It then drops to the derrick platform (2.85 m) in the south-west corner and goes back into
  the sand there.
- **The fuel-tank skid** stands west of the tower at 3.0 m. A short pipe joins it to the middle deck.
- **Around the edges:** the blue containers (north-west, climbable from crates), the guard shack at the
  front gate (north), a horizontal tank, the tank house (north-east), the Barn Oil building with its
  covered passage (east), the trucks (south-east) and the south container. The derrick has a tunnel
  under its south wing.
- **The play space** is the square inside the fences, with sand, rock and the pipeline carrying on
  beyond it.

**Scrapyard.** Rebuilt from the MW2 overhead minimap at true scale (1 m = 9.5 minimap px). The
reference, callouts and sources are in `docs/maps/scrapyard-reference.md`. The yard is a 51 x 80 m
rectangle running north-south, with a building on each side:
- **Red Warehouse** (north): a two-storey L-shaped office. Stairs run along its back wall, and the
  upstairs offices have windows looking down the yard. The corner office overlooks Domination A.
  It has a walled front yard and a dead-end back alley.
- **Blue Warehouse** (south): a tall open hall with a grated catwalk at 3.6 m along its north wall
  (stair ramps at both ends). Its windows duel with the Red Warehouse across the map.
- **Storage** (west): one floor, four entries. Outside are a low wall along its front, the box truck
  and a white container.
- **Forklift building** (east): a big opening onto the centre. Nearby are the shed, the burning
  truck, an engine bay and the gas tanks.

The north-west has the helipad with a walk-through Sea Knight. The centre has the fuselages, all
walk-through with cabin floors one step up:
- an L of long fuselages with a blue roof;
- the north tube, under a fallen lattice tower;
- a closed tail section;
- the "818" pair.

A crate stack and a fallen wing lead up onto the fuselage roofs (3.6 m). There are three lanes:
west (truck, low wall), centre (fuselages) and east (an open service road). The boundary is
corrugated walls and chain-link, with dirt berms beyond. A crane outside the south wall swings its
boom over the yard.

**Terminal (compact section).** The gate level is a solid 3 m plinth. On it are the bookstore (its
own walls and ceiling, shelves and a till), the food counter, a gate desk with a sign, gate seating
rows and pillars. Big windows look over the apron, and you can jump out through them. The jet
bridge runs from the gate to an airliner parked on the apron. Its cabin is at gate height and you
can walk through it, with seats and an aisle and a rear airstair down to the tarmac. You walk under
the wings. A landing with a stair ramp at the west end and a service ramp at the east end also link
the gate level and the apron. On the apron are a fuel truck, baggage carts, a tug, ULD containers
and cones, with a blast fence to the south and chain-link fences to the sides.

## Data conventions (for modes, bots and frontend)

- **Team spawns.** `spawns.teams[0]` is on one side (Rust: the trucks, south-east; Scrapyard: north-west as in MW2;
  Terminal inside the terminal) and `spawns.teams[1]` is on the other. Every team spawn is more than 20 m from every
  enemy team spawn. Spawns face into the map. Each team has 8 or more spawns, plus 12 or more FFA
  spawns.
- **Domination:** `objectives.dom` = `A`, `B`, `C`. A is on team 0's side, B is in the middle (Rust:
  just east of the tower; Scrapyard: inside Storage, the west building; Terminal: under the jet bridge), and C is on team
  1's side.
- **Search and Destroy:** `objectives.sd` = sites `A`, `B`, both with `team: 1`. Team 1's spawn side
  defends and team 0's spawns are the attacker starts. `objectives.sdBomb` = one point (`id: 'bomb'`,
  `team: 0`) at the attackers' start. Swapping sides each round is the mode's job: give the
  defending team `spawns.teams[1]` through `ModeRules.spawnPoints`.
- **Headquarters:** `objectives.hq` = 5 named points per map (some on upper floors; read `y`).
- **Bots:** `hotspots` = 10 to 16 roam points per map, including the upper levels (the tower decks,
  the building's upper floor, catwalks, the fuselage cabins and roofs, the Sea Knight cabin, the nose roof, the container roost,
  the gate level and the jet bridge).
- **Stairs:** the ramp brushes for stairs carry `tag: 'stairs'`. Railings are player-only clips
  tagged `rail` (bullets and sight pass), and map-edge and fence clips are tagged `clip`. A nav
  builder can use these tags.
- **Modes:** `defs/maps.ts` lists `tdm`, `ffa`, `dom`, `sd`, `hq` and `kc` for these maps, plus every
  wager mode (`playlist: 'wager'`), filtered to the modes that exist in `MODE_BY_ID`. Domination,
  S&D and HQ switch on automatically once the modes area adds those `ModeDef`s.
- **Heights:** these are exported for features and tests as `RUST_DECKS`, `SCRAPYARD_LEVELS` and
  `TERMINAL_LEVELS`.

## Bots (lobby backfill)

The maps are built so that a lobby with too few humans can be filled with bots and still play
properly:
- Hotspots exist on every level, so roaming bots spread over the whole map, upper floors included.
- Every upper floor is reached by a walkable ramp, never a ladder, so the bots area's nav graph
  (built from brushes) and the real `stepMove` can reach every floor.
- The play space is closed by perimeter player clips, so a bot that wanders can never leave the
  map or fall out of the world.
- `tests/maps-mw2.integration.test.ts` checks this. It fills rooms on each map with
  `botFill` (TDM 10, FFA 8), runs them for 45 simulated seconds with roaming brains, and has a
  human join a bot-filled lobby over a real socket. Nobody may die to the world, and the bots must
  actually travel.

Bot skill tuning is the bots area's job (`src/shared/defs/bots.ts`). Nothing here depends on the
skill settings.

## Textures

All the textures are photo recipes made from the CC0 Poly Haven photos in `assets/textures`, run
through the developer. Rust's sand now uses `coast_sand_04` (CC0, Poly Haven, Diffuse 1k cut down to
512 px), which was added for the Rust rebuild. An aircraft-aluminium photo would still help the
planes.
Recipe files (auto-imported):
- `src/client/render/recipes/rust.ts`: `rust_sand rust_rock rust_deck rust_beam rust_corr
  rust_stairs rust_rail rust_tank rust_pipe rust_bldg rust_concrete rust_trailer rust_sandbag
  rust_skyDusk rust_skyHaze`
- `src/client/render/recipes/scrapyard.ts`: `scrap_ground scrap_asphalt scrap_hangar
  scrap_concrete scrap_grate scrap_fuse scrap_alu scrap_cabin scrap_carpet scrap_seat
  scrap_cockpit scrap_junk scrap_wall scrap_trailer scrap_blueclad`
- `src/client/render/recipes/terminal.ts`: `term_apron term_facade term_floor term_wall term_books
  term_counter term_signBooks term_signGate term_signFood term_jet term_bridge term_blast
  term_truck term_skyDay`

Shared ids from core and the Yard are reused as-is: `fence steel lamp crate pallet barrel barrier
rubber yellow hazard paint winRow container0..5 skyGrey skyDusk skyNight`. If the Yard recipes are
ever renamed, these maps need the same ids. Terminal and Scrapyard also reuse each other's and
Rust's `scrap_*` and `rust_stairs` / `rust_rail` recipes.

## Authoring kit

`src/shared/maps/mw2kit.ts` has `MapKit`, with `slab` (corner-based boxes), `trim`, `ramp`,
`wall(axis, from, to, at, y0, y1, t, mat, holes)` (doors and windows as holes), `rail`, `fence`,
`perimeter`, `playerClip`, `cyl`, `lampPole` and `glow`, plus `spawnAt` / `yawTowards`. Anyone
can use it for more maps.

## Tests

- `tests/maps-mw2.test.ts` checks the following for each map:
  - registry entry and `inspiredBy`;
  - spawn counts, with each spawn free, with headroom and on the floor;
  - team spawn separation;
  - Domination, S&D (defender-side sites), HQ and the bomb point;
  - objective floors;
  - time presets, lights and hotspots;
  - **walk tests** that flood-fill the map with the real `stepMove` (walking plus running jumps)
    from both team spawns. These assert that the space is closed (no escape past the bounds, no
    falling out), and that every spawn, objective point and hotspot can be reached from both
    sides. This covers the stairs to every deck.
- `tests/maps-rust.test.ts` checks Rust against its reference:
  - the play-area size;
  - floors at the reference heights (top deck, middle deck, raised platform, pipe, derrick, skid,
    containers);
  - the places you can walk under or through (pipe branch, chute, the maze, the derrick tunnel, the
    covered passage);
  - the sightlines from the top deck;
  - the bots' `NavGrid` reaching every objective and hotspot, tower top included, from both team
    spawns.
- `tests/maps-scrapyard.test.ts`: Scrapyard against its reference (scale, building positions,
  diagonal spawns, objective placement, the warehouse-to-warehouse and lane sightlines). It also
  checks that the bots' `NavGrid` reaches every objective, roam point, S&D site and upper floor
  from both team spawns.
- `tests/maps-mw2-walk.ts` is the flood-fill helper (`floodWalk`, `reaches`). Other map areas can
  use it.
- `tests/maps-mw2.integration.test.ts`: real server and socket, plus simulated bot-filled rooms
  (see above).

## Integration notes

- Core files touched: only `src/shared/defs/maps.ts`, which gets the three registry lines, an
  import of `MODE_BY_ID` / `MODES` and the `mw2Modes()` helper. The maps-bo agent edits the same
  `MAPS` array, so expect a trivial merge there: keep both sets of entries.
- No contract changes. The `sdBomb` objective key and the "sites carry the defending team" rule
  are conventions inside the existing `objectives: Record<string, ObjectivePoint[]>`.
- Modes area: read `objectives.dom`, `objectives.sd` (+ `team`), `objectives.sdBomb` and
  `objectives.hq`. Some HQ points sit on upper floors, so use the 3D distance or check `y` within
  ±1.5 m when you test whether a player is inside an objective.
- Frontend: the map vote can show `name`, `size` and `inspiredBy`. No preview images yet; the
  screenshots in `docs/features/maps-mw2/` could become `MapDef.preview`.
