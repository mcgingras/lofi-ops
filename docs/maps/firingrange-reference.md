# Firing Range (Black Ops, 2010): layout reference

What `src/shared/maps/firingrange.ts` is built from. Coordinates are our metres: +x east, +z south
(north is up on every overhead here and in the game's minimap), y up, the origin near the middle of
the playable area. Yaw 0 faces north.

## Sources

- Call of Duty Wiki, Firing Range: https://callofduty.fandom.com/wiki/Firing_Range (callout list:
  Bunker, Containers, Depot, Dirt Road, Garage, Office, Road, Range, Shoot House, Showers, Storage,
  Tower; trivia: building 3 is the car shop with the jeep, the red Storage shed next to it, the
  southernmost building is the range house with the bench rest, the map is "small-medium").
- BO1 minimap, 512 px: https://static.wikia.nocookie.net/callofduty/images/8/87/FiringRange_MiniMap_BO.png
- BO1 colour overhead with an A1..E5 grid (Prima-guide style), 512 px:
  https://static.wikia.nocookie.net/callofduty/images/1/11/Map_Firing_Range_BO.png
- BO1 loading screen (the Tower with its ladder, the sandbagged shed, building 7):
  https://static.wikia.nocookie.net/callofduty/images/8/82/Bare_Load_Screen_Firing_Range_BO.jpg
- Black Ops 6 map guide (a "faithful remaster", same layout) with tac maps for areas, spawns,
  Domination, S&D and Hardpoint, and POI shots:
  https://www.callofduty.com/guides/blackops6/multiplayer-maps/call-of-duty-guides-black-ops-6-multiplayer-map-guide-firing-range
  (tac maps: `.../firing-range/Firing-Range-Tac-Map-{BLANK,AREAS,SPAWN,DOM,SND,HP}.webp`, 2048 px).

The BO6 tac map lines up with the BO1 minimap and overhead to within a couple of metres once
scaled (overlaid in the browser at 4.0x and a few pixels of offset), apart from one change: BO6
opens up the garage yard north of Storage, which in BO1 is a corrugated shed outside the
boundary. Footprints were therefore traced from the clean BO6 tac map, and checked against the BO1
images for what each shape is. Only the images were viewed; nothing was copied into the repo.

## Scale

Measured on the BO1 colour overhead: the M35 cargo trucks parked outside the east edge are 31 px
long (6.7 m), the car by the Range 23 px (4.5 to 5 m): about 4.6 px per metre. The BO6 tac map is
the same picture at 4.0x, so 1 BO6 px = 0.055 m. Cross-checks: the Office comes out 6.3 m wide (a
one-room hall), the Shoot House bar 4.6 m wide with 1.2 m doors, the shooting benches 2.4 m long.
Playable area: x -39.8 .. 38.5 (78 m), z -45.1 .. 45.2 (90 m), irregular.

## Layout in words

The map is a ring of buildings round a jungle hill. The north team spawns in a short gated road
stub at the top (Road); the east team spawns in the Range courtyard on the right, whose fence looks
out over the actual target lanes (outside the map). Between them the hill blocks every direct
line, so the fights happen on the three lanes around it:

- **North lane, the Dirt Road.** From the Road mouth it curves east along the north edge, between
  the boundary fence and the Shoot House, then past the hill's north side to the red Storage shed
  in the north-east corner and down a short path to the Garage and the Range. The Shoot House's
  covered shed sits on this road and its roof (reached with crates) looks straight down it.
- **Middle, the crossroads.** South-west of the Shoot House, the open junction with the jeep and
  sandbags under the wooden Tower (Domination B). The Tower's platform watches the junction, the
  Office's east doors and building 7. From the junction a sandy path runs east between the hill
  and a smaller rock outcrop to the Garage's west door.
- **South/west lane.** The long Office hall on the west side, then south past the Containers
  (Domination C) to the concrete Bunker on the south edge, and east along a concrete walkway under
  a lean-to (the Depot strip) to the Garage's south porch and the Range.

## Callouts (approximate centres, metres)

