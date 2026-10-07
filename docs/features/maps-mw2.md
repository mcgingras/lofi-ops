# maps-mw2: Rust, Scrapyard, Terminal

Three low-poly recreations of Modern Warfare 2 maps, built as plain `MapData` (brushes, ramps,
decals, props, lights, spawns, objectives, time presets). Each one is registered in
`src/shared/defs/maps.ts` with `inspiredBy`, so it shows up in quick play and map rotation for
every mode it supports. Each one can also run a full lobby of bots (see "Bots" below).

| id | name | size | play space | default time | other presets |
|---|---|---|---|---|---|
| `rust` | Rust | small | ~60 x 60 m | `dusk` (hazy desert dusk) | `day` (dust haze), `night` |
| `scrapyard` | Scrapyard | medium | ~88 x 76 m | `overcast` | `dusk`, `night` |
| `terminal` | Terminal | large | ~115 x 79 m (full map) | `day` (clear afternoon) | `overcast`, `dusk` |

Screenshots (headless Chrome, dev server, free camera) are in `docs/features/maps-mw2/*.jpg`:
an overview plus three close-ups per map (Terminal's are in `docs/maps/terminal/*.jpg`, one per
callout, after its full-map rebuild).

## What is in each map

**Rust.** The rusted derrick in the middle has three decks: L1 at 3.2 m (12 x 12, corrugated half
walls), L2 at 6.4 m (west half, bar railings) and the crow's nest at 9.6 m (4 x 4, railings), with
the mast above it. Steep stair ramps take the place of MW2's ladders: two from the ground to L1
(east and west), one from L1 to L2, and one from L2 to the top. To the north-east is the two-storey
block building with the sniper windows, which has stairs inside along the north wall. There are
two big crude tanks on pads plus a horizontal tank and manifold to the south-west, and a pumpjack
and a corrugated shed to the west/north-west. A knee-high pipeline crosses the south (hop it), a
raised pipe rack runs on the west (walk under it), and a third pipe runs along the east fence. The
east side also has the site trailer, a chain-link fence and an open-front shed. Sand berms rise to
the north, south and west edges, with scenery dunes beyond.

**Scrapyard.** The hangar to the north (28 x 20 m, 9 m tall) has a main door to the south, a back
door, side doors and high windows. Catwalks at 3.6 m run along both side walls, a bridge joins them
across the north end, and there is a stair ramp up on each side. Inside are an engine on a stand, a
wing panel, crates and a tug. To the south-west lies the walk-through airliner fuselage (cabin floor
at 0.8 m). You can enter through the open front, a tail door or two hull breaches, each with a
debris ramp; there are seat rows either side of the aisle, plus a tail fin, a sloped wing and loose
engines. The broken-off nose section to the south-east has a nose-cone ramp up onto its roof (3.4 m
perch). Containers include an east roost (a scrap ramp up onto a container at 2.6 m), a north-east
stack, west cover and mid-field singles. There are two trailers, junk-pile slopes in two corners and
a taxi strip across the middle. The boundary is corrugated walls plus a fence section with wrecks
beyond.

**Terminal (full map, rebuilt from the official overheads; see `docs/maps/terminal-reference.md`).**
The concourse is 4 m up. West to east it holds Security with its scanner lanes (team 0 spawns behind
them), the departure hall and Shopping (check-in island, airline office, customer service desk, gate
seating, the Makeup Store), the Bookstore passage between two closed shop blocks, the west corridor
up to Dining (checker floor) with Burger Town in its corner, and the Upper Lounge at the top of the
escalators. The Hallway runs along the east wall, with windows over the Maintenance roof and the
apron. On the ground floor are the Lower Lounge (team 1 spawns: baggage claim, snack bar, glass
facade), the Maintenance shed (walk through it, or take its outside stairs to the roof), the NE
strip and the apron. The apron has the parked trijet, which you walk through: in from the Hallway by
the jet bridge (front), out by the evacuation slide (side) or the aft airstair (rear). Outside stairs
beside the jet bridge climb back into the concourse. Containers, a police car, a tug and baggage
carts, and a fuel truck give cover on the apron; crates by the north wing root let you climb onto
the wing. Overheads: `docs/maps/overhead/terminal-overhead*.png`. In-game screenshots:
`docs/maps/terminal/*.jpg`.

## Data conventions (for modes, bots and frontend)

- **Team spawns.** `spawns.teams[0]` is on one side (Rust north, Scrapyard west, Terminal in
  Security) and `spawns.teams[1]` is on the other. Every team spawn is more than 20 m from every
  enemy team spawn. Spawns face into the map. Each team has 8 or more spawns, plus 12 or more FFA
  spawns.
- **Domination:** `objectives.dom` = `A`, `B`, `C`. A is on team 0's side, B is in the middle (Rust:
  under the tower; Scrapyard: inside the hangar; Terminal: in the Hallway, as in MW2), and C is on team
  1's side.
- **Search and Destroy:** `objectives.sd` = sites `A`, `B`, both with `team: 1`. Team 1's spawn side
  defends and team 0's spawns are the attacker starts. `objectives.sdBomb` = one point (`id: 'bomb'`,
  `team: 0`) at the attackers' start. Swapping sides each round is the mode's job: give the
  defending team `spawns.teams[1]` through `ModeRules.spawnPoints`. Terminal also carries
  `modeSpawns.sd.attackers` (Security) and `.defenders` (Lower Lounge).
- **Headquarters:** `objectives.hq` = 5 named points per map (some on upper floors; read `y`).
- **Bots:** `hotspots` = 10 to 20 roam points per map (Terminal: 20, one per callout), including
  the upper levels (the tower decks,
  the building's upper floor, catwalks, the fuselage cabin, the nose roof, the container roost,
  the concourse, the Maintenance roof, the jet bridge and the cabin).
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

All the textures are photo recipes made from the CC0 Poly Haven photos already in
`assets/textures`, run through the developer. I did not download any new photos. A real sand photo
and an aircraft-aluminium photo would help Rust and the planes if someone approves the download.
Recipe files (auto-imported):
- `src/client/render/recipes/rust.ts`: `rust_sand rust_deck rust_beam rust_corr rust_stairs
  rust_rail rust_tank rust_pipe rust_bldg rust_concrete rust_trailer rust_sandbag rust_skyDusk
  rust_skyHaze`
- `src/client/render/recipes/scrapyard.ts`: `scrap_ground scrap_asphalt scrap_hangar
  scrap_concrete scrap_grate scrap_fuse scrap_alu scrap_cabin scrap_carpet scrap_seat
  scrap_cockpit scrap_junk scrap_wall scrap_trailer`
- `src/client/render/recipes/terminal.ts`: `term_apron term_facade term_floor term_wall term_books
  term_counter term_signBooks term_signGate term_signFood term_jet term_bridge term_blast
  term_truck term_skyDay term_carpet term_seat term_alu term_cabin term_cockpit term_stairs
  term_rail term_glass term_checker term_slide term_signBurger term_signSecurity term_signMakeup
  term_signBaggage term_signLounge` (Terminal no longer borrows `scrap_*` / `rust_*` recipes)

Shared ids from core and the Yard are reused as-is: `fence steel lamp crate pallet barrel barrier
rubber yellow hazard paint winRow container0..5 skyGrey skyDusk skyNight`. If the Yard recipes are
ever renamed, these maps need the same ids (Terminal also uses `shutter`). Scrapyard reuses Rust's
`rust_stairs` / `rust_rail` recipes.

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
