# Terminal: layout reference

Reference notes for `src/shared/maps/terminal.ts`, the recreation of **Terminal** from Call of Duty:
Modern Warfare 2 (2009), Zakhaev International Airport. The first version of the map was a compact
gate + apron section built from memory. This rebuild follows the official overheads instead.

## Sources

Overheads and descriptions (viewed only; no game assets are copied into the repo):

- Official MWIII (2023) map guide with tac maps (blank, areas, Domination, S&D, Hardpoint, spawns)
  and area photos: <https://www.callofduty.com/guides/multiplayer-maps/call-of-duty-modern-warfare-iii-play-maps-core-multiplayer-map-guide-terminal>.
  The tac map images are `.../tacmap/terminal-tac-map/Terminal_Tac_Map_{Blank,Areas,DOM,SNd,HP,Spawn}.png`.
  MWIII's Terminal remasters the 2009 layout, so its overhead is the most precise source. It carries
  a few additions, listed below.
- Call of Duty Wiki, Terminal (map): the MW2 minimap (`Terminal_minimap_MW2.png`), the MW3 (2012)
  overhead render (`Terminal_overhead_map_MW3.jpg`) and MW3 screenshots (centre store, plane,
  Burger Town). The wiki text also has MW2 notes ("Hallway of Death", Domination B in the middle
  hallway, the plane being safe from air support): <https://callofduty.fandom.com/wiki/Terminal_(map)>.
