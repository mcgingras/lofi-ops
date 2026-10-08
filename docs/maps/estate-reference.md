# Estate: layout reference

Reference notes for `src/shared/maps/estate.ts`, the recreation of **Estate** from Call of Duty:
Modern Warfare 2 (2009) (mp_estate): Makarov's safehouse, a lodge on a forested hillside in the
Caucasus with a substation, outbuildings, a waterfall and a lake.

## Sources

Viewed only. No game assets are copied into the repo; the comparison image in `docs/maps/estate/`
uses a hand-traced plan, not the reference pixels.

- **MW2 minimap** (Call of Duty Wiki file `Estate_minimap_MW2.png`, served from
  `static.wikia.nocookie.net/callofduty/images/f/fb/Estate_minimap_MW2.png`). It has the outline,
  the building footprints, the rock outcrops (hatched) and the garden walls.
- **Official Modern Warfare III (2023) map guide** with tac maps (blank, areas, Domination, S&D,
  Hardpoint, spawns) and area photos (Substation, Backwoods, Lodge, Waterfall, Workshop, Boathouse):
  <https://www.callofduty.com/guides/multiplayer-maps/call-of-duty-modern-warfare-iii-play-maps-core-multiplayer-map-guide-estate>.
  The tac map images are `.../tacmap/estate-tac-map/Estate_Tac_Map_{Blank,Areas,DOm,SNd,HP,Spawn}.png`.
  MWIII's Estate remasters the 2009 map: its outline and footprints line up with the MW2 minimap
  (the Lodge's cross plan, the L-shaped Garage, the Greenhouse L, the two hatched outcrops). The guide
  text gives the area names and routes: the Substation (north spawn) with its building and two
  ladders to the roof, the Backwoods (south spawn), the Lodge (bay windows over the north, Bedroom and
  Kitchen at the back, upstairs loft over the Main Room, east wraparound balcony, the log pile from
  the Garden up to the second-storey Bedroom, the lower Game Room entrance from the Gravel
  Courtyard), the Waterfall and Lodge Path beside the Main Road, the Workshop (stairs at both ends
  to a loft facing the Lodge and the Substation, a log pile up to the roof), the Garage at the top of
  the Main Path, and the Boathouse (Long Stairs, Curved Stairs, the lake).
- **Call of Duty Wiki / search summaries** for the MW2 notes: "the house, set atop a hill... offers
  views over most of the map"; the upstairs is reached by "the main stairway opposite the front
  door, and a route over a wood pile to an upper balcony in the rear"; the main floor is reached
  "from the front and the rear as well as from below via the basement stairs"; "the roof of the
  boathouse can be accessed... used to defend the B objective in S&D"; another building has an
  accessible roof, and so does "the top of the power lines at the far corner".
- **Gameplay footage** (frames viewed in the browser pane): "Modern Warfare 2 - Map Estate [HD]"
  (<https://www.youtube.com/watch?v=bykmHM9PLlA>: the kitchen counter, the greenhouse with its glass
  dome and stone garden walls, the curved low wall looking at the red pylon, the boathouse steps,
  the white shed with the greenhouse behind it), "-=UGF=- MW2 - Walkthrough - Estate"
  (<https://www.youtube.com/watch?v=HNKuyl88HGU>: kitchen island, balcony, interiors) and "Modern
  Warfare 2 (2009) - All Maps + DLC Maps - Flythrough 4K60", Estate at 13:22
  (<https://www.youtube.com/watch?v=U-8ZowlW-fU>: the boathouse on its rock with the stairs and the
  graffiti rock, the Lodge's double-height main room with its gallery, the basement game room with
  the pool table and bar, the backyard with the stone basement wall and the greenhouse).

## Coordinates and scale

Map metres: x east, z south (the overhead's "down"), y up. The grid is tied to the MWIII tac map
(2048 px): **x = (px − 1030) / 8.3, z = (py − 1000) / 8.3**. The MW2 minimap matches it after
scaling by about 1.5, with the same orientation.

The scale comes from objects of known size on the tac map:

| object | measured | real size |
|---|---|---|
| parked cars beside the Lodge | 38 to 40 px long | 4.6 to 4.8 m |
| Garage (L plan) | 16 x 9 m main block | a two-car garage with a carport |
| Boathouse | 13 x 8 m | small timber boathouse |
| Substation Building | 13.7 x 7.6 m | single-storey block building |
| Lodge | 24 x 29 m over the cross | a large two-storey lodge with a basement |

The play space is about **161 m east-west (x −82 to 80) by 178 m north-south (z −87 to 92)**, a
diagonal, irregular outline. MW2 lists Estate as medium-large; the registry uses `large`.

## Levels

The ground climbs from the north to the Lodge on the hill top (south).

| level | y | what is on it |
|---|---|---|
| field | 0 | the Substation, the north fields, the Workshop, the Garage, the driveway from the gate |
| north-east field | 0 to 2.4 | slopes up south to the foot of the Curved Stairs |
| Waterfall terraces | 0 to 2.0, then 3.4 to 6.4 | two ramps with a 1.4 m rock step at z 16, where the creek falls |
| Main Road / Lodge Path | 0 to 9.6 | z 4 to 26, up to the front yard; stone retaining wall on the west |
| Boathouse plateau | 5.0 | east of the outcrop; the shore slopes down east to the lake (1.2) |
| garden / Backwoods | 6.4 | the Greenhouse, the gravel courtyard, the shed, the Backwoods, the Lodge basement |
| front yard | 9.6 | the gravel turnaround east and north-east of the Lodge, level with the main floor |
| outcrop | 9.6 | the hatched rock in front of the Lodge; you walk onto it from the front yard |
| Lodge main floor | 9.6 | great room, hall, kitchen, den; the west deck |
| Lodge upper floor | 12.9 | loft, two bedrooms, the rear and east balconies |
| roofs | 3.2 to 9.45 | big rock 3.2, Garage 3.9, Substation Building 4.5, Workshop 7.3, Boathouse 9.45 to 10.25 |
| pylon platform | 6.0 | in the far north corner, reached by a ladder |

Routes between the levels:
- the **Main Road** (gravel) and the **Lodge Path** beside it, from the Garage up to the front yard;
- the **Waterfall terraces** from the north field up to the garden, with wooden steps beside the
  falls and stone steps further east;
- the **Long Stairs** from the front yard down to the Boathouse plateau, and the **Curved Stairs**
  up from the north-east field; an earth ramp also climbs onto the plateau at its east end;
- the drive from the front yard down to the Backwoods (south-east of the Lodge);
- inside the Lodge: the main stairs along the great room's west wall (opposite the front door) up to
  the loft, and the basement stairs in the den; outside, the west deck stairs, and the log pile up
  the south face to the rear balcony;
- the Workshop's two inner stairs to its lofts; the log pile onto the lean-to, then a ladder to the
  roof;
- ladders onto the Substation Building roof (north and east faces) and the pylon platform; the big
  rock's west slope, and from its top a hop onto the Garage roof; the graffiti rock behind the
  Boathouse to its roof.

## Layout in words

**North: the Substation.** A fenced transformer yard (x −44 to −26, z −50 to −34) with five
transformers and a gantry, a fenced equipment yard north of it, and the block-built **Substation
Building** (x −16 to −3, z −47 to −39), with doors at both ends and ladders to its flat roof. The power
**pylon** stands in the far north corner. The gravel **driveway** enters through the stone-pillared
**gate** in the north-east (x 2 to 12, z −52), runs south past the Substation Building and the Garage,
and climbs the Main Road to the Lodge. The creek runs along the south side of the Substation yard in a
concrete culvert, with a burnt-out car on its slab. Team 1 (TF141) spawns west of the yard, with a
few spawns along the driveway.

**West: the Workshop** (Domination C), a two-storey barn (x −61 to −49, z −19 to 3). It has a big door
east, doors north and south, lofts at both ends joined by a catwalk along the east wall, and upper
windows facing the Lodge (south) and the Substation (north). A lean-to woodshed and a log pile on the
west side lead up to the roof. Behind it, the open field runs to the west edge of the map.

**Middle.** The **big rock** (x −30 to −6, z −30 to −12) has a walkable top (3.2) and blocks the
Substation's view of the Garage. The **Garage** (Domination B, x −10 to 4, z −11 to −1, with its store
room annex) is tucked against the rock's south-east side; it has two open garage doors, a carport
open east and south, and a flat roof you can reach from the rock. South of it, the **Waterfall
terraces** climb towards the Greenhouse and the Lodge. They are held by low stone garden walls, the
creek falls over the rock step at z 16, and wooden steps run beside the falls. Further east, the
**Main Road** and **Lodge Path** climb to the front yard, where cars are parked.

**East: the Boathouse.** The hatched **outcrop** (x 12 to 25, z 10 to 37, top at the front-yard
level) screens the Boathouse plateau from the Main Road. The **Boathouse** (S&D B side, x 34 to 47,
z 22 to 31) is a timber shed on a raised deck, with an open east end onto a deck with sandbags. Its
thin walls let bullets through, and its low roof can be reached from the graffiti rock behind it.
The shore slopes down to the lake (out of bounds), which has a dock, a rowboat and a boat shed.

**South: the Lodge** (S&D A, x −26 to −3, z 40 to 57, plus the great room arm x −22 to −12,
z 29 to 40). It sits on a stone plinth, with the basement at garden level and the main floor level
with the front yard:
- **basement**: the game room (pool table, bar, sofa) and storage. Doors open west to the garden
  and south to the courtyard ("the lower Game Room entrance"); stairs climb to the den;
- **main floor**: the double-height **great room** with the bay window north over the Waterfall,
  the front door east onto the porch, and the main stairs along its west wall. There is a hall, the
  **kitchen** (island, counters; rear door to the west deck) and the den;
- **upper floor**: the **loft** overlooking the great room through its railing, and two bedrooms.
  The south-east bedroom opens onto the **wraparound balcony** (south and east sides), where the
  log pile from the garden arrives.

West of the Lodge is the **Greenhouse** (L-shaped glass house on a low stone sill; bullets and
sight pass through the glass, players don't). Between it and the Lodge is the **gravel courtyard**
(Domination A). The white **shed** stands in the **Backwoods** south of the Lodge, where team 0
(Spetsnaz) spawns.

## Measured features (traced off the references, metres)

| feature | traced |
|---|---|
| outline | (−29, −86.7) (−12, −70.5) (0, −60) (11, −48) (19, −40) (21, −34) (18, −31) (19, −19) (25.8, −10.8) (37, −13) (48, −16) (59, −1) (70, 12) (78.6, 25) (80, 29) (80, 37) (59, 40) (54, 39) (42, 44) (30, 42) (18.6, 49) (7, 52) (3.6, 59) (−3, 64) (8.4, 89) (−26.5, 91.5) (−37, 84) (−43.4, 82) (−55, 34) (−56, 25) (−42, 11) (−54, 11) (−81, −8.4) (−75, −18) (−59, −41.6) (−48, −47) (−42, −56.6) (−40, −73.5) |
| Lodge (cross) | x −27 to −1.8, z 28.3 to 57.8, turned about 15° |
| Garage (L) | x −11.4 to 5.4, z −16 to 4.2, turned about 25° |
| Workshop | corners (−66, −3) (−52.8, −20.7) (−43.5, −13) (−57, 6.3): 22 x 12 m |
| Substation Building | corners (−17.5, −47) (−10.8, −50.6) (−1.2, −41) (−7.8, −34.3) |
| transformer yard | a diamond about (−45, −44) (−34, −55) (−24, −45) (−35, −34) |
| Boathouse | centre (40.8, 26.5), 13 x 8 m, turned −25° |
| Greenhouse | L: north wing about x −52 to −38, z 34 to 44; long wing x −50 to −41, z 43 to 60 |
| shed | x −26 to −17, z 72 to 79 |
| big rock (hatched) | x −30 to −5, z −31 to −12 |
| outcrop (hatched) | x 7 to 25, z 12 to 37 |

The buildings stand at small angles on the overhead. Here they are axis-aligned at the same centres
and sizes (collision brushes are axis-aligned boxes), and the outline is a rectilinear trace of the
real one. `ESTATE_OUTLINE` in the map file holds the trace that the clips follow.

## Callouts

| callout | x | z | y |
|---|---|---|---|
| Substation spawn (TF141) | −55 | −33 | 0 |
| Transformer yard | −35 | −42 | 0 |
| Substation Building (roof 4.5) | −9.5 | −43 | 0 |
| Pylon | −30 | −75 | 0 / 6 |
| Gate | 7 | −52 | 0 |
| Workshop (Dom C) | −55 | −5 | 0 |
| Workshop roof | −55 | −8 | 7.3 |
| Big rock | −18 | −22 | 3.2 |
| Garage (Dom B) | −2.5 | −5 | 0 |
| Waterfall | −40 | 16 | 2.0 to 3.4 |
| Main Road / Lodge Path | 0 | 4 to 26 | 0 to 9.6 |
| North-east field | 30 | −5 | 0 to 2.4 |
| Curved Stairs | 30 | 5 to 10 | 2.4 to 5.0 |
| Outcrop | 17 | 24 | 9.6 |
| Long Stairs | 12 to 25 | 40 | 9.6 to 5.0 |
| Boathouse (S&D B beside it) | 40.5 | 26.5 | 6.2 |
| Shore | 68 | 30 | 2 to 4 |
| Front yard / porch | −6 | 34 | 9.6 |
| Great room (bay window) | −17 | 34 | 9.6 |
| Kitchen | −20 | 52 | 9.6 |
| Loft | −17 | 43.5 | 12.9 |
| Balcony (rear / east) | −6 / −1.6 | 58.3 / 50 | 12.9 |
| Game room | −14 | 53 | 6.4 |
| Greenhouse | −46 | 48 | 6.4 |
| Gravel courtyard (Dom A) | −34 | 60 | 6.4 |
| Shed | −22 | 75 | 6.4 |
| Backwoods spawn (Spetsnaz) | −6 | 75 | 6.4 |

## Spawns and objectives

The real positions come from the MWIII tac map overlays. The DOM/S&D/HQ overlays place icons
above their points; the points below are the icon tips moved to a free floor nearby.

- **Team spawns**: TF141 at the Substation (north-west of the yard, tac (−48.6, −34)) and Spetsnaz in
  the Backwoods (tac (−9.4, 74.6)). Here team 0 is the Backwoods side, so Domination A is the flag
  nearest team 0 (the convention in CONTRACTS.md); team 1 is the Substation side.
- **Domination**: A in the gravel courtyard between the Greenhouse and the Lodge (tac (−34, 60)),
  B in the Garage (tac (2.4, 5.4), "positioned indoors"), C in the Workshop (tac (−56, −0.6)).
- **Search and Destroy**: A inside the Lodge (tac (−6.4, 44), main floor by the front door), B by
  the Boathouse (tac (27, 13); here (30, 19) on the plateau north-west of the Boathouse). The
  defenders hold the hill (spawn side 0, `team: 0` on the sites, `modeSpawns.sd.defenders` in the
  Backwoods); the attackers come up from the Substation (`modeSpawns.sd.attackers`, with the bomb
  there). The guide says the attackers face "an uphill battle".
- **Headquarters**: the MWIII Hardpoint rotation (Substation, Workshop, Garage, Boathouse, Lodge),
  plus the Greenhouse.

## Key distances and timings

These route lengths come from the bots' nav grid (`NavGrid.path`). Walking is 5.0 m/s and
sprinting is 7.2 m/s.

| route | length | walk | sprint |
|---|---|---|---|
| Backwoods spawn → Substation spawn | 124 m | 24.8 s | 17.2 s |
| Backwoods spawn → Dom A (courtyard) | 21 m | 4.2 s | 2.9 s |
| Backwoods spawn → Dom B (Garage) | 90 m | 17.9 s | 12.4 s |
| Substation spawn → Dom B (Garage) | 73 m | 14.7 s | 10.2 s |
| Substation spawn → Dom C (Workshop) | 39 m | 7.7 s | 5.4 s |
| Substation spawn → S&D A (Lodge) | 110 m | 22.0 s | 15.3 s |
| Substation spawn → S&D B (Boathouse) | 122 m | 24.4 s | 16.9 s |
| Backwoods spawn → S&D B (Boathouse) | 81 m | 16.1 s | 11.2 s |
| Dom C → Dom A | 85 m | 17.1 s | 11.9 s |

## Sightlines (checked in tests/maps-estate.test.ts)

- The great room's bay window looks down over the Waterfall terraces.
- The wraparound balcony sees the Boathouse roof; the outcrop screens the Boathouse door from the
  east balcony and the plateau from the Main Road.
- The Workshop's north loft window watches the Substation yard.
- The big rock blocks the Garage from the Substation at standing height.
- The driveway runs straight from the gate to the Garage.

## What is approximated

- Buildings are axis-aligned at the right places and sizes; the overhead turns them by 15 to 30°.
- Terrain is flat patches and single-direction ramps, with retaining walls where they meet. The real
  map's slopes are smoother and its rock outcrops more irregular (boulder trim breaks up the edges
  here).
- The Lodge follows the cross plan and the MW2 descriptions: stone plinth, dark siding, big glass,
  pitched roof. Its interior plan (room sizes, partitions) is a plausible fill, not traced.
- The lake is beyond the boundary (players reach the shore, not the water). There are no fall/kill
  zones: the real map has no fatal drops, and the drops here (outcrop and plateau edges) are at most
  about 7 m.
- Trees are crossed alpha cards with collidable trunks, placed procedurally in the forest areas
  (kept off paths, doorways and spawns).
