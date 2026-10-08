# Launch (Black Ops, 2010): layout reference

What `src/shared/maps/launch.ts` is built from. Coordinates are our metres: +x east, +z south
(north is up on every overhead here and in the game's minimap), y up. The track and the rocket sit
on x = -0.45 (the overhead's centre line), the origin is the middle of the overhead's C row. Yaw 0
faces north.

## Sources

- Call of Duty Wiki, Launch: https://callofduty.fandom.com/wiki/Launch (read through the MediaWiki
  API). Facts used: Baikonur cosmodrome, Soyuz 11A511 on the pad; the rocket launches about half
  way through a match and kills anyone under the engines (also on the platforms beside it); in
  S&D target A is under the rocket, in Domination flag B is under the rocket; a vertical map.
- BO1 colour overhead with an A1..E5 grid (Prima-guide style), 512 px:
  https://static.wikia.nocookie.net/callofduty/images/9/9c/Map_Launch_BO.png
- BO1 minimap, 512 px: https://static.wikia.nocookie.net/callofduty/images/1/16/Launch_minimap_BO.png
- BO1 loading screen (the rocket between its two gantry towers, the horizontal fuel tanks, the
  white star building, the shuttered garage):
  https://static.wikia.nocookie.net/callofduty/images/c/c6/Bare_Load_Screen_Launch_BO.jpg
- Black Ops 7 map guide (the 2026 remaster, same layout) with the blank tac map, Domination and
  Hardpoint layers and the intel ("Fuel Yard, Loading area, Launch Pad ... along the main Road",
  "Wall Jump off the angled ground platforms up to one of two ledges", "Climb up to the top level of
  either of the Launch Pad staircases for excellent views extending toward the map's two main spawn
  points. Use the red piping running along the outer wall"):
  https://www.callofduty.com/guides/blackops7/multiplayer-maps/s04/launch
  (tac maps `.../season-04/launch/BO7_MP_Launch_{BLANK,DOM,HP}.webp`, 2048 px).
- Black Ops 4 map spotlight (the 2019 remake): spawns at the east and west security checkpoints, the
  underground path under the rocket on the north side with two winding staircases beside it and an
  open roof above, the centre on top of two converging inclines with a missile car you can mantle,
  the elevated track across the middle looking down onto the flame duct:
  https://blog.activision.com/call-of-duty/2019-09/Black-Ops-4-Map-Spotlight-Launch
- Gameplay footage (frames looked at in a headless browser, nothing saved in the repo):
  "Call of Duty: Black Ops Tour of Multiplayer Map Launch" (https://www.youtube.com/watch?v=4p3iAUxyBSA),
  "Black Ops 1 Multiplayer: Launch Domination (42-22)" (https://www.youtube.com/watch?v=n71w5aXU23w),
  "Call of Duty: Black Ops - Launch Takeoff (HD)" (https://www.youtube.com/watch?v=TYpFJZF41Mw).
  They show the checkpoint fences and gate, the stair towers with grated steps, the trench under the
  rocket with the red flame deflector, the concrete inclines either side of the track with the green
  tracked missile car and its orange erector on top, the containers by flag A, the white fuel tanks.

None of these images are freely licensed, so none were copied into the repo. `docs/maps/launch/`
holds only our own renders: `launch-overhead.png` (and the ground floor slice `-y3`), our
`reference-trace.png` (the outline, footprints and objective positions as traced, drawn by us) and
`comparison.png` (trace above, rebuild below). The overlay of the rebuild on the real overhead used
while iterating stays in the scratchpad.

## Scale

The BO1 overhead shows the white fuel tanks at D4 as 22 px circles (512 px image); they read as
about 6 m across next to a player in the footage, so about 3.6 px per metre. The rocket cross with
its boosters measures 33 px (10.3 m for a Soyuz across the boosters: 3.2 px/m) and the pit circle
around it 45 px (12.6 m). We use 3.57 px/m on the 512 px overhead (0.28 m per px). Cross-checks: the
outline comes out 126.75 x 63.4 m, the flame trench opening 12.6 m, the Control building 11.7 x 7.3 m,
the Centrifuge hall 14 x 9.4 m, doors 1.2 to 1.6 m, the walk from checkpoint to checkpoint about
120 m (17 s sprinting). The BO7 tac map lines up with the BO1 outline to about a metre at
0.0776 m per px (2048 px image).

## Layout in words

A long east-west band between two security checkpoints, with the launch pad pushed out of its north
side like a tower on a castle wall. The middle third is the pad and the track: the Soyuz stands on
the pad over the flame trench, the raised rail track (the embankment the missile cars run on) runs
south from it to the south edge, and the main road crosses it in the middle. Two diagonal corridors
run from the main road up the north-west and north-east sides of the pad to its corner entrances.

- **The pad.** The flame trench under the rocket (1.5 m below the apron) runs west-east and comes up
  on ramps to the two corner entrances: the underground northern path from one side to the other
  (Domination B, S&D A). Over it the deck ring (2.4 m) round the rocket opening; stairs from each
  corner climb to the walkway behind the rocket (the red pipes run along its outer wall); two stair
  towers on the deck south-west and south-east of the rocket go up to balconies (6.4 m) that look
  down the main road towards both spawns. The gantry towers stand behind the pad outside the map.
- **The track.** The embankment's top is level with the deck (2.4 m), its sides are the two concrete
  inclines you run up anywhere. The big missile car stands on it at the main road crossing (climb
  its ladder: 5 m, the highest spot in the middle), a smaller tank car further south.
- **West half.** The West Checkpoint yard (team 0), the Offices block north of the main road, the
  Warehouse south of it with the main road a narrow alley between them, the Containers yard
  south of the Warehouse (Domination A by the turned container), the Stairs Roof building on the
  south-west edge, and the west-centre sheds (the two-door shed, the red-roofed store and the
  lean-to: Hardpoint 2) between the Warehouse and the track. The Centrifuge is the big hall south of
  them, by the track.
- **East half.** Control, the two-storey building north-east of the track (outside stairs up to the
  low roofs south of it, its upper windows over the track and C4), the C4 yard with horizontal
  fuel tanks, the Garage and its store on the north-east edge, the east warehouse, the Loading dock
  in the south-east and the East Checkpoint yard (team 1). The Fuel Yard tank farm is south-east of
  the track, the two big tanks on the south edge (S&D B between them and the farm), Domination C by
  the turned container east of it.

## Callouts (approximate centres, metres)

| callout | where | x, z | notes |
|---|---|---|---|
| West Checkpoint | team 0 spawn yard | -58, 1.5 | gate on the west edge, booth, barriers |
| Offices | block north of the main road | -44, -5.4 | two rooms, covered passage, sheds east |
| Main Road | the east-west road | -35 .. 45, 0 | 2.5 m alley between Offices and Warehouse |
| Warehouse | hall south of the road | -34, 6 | Hardpoint/HQ, big door east |
| Containers | sandy yard south of the Warehouse | -30, 16 | Domination A at -24.8, 21 |
| Stairs Roof | south-west edge | -39.6, 17 | roof 3.2 m, stairs up its west side |
| NW corridor | diagonal lane to the pad | -19, -15 | to the west corner entrance |
| Launch Pad | rocket at | -0.45, -22.1 | deck 2.4, towers 6.4, walkway z -31.6 .. -27 |
| Flame trench | under the rocket | -0.45, -20 | floor -1.5, ramps to x -10.9 / 10.0 at z -24.75 .. -21 |
| Track | embankment | -0.45, -15.5 .. 26 | top 2.4 (\|u\| < 2.6), inclines to \|u\| 5.6 |
| Missile car | on the track at the road | -0.45, -0.7 | top 5.0, ladder at its north end |
| Centrifuge | big hall | -16, 15 | catwalk 3.4 along the north wall, drum and arm |
| NE corridor | diagonal lane to the pad | 16, -15 | to the east corner entrance |
| Control | two storeys | 15.8, -5.5 | upper 3.6, low roofs 3.6, outside stairs at x 17.5 |
| C4 | yard east of Control | 27, 2 | horizontal tanks, Hardpoint 4 at 20.4, 9.4 |
| Garage | north-east edge | 36, -3 | open front, store behind |
| Fuel Yard | tank farm | 15, 16 / 15.8, 27 | 3 tanks on a walled base, 2 big tanks; S&D B 16, 22; Domination C 24, 20.6 |
| Loading | south-east dock | 42, 17 | platform 1.3 m with a shed |
| East Checkpoint | team 1 spawn yard | 55, 1 | gate on the east edge, booth |

## Key distances

- Checkpoint to checkpoint: about 115 to 123 m straight, about 125 m on foot along the main road.
- West yard to the trench through the NW corridor: about 60 m; east yard to the trench about 65 m.
- Domination B is 56 / 54 m from the nearest spawn of each team (within 4 %), A 34 m from team 0's,
  C 31 m from team 1's.
- Tower balcony to the west yard mouth: 44 m; to the east yard: 52 m.

## Sightlines (all in tests/maps-launch.test.ts)

- Tower balconies down the main road: west to the west yard mouth (-50, 3), east to the east yard.
- The two spawn yards never see each other (buildings and the missile car in the way).
- The trench is open end to end under the rocket and hidden from the road; the deck looks down into it.
- The missile car top watches the deck; the walkway corner watches the track; the rocket itself
  blocks the walkway's view straight down the track.
- Control's upper west windows over the track; the Centrifuge catwalk windows over the lean-to.

## Spawns and objectives (as placed)

- TDM: team 0 in the West Checkpoint yard, team 1 in the East Checkpoint yard (BO4: "teams spawn at
  either the eastern or western security checkpoint"). FFA: 27 points over every area and level.
- Domination (BO1 wiki + BO7 tac map): A by the turned container south of the Centrifuge, B under
  the rocket in the flame trench, C by the turned container at the Fuel Yard.
- S&D: A in the flame trench (BO1 wiki), B between the tank farm and the big tanks. The BO1 position
  of B is not documented; the Fuel Yard is our choice. Attackers start at the West Checkpoint,
  defenders round the Garage / C4 (sites 31 and 26 m away; 53 and 72 m from the attackers).
- Headquarters: the BO7 hardpoint rotation (track south, the west-centre lean-to, the pad, south of
  Control) plus the Warehouse, Control, the Centrifuge, Offices and the east warehouse.

## What is approximate

- Heights are estimates from the footage: deck/track 2.4 m, trench -1.5 m, towers 6.4 m, Control
  7 m with the upper floor at 3.6 m, most sheds 3.5 to 5.5 m.
- The towers' "winding staircases" are two-flight U stairs inside a 4 x 5.5 m tower; the original
  towers are taller and open. Their bases stand on the deck; you reach the trench by the ramps, not
  the towers.
- The NE complex (Control) is simplified from the overhead's beige platforms into one two-storey
  building with low roofs and an outside stair. Several overhead shapes whose purpose isn't visible
  in the footage are plain blocks.
- The missile car's mantle is a ladder (steep ramp); stairs elsewhere are ramps (the movement code
  has no ladders or mantling).
- The rocket launch event (countdown, ignition, kill zone under the engines) is not modelled: the
  rocket is static scenery that stops bullets.
- Turned containers collide as a stair of axis-aligned slices inside their footprint.