- Call of Duty: Mobile map snapshot (route descriptions: the lobby, escalators, departure hall, the
  walkway, the middle bookstore, and the plane's side and back exits):
  <https://blog.activision.com/uk/en/call-of-duty/2020-09/Call-of-Duty-Mobile-Map-Snapshot-Terminal>.
- VHPG MW3 Terminal page (area list and positions; its images were broken):
  <https://www.vhpg.com/mw3-terminal-map/>.
- Game8 MW3 Terminal tips (crates to the wing, Burger Town kitchen slits):
  <https://game8.co/games/MW3/archives/432390>.

All three overheads (MW2 minimap, MW3 2012 render, MWIII tac map) show the same outline in the same
orientation: Security in the west, the Lower Lounge in the north-east, the apron and plane in the
south-east. The MW2 minimap scales onto the MWIII tac map with one factor (1.16, the same on both
axes), which confirms that the layout is unchanged.

## Coordinates and scale

Map metres: x east, z south (the overhead's "down"), y up. The grid is tied to the MWIII tac map
cropped at (420, 660) of the 2048 px image: **x = (px − 600) / 10, z = (py − 400) / 10**, so 10 px is
1 m. Checks against known objects:

| object | measured on the overhead | real size |
|---|---|---|
| plane cabin (dotted outline) | 33 m long, 4.1 m wide | Boeing 727-class trijet: cabin ~33 m, fuselage 3.8 m |
| jet bridge | 2.9 m wide | 2.5 to 3 m |
| escalator strips | 1.4 m each | about 1.2 m |
| security lanes | 3 to 4 m between barrier rows | about 3 m |
| columns | 0.8 to 1.2 m | about 1 m |

Overall the play space is **about 115 m (x −57 to 58) by 79 m (z −38 to 40.5)**. MW2 called the map
medium-large, and the registry now lists it as `large`.

## Levels

| level | height | what is on it |
|---|---|---|
| ground | 0 | apron, Lower Lounge, Maintenance (inside), NE strip |
| cabin | 3.2 m | plane cabin and the jet bridge cab |
| concourse | 4.0 m | Security, departure hall, Shopping, Bookstore, Makeup Store, Dining, Burger Town, Upper Lounge, Hallway, jet bridge root |
| Maintenance roof | 4.0 m | level with the Hallway floor; you step out through the Hallway windows |

Routes between the levels (all walkable, no ladders):
- the **escalators** (escalator, stairs, escalator) from the Lower Lounge (bottom at x 19.5) up to the
  Upper Lounge (top at x 13), z −29.6 to −24.9;
- the **outside stairs** beside the jet bridge, from the apron (x 16.4) to the jet bridge root (x 8),
  z 21.9 to 23.4 ("take the stairs up into the Shopping area");
- the **jet bridge**, sloping from the root (4.0 m) to the cab (3.2 m), then into the plane's front door;
- the plane's **evacuation slide** (side exit, north, x 27.1 to 28.7) and the **aft airstair** under the
  tail (rear exit, x 46 to 54);
- the **Maintenance outside stairs** along its south face (x 23 → 16) to the roof, which meets the
  Hallway windows and the Upper Lounge window;
- drops: out of the Hallway windows onto the apron (4 m), over the Upper Lounge railing into the
  Lower Lounge, off the Maintenance roof.

## Layout in words

West to east along the concourse. **Security** (team 0 spawn) is a hall about 36 x 24 m. The spawn
is a vestibule behind it (x −57 to −51). East of it are five barrier rows that make the scanner lanes,
with metal-detector arches at x −40.5 and an x-ray belt beside each one. The round info desk stands
in the departure hall to the east. The **Kastovia Airlines office** is south of the scanners
(x −42 to −34.4, z 16.6 to 26). Next to it is the east-facing **customer service desk**, which has a
36 m sightline down the Shopping corridor to the plane entrance. The **Shopping** lobe runs south
and south-east from the hall. It holds the atrium with the check-in island and gate seating, and has
a diagonal south-west wall. Along its south edge is the **Makeup Store** (x −11.9 to 5.2,
z 27.5 to 36.6), which has two doors on the north side and one on the west.

Two closed shop blocks sit in the middle (x −17 to −1). Between them runs the **Bookstore passage**
(z −2.2 to 6.25), which connects the departure hall to the Hallway: "the middle bookstore connects
the two pathways". North of the blocks, the **west corridor / gift shop** (x −30 to −15) leads up to
**Dining**, which has the checker floor, tables round a cross-shaped planter, and pillars. **Burger
Town** sits in Dining's north-west corner (x −30 to −22, z −28 to −19.4). It has a wraparound counter
on the south and east sides, and a kitchen shelf with a slit you can see and shoot through. The
**Upper Lounge** (x −1.6 to 17) has the snack and info desk and a glass railing over the Lower Lounge,
and is the top of the escalators. The **Hallway** ("Hallway of Death") runs south from the Upper
Lounge along the east wall (x −1 to 5.2, z −13.75 to 27.5). Its windows look over the Maintenance roof
and then the whole apron. It ends at the jet bridge root (the plane entrance, "GATE") and the Makeup
Store.

On the ground floor, the **Lower Lounge** (team 1 spawn, x 13 to 42.4, z −37.8 to −14.4) has baggage
claim carousels on the north wall, a snack bar facing the escalators, benches and pillars. A glass
facade with a diagonal corner faces the apron to the south-east, and doors lead to the apron, the NE
strip and Maintenance. **Maintenance** (x 5.2 to 23, z −13.75 to −3.4) is a two-bay shed. The west
room has a garage shutter onto the apron, the east bay holds a truck and has doors to the lounge and
the apron. Its roof is a power position over the apron and the plane.

The **apron** (x 5.2 to 57.7, z −14 to 28.4, with a cut south-east corner) has the parked trijet. The
nose is to the west by the jet bridge and the tail to the east. The cabin runs x 17.7 to 50.8 along
z 12 to 16.1, and the wings are swept back with headroom underneath. North of the nose is the
air-freight container cross. The baggage cart train is under the south wing, the police car and a
tug are north, another container cross is north-east, and the fuel truck is along the east fence.
The **NE strip** (x 42.4 to 54.9, z −36.6 to −21) has the air-conditioning units.

## Callouts

| callout | x | z | level |
|---|---|---|---|
| Security spawn (vestibule) | −54 | 4.5 | concourse |
| Security scanners | −40 | 4 | concourse |
| Info desk | −22.7 | 3.9 | concourse |
| Airline office | −38 | 21 | concourse |
| Customer service desk | −30 | 17.5 | concourse |
| Check-in / atrium | −22 | 22 | concourse |
| Gate seating | −21 | 33 | concourse |
| Makeup Store | −4 | 32 | concourse |
| Bookstore | −8 | 2 | concourse |
| Shopping south | −6 | 23 | concourse |
| Gift shop / west corridor | −25 | −15 | concourse |
| Burger Town | −26 | −24 | concourse |
| Dining (food court) | −10 | −27 | concourse |
| Upper Lounge (snack desk) | 7 | −27 | concourse |
| Top of escalators | 12 | −27.3 | concourse |
| Hallway | 2.4 | 0 to 25 | concourse |
| Plane entrance (jet bridge root) | 6.5 | 20 | concourse |
| Jet bridge | 13 | 20.2 | 3.2 to 4.0 |
| Lower Lounge spawn | 36 | −28 | ground |
| Baggage claim | 23 | −36 | ground |
| Snack bar | 26 | −28.7 | ground |
| Maintenance | 9 to 20 | −8 | ground |
| Maintenance roof | 14 | −8 | 4.0 |
| Containers (nose) | 18 | 9.5 | ground |
| Plane, front / side exit / rear | 20 / 28 / 50 | 14 | cabin |
| Wing (north / south) | 38 | 6 / 22 | 2.2 to 2.6 |
| Police car | 31 | −6.5 | ground |
| Fuel truck | 54 | 2 | ground |
| NE strip (AC units) | 52 | −26 | ground |

## Key distances and timings

Route lengths come from the bots' nav grid (`NavGrid.path`). Walking is 5.0 m/s and sprinting 7.2 m/s.

| route | length | walk | sprint |
|---|---|---|---|
| Security spawn → Lower Lounge spawn | 103 m | 20.6 s | 14.3 s |
| Security → Dom A (Shopping) | 49 m | 9.8 s | 6.8 s |
| Lower Lounge → Dom C (Dining) | 49 m | 9.8 s | 6.8 s |
| Security → Dom B (Hallway) | 57 m | 11.4 s | 7.9 s |
| Lower Lounge → Dom B (Hallway) | 60 m | 12.0 s | 8.3 s |
| Security → Dom C / Lower Lounge → Dom A | 61 m / 85 m | | |
| Security → S&D A (plane) / B (Upper Lounge) | 90 m / 75 m | 18.0 s / 15.0 s | 12.5 s / 10.4 s |
| Lower Lounge → S&D A / B | 48 m / 32 m | 9.6 s / 6.4 s | 6.7 s / 4.4 s |

Other measurements:
- the Hallway is 41 m long and 6 m wide;
- the apron is about 52 x 42 m;
- the plane cabin is 33 m long, with a 1.3 m aisle;
- the jet bridge is 10.6 m long, plus a 5.5 m cab;
- the escalators rise 4 m over 6.5 m.

The two flag runs are symmetric: each team is 49 m from its home flag, and B is nearly equidistant.

## Sightlines (each is pinned by a test in `tests/terminal.test.ts`)

- Hallway windows ↔ apron: the "Hallway of Death". You see the whole apron and the plane, and the
  apron shoots back up into the Hallway.
- Customer service desk → Shopping south → plane entrance, about 36 m.
- Snack bar (Lower Lounge) → top of the escalators.
- Maintenance roof → apron and plane.
- Through the Bookstore doors, west to east (one narrow straight line between the shelves).
- The shop blocks are solid, so nothing sees through them. The cabin roof is solid, so the plane is
  safe from air support.

## Spawns and objectives

- **TDM:** team 0 is in Security (the vestibule and the west end of the hall) and team 1 is in the
  Lower Lounge (MWIII guide: "teams will either spawn in the Lower Lounge (north) or in Security
  (west)"). FFA spawns are spread over every area, including the cabin, the Maintenance roof and
  the NE strip.
- **Domination:**
  - A is in Shopping south (−8, 24.5) and C is in Dining (−10, −31.5), as on the MWIII overhead.
  - B is in the **Hallway** (2.6, 6), following the MW2 wiki: "the B flag in the middle hallway is
    almost always a deathtrap". MWIII moved B out onto the apron.
- **Search and Destroy:** the attackers start in Security and team 1 (Lower Lounge) defends, as in the
  guide. Site **A** is in the plane, just aft of the emergency exit (31.5, 14.05, cabin height).
  Site **B** is in the Upper Lounge by the Hallway and Dining (9.5, −19). The guide's text names them
  the other way round (A Upper Lounge, B plane), but its overhead labels the plane A, and the map
  follows the overhead. `modeSpawns.sd` holds 8 attacker and 8 defender points.
- **Headquarters (Hardpoint rotation):** Burger Town, Makeup Store, Plane, Lower Lounge, Bookstore.
  MWIII lists "Upper Lounge by Burger Town, Makeup Store, Plane, Dining, Bookstore". The map follows
  the icon positions on its overhead.
- **Bot hotspots:** 20 roam points, one per callout, on all levels.

## Not faithful / assumptions

- **Shapes.** Everything is axis-aligned boxes and ramps. The two diagonal walls (the Shopping lobe's
  south-west wall and the lounge's glass corner) are rotated render panels over stair-stepped
  collision. The plane is boxy, the wings are stepped slabs, and the escalators are ramps.
- **Glass.** Glass is not breakable. Windows are open frames (you can see, shoot and drop through
  them) or solid walls. Of the MW2 breakable glass, only the routes that matter are kept: the
  Hallway windows onto the Maintenance roof and the apron, and the lounge facade windows.
- **MWIII-only features left out.** The ladder and high platform in the Lower Lounge and the Security
  metal detector chime are not in MW2 or not modelled.
- **Upper level heights** (4 m concourse, 3.2 m cabin floor) are estimates from screenshots. The
  overheads do not give heights.
- **Shops.** The two central blocks are solid closed shops: the overheads mark them as out of
  bounds. Their interiors and the exact shelving in the Bookstore and Makeup Store are approximate.
- **Domination B** follows MW2 (Hallway) rather than MWIII (apron). The Hardpoint rotation follows
  MWIII, because MW2 Headquarters positions were not documented in the sources.
- **Outside the fence.** Scenery beyond the fences (tower, second pier, a parked jet) is
  representative, not measured.
