# Rust (MW2, 2009): layout reference

This is what `src/shared/maps/rust.ts` is built from. The layout comes from the original MW2 minimap
(Call of Duty Wiki) and the MWIII (2023) remaster's official tac maps, which use the same layout. The
heights and how the levels connect come from the official MWIII map guide and from screenshots of
both versions. I viewed these references and did not copy any of them. Our render of the result is
in `docs/maps/rust/`.

## Coordinates and scale

- Metres; x runs east and z runs south (the minimap's "down"). The origin is the centre of the MW2
  minimap square, so the tower is a little north-east of it.
- **Scale.** The container on the south edge measures 6.0 m on the minimap, the same as a 20 ft ISO
  container (6.06 m). The fuel truck measures about 8 m, the pickup about 5 m, and the big pipe about
  2.2 m across. All four agree to within a few percent on 22.5 px/m for the MW2 minimap (at 4x) and
  15 px/m for the 2048 px MWIII tac map.
- **Play area:** x -24.2 to 24.4 and z -24.4 to 25.2, so **48.6 x 49.6 m**. It is the smallest map in
  MW2: roughly 3 s of sprinting (7.2 m/s) from any edge to the tower, and under 10 s from corner to corner.

## The layout in words

The map is a fenced square of sand. The rusted **tower** stands just north-east of the centre. The
big round **pipeline** runs down the whole west side. It rises out of the sand near the north-west
spawn and climbs to the tower's middle deck, with a branch that runs east at about 4.4 m into the
tower. Its south run drops to the **derrick** platform in the south-west corner and then back into
the sand at the corner.

- **The ground floor of the tower** is a cramped maze of machinery: a dark passage on the west side, a
  tunnel under the north deck, a small room under the north-east deck, and the ladder well on the east
  side. These are the two "hidden tunnels" the wiki describes, one by the ladder and one on the other
  side.
- **The ladder** starts from a raised platform on the south face. A long stair runs south from that
  platform down to the sand.
- **The exhaust chute** rises from the sand east of the tower straight up to the top deck. It is the
  second way to the top.
- **The fuel-tank skid** stands west of the tower. A short pipe joins it to the middle deck.

Around the edges, going clockwise from the north:

- the guard shack at the front gate on the north fence;
- a horizontal tank;
- the tank house in the north-east corner (H-shaped plan, white tanks on the roof);
- the Barn Oil building on the east edge, with tanks on its roof and a covered passage along its west
  side;
- the trucks in the south-east (fuel truck and pickup);
- the container on the south edge, with crates beside it;
- the derrick in the south-west;
- the two blue containers in the north-west.

The generator, with an L of low concrete wall, stands just south-east of the tower. Sand and rock rise
past the south edge, and the pipeline carries on off the map to the north and the south.

## Callouts (centre or extent, metres)

| Callout | Where (x, z) | Height | Notes |
|---|---|---|---|
| Tower: core / heater box | x -3.0..1.3, z -3.5..1.9 | solid to 8.1 | top deck sits on it |
| Tower: middle deck | west wing x -7.7..-3.0, z -8..1.9; north strip x -3..8.5, z -8..-3.5; east part x 3.7..8.5, z -4.7..1.2 | 4.4 | pipe branch arrives on the north edge, tank pipe on the west edge |
| Tower: top deck | x -4.3..1.3, z -1.5..4.4 plus x -3..1.3, z -3.5..-1.5 | 8.4 | the stack and its frame rise from the north-east corner; railings all round |
| Raised platform ("by the ladder") | x -2.3..2.5, z 1.9..6 | 1.8 | south face; stair down to the sand at z 11.4 |
| Ladder 1 (ship ladder) | x 1.3..2.5, z 1.9 -> -1.4 | 1.8 -> 4.4 | in the ladder well |
| Ladder 2 (ship ladder) | x -4.3..-3.1, z -6.5 -> -1.5 | 4.4 -> 8.4 | on the west face of the core |
| Exhaust chute | x 14.7 -> 1.3, z 1.2..2.6 | 0 -> 8.4 | you can walk under its upper half |
| West passage (tunnel) | x -4.6..-3.0, z -8..1.9 | ground | dark |
| North tunnel | x -3..3.7, z -8..-3.5 | ground | under the north deck |
| North-east room | x 3.7..8.5, z -8..-4.7 | ground | walls on the north and east sides; S&D B |
| Ladder well | x 2.5..3.7, z -1.4..1.9 | ground | |
| Annex (pump house) | x -0.9..2.7, z -14..-8 | roof 3.4 | |
| Valve stack (end of the pipe branch) | (-2.2, -8.8) | | |
| Fuel-tank skid | x -14.8..-11.6, z -4.5..-1.4 | 3.0 | reached from the middle deck along the short pipe |
| Pipeline north end | x -20.9..-18.7, z -21.2 | 0 -> 4.4 at z -10 | walk up it from the north-west |
| Pipe branch | z -9.8..-8.0, x -18.7 -> -2.6 | top 4.4 | 2.6 m clearance underneath |
| Pipeline south run | x -24..-22, z 9..18.7 | 2.85 | S-bend at z 5..9 |
| Pipe into the sand (south-west corner) | x -24..-22, z 18.7 -> 25 | 2.85 -> 0 | "climb up in the far south-west corner" |
| Derrick platform | x -20.9..-13.1, z 11.5..18.2 (+ wing x -20.9..-17.3 to z 22.5) | 2.85 | crate steps on the south-east side; tunnel under the wing |
| Blue containers | x -15.1..-9.8, z -18.6..-12.5 | 2.6 | climb them from the crates at the south-west corner |
| Guard shack / front gate | x -5.8..0.2, z -24.4..-20.5 | | hollow; door on the south side; gate at x -13.5..-6.5 |
| Horizontal tank | x 4.2..10.1, z -23.4..-21.6 | | |
| Tank house (north-east) | x 13.7..21.3, z -21.1..-12.9 (H plan) | 3.0 | 3 m lanes to its north and east |
| Barn Oil building | x 20.4..24.4, z -9.1..1.7 | 3.4 | covered passage x 17.5..20.4, z -4.4..1.7 |
| Generator | x 3.9..6.3, z 5.2..7.9, with an L wall to x 8.6, z 10 | 2.3 / 1.2 | |
| Trucks | fuel truck (19.1, 17.4), heading NNW; pickup (6.8, 20.5), heading NE | | |
| South container | x -5.9..0.1, z 20.4..22.85 | 2.6 | |

## Key distances and sightlines

- From the north-west spawn (-14, -22) to the foot of the pipe is about 6 m, and to the tower's
  middle deck along the pipe about 28 m (about 4 s of sprinting).
- From the trucks spawn (15, 22) to the foot of the chute (14.7, 2) is about 20 m, and up the chute to
  the top another 16 m.
- Tower top to the south-east corner: about 34 m. To the north-west corner: about 34 m.
- The **top deck** is the power position. Standing at its rails you can see every trucks spawn, most of
  the pipe and front gate spawns, and about half of the open ground. The decks below hide the ground
  maze from it, as do the buildings along the edges. `tests/maps-rust.test.ts` checks this.
- **Long lanes:** the east side (trucks <-> Barn Oil <-> north-east lane, about 45 m); the north edge
  (shack <-> tank <-> tank house); the south edge (container <-> pickup <-> fuel truck); the pipe
  branch at 4.4 m (pipe junction <-> tower).
- **Close-quarters spots:** the tower maze, the north-east room, the derrick tunnel, the covered
  passage, the north-east lane behind the tank house, and the guard shack.

## Spawns and objectives (where MWIII puts them)

- **TDM:** OpFor spawns at the north / north-west, between the pipe and the front gate. Task Force
  141 spawns at the south-east, by the trucks. In our data team 0 = the trucks (south-east) and
  team 1 = the north-west. We use that order because the S&D convention below needs team 1 to be the
  side that defends.
- **Domination** (three flags on the ground around the tower, roughly the same distance apart): one by
  the fuel-tank skid west of the tower, one just east of the tower, and one south-south-west between
  the derrick and the south container. MWIII letters them NE = A, W = B, S = C. We re-letter them to
  match our convention that A is on team 0's side: **A = south (-7.6, 16.8)**, **B = east
  (10.6, -8.6)**, **C = west (-12.8, -6.4)**.
- **Search and Destroy:** the attackers start at the trucks. **Site A** is on open ground by the pipe's
  S-bend, north of the derrick (-16.4, 9.4). **Site B** is the cramped room under the tower's north-east
  deck (5.6, -6.3); the attackers are a little closer to it. The defenders are at the north-west. The
  data for this is `modeSpawns.sd.attackers` (the trucks), `.defenders` (north-west) and
  `objectives.sdBomb` (by the trucks).
- **Headquarters** (MWIII's five hardpoints): the north-west by the containers, north-east of the
  tower by the annex, south-west of the tower by the stair, at the generator, and up on the derrick
  platform (the only raised one).
- **FFA:** 16 points spread around the edges and the open ground.

## Simplifications

- **Ladders** are steep ship-ladder ramps (slope 0.8) instead of real ladders. That way players and
  the bots' nav grid (which walks up to 0.43 m per 0.5 m cell) can both climb them.
- **Sloped pipes** are wedges with flange rings, because round pipes can't tilt in our brush format.
- **The tower** has only three walkable levels (ground maze, middle deck, top). The original's extra
  ledges, its crawl spaces (you can't crouch through them here) and the small platform you jump from to
  the Control Room are left out.
- **Rotated vehicles** collide as a row of axis-aligned boxes.

## Sources

- MW2 minimap: Call of Duty Wiki, "Rust" (`https://callofduty.fandom.com/wiki/Rust`), image
  `Rust_minimap_MW2.png` (`https://static.wikia.nocookie.net/callofduty/images/a/a3/Rust_minimap_MW2.png`).
  The page also describes the map: the tower with its ladder and two connecting pipes, the raised
  corner reached by the round pipeline, the small tunnel behind that building, and the two hidden
  tunnels by the tower.
- MWIII (2023) official map guide: `https://www.callofduty.com/guides/multiplayer-maps/call-of-duty-modern-warfare-iii-play-maps-core-multiplayer-map-guide-rust`.
  Its tac maps (blank, areas, spawn, DOM, S&D, Hardpoint) are under
  `https://www.callofduty.com/content/dam/atvi/callofduty/cod-touchui/blog/guides/mwiii/tacmap/rust-tac-map/`.
  The guide also has five environment shots and three action shots. The text describes the two
  routes to the top (the centre ladder and the exhaust chute), the middle deck reached from the
  pipeline or the chute, the crawl spaces, the fuel-tank platform, the spawns, and where the
  attackers start in S&D.
- Activision blog, "Modern Warfare Tactical Map Intel: Rust" (MW 2019 reimagining, used only for zone
  names): `https://blog.activision.com/call-of-duty/2020-02/Modern-Warfare-Tactical-Map-Intel-Rust`.
- An MW2 (2009) screenshot of the tower and the chute (Call of Duty Wiki `Rust.jpg`) and a Game Rant
  image of the 2009 map: `https://static0.gamerantimages.com/wordpress/wp-content/uploads/2025/01/modern-warfare-2-2009-rust-map.jpg`.
- MWIII promo screenshots on the Call of Duty Wiki (`Rust_Promo_MWIII.jpg` to `Rust_Promo6_MWIII.jpg`).
