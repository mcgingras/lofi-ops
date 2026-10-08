# Jungle (Black Ops, 2010): layout reference

What `src/shared/maps/jungle.ts` is built from. Black Ops 1's Jungle (`mp_havoc`) is a river
valley village on the Laos/Vietnam border: a creek running west to east through the middle, a
ruined stone temple at the west end, a village of stilt huts in the south under a big limestone
cliff, a sandbagged military post in the north-east and foxholes on the east edge by the rice
paddies. The map file is written in the overhead's pixels (see Scale), so every coordinate below
can be checked against the overhead directly.

Coordinates: overhead pixels (px, py) on the 512 px overhead, and our metres: +x east, +z south
(north is up on the overhead and the game's minimap), y up, origin at overhead pixel (250, 234).
Yaw 0 faces north.

## Sources

Only viewed in the browser; nothing was copied into the repo (the images are Activision's).

- Call of Duty Wiki, "Jungle (Black Ops)": https://callofduty.fandom.com/wiki/Jungle_(Black_Ops)
  (via the MediaWiki API). Overview: a ruined village and a small military base split by a river;
  vertical, many slopes and ladders; sniping perches; "the rock" in the middle with one access
  point and a fatal drop; the rice paddies on the north-east edge are an open boundary (a
  landmine kills you). Console name `mp_havoc`. Trivia: a Viet Cong flag in one of the huts.
- BO1 colour overhead with the A1..E5 grid (Prima style), 512 px:
  https://static.wikia.nocookie.net/callofduty/images/f/fb/Map_Jungle_BO.png . **The layout is
  traced from this image**: the white playable outline, the dimmed holes (rock outcrops), the hut
  outlines, the Bridge's double line, the Lookout's ledge line, the Base compound and the foxholes.
- Black Ops Cold War remaster minimap (3840 px, same layout):
  https://static.wikia.nocookie.net/callofduty/images/f/fd/Jungle_MiniMap_BOCW.png and the BO4
  minimap (`.../9/97/Jungle_MiniMap_BO4.png`), used to confirm which holes are raised rock and that
  the Bridge walkway runs on/along the central rock's north-east edge.
- Call of Duty blog, BOCW Jungle launch (2022-05-06), callouts: Village (south, between the Ruins
  and Headquarters), Ruins (west), the northern route through the building that leads to the
  Bridge overlook in the centre of the River, Tunnel, the Lookout; "All eyes on River": vantage
  points from the western Ruins, the centre Bridge and the Lookout cover the main River path.
  https://www.callofduty.com/blog/2022/05/call-of-duty-black-ops-cold-war-jungle-map-lazar-operator-ugr-smg
- PC Games multiplayer guide (2010) with in-game mode maps for Jungle (CTF, HQ, Domination,
  Sabotage, Demolition, S&D) drawn on a perspective overhead:
  https://www.pcgames.de/Call-of-Duty-Black-Ops-Spiel-19647/Tipps/Call-of-Duty-Black-Ops-Multiplayer-Guide-mit-Level-Karten-und-Tipps-und-Tricks-fuer-alle-Maps-801536/4/
  (images `screenshots/1280x1024/2010/11/Jungle-Herrschaft1.jpg`, `Jungle-Suchen_Zerst_ren_...jpg`,
  `Jungle-Hauptquatier1.jpg`). The overhead there is the 512 px overhead turned about 60 degrees
  clockwise; it was registered on the Base compound, the two foxholes, the thatched hut and the red
  hut (about 1.37 screen px per overhead px), which puts the objective markers within ~20 px.
- Gameplay footage, frames captured in the browser: "Black Ops 1 Multiplayer | Classic Jungle Map
  Gameplay! [4K]" (https://www.youtube.com/watch?v=Qy_QWYaNgjM) and IzDivine's Domination match
  (https://www.youtube.com/watch?v=XoQZTYzzJI0). Used for what things look like and how high they
  are: the SOG spawn by the foxholes with the thatched stilt hut and the red stilt house beyond it
  (the loading screen view), the bamboo/plank huts on stilts, the sandbag compound under a camo
  net, the stone arch with the muddy creek in front of it, stone stairs in the Ruins, the long
  walkway with rails, the deck of the red hut, the limestone cliff over the Village, the VC flag
  hut, standing on top of the Lookout.
- BO1 loading screen (`Bare_Load_Screen_Jungle_BO.jpg`): the thatched stilt hut, the red-roofed
  stilt house with its ladder, the rock and tree at the right.

## Scale

0.27 m per overhead pixel (`JUNGLE_SCALE`). Cross-checks: the thatched stilt hut traces as 19.5 x
14.6 px = 5.3 x 3.9 m (one room with a porch); the red stilt house 21 x 26 px = 5.8 x 7.0 m; the
village longhouse 37 x 36 px = 10 x 9.9 m; the Base compound 35 px = 9.4 m square; the foxholes
are 13 px (3.5 m) across. The playable outline spans px 36.6 .. 461 by 58 .. 409, i.e. **114 m x
95 m** - bigger than Firing Range (78 x 90 m), as Treyarch's "large map" label suggests, while the
open ground inside is broken up by a dozen rock outcrops. Spawn to spawn (Ruins to foxholes) is
about 95 m straight, ~100 m along the creek (~15 s sprinting).

## Layout in words

Three loose lanes run west to east between the Ruins and the foxholes:

- **North route.** From the Ruins up the B2 lane (west of the B2 rock) to the north strip past the
  small diamond hut and the **stilt house** whose upper floor (3.6 m) opens onto the **Bridge**,
  then east along the B3 strip to the **Base** (sandbag compound) and down the north-east edge to
  the foxholes.
- **The River (middle).** The creek starts in the waterfall pool in the north-west bay (C1), runs
  past the Ruins' arch (C2), squeezes between rock outcrops, passes under the Bridge, runs down the
  valley between the central cliff and the **Lookout**, then east past the thatched hut to the east
  edge (C5), where it leaves through a notch in the outline between the two foxholes. Shallow,
  knee deep, stepped mud banks. Watched from the Ruins platform, the Bridge and the Lookout.
- **South route (the Village).** From the Ruins' south yard east past the stone block and the
  Village's longhouse, small hut and white stilt hut, under the **central cliff**, to the red stilt
  house at the foot of the Bridge's cliff path, and on past the thatched hut to the foxholes.

**The Bridge** is an elevated walkway: from the stilt house's east door a 2.2 m walkway heads
south-south-east, then a narrow deck (1.7 m, 21 m long) crosses the river valley at 3.6 m, then a
plank ledge descends the central cliff's north-east face to the red hut's deck at 2.2 m, which has
stairs down to the Village.

**The Lookout** is the flat-topped rock east of centre (C4), 6 m high; one narrow ledge path climbs
its north-west face from the river valley (between the B3/C3 outcrop and the rock face) and comes
out on the north tip of the top. Every other side is a sheer drop. From the top you see the east
spawn, the creek and the valley under the Bridge.

## Callouts (as placed)

| callout | overhead px | metres (x, z) | notes |
|---|---|---|---|
| Ruins temple platform | 104..142, 317..355 | -39.4..-29.2, 22.4..32.7 | top 0.9 m, cross-shaped dais, broken walls, the arch over its north stairs |
| roofless ruin by the creek | 104..118, 266..289 | -39.3..-35.7, 8.8..14.7 | stone walls, arched opening north, door east |
| waterfall pool | 94, 223 | -42.1, -3.0 | falls on the cliff at the bay's north edge |
| team 0 spawn (Ruins yard) | 50..100, 300..356 | -54..-40, 18..33 | |
| Domination A | 124, 302 | -34.0, 18.4 | between the ruin and the platform |
| stilt house | 204..230, 166..190 | -12.4..-5.4, -18..-12 | turned -25 deg, floor 3.6 m, stairs south |
| Bridge deck | 240,220 -> 286,284 | -2.6,-3.6 -> 9.7,13.4 | 3.6 m over the creek |
| Domination B | 244, 218 | -1.6, -4.3 | on the ground under the walkway's foot |
| central cliff (C3) | ~200..306, 237..323 | ~-13.5..15, 1..24 | up to 12 m, impassable |
| red stilt house | 316..345, 309..339 | 18..25.5, 20..28 | turned 14 deg, floor/deck 2.2 m, tile roof |
| Lookout (C4) | 312..392, 195..261 | 17..38, -10.5..7 | flat top 6 m; ledge foot at px 301, 249 |
| Base compound | 352, 118 | 27.5, -31.3 | 9.4 m sandbag square under a camo net, turned 19 deg |
| Domination C | 322, 150 | 19.4, -22.7 | B3/B4 strip by the Base |
| foxholes (team 1 spawn) | 442.5, 224.6 / 442.5, 272 | 51.8, -2.5 / 51.8, 10.3 | sandbag rings, trench walls, supplies under a tarp |
| thatched stilt hut | 384..408, 281..304 | 36..42, 13..19 | the loading-screen hut, floor 0.9 m |
| Village longhouse | 211..251, 333..382 | -10.5..0.3, 26.7..40 | L-shaped, turned 27 deg, thatch |
| small hut | 261..284, 331..356 | 3..9, 26..33 | turned 24 deg, tin roof |
| white stilt hut | 293..318, 370..406 | 11.6..18.4, 36.7..46.4 | Viet Cong flag inside, on the south edge |
| S&D A | 301, 336 | 13.8, 27.5 | Village, at the foot of the red hut's stairs |
| S&D B | 343, 140 | 25.1, -25.4 | south side of the Base compound |
| diamond hut | 227, 149 | -6.2, -23.0 | small plank hut on the north strip |
| rice paddies, crashed Hueys | east of px 470 | x > 60 | out of bounds (scenery) |

## Heights

Ground 0; creek terraces -0.4 / -0.8 / -1.2 (bed), water surface -0.7; Ruins platform 0.9 (dais
+0.4); thatched hut floor 0.9; longhouse floor 0.4; red hut floor 2.2; stilt house floor, walkway
and deck 3.6; Lookout top 6.0; rock outcrops 2.4 .. 7.5 (edges at least 2.4, which nobody can
jump), central cliff to 12 with a 4.5 m face. Ladders do not exist in our movement code: the
stilt house and the red hut have stairs, the Lookout a stepped ledge.

## Sightlines (tested)

- Lookout top over the east spawn and down to the creek east of it.
- Bridge deck down into the river valley under it.
- Ruins platform down its stairs, under the arch, to the creek.
- The central cliff blocks the north strip from the Village; the spawns cannot see each other.
- Foliage (cut-out cards, box canopies) never stops bullets or sight, as in BO1, where foliage
  hides you but bullets go through it; the rock outcrops do.

## Spawns and objectives

- TDM: team 0 (Spetsnaz/NVA) in the Ruins yard, team 1 (Black Ops/SOG) at the foxholes; the 2010
  footage starts the SOG at the foxholes and the PC Games S&D map has the other team at the Ruins.
- FFA: 20 points round every area, one on the stilt house floor and one on the Lookout top.
- Domination (PC Games 2010 map, registered as above): A by the Ruins, B under the Bridge, C at the
  Base. (In 2010 Domination the teams started at the Ruins and the Base; here the team spawns are
  shared by all team modes, so the foxholes stand in for the Base side.)
- S&D: attackers at the Ruins, defenders at the foxholes; A in the Village, B at the Base.
- Headquarters (eight points, after the 2010 HQ map): the Base compound, the Village, the Ruins
  ruin, the diamond hut strip, the thatched hut, the B2 lane, the valley under the Bridge and the
  longhouse.

## What is approximate

- Heights are estimates from footage; the BO1 terrain is sculpted, ours is flat ground with a
  stepped creek and terraced rock boxes.
- The river's exact course in the valley under the Bridge and south of the Lookout is inferred
  (the overhead shows it only as lighter ground); the BO1 "Tunnel" callout is not modelled.
- Turned buildings collide as thin axis-aligned slices (firingrange.ts technique); the Bridge deck
  and ledges collide as stepped slices.
- The crashed helicopters are outside the boundary in the paddies, as on the overhead and the
  2010 guide images; there is no wreck inside the play space.
- The waterfall is placed at the north-west bay where the creek starts; the overhead does not show
  it, so its exact spot is a guess.
- The paddies are a clipped boundary, not the BO1 landmine kill zone.
