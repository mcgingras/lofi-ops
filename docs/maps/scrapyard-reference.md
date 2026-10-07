# Scrapyard (MW2, 2009): layout reference

The reference that `src/shared/maps/scrapyard.ts` is built from. MW2's codename for the map is
`mp_boneyard`. It is a small aircraft boneyard ("U.S. Vehicle Disposal Yard 437"). A walled
rectangle runs north-south, with a building on each of its four sides and scrapped airliner
fuselages in the middle. It plays as a three-lane map.

## Sources

I only looked at these (screenshots in a browser, pixel measurements from the minimap). Nothing was
copied into the repo.

- MW2 overhead minimap, 1024 x 1024 (the main source for footprints and positions):
  https://static.wikia.nocookie.net/callofduty/images/d/d4/Scrapyard_minimap_MW2.png (via
  https://callofduty.fandom.com/wiki/Scrapyard)
- MW2 bird's-eye spectator shot and the MW2 loading screen (building heights, the crane, the
  "818" fuselages, the white two-storey building): same wiki page (`Scrapyard_Overview_MW2.jpg`,
  `Scrapyard.jpg`).
- MW2 multiplayer tour video, frames from YouTube's seek-preview storyboard (interiors: the office
  stairs and upstairs offices, the forklift room, the blue warehouse's grated catwalk, the fuselage
  tubes, the gas tanks and the burning truck): https://www.youtube.com/watch?v=ISBA-AddQew, and MW2
  gameplay at https://www.youtube.com/watch?v=dSJ0Ov9OMBI
- The official MWIII remake guide (a faithful remake of the MW2 layout). Used for callout names, which
  floors are playable, the team spawn corners and the Domination, S&D and Hardpoint placements:
  https://www.callofduty.com/guides/multiplayer-maps/call-of-duty-modern-warfare-iii-play-maps-core-multiplayer-map-guide-scrapyard
  (tac-map overlays `Scrapyard_Tac_Map_{Blank,Areas,Spawn,DOM,SND,HP}.png`).
- The MWIII minimap on the wiki (`Scrapyard_MiniMap_MWIII.png`), used to check the orientation of
  the remake against MW2.

**Orientation.** The MWIII tac map is the MW2 map turned 90 degrees, not mirrored. MW2 north is
MWIII "east" (the Red Warehouse), MW2 south is MWIII "west" (the Blue Warehouse), MW2 west is
MWIII "north" (Storage), and MW2 east is MWIII "south" (Forklift). I checked this by matching the
building footprints. The guide's compass words are loose, so I worked from its images.

## Scale

I measured the minimap with a pixel ruler (image px) and checked the scale against known objects:

| object | minimap px | real size | px per m |
|---|---|---|---|
| fuselage tube width (four tubes) | 38-41 | airliner fuselage ~4 m | 9.5-10 |
| Griffin box truck | 22 x 63 | box truck ~2.3 x 6.5 m | 9.5-9.7 |
| 20 ft container (south-west) | 61 x 20 | 6.1 x 2.4 m | 10 / 8.3 |

The scale used is **1 m = 9.5 minimap px**. Map metres: `x = (px - 488) / 9.5`, `z = (py - 521.5) / 9.5`.
x points east and z points south (minimap up is north = -z, matching yaw 0).

That gives a play space of **51 m (west-east) x 80 m (north-south)**, and the Red Warehouse
reaches 8 m further north. MW2 movement is about 190 units/s with 1 unit = 1 inch, which is 4.8 m/s.
Our walk speed is 5.0 m/s, so timings carry over at true scale. Running spawn to spawn takes about
14 s (70 m).

## Layout in words

- **North: the Red Warehouse** (the large office; MW2 trivia puts the "Squeeky wheels" sign on its
  roof, "near flag A"). An L-shaped two-storey building: a main block 18.6 x 8.5 m along the north
  wall, and a 4.4 x 6.7 m wing coming south on its west end. Inside on the ground floor are a
  kitchen and store rooms. Stairs lead up to the offices. Their windows face south down the whole
  yard, and the corner office at the east end overlooks Domination A. In front, in the corner of
  the L, is a front yard with no roof, broken up by concrete walls and barriers (the partition lines
  on the minimap). A back alley (4 m wide, a dead end) runs north past its east end to a rear door.
- **South: the Blue Warehouse.** A tall open hall of 22.4 x 11.3 m in blue corrugated cladding. The
  ground floor is open with nowhere to hide. A grated catwalk at about 3.6 m runs along the north
  wall, and its windows duel with the Red Warehouse's upstairs windows across the map (about 68 m).
  There is a big roll-up door in the middle of the north wall, a man door, and two side doors (west
  and east). The crane stands outside the south wall, and its boom reaches over the roof to the
  fuselages.
- **West: Storage** (the white building with a gable roof and a blue skirt, "2" painted on the roof).
  It is 10.7 x 23 m with one playable floor and four entries: two on the east front (one up a
  concrete porch step), one north, one south. Inside are a partial wall and climbable crate stacks.
  Outside: an electrical box and a wall stub running east from the front; a **low wall** (knee-high
  stone) running 24 m south along the front, 1.7 m out; the **Griffin box truck** in the west lane;
  a **white container** and a dumpster at the south end.
- **East: the Forklift building** ("4" on the roof). It is 8.6 x 14.3 m, single storey, with a big
  roll-up opening onto the centre, doors north and south, a forklift and stacked crates inside. To
  its north is the **shed** (5.8 x 7 m, barrels inside). To its south: the **burning truck** (by
  Domination C, with smoke and fire), the **engine bay** (two turbofans behind low walls) and the
  **gas tanks** (two spheres on a pad behind hazard barriers, S&D B).
