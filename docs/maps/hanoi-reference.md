# Hanoi (Black Ops, 2010): layout reference

What `src/shared/maps/hanoi.ts` is built from. Coordinates are our metres: +x east, +z south
(north is up on the game's minimap and on every overhead here), y up. The origin is minimap
pixel (250, 255), roughly the middle of the playable area. Yaw 0 faces north.

## What the original is

Hanoi (`mp_hanoi`) is one of Black Ops' launch maps; it was not part of the First Strike DLC
(that pack was Berlin Wall, Discovery, Kowloon and Stadium). It is set in 1968 at night in an
NVA prison modelled on the Hoa Lo "Hanoi Hilton", with a barricaded city street along its west
side. SOG fight NVA. The wiki describes a medium map: a prison inside and a barricaded street
outside, dark enough that spy planes are hard to see against the sky.

There is no tram line, market square or canal in the original. The brief asked for those, but the
user's standing rule is that maps must be faithful, so the build follows the real map and takes
from the brief only what the original also has: the night street with its two- and three-storey
colonial shophouses and balconies, street lamps, lanterns, power lines and parked vehicles. As a
small nod to the brief, a pair of old tram rails is let into the street's asphalt (decals only).

## Sources

- Call of Duty Wiki, "Hanoi": https://callofduty.fandom.com/wiki/Hanoi (overview: prison and
  barricaded street, night; trivia: the gallows with the blood pool under it, the projector room
  with the "re-education" door and the wall clock, the balcony with the ladder near the SOG spawn
  whose banister stops bullets, the searchlight tower, the gate flag, the cell blocks with rat
  holes, two RC-XD tunnels).
- BO1 minimap, 512 px (the main measuring reference):
  https://static.wikia.nocookie.net/callofduty/images/8/85/Hanoi_MiniMap_BO.png
- BO1 overview with the A1..E5 grid (same frame as the minimap, offset by about 3, 12 px):
  https://static.wikia.nocookie.net/callofduty/images/8/81/Map_Hanoi_BO.png
- Two bird's-eye screenshots (the second is the map turned 180 degrees: street on the right, the
  bus by the gate tower, the gallows courtyard, the well courtyard, the round plaza with the tree):
  https://static.wikia.nocookie.net/callofduty/images/c/c8/Bird%27s_Eye_View_Hanoi_BO.png and
  https://static.wikia.nocookie.net/callofduty/images/2/20/Bird%27s_Eye_View_2_Hanoi_BO.jpg
- Loading screen: https://static.wikia.nocookie.net/callofduty/images/e/eb/Bare_Load_Screen_Hanoi_BO.jpg
- Gameplay, no commentary (TDM; SOG spawn by the well and the stairs, the street with the bus and
  power lines, the covered walkways, the wash-house basins, the gallows yard):
  https://www.youtube.com/watch?v=mrBxf7UbLLY
- Gameplay, Domination (flag markers on the minimap; used for the flag positions):
  https://www.youtube.com/watch?v=okXz-93blBQ

These images are Activision's, so none are saved in the repo. I viewed them in the browser and
traced them by hand. `docs/maps/hanoi/comparison-trace-vs-build.png` sets that hand trace (my own
schematic) beside the build's overhead. I also overlaid the build's collision footprint on the
real minimap in the browser; it lines up to within a pixel or two (a metre or less) everywhere.
That overlay is kept outside the repo because it contains the minimap.

## Scale

The 512 px minimap comes to **0.2 m per pixel**:

- the parked cars measure 22 x 8 px (4.4 x 1.6 m), and the bus by the gate 42 x 11 px
  (8.4 x 2.2 m);
- the gallows platform measures 46 x 24 px (9.2 x 4.8 m), the long cell block is 29 px wide
  (5.8 m: a corridor plus a row of cells), and the well 12 px across (2.4 m);
- doors read as 6 to 7 px gaps (1.2 to 1.4 m), about right for 2 m doors;
- the playable outline spans 88 x 88 m (about 5,000 m² of floor): a medium map. Sprinting at
  7.2 m/s, the NVA street spawn to the SOG well spawn is about 70 m of path, roughly 10 s, which
  matches the footage.

## Layout in words