| callout | where | x, z | notes |
|---|---|---|---|
| Road | north spawn stub | -13.6, -38 | 9 m wide, gate and truck at the top (z -45) |
| Showers | NW block | -29.7, -28.5 | T-shaped, porches either side of the stall block |
| Shoot House | L, turned 24 deg | -9.4, -9.6 (bar) / -18.6, -6.2 (room) | bar two storeys (upper floor 3.2 m), west room one storey with a roof balcony, the "2" |
| covered shed | on the Dirt Road side | -2.9, -12.2 | roof 2.75 m, crates to climb |
| generator hut | north yard | -9.6, -19.5 | small turned hut with sandbags |
| Dirt Road | north edge | 3, -13 | Domination A, HQ |
| Storage | red shed NE | 21.8, -7.5 | doors west and south |
| Tower | at the crossroads | -4.7, 2.7 | platform 4.6 m, ladder on the west face |
| crossroads | junction | -12, 5 | Domination B, Hardpoint/HQ 1 |
| Office | long hall, turned -20 deg | -26, 11.2 | 19.8 x 6.3 m, doors both ends and both sides; porch north |
| building 7 | workshop south of the junction | -7.3, 15.2 | corrugated, yellow stripe |
| hill | middle, impassable | 7, 0 | x -3 .. 16, z -11 .. 15 |
| rock path | between hill and outcrop | 5, 13 | 5 to 9 m wide |
| Garage | building 3, the car shop | 22, 17 | S&D B inside, roll-up door to the Range |
| Range | east courtyard | 32, 17 | team 1 spawn, firing line along x 35 .. 38 |
| Containers | walk-through container | -15, 22.6 | Domination C at -8, 28 |
| Bunker | south edge, turned 20 deg | -15.6, 34.5 | 17.1 x 8.5 m, roof 3.25 m reached by stairs on its north side |
| south yard | east of the Bunker | -1, 38 | S&D defender spawn |
| Depot walk | south edge | 9, 28.8 | concrete walk under a lean-to |
| S&D A | west of the Office | -33, 15.5 | (BO6 position) |

## Key distances

- Spawn to spawn: 71 m straight (Road -13.6, -38 to Range 31, 17); about 85 m on foot via the Dirt
  Road or the Office, 12 s sprinting.
- Road mouth to the crossroads: about 30 m round the Shoot House's west end.
- Crossroads to the Garage's west door by the rock path: about 30 m.
- Tower platform to Domination B: 8 m; to the Office's east doors about 20 m.
- Dirt Road, covered shed to Storage: about 25 m.
- Office hall end to end: 19 m; Range courtyard north to south: 27 m.

## Sightlines

- The hill splits the map: nothing sees from the north half (Road, Dirt Road) to the Garage or Range.
- Covered shed roof down the Dirt Road to Storage.
- Tower platform over the crossroads, the Office front and building 7.
- Office hall, door to door.
- Range courtyard along the firing line, and out over the target lanes.
- Bunker roof over the Containers and Domination C.
- Shoot House upper windows over the Dirt Road (north) and the crossroads (south).

## Spawns and objectives (as placed)

- TDM: team 0 in the Road stub, team 1 in the Range courtyard (the BO6 spawn icons sit exactly
  there). FFA: 18 points spread round every area, one on the Shoot House upper floor.
- Domination (BO6 tac map): A on the Dirt Road by the covered shed, B at the crossroads under the
  Tower, C beside the Containers north of the Bunker.
- S&D (BO6 tac map): A west of the Office, B inside the Garage. Attackers spawn in the Road stub,
  defenders in the south yard / Containers area, between both sites.
- Headquarters (BO6 hardpoint rotation Tower, Bunker, Shoot House, Office, plus the Garage, Showers,
  building 7, Storage, Dirt Road).

## What is approximate

- Heights: wall and floor heights are estimates from the screenshots (Shoot House upper floor
  3.2 m, Tower platform 4.6 m, Bunker roof 3.25 m).
- The Tower's ladder is a steep invisible ramp (the movement code has no ladders).
- Turned buildings collide as thin axis-aligned slices inside their walls (bullets, players and
  sight all stop; corners are capped), and their stairs are short solid steps.
- The hill and the outcrop are terraced rock blocks with palms, not sculpted terrain.
- "Depot" and "Showers" are placed from the callout list and the overhead's shapes; the wiki does
  not mark them on a map. S&D and HQ positions follow the BO6 remaster, which may differ from 2010.
