# Summit (Black Ops, 2010): layout reference

What `src/shared/maps/summit.ts` is built from. Coordinates are our metres: +x east, +z south, y up,
north up as on the BO1 overhead. Yaw 0 faces north. The origin is the middle of the Control
building. ("North" here is the BO1 overhead's up; the BO7 guide turns the map 90 degrees and calls
the same west cliff "southern".)

## Sources

- Call of Duty Wiki, Summit (wikitext via the MediaWiki API): the map description ("research
  facility on a snowy mountain", "narrow map with severe drops on all sides", one large central
  building, "spawn trapping is very easy if the other team has the A flag"), console name
  `mp_mountain`, and the trivia: you can sprint-jump into the cable car at the edge of the map; you
  can reach "the tower near the cable car" from the central building (onto the computers, onto a
  ledge, through the glass, across to the tower); the danger sign on the west cliff; the control
  room clocks. https://callofduty.fandom.com/wiki/Summit
- BO1 colour overhead with the A1..E5 grid (Prima-guide style, 512 px), the main trace:
  https://static.wikia.nocookie.net/callofduty/images/0/0d/Map_Summit_BO.png
- BO1 minimap: https://static.wikia.nocookie.net/callofduty/images/2/2e/Summit_MiniMap_BO.png
- BO1 "bird's eye view" (perspective shot of the whole base, gondola, pylons):
  https://static.wikia.nocookie.net/callofduty/images/1/12/Bird%27s_Eye_View_Summit_BO.jpg