- **North-west: the helipad** (8.7 x 8.8 m pad on a dark apron) with a parked CH-46 Sea Knight. MW2
  trivia says it is one of the few aircraft with a real interior, so here it is walk-through: a side
  door and a rear ramp. A red and white lattice tower lies fallen from the helipad across the tail
  section onto the north fuselage.
- **Centre: the fuselages.**
  - The long blue-roofed fuselage, 22.4 m north-south, west of centre, with a cross piece (11 m
    east-west) at its north end forming an L.
  - The north tube (11.8 m, open at both ends) under the fallen tower.
  - The tail section (9 m, closed at the tail end, side door).
  - The "818" pair east of centre (11 m each, open ends, doors and breaches).
  - A broken wing panel lying beside the long fuselage, a baggage tug, and a tree in the middle
    (no collision, like MW2's).
  - Crates stacked on the long fuselage's west side, and a fallen wing on the east side of the 818
    pair, give access to the roofs (MWIII: "several points provide access to the top of the
    fuselages").

## Callouts (map metres, centre of each)

| callout | x | z | notes |
|---|---|---|---|
| Red Warehouse (ground / upstairs) | 2.5 | -43.6 | floors 0 and 3.4 m; stairs along the back wall |
| Red Warehouse wing | -4.6 | -36 | doors W/S/E, windows upstairs |
| Corner office | 9.8 | -42 | upstairs, overlooks A |
| Front yard | 4.5 | -36.5 | concrete walls, barriers |
| Back alley | 13.9 | -42.5 | dead end, rear door |
| Spawn NW (outside Red Warehouse) | -16 | -36.5 | team 0 (OpFor in MW2) |
| Helipad / Sea Knight | -16.8 | -28.2 | pad 0.35 m, cabin 0.75 m |
| Shed | 19.4 | -23.7 | |
| Tail section | -2.2 | -22.2 | |
| North tube | 7.6 | -21.3 | |
| Tree / centre | -1 | -13.5 | |
| Storage | -20.2 | -5.8 | Dom B, S&D A |
| Storage porch | -14.3 | -11.3 | |
| Low wall | -13.1 | -6 to 18 | 0.9 m |
| Griffin truck | -9.3 | 1 | |
| Long fuselage | -4 | 6.5 | cabin 0.4 m, roof 3.6 m |
| Cross piece | -0.7 | -6.6 | |
| 818 fuselages | 7.5 | 2 / 13.6 | |
| Forklift | 19.4 | -8 | big opening west |
| Burning truck | 15.8 | 10.3 | |
| Engine bay | 22.5 | 10.2 | |
| Gas tanks | 19.5 | 24.5 | S&D B |
| White container | -16.3 | 8.5 | |
| South-west yard | -18 | 32 | team 1 |
| Blue Warehouse (hall / catwalk) | 2.4 | 34 | catwalk 3.6 m along the north wall |
| Loading Zone | 19.5 | 34 | team 1 (Task Force 141 in MW2) |

## Distances, lanes and sightlines

- Spawn to spawn (NW to SE corner): about 85 m diagonal, about 70 m walked; on foot the first fight is
  at the centre fuselages after about 6-7 s.
- **West lane**: Storage front, low wall, truck, white container, south-west yard (about 6 m wide
  between the low wall and the long fuselage).
- **Centre lane**: through the fuselages (cabins one step up) and over their roofs.
- **East lane**: a straight 50 m asphalt service road from the shed past the Forklift building and
  burning truck to the gas tanks. It is open end to end at ground level.
- **Warehouse duel**: from the Blue Warehouse catwalk windows to the Red Warehouse upstairs windows,
  about 68 m over the fuselage roofs (3.6 m). At ground level the fuselages block it.
- **Corner office -> A** (about 10 m) and **-> the front yard and the centre**.

## Objectives (from the remake's tac maps, mapped onto MW2)

- **Team spawns**: diagonal corners. Team 0 north-west (outside the Red Warehouse, by the helipad);
  team 1 south (the Loading Zone south-east of the Blue Warehouse, plus the south-west yard for
  TDM spread).
- **Domination**: A in the open in front of the Red Warehouse's east end (13.5, -32.5); B inside
  Storage (-18.5, -5); C in the open by the burning truck (18.5, 3).
- **Search and Destroy**: A inside Storage (south half, -19.5, 1.5); B at the gas tanks (19.5, 19.5).
  The attackers start by the shed in the north-east; the defenders start in the Blue Warehouse.
- **Headquarters** (the remake's Hardpoints, all indoors): Storage, the centre fuselages, the Red
  Warehouse ground floor, the Blue Warehouse hall and the Forklift building.

## What is guessed

- The minimap gives only footprints. Heights come from screenshots: the office storey is 3.4 m, the
  catwalk 3.6 m, fuselage roofs 3.6 m, Storage 4.2 m with a gable roof, Forklift 4.6 m and the
  Blue Warehouse 7.6 m.
- I placed the interior rooms, windows and doors from the video frames and the guide's text, not
  from exact plans.
- MW2 used ladders (and the remake has a third level in the Blue Warehouse). Here every upper level is
  reached by stair ramps, crate stacks or a sloped wing, so the bots can use them.
- The fuselages are boxes with a stepped shoulder rather than round tubes, and MW2's sheared, torn
  ends are cut square.
