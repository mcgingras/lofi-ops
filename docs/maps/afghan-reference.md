# Afghan (MW2, 2009): layout reference

This is what `src/shared/maps/afghan.ts` is built from. The layout comes from the original MW2 minimap
(Call of Duty Wiki) and the official tac maps of the MWIII (2023) remaster, which keeps the 2009 layout.
Area names, objective positions and how the areas connect come from the official MWIII map guide, the
MW2 gallery screenshots on the wiki and a walking tour of the 2009 map on YouTube. I viewed these
references and did not copy any of them into the repo: their licences don't allow it. The comparison in
`docs/maps/afghan/` shows only the minimap's outlines, traced, next to our render.

## Coordinates and scale

- Metres; x runs east and z runs south (the minimap's "down"). The origin is the centre of the MW2
  minimap square.
- **Scale: 6.3 px/m on the minimap upscaled to 1024 px** (3.15 px/m on the native 512 px image). Four
  known sizes agree on it to within about 5%:
  - The three pieces of the C-130 add up to 185 px, which is 29.4 m. A real C-130 is 29.8 m long.
  - The tail piece is 30 px across (4.8 m). The fuselage is 4.3 m wide.
  - The Humvees are 30 px long (4.8 m). A real one is 4.6 m.
  - The sandbag rings round the AA guns are about 25 px across (4.0 m).
- **Play space:** x -73.5 to 60.1 and z -74.6 to 64.7, so about **134 x 139 m**. That makes Afghan medium-large:
  three times the width of Rust and twice the area of Scrapyard. Sprinting at 7.2 m/s, you reach the
  plane from either spawn in about 8 s, and cross the map corner to corner in about 25 s.
- **Heights** aren't on any minimap. They come from the screenshots and the guide text: the overlook
  above the tail, the bunkers looking down on the crash site, and the cave mouth overlooking the plane.
  I judged them against door heights (about 2 m) and the C-130's 4.3 m fuselage.

## The layout in words

Afghan is a desert canyon. A crashed **C-130** lies in the low basin in the middle, broken into three
sections:

- the **tail section** to the west, with its fin standing upright;
- the **middle section**, whose wing runs south up onto the **ledge above the Cave mouth**;
- the **cockpit section** to the east. Its nose points at the Canyon and the east Bunker.

Rock masses ring the basin, and the paths run round them, so every area has two or more ways in:

- **North:** the big central rock. The north path runs along its top. The passage on its east side
  runs past the centre Bunker.
- **North-west, the Rocks (OpFor spawn):** a high lobe of ground with the rock pair R1 and R2.
  - A path circles R1, and the pipeline crosses overhead on a lattice.
  - The valley between R2 and the central rock runs down to the basin behind the tail.
- **West, the Batteries:** the high plateau with two ZU-23 guns in sandbag rings and crumbled mud-brick
  walls.
  - Its cliff edge is the **overlook** above the tail. It is a one-way drop, with mattresses at the bottom.
  - The big south-west rock rises along its east side.
- **South-west, the Cliffs and the Walkway:**
  - The concrete Walkway runs down from the plateau along the cliff face. It has a railing on the outside.
  - On its inner side are a small alcove with a shelter door and two flights of stairs down to the Cliffs.
  - From the Cliffs, the west mouth of the Cave opens into the mountain.
- **South, the Cave:** the Cave runs through the cave mountain. It has a north mouth (up a sand slope
  from the basin, under the ledge), a west mouth (to the Cliffs) and a south mouth (down to the
  south pocket).
- **South pocket:** the third AA gun with its sandbag arc, at the end of the Walkway. A narrow pass leads
  from it to the Canyon.
- **South-east, the Canyon (TF141 spawn):**
  - two Humvees and the small hill in the middle;
  - the sealed cave door in the cliff;
  - the Stryker blocking the road out.
- **North-east, the Poppy Fields:**
  - the farm buildings, the low field walls and the poppy field;
  - the open plank shack, and the two-storey farmhouse in the far corner;
  - the water tank.
- **The two Bunkers face the plane:**
  - The **centre Bunker** sits on its sand mound east of the central-rock passage. It has a window slit
    over the crash site and a rear door and stairs down to the fields.
  - The long **east Bunker** has four rooms. It sits on a raised plinth between the north-east lane and
    the Canyon, with windows west to the plane and south down the Canyon.

## Callouts (centre or extent, metres)

| Callout | Where (x, z) | Floor height | Notes |
|---|---|---|---|
| Tail section | x -16..-7.4, z -16.6..-12.4 | 0.35 (cargo floor) | fin up to 10.7, tailplane 12 m span at 4.1 |
| Middle section | x -1.6..8.6, z -18.2..-13.8 | 0.35, roof 4.3 | both ends broken open, crates inside |
| The wing | x 1..5, z -13.8 -> 7.2 | 0.15 -> 5.8 | walk up it onto the ledge, walk under its high end |
| Cockpit section | x 12.2..21 (nose to 23.6), z -9.6..-5.2 | 0.35 | windscreen and side windows |
| Ledge above the Cave mouth | x -4.2..7.2, z 7..12.4 | 5.8 | power position over the plane |
| Overlook (plateau edge) | x -31..-26, z -15..-10 | 6 | tarp shelter, 6 m drop to the mattresses |
| Batteries plateau | x -73..-27, z -18.5..16 | 6 | AA guns (-69.2, -12.6) and (-51.4, 7.2), mud-brick ruins |
| The Rocks (OpFor spawn) | x -36..-17, z -69..-46 | 5 | low stone wall, boulders |
| North path / R1 ring | z -52..-46 and x -56..-47 | 5 -> 6 | the pipeline overhead |
| Rocks valley | x -35..-19.6, z -45 -> -19 | 5 -> 3.25 (landing) -> 0 | the path from the R1/R2 gap joins at the landing |
| North path over the central rock | x -19..-3, z -52..-46 | 5 -> 2.5 | down to the Poppy Fields |
| Poppy Fields | x -6..40, z -74..-35 | 2.5 | farm buildings, field walls, poppy field (10..22, -51..-43) |
| Open shack | x 26..29.6, z -48.8..-42.1 | 2.5 | thin plank walls: they hide you but don't stop bullets |
| Farmhouse (far north-east) | x 27.5..33.9, z -65..-53 | | two storeys, solid |
| Centre Bunker | x 6.8..16.8, z -34.6..-29.4 | 4 | slit window south, door west end, rear door and stairs north |
| Central-rock passage | x 2.8..6.2, z -35 -> -27 | 2.5 -> 0.3 | between the central rock and the bunker mound |
| East Bunker | x 31.6..42.2, z -21.8..-4 | 2 | four rooms; doors north, west and south |
| Cave | x -11.6..9.2, z 10.6..38.2 | 2 (2.5 at the west mouth) | ceiling 5.4..6.6, rock pillars, timber props, crates |
| Cliffs | x -40..-10, z 16..41.6 | 2.5 | climbable outcrop (-24..-16, 24..30), boulders |
| Walkway | west leg x -43.4..-40, z 16..32; south leg z 41.6..45.2 to x -6 | 6 -> 4 -> 2 | alcove (-28..-23.6, 37.6..41.6) |
| South pocket | x -6..17, z 37..65 | 0 | AA gun (6.2, 49.4) and its sandbag arc |
| Canyon | x 30..58, z -3..52 | 2 -> 0 | Humvees (38.8, 10.3) and (37.8, 27.9), hill (43, 19.5), Stryker (57, 46.6) |
| Sealed cave door | x 27.2, z 22..25.4 | | in a recess of the mountain's east face |

## Lanes and sightlines

- **The middle:** the basin round the plane is the long-range killing ground. These all watch it:
  - the overlook (west);
  - the ledge above the Cave (south);
  - the Cave's north mouth;
  - the centre Bunker's slit (north);
  - the cockpit windscreen (east).

  `tests/maps-afghan.test.ts` checks these lines.
- **The Canyon** runs about 50 m from the east Bunker plinth down to the TF141 spawn bay. The east
  Bunker's south windows look straight down it.
- **The west loop:** the Rocks, then the R1/R2 gap or the west strip, then the Batteries, then the
  Walkway, then the Cliffs and the Cave. The long flank. It has no long sightlines except across the
  plateau.
- **The north loop:** the Rocks, then the north path, then the Poppy Fields, then the north-east lane,
  then the east Bunker, then the Canyon. It flanks behind both Bunkers.
- **Blocked lines:** the central rock hides the Rocks spawn from the Poppy Fields and the plane from the
  north path. The cave mountain hides the Canyon from the Cliffs and the pocket from the plane.
- **Close quarters:** the Cave (three mouths), the Bunkers, the plane interiors and the Walkway alcove.

## Spawns and objectives

- **TDM:** OpFor spawns at the Rocks (north-west) and Task Force 141 in the Canyon (south-east),
  from the MWIII spawn map. In our data team 0 = the Rocks and team 1 = the Canyon, so that team 1
  can be the side that defends in S&D.
- **Domination:** the MW2 flags are at the Batteries (west), the plane (middle) and the Canyon (east).
  MWIII moved B north to the Poppy Fields. We keep MW2's B at the plane, at (10.4, -9.4) between the middle
  section and the cockpit. Our convention needs A on team 0's side, so the letters are: **A = Batteries**
  (-46.4, 3.6, on the plateau), **B = plane**, **C = Canyon** (43.2, 21.8). MWIII calls them C, B and A.
- **Search and Destroy** (MWIII): the attackers start at the Rocks (`modeSpawns.sd.attackers`, the bomb by
  their spawn). Site **A** is at the plane (9.4, -5.2), south of the middle section. Site **B** is in
  the south pocket by the AA gun (1.8, 47.4). The defenders (`modeSpawns.sd.defenders`) start in the east
  Bunker and on the Canyon plinth, which is closer to both sites. The guide's advice fits this: hold the
  Cave and the east Bunker on defence.
- **Headquarters** (MWIII's five hardpoints): the Batteries, the plane, the east Bunker, the Poppy Fields
  and the Cave.
- **FFA:** 20 points spread over every area.

## Simplifications

- **Terrain** is stepped: a height function per area, rasterised into 1 m brushes with 0.25 m steps, which
  you can always walk up. The long slopes are real ramps: the Rocks valley, the north path, the passage,
  the bunker mound, the plinth, the cave approaches and the Walkway.
- **Rock masses and the canyon walls** are polygons rasterised into 1.5 m blocks that step in 1.8 m strata.
  Nobody can jump that high, so the rocks need no clips. The original's smooth displacement rock is
  approximated this way.
- **The plane sections** lie square to the axes. In the minimap the middle and cockpit sections turn about
  25-35° south of east. The wing points straight south, where in MWIII it points south-west, so it can
  be one continuous ramp. Its top is a smooth slope, and its underside is a shallow sawtooth.
- **The ledge** is reached straight from the wing. In MW2 you had to jump from the wingtip to the ledge.
- **Secret spots:** the bush under the clifftop and the Cold Blooded perch on the middle wing are left out.
- **The pipeline** over the Rocks is scenery from the remaster, with one collidable leg.
- **Fall damage:** there isn't any in the game yet, so the overlook drop is free. The mattresses are only
  scenery.
- **Rotated props** collide as rows of axis-aligned boxes. These are the Humvees, the Stryker, the
  farmhouse by the poppy field, the sandbag rings and the ruined walls.

## Sources

- Call of Duty Wiki, "Afghan": `https://callofduty.fandom.com/wiki/Afghan`. It has the overview text
  (the cave, the bunkers, the path round the back of the cave to the high ledge, the poppy fields, the
  ledge above the cave mouth reached up the wing, the mattresses under the clifftop) and the trivia
  (the concrete bridge with an alcove along the cliff face, the bomb-shelter door, the Stryker blocking
  the road, the village behind the OpFor spawn). It also hosts the images I used:
  - MW2 minimap `Afghan_Map.jpg`: `https://static.wikia.nocookie.net/callofduty/images/` + the usual hash path.
  - MWIII minimap `Afghan_MiniMap_MWIII.png`.
  - MW2 loading screen `Afghan_loading_screen_MW2.png`.
  - MW2 gallery: `TF141_spawn_Afghan_MW2.png`, `OpFor_spawn_Afghan_MW2.png`,
    `Plane_from_the_front_Afghan_MW2.png`, `Plane_interior_Afghan_MW2.png`,
    `Bunker_from_the_inside_Afghan_MW2.png`, `Cave_from_the_front_Afghan_MW2.png`,
    `Cliff_area_Afghan_MW2.png`, `Overlook_Afghan_MW2.png`.
  - MWIII promos `Afghan_Promo_MWIII.jpg` to `Afghan_Promo7_MWIII.jpg`.
- MWIII (2023) official map guide: `https://www.callofduty.com/guides/multiplayer-maps/call-of-duty-modern-warfare-iii-play-maps-core-multiplayer-map-guide-afghan`.
  - Its tac maps (Blank, Areas, Spawn, DOM, SND, HP) are under
    `https://www.callofduty.com/content/dam/atvi/callofduty/cod-touchui/blog/guides/mwiii/tacmap/afghan-tac-map/`.
  - It also has six environment shots and three action shots.
  - The guide text gives the area names (Rocks, Canyon, Poppy Fields, Plane, Cave, Batteries, Walkway,
    Cliffs) and the spawns. It describes the wing up to the cliffside ledge, the high perch above the
    fin, the Cave's three entrances, the Bunkers' rear exits to the fields, and the S&D attack and
    defence routes.
- "Call of Duty: Modern Warfare 2 Tour of Multiplayer Map Afghan (Xbox 360)", YouTube
  `https://www.youtube.com/watch?v=M987OMdrI8k`. A walking tour with the minimap on screen, which I used
  to check the walkway railing, the bunker interiors, the farm shacks and walking on the wing.
