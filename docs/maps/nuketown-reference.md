# Nuketown (Black Ops, 2010): layout reference

What the rebuilt `src/shared/maps/nuketown.ts` is traced from, in our metre space. Images were only viewed for measurement; no game assets are in the repo.

## Sources

- BO1 overview map texture with the playable outline and A1..E5 grid (the main measuring reference): `Map_Nuketown_BO.jpg` on https://callofduty.fandom.com/wiki/Nuketown_(map) (gallery, "Nuketown mini-map").
- BO1 in-game minimap: `Nuketown_minimap_BO.png`, same page.
- BO1 spectator bird's-eye view: `Bird's_Eye_View_Nuketown_BO.png`, same page.
- BO6 remake minimap (clean wall/fence lines, same layout turned so the street exits south): `Nuketown_MiniMap_BO6.png`, same page. CoD Mobile remake minimap `Nuketown_MiniMap_CODM.png`, same page.
- Room-by-room description of the house plan (living room in front, stairs up to a study that leads to the front bedroom and the rear balcony, kitchen in the rear with doors to the backyard and the attached garage, garden spawn, Domination A/C in the backyards and B in the street): Treyarch's "Tactical Map Intel: Nuketown '84", https://www.callofduty.com/blog/2020/11/Black-Ops-Cold-War-Tactical-Map-Intel-Nuketown-84 (the '84 layout is the BO1 one re-skinned).
- Map overview text (two houses with two floors and a garage, garden spawns, three ways upstairs: inside stairs, yard stairs to a deck, and the front window via climbable objects): https://callofduty.fandom.com/wiki/Nuketown_(map).
- BO1 gameplay frames (YouTube thumbnails, found through Bing image search): green house front with the Welcome sign (`i.ytimg.com/vi/p8SPOLUF5NQ`), green house back with the balcony and stairs (`vi/EUsyxjuG7T4`, `vi/0vn-YkEfzMk`, `vi/NZrpQevEE6E`), yellow house back with the deck and balcony stairs (`vi/fM4Ke2aPHkA`, `vi/2IEbWsB0LYo`), bus and moving truck in the circle looking at the sign (`vi/2IEbWsB0LYo`), the trailer and its open side door (`vi/yFASllCNfy0`), the red kitchen (`vi/F-rv66dfWN8`, a Demolition match: its minimap shows the two bomb sites), the yellow upstairs study (`vi/GoAx7CxPMY0`), the white garden fence with the arbor (`vi/MswqsM-HUyA`), a chopper view over the yellow house and backyard (`vi/v_MFV_3P3J8`), Domination HUD and minimap (`vi/pNYZAEQnW-Y`, `vi/yFASllCNfy0`).

## Frame and scale

- Game frame: +x east, +z south, y up, yaw 0 faces north. The BO1 overview is turned a quarter turn clockwise: the green house (bottom of the overview) is west, the yellow house (top) is east, the street that leaves the cul-de-sac (right of the overview) goes south. The circle's centre is the origin. This is also how the BO6 minimap is drawn.
- Scale from the overview (512 px): the school bus is 46 to 48 px long and 11 px wide (a 1950s conventional bus is about 10 to 10.5 m by 2.5 m), the car parked across the street 19 px (4.2 m), a house front 44 to 47 px including eaves (the green front in gameplay frames is about 4 door-heights wide, 8.5 to 9 m of wall). Taken together: 4.6 px per metre, 0.217 m per px. The truck and trailer come out at 13 m, the turning circle at 14.8 m across the asphalt, 17.6 m with the sidewalk ring.
- The real houses are turned to face the circle (the yellow lot about 13 degrees one way, the green lot about 20 degrees the other) and the street is straight. Brushes are axis-aligned, so each lot was un-rotated about its house's centre: every house keeps its position and size, the lot lines stay square to the house. The street, circle, bus and truck are taken as measured.

## Layout in words

A dead-end street comes in from the south and ends in a turning circle. Two model homes stand at the west and east ends of the cul-de-sac, facing the circle across small front lawns; behind each is a fenced backyard with a garden where that team spawns. A neighbour's house closes the north side behind its driveway (a car parked in it), neighbours' houses flank the street to the south, and the playable area ends at the barrier across the street.

Each house is a two-storey main block (about 13.6 m deep, 9.6 m wide; gable end to the street) with an attached single-storey garage on one side. The plan is the same in both, turned half round:

- Ground floor: front door under a small porch canopy, straight into the living room (front half). Stairs run up along the side wall away from the garage, rising towards the back. Through a wide opening is the kitchen (rear half): red cabinets, checkered floor, the back door to the backyard and a door into the garage. The garage is open to the driveway and has a back door to the yard.
- Upper floor: the stairs arrive in the study (rear). A door leads to the front bedroom with the two big windows over the circle. A door in the back wall goes out on the balcony, whose stairs lead down to the backyard. The porch-side bedroom window can be climbed into from outside: planter, the porch's stone pillar, the porch roof, the window (the "climbable objects" route; exposed to the whole circle).
- Green house (west): green lap siding downstairs, white upstairs, stone veneer along the front. The garage (white) is on the south side, set back about 3 m from the front, the green car in its driveway. The balcony runs along the north half of the back wall under a pergola; its stairs come down along the back wall to a concrete patio behind the garage. A green-lattice screened porch stands in the south-east corner of the backyard, trash cans by the garage, a shed on the north fence, the garden (dirt bed with flowers) behind a white fence with an arbor at the very back.
- Yellow house (east): yellow siding. The garage (wider, flush with the front) is on the north side with a short concrete driveway. The balcony sits at the garage end of the back wall; its stairs go straight out onto a large ground-level wooden deck that covers most of the space behind the house and garage. The backyard has the yellow shed and the sandbox in the north-east, a swing set, the garden bed with a bench in the bump-out at the very back, an AC unit and trash cans by the south fence.
- In the circle: the school bus on the green side (hood south, a lane between it and the truck), the moving truck on the yellow side (cab-over tractor to the south, a "Westward Moving & Delivery" box trailer to the north with crates by its open side door). The "Welcome to Nuketown" sign stands at the circle's edge just north of the green front walk.
- Lanes: the middle (circle, around and between the bus and truck), the north side alleys (between each house's north wall and the lot fence, joined across the neighbour's lawn north of the circle), the south side alleys (green: the stepping-stone bed past the garage; yellow: a narrow alley along the south wall) that meet at the end of the street, and through each house (back door, kitchen, living room, front door). Upstairs bedroom windows look across the circle at each other over the truck.

## Callouts (game metres)

| Callout | Where (x, z) | Notes |
|---|---|---|
| Green garden (team 0 spawn) | -41.3..-38.6, -6.9..8.8 and the backyard x -38..-24 | white fence and arbor at x -38.55 |
| Green backyard / patio | patio -26.2..-19.8, -5.5..4.9 | Dom A at (-28, -1.5) |
| Green balcony / back stairs | balcony -25.2..-23.2, -12.3..-7.4 (y 3.0); stairs down to z -2.4 | |
| Green house | main -23.2..-9.6, -12.4..-2.8; front door (-9.6, -8.4) | upper floor y 3.0 |
| Green garage | -19.8..-12.6, -2.8..4.0 | open to the east, back door at z 2.6 |
| Green driveway / car | -12.6..-6.2, -0.4..1.6 | |
| Green north alley | z -12.4..-16.7 | 4.3 m wide |
| Green south alley (stepping stones) | z 4.0..8.8 | 4.8 m wide |
| Welcome sign | x -4.6, z -13.1..-8.9 | 2.5 m tall, faces the circle |
| Bus | -3.6..-1.0, -0.5..9.7 | hood (south end) 1.9 m tall, body 3.0 m |
| Truck | tractor 1.8..4.3, -1.8..2.6; trailer 1.7..4.4, -10.2..-2.2 | trailer top 3.8 m |
| Circle (middle) | centre (0, 0), asphalt r 7.4, sidewalk r 8.8 | Dom B at (-0.3, -4.0) |
| North (neighbour's driveway) | x -15.5..14, z -21..-11 | car at (-0.2, -14), chain-link at z -21 |
| Street stub / barrier | x -5.3..7.9, z 8.8..17.4 | car across it at z 13.9, barrier at z 16.6 |
| Yellow house | main 13.6..27.2, -5.7..3.9; front door (13.6, -0.1) | |
| Yellow garage | 13.6..23.6, -13.9..-5.7 | S&D A at (18.2, -9.6) |
| Yellow balcony / stairs | balcony 27.2..30.2, -5.6..-2.3; stairs out to x 34.8 | |
| Yellow deck | 27.2..36.5, -12.5..3.0 and 23.6..27.2, -12.5..-5.7 | 0.25 m high |
| Yellow north alley | z -13.9..-17.5 | 3.6 m wide |
| Yellow south alley | z 3.9..6.8 | 2.9 m wide |
| Yellow garden (team 1 spawn) | bump-out 41..47, -6..6.8 and the backyard x 37..41 | Dom C at (38, -0.5) |

## Key distances and timings

- Playable area: x -41.3..47 (88 m) by z -21..17.4 (38 m at the street); the BO1 outline's 9.3 bus-lengths long is the same ratio.
- Front door to front door: 24.6 m. Bedroom window to bedroom window: about 24 m. Garden to garden: about 84 m in a straight line.
- Measured in the movement code (walk 5 m/s, sprint about 7.2 m/s): green garden to the circle by the north alley 9.9 s walking (about 6.9 s sprinting), the yellow garden the same way 10.1 s (7.0 s); green garden through the house to the circle 9.1 s (6.3 s); each garden down its south alley to the end of the street 7.9 s and 7.6 s (5.5 s and 5.3 s). Both teams reach the middle within a few tenths of a second of each other.
- Heights: upper floor 3.0 m, eaves 5.7 m, ridge 8.1 m; garage walls 3.0 m; privacy fences 2.0 m (with a clip above), picket fences 0.9 m (jumpable), porch roof 2.55 m, porch pillar 1.7 m, planter 0.85 m.

## Sightlines

- Window to window: green bedroom windows to yellow bedroom windows, over the trailer (the BO1 classic).
- Each bedroom looks down into the circle and its own front lawn.
- North alley of each lot to the neighbour's lawn north of the circle; the parked car breaks the line straight across.
- South alleys to the end of the street; the bus blocks the view across the circle from the green side, the trailer from the yellow side.
- The houses block garden-to-garden lines.

## Modes

- Team spawns: TDM/KC team 0 in the green garden and backyard, team 1 in the yellow garden and backyard (8 each). FFA: 14 spread over both gardens, side alleys, garages, upstairs, the north lawn and the street stub.
- Domination: A by the green patio, B in the circle between the bus and the trailer, C off the yellow deck (A/C in the backyards, B in the street, as in BO1 and '84).
- Search and Destroy (and Demolition sites in BO1): A in the yellow garage, B at the front of the bus at the head of the street (read off the BO1 Demolition minimap). Attackers spawn in the green garden, defenders round the yellow backyard and side alleys (`modeSpawns.sd`).
- Headquarters: the circle, both garages, both upstairs (green study, yellow study), the green north alley, the yellow south alley, the north lawn, the street stub.

## Known differences from BO1

- Axis-aligned houses and lots instead of the slight fan round the circle (collision is axis-aligned boxes). Positions and sizes are kept; the outline's corners are squared.
- Interiors are the shared plan described above; BO1's two houses differ in small details (furniture, a fireplace and chimney on the yellow house, the exact stair position) that are not reproduced.
- The truck's trailer is solid (no walk-in cargo hold). The balcony railings are solid panels, the stair handrails posts only.
- The "climbable objects" to the front window are a planter and the porch pillar; BO1's exact props are not known.
- S&D site B and the HQ rotation are inferred (Demolition minimap and sensible spots), not confirmed from a BO1 S&D match.