- BO1 loading screen (the Tower's grated catwalks over the cliff, the red gondola, building "1"):
  https://static.wikia.nocookie.net/callofduty/images/5/54/Bare_Load_Screen_Summit_BO.jpg
- BO1 in-game shots on the wiki: the control room with its stairs, mezzanine, filing cabinets and
  broken windows (`AdvancedRookie_Summit_soldiers_aiming_weapons.png`), the grated Tower platform
  looking down on the catwalk and gondola "2" (`..._soldier_firing_grim_reaper.png`), the red
  corrugated buildings (`..._team_stacking_up.png`), the gallery corridor with windows to the
  valley (`RC-XD_Summit_BO.jpg`).
- Black Ops 7 guide (2026 remake, "a triumphant return"; callouts Control room, Bridge, Catwalk,
  Tower, Gondola, Cliffside; Domination and Hardpoint tac maps):
  https://www.callofduty.com/guides/blackops7/multiplayer-maps/s03/summit
  (`BO7-Summit-Tac-Map-BLANK.webp`, `Summit_Tac_Map_DOM.webp`, `Summit_Tac_Map_HP.webp`), and the
  BO7 minimap on the wiki (`Summit_MiniMap_BO7.png`, 4096 px), which traces the same outline as BO1.
- Black Ops 4 hardpoint rotation overhead (a top-down render of the BO4 remake, structures in 3D):
  https://gameguidehq.com/wp-content/uploads/2018/10/summithardpointlocations.jpg
- Gameplay: BO1 Domination on Summit (https://www.youtube.com/watch?v=zQlMIJ5k8xE: B is captured at
  the consoles in front of the control room's wall of screens; the rotating minimap shows A and C on
  opposite sides of B) and BO1 S&D on Summit (https://www.youtube.com/watch?v=WkqYyukqMDw:
  defenders spawn in the south yard by the comms dishes).

Only the images were viewed; none are copied into the repo (they are Activision's). The comparison
image here (`summit/overhead-vs-reference.png`) shows the BO1 overhead's outline strokes only, as a
thresholded line trace resampled into our metres, beside and over our overhead.

## Orientation and how the references line up

The BO4 and BO7 maps are the BO1 map turned 90 degrees anticlockwise (BO1 north is their west):
BO1's round tank (top right) is their top left, BO1's curved west cliff path is their bottom edge.
The BO1 birdseye is the BO4 picture turned 180 degrees. With that, the BO7 minimap scaled 4.055x
down lines up with the BO1 overhead to within 1 to 2 m in the north and middle and drifts by up to
5 m in the far south; BO1 was used wherever they disagree.

## Scale

BO1 overhead: 4.5 px per metre. Checks: on the BO4 overhead (about 18 px per metre) the snowcat is
5.5 m long, the gondola cabin 2.4 m, the fuel tank 6 m across, and the same features on the BO1
overhead come out at 4.2 to 4.7 px per metre; the Firing Range overhead from the same guide series
is 4.6 px per metre. Doors traced on the BO4 render are about 1.4 m wide.

Playable area: x -25.2 .. 20.6 (46 m at its widest, across the Control building), z -51.5 .. 45.6
(97 m north to south). The north end (Barracks) and the south tail are 15 to 18 m wide. Spawn to
spawn is about 75 m in a straight line; the walk test from the north plaza to the south yard through
the Alley, the control room and the Courtyard takes about 21 s at walking pace (about 15 s
sprinting).

## Layout in words

A narrow north-south ridge with cliffs on every side, one team at each end, and the big Control
building filling the middle. Three lanes run past it:

- **West: the Cliffside.** From the north plaza's west corner, past the Cable Car station, across
  the steel **Bridge** over a chasm (the **Gondola** hangs off the cliff at its north end; a small
  ramp lets you jump in), under the **Tower** (a grated platform standing out of the chasm, its
  ladder cut off), then the open **Ledge** in front of the **Gallery**'s glass wall (the windows over
  the valley; danger sign on the open edge), and on round the curve to the Garage.
- **Middle: through Control.** From the plaza down the **Alley** (Domination A) between the Cable
  Car station and Comms to the north yard, into the Control building: offices under the mezzanine,
  the double-height **control room** with its consoles and wall of screens (Domination B), the
  mezzanine and west walkway up the stairs, the Gallery along the west wall, rooms along the east;
  out the south doors into the **Courtyard** with the snowcat.
- **East: the Catwalk.** From the north yard down the grated **Catwalk** along the east side over
  the drop (Domination C), to the passage between the generator hut and the Lab.

The Tower is reached the BO1 way: up to the control room walkway, out of the broken west window onto
the Gallery roof, and a short jump across. Nothing else gets you there.

## Callouts (centres and footprints, metres)

| callout | where | footprint / point | height | notes |
|---|---|---|---|---|
| Barracks | north end | x -7 .. 6.3, z -47.5 .. -40.2 | 6.5 (west) / 4.4 (east) | team 0 spawn in front of it; radome on the roof |
| Fuel Tank | NE corner | centre (14, -40), r 2.7 | 9 | ring of walkable ground round it (outline r 5) |
| North Plaza | z -40 .. -30 | x -12 .. 16.5 | | snowmobile, crates, guard hut on the west bump (x -17.2 .. -15, z -31.6 .. -28.2) |
| Cable Car station | NW of centre | x -10 .. -1, z -30 .. -20.4, wing x -9 .. -3.4 to z -13 | 5.0 / 3.6 | bull wheel, parked car; cable out of the west wall |
| Alley | between the two | x -1 .. 2 (z -30 .. -20.4), x -3.4 .. 2 (to z -13) | | Domination A at (0.3, -19.6) |
| Comms | NE of centre | x 2 .. 15.2, z -30 .. -13 | 6.0 / 3.8 / 4.6 | red/white antenna mast to 24 m with a beacon |
| North yard | | x -16.3 .. 15.2, z -13 .. -9.5 | | porches on the Control building's north face |
| Bridge | west cliff | from (-18, -18) to (-24.5, -7.5), 2.6 m wide | deck 0.05 | over the chasm, railings both sides |
| Gondola | off the cliff | x -24.3 .. -21.9, z -22.5 .. -20.1 | floor 0.35 | open on the cliff side; jump in from the ramp at (-17.8, -19) |
| Tower | over the chasm | x -20.3 .. -16.7, z -11.6 .. -8 | platform 4.4 | radar mast on it; from the Gallery roof only |
| Control building | centre | x -16.3 .. 14, z -9.5 .. 9.5 | roof 8.0 (east block 4.2) | |
| control room | inside | x -13 .. 7, z -6.5 .. 9.5 (double height) | | consoles and screens at z 0.6 .. 2.6, Domination B at (0, -0.9) |
| mezzanine / walkway | inside | north x -12.85 .. 6.85, z -9.35 .. -6.5; west x -12.85 .. -10.85 | 3.6 | stairs up from x 6 (rising west) and from z 7.5 (rising north) |
| Gallery | west side | x -16.3 .. -13, z -9.5 .. 9.5 | roof 3.6 | glass wall to the west, doors both ends and onto the Ledge |
| Ledge | west | x -21.6 .. -16.3, z -3.2 .. 3.8 | | snow ledge between rock outcrops |
| Catwalk | east side | x 14 .. 19.2, z -10.2 .. 9.2 | deck 0.05 | over the drop; canopy along the wall; Domination C at (17.4, 4) |
| Garage | SW | x -14.4 .. -7.6, z 12.6 .. 25.2, open bay to x -4.4 | 4.0 / 3.6 | truck in the bay; S&D A at (-11, 18.8) |
| Courtyard | south of Control | x -4.4 .. 7, z 9.5 .. 25.2 | | the snowcat at (0.3, 17.4), fuel tank on skids |
| Generator hut | SE | x 5 .. 9, z 10.2 .. 15.6 | 3.0 | |
| Lab | SE | x 6.8 .. 14.4, z 18.6 .. 25.2 | 4.0 | S&D B at (10.6, 21.4) |
| Radar | south | x -10.2 .. 0.6, z 27.6 .. 34.2 | 4.2 | radar dish on a plinth at x 1.4 .. 4.8 |
| South Yard | the tail | x -5.6 .. 13, z 34.6 .. 45.6 | | team 1 spawn; comms dishes and the helipad with the Hind beyond the edge |

## Sightlines (all checked in tests/maps-summit.test.ts)

- Tower platform over the Bridge, the north yard and the Gondola.
- Gallery windows across the Ledge to the cliff edge; the Gallery end to end (19 m).
- The Catwalk end to end (18 m).
- Mezzanine and walkway down onto the consoles.
- The Alley straight from the plaza to the Control building's north face.
- The Control building blocks every line from the north plaza to the Courtyard and the South Yard.
- The control room's west door lines up with the Gallery's west door: a lane from B out to the cliff.

## Spawns and objectives (as placed)

- TDM: team 0 in the north plaza (10 points), team 1 in the South Yard (10). FFA: 18 points round
  every area, one on the mezzanine and one on the Catwalk.
- Domination: A in the Alley, B at the control room consoles, C on the Catwalk. This is the BO7
  remake's tac map (A north of centre, B in the Control room, C on the east side), which matches what
  the BO1 Domination footage shows (B at the consoles; A and C on opposite sides of B, A nearer the
  north spawn). Confidence: B high, A and C medium.
- Search and Destroy: attackers at the north end, defenders by the Radar building and the Courtyard;
  A in the Garage, B in the Lab. The defender side is from BO1 S&D footage; the exact site rooms are
  not confirmed by any source found, so the sites sit in the two southern buildings either side of
  the Courtyard (low confidence).
- Headquarters: the BO4/BO7 hardpoint rotation (control room, the south-west building, the Cable Car
  station, the Catwalk) plus Comms, Radar, the Lab, the Barracks and the Gallery.

## What is approximate

- Heights are estimates from the screenshots: control room roof 8 m, mezzanine 3.6 m, Tower
  platform 4.4 m, other buildings 3 to 6.5 m. The ground is flat at 0; the real map has small level
  changes that are left out.
- The interiors (offices, east rooms, the station's machinery) are plausible fills; only the
  control room has good reference shots.
- The chasm under the Bridge and Tower, the void beside the Catwalk and the rock outcrops either side
  of the Ledge are read from the overhead's dark areas and the BO7 hatching; the original's exact
  rock shapes are terraced boxes here.
- The Gondola is open on its cliff side (our movement has no mantle), so the jump in from the ramp
  works without climbing; jump too early and the cliff takes you.
- The Tower jump goes from the Gallery roof, which you reach through the control room's west
  window; BO1 has you jump from the computers onto a window ledge first.
- Callout names are BO7's where it has them (Control room, Bridge, Catwalk, Tower, Gondola,
  Cliffside); the rest (Barracks, Alley, Comms, Garage, Lab, Radar, Courtyard, South Yard) are
  descriptive.