The street runs north-south along the west side (x -39 .. -22) and turns east at the top into the
**North Lane** (z -40 .. -29). Its far side is a row of shophouses (render-only, 8 to 10 m, French
windows, balconies and lanterns), with the pyramid-roofed **villa** and a shophouse front stepping
out into it. On the prison side stand the street lamps, the **gate** (a 6 m opening at
z -23.6 .. -17.6 under a lintel wall with the flag) and the stone **watch tower** with its
searchlight. The cream-and-blue **bus** is parked by the tower. Barricades and sandbags cross the
street. The NVA spawn here.

Through the gate is the **Gallows courtyard** (flagstones): the raised platform (1.5 m, stairs on
its west end, rails, three nooses, the blood pool), closed to the north by the single-storey
**North Block** (cell block; a porch and door through to the North Lane) and to the south by the
**Theatre**. The Theatre is L-shaped: its west wing is the prison wall along the street, and the
south wing is the re-education room, with the projector, benches, the screen showing the film
countdown and the clock. Semicircular steps lead up to its "RE-EDUCATION" door.

The **Cell Block** runs north-west to south-east through the middle at 45 degrees, 30.5 x 6 m.
Cells line its north-east side off a corridor, with doors at both ends, to the Plaza (NE) and to the
Yard (SW, two). A covered walkway runs along the Yard face. Its south-east end is two storeys: a
guard room with inside stairs up to the room whose big window overlooks the Well.

North-east of the Cell Block is the **Plaza**: packed dirt, two stone planters with trees, four
turned crate stacks (the rotated squares on the minimap) and the big tree in the rounded corner.
The arched gate in the wall between the Plaza and the **Well courtyard** (east) is the main way
between them. The Well courtyard holds the well, crates and lanterns, and stone stairs up to a
landing that steps onto the 3.2 m wall top. The SOG spawn here and in the alley.

South of the Theatre is the two-storey **Guardhouse**: outside stairs up its east face, and its
upper windows look over the **B yard**. East of it is the open **Yard**, with two tin huts in the
middle. Across the south is the T-shaped **Hall** (wash-house: basins, pillars, tubs): a 30 m hall,
a west wing and a south room, plus a dead-end courtyard off it. East of the Yard is the two-storey
**Barracks** (outside stairs on its south face; a one-storey wing). On the east edge is the
**East House** with the balcony and ladder (and inside stairs). The cobbled **South Lane** runs
along the south edge to the **alley** that leaves south-east (turned 45 degrees).

Heights: single-storey prison blocks 3.8 m to the eaves with clay or mossy tile roofs; the
two-storey blocks have their upper floor at 3.2 m and eaves at 6.6 m. All roofs are out of
bounds (player clips).

## Spawns and objectives

- **TDM:** NVA (team 0) in the street and the North Lane; SOG (team 1) at the Well and in the
  south-east alley (the footage starts SOG at the well with the stairs and balcony, D4/D5 on the
  grid).
- **Domination:** **A** in the Gallows courtyard north of the platform, **B** in the B yard
  between the Guardhouse and the Hall, **C** beside the well. Taken from the Domination footage:
  from the SOG spawn, A reads north-north-west, B north-west and C north-north-east; standing on B,
  A is due north and C due east. Confidence: medium (B is within a few metres; A and C are on the
  right sides of their courtyards).
- **S&D:** not confirmed from a source. Sites are placed indoors in the two big rooms, where the
  original's bomb sites are usually remembered: **A** in the re-education room, **B** in the Hall
  (wash-house). Attackers start in the north of the street and the North Lane, at least 25 m from
  both sites; defenders start at the Well and in the alley. Confidence: low.
- **HQ:** nine points through the courtyards and rooms (Yard, Plaza, street, Hall, Well, Gallows,
  South Lane, North Block, B yard). These are approximate.

## Approximations

- Roofs are pitched clay or moss tiles on simple ramps. The 45-degree Cell Block, which ramps
  can't turn, gets a stepped roof of five tiers.
- Building interiors are simplified: cells as open alcoves, one room per floor elsewhere. RC-XD
  tunnels are left out.
- The pyramid roof on the villa is drawn as a gable.
- The East House gets inside stairs as well as the ladder, so the bots' nav grid can reach it;
  the ladder is too steep for the grid.
- The Theatre's interior is joined into a single L-shaped room.
- The far-side shophouses, the city rooftops and the searchlight tower beyond the north-east
  corner are render-only backdrop.
