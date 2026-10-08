# Highrise (MW2, 2009): layout reference

This is what `src/shared/maps/highrise.ts` is built from. The layout is traced from the original MW2
minimap. The names of areas, the levels and the routes come from the official MWIII (2023) map
guide, whose remaster keeps the 2009 layout, and from MW2 gameplay footage. I viewed these
references and did not copy any of them into the repo. Our renders and the traced outline are in
`docs/maps/highrise/`.

## Sources

- **MW2 minimap.** Call of Duty Wiki, "Highrise" (`https://callofduty.fandom.com/wiki/Highrise`),
  image `Highrise_minimap_MW2.png` (512 px). This is the main source for the outline, the walls and
  the objects on the roof. The wiki text describes the two office buildings, the elevated helipad,
  the tunnel underneath that joins both offices, the elevator shaft with a ladder near the cranes,
  the roof of the south block, and the crane on the west side. From the crane you reach the ledge
  above the north office: you walk across to the north building, climb onto a window-cleaning
  platform and walk along the ledge. The trivia mentions the KRIEGLER letters seen from the yellow
  catwalks, the teddy bears and the WKM block on the roof of the southern tower.
- **MWIII (2023) official map guide:**
  `https://www.callofduty.com/guides/multiplayer-maps/call-of-duty-modern-warfare-iii-play-maps-core-multiplayer-map-guide-highrise`.
  Its tac maps (blank, areas, spawns, Domination, S&D and Hardpoint) are at
  `https://www.callofduty.com/content/dam/atvi/callofduty/cod-touchui/blog/guides/mwiii/tacmap/highrise-tac-map/Highrise_Tac_Map_{Blank,Areas,Spawn,DOM,SND,HP}.png`.
  The guide also has four environment shots (the Phonic office, the Actibase office, the Pit and the
  Helipad) and four action shots. From the text:
  - Phonic Office (north, with Phonic Reception's elevators as one team's spawn);
  - Actibase Office (south, the other spawn);
  - the Pit, a trench along the west side in two sections, the Orange Pit and the Red Pit, each
    running into maintenance tunnels under a building;
  - the Mechanical Room;
  - the Helipad, with staircases at its north and south ends;
  - the Propane Tank, the Propane Shack, the Green Tarp, the Green Shack and the Substation;
  - the Crane, and its northern path to the Phonic upper ledge;
  - the climb up the front of the Actibase building: a ladder at its east end, along the ledge, a
    hanging platform at the west end, then the roof;
  - the drop off the north-east corner;
  - the spawns, the Domination flags, both S&D sites on the rooftop with the attackers coming out
    of Actibase, and the five hardpoints.
- **MW2 gameplay**, used for looks and for how the levels connect:
  - official IW flythrough with commentary (`https://www.youtube.com/watch?v=3IsO1JYD7xw`);
  - a no-commentary TDM match (`https://www.youtube.com/watch?v=vHGEwTHaeEU`);
  - the MW2 promo screenshot (Call of Duty Wiki `Highrise-promo.jpg`): the Mi-8 on the helipad, the
    cranes, the brick office and the hazy brown sky.

The MW2 minimap and the MWIII tac map agree on the outline, on both pits, the helipad strip, the
shacks, the substation, the skip and the tarp fence. MWIII stretched the two office buildings a
little north-south: the MW2 rooftop scales onto the tac map at about 2.94x across and 3.0x along,
but the whole map comes out at 3.23x along. Where they differ, we follow MW2.

## Coordinates and scale

- Metres. x runs east, z runs south (the minimap's "down"), y is up. The roof is at y = 0.
- **Minimap to metres:** `x = (px - 258.5) / 3.75`, `z = (py - 277) / 3.75`, where px and py are pixels
  on the 512 px MW2 minimap. That is 3.75 px per metre, with the origin in the middle of the open
  rooftop.
- **How the scale was checked:**
  - Doorways on the minimap measure 5 to 6 px, which is 1.3 to 1.6 m.
  - The small offices in the south building measure about 15 px, about 4 m.
  - The rooftop measures 44.6 m across on the minimap, and 45 m on the MWIII tac map at the 11 px/m
    we get there from the helipad deck and the propane tank.
  - The crane jibs that reach the map are about 53 m long, which is typical for a tower crane.
  - The helipad strip measures 19 m by 6 m, enough for the 18 m long Mi-8 parked along it.
- **Size:**
  - open rooftop: 44.7 x 56 m (x -22.3 to 22.4, z -28 to 28), with the bulges on the west and east
    edges going out to x -26.3 and 26.4 between z -10.9 and 11.2;
  - from the north wall of the elevator lobby (z -65.6) to the south wall of the reception wing
    (z 59.7): 125 m;
  - whole map: about 55 m wide.
  - Spawn to spawn is about 120 m: roughly 17 s of sprinting (7.2 m/s), or 8 s across the roof from
    one office front to the other.
- The registry calls it `medium`.

## Levels

| Level | Height (feet) | What is there |
|---|---|---|
| Tunnels and pits | -3.2 | the Orange Pit and the Red Pit, the underpass between them (under the B lane), the north tunnel (to the Phonic stairs) and the south tunnel (to the Actibase stairs) |
| Roof and offices | 0 | the open rooftop, both covered walkways, both office floors |
| Shack roofs | 2.8 | the Propane Shack (north-east) and the Green Shack (south-east), climbed from crates |
| South front ledge | 3.9 | the roof of the walkway in front of Actibase |
| Elevator shaft roof | 4.0 | the shaft on the open west edge, with a water tank on top for cover |
| Helipad deck, upper ledge | 4.2 | the deck over the Mechanical Room; the roof of the walkway in front of Phonic |
| Crane jib A | 4.9 | from the shaft roof (a plank), out west-north-west |
| Crane jib C | 5.8 | crosses above jib A in the air and runs back to the north building's corner |
| South roof | 7.6 | the roof of the Actibase building, the highest spot |

**Routes between the levels:**
- **Pit to roof:**
  - a stair from the B lane down into the Orange Pit, on its east side;
  - a ship ladder out of the Orange Pit's north-east corner;
  - a stair into the Red Pit from a landing in its south-east corner;
  - both tunnels, which lead to stairs in the buildings.
- **Roof to helipad:**
  - the north stair rises east along the Mechanical Room's north face;
  - the south stair rises west along its south face;
  - a ship ladder inside the Mechanical Room comes up through a hatch in the deck.
- **The crane climb:**
  - the ladder on the south face of the elevator shaft;
  - the shaft roof;
  - a plank up onto jib A;
  - jib A out to where jib C passes overhead, then jump up onto C;
  - jib C back to the north building;
  - the window-cleaning gondola, then the ledge along the building's front onto the upper ledge.
- **The south roof:**
  - the ladder at the east end of the Actibase walkway;
  - the front ledge, walked from east to west;
  - the hanging platform (a tilted beam) at the west end up to the roof.
- **Drops:** every ledge drops back onto the roof. The open west and east edges, the cranes, and the
  gondola and the ledge drop into the void (the bounds floor is at -6 m, so you die).

## The layout in words

**North: the Phonic offices.**
- The elevator lobby runs down the west side (x -28.4 to -20, z -65.6 to -31.7). It has elevators
  on its west wall and is team 1's spawn.
- A corridor leads east from the lobby to the stair hall. The stairs there go down south into the
  north tunnel. The restrooms are beside the stairs.
- The long office hall faces the roof through glass doors and windows (z -39.5 to -31.7). Two
  columns stand in it, and Domination C sits between them.
- Behind the hall is a back room with a reception counter. Phonic Storage is the room in the
  north-east corner.
- A covered walkway with piers runs along the front of the building. Its roof is the upper ledge.

**South: the Actibase offices.**
- A long front corridor runs behind glass (z 32.8 to 36.3).
- The cubicle office (Domination A) has glass-fronted offices along its north side and a meeting
  room.
- The stairwell in the south-west goes down north into the south tunnel. A back corridor runs along
  the south side.
- The east wing has a reception room and a corridor down to the elevator lobby in the south-east
  (x 18.3 to 27.6, z 49.6 to 59.7). That lobby is team 0's spawn.
- A covered walkway runs along the front. Its roof is the front ledge.

**The rooftop, west to east.**
- **The Pit** runs down the west side. It is a sunken trench with plywood formwork walls that stand
  1.2 m above the roof, too high to jump. Its outer ends are chamfered like an octagon.
  - The Orange Pit (x -17.2 to -5.5, z -22.7 to -8.5) has a machinery skid in the middle.
  - The B lane crosses between the two pits at roof level (z -8.5 to -1.3), over the underpass
    that joins them.
  - The Red Pit (z -1.3 to 23.2) has the big tank and the red kerb.
  - West of the Pit there is a 5 m lane, and then the bulge on the open west edge with the
    elevator shaft. The crane jibs reach in over it.
- **The B lane** runs north-south between the Pit and the Helipad. It has a plywood wall and a
  barrier. Domination B is here.
- **The Helipad**: the Mechanical Room (x 2 to 21.5, z -2.1 to 3.7) with the deck on top of it at
  4.2 m, and the Mi-8 parked nose-west. The room is open at its west end, has a door on the south
  and the east, and holds air handlers and a ladder up through a hatch. Stairs rise along its north
  and south faces. The propane tank stands on cradles at the east end, on the open east bulge.
- **North-east:**
  - the Propane Shack, whose roof you can climb onto;
  - the Substation on the centre line, with its fence;
  - the yellow skip turned 43° (S&D A beside it);
  - pallets of bricks, barrels and AC units.
- **South-east:**
  - the tarp-covered pallet stack;
  - the L-shaped tarp fence, which blocks sight and lets bullets through;
  - the Green Shack, whose roof you can climb onto;
  - crates and barrels.

Outside the play space:
- the tower's own facade drops away below a setback deck at -8 m, with scaffolding along both long
  sides;
- the two crane towers and two more decorative jibs;
- the KRIEGLER letters on the roof of the north building's west wing, facing the cranes;
- the city: a ring of towers well below the roof nearby, rising into the haze further out.

## Callouts (centre or extent, metres)

| Callout | Where (x, z) | Height | Minimap (px) |
|---|---|---|---|
| Elevator lobby (team 1 spawn) | x -28.4..-20, z -65.6..-31.7 | 0 | 152-184, 31-158 |
| Phonic office hall (Dom C) | x -28.4..26.4, z -39.5..-31.7 | 0 | 152-357, 129-158 |
| Phonic stairs to the tunnel | x -12.4..-9.9, z -51..-45 | 0 to -3.2 | ~206-218, 81-125 |
| Upper ledge (walkway roof) | x -19.9..19.1, z -31.7..-28 | 4.2 | 185-330, 158-172 |
| Orange Pit | x -17.2..-5.5, z -22.7..-8.5 | -3.2 | 194-238, 192-245 |
| B lane over the underpass (S&D B) | x -17.2..-5.5, z -8.5..-1.3 | 0 / -3.2 | 194-238, 245-272 |
| Red Pit (tank at -11.3, 13.7) | x -17.2..-5.5, z -1.3..23.2 | -3.2 | 194-238, 272-364 |
| Elevator shaft | x -26.3..-22, z -5.3..5.9 | roof 4.0 | 158-178, 257-299 |
| Mechanical Room / Helipad deck | x 2..21.5, z -2.1..3.7 / deck x 1.5..22, z -2.8..4.4 | 0 / 4.2 | 266-338, 269-292 |
| Helipad north / south stairs | x 0.2..9, z -4.6..-2.8 / x 8.6..17.4, z 4.4..6.2 | 0 to 4.2 | 262-287, 255-270 / 296-325, 292-307 |
| Propane tank | x 22.6..25.2, z -2.7..4.3 | top 3.1 | 345-352, 270-292 |
| Propane Shack | x 12.7..19.1, z -25.1..-21.3 | roof 2.8 | 306-330, 183-197 |
| Substation | x -0.1..2.5, z -20.8..-15.5 | 2.4 | 258-268, 199-219 |
| Skip (S&D A beside it) | centre (11.9, -11.5), 7.4 x 2.5 m at 43° | 1.9 | 290-316, 221-247 |
| Tarp fence | x 7.3..16.2 at z 12.6; x 16.2 at z 12.6..17.6 | 2.2 | 286-322, 323-343 |
| Green Shack | x 4.1..8.4, z 17.6..24.5 | roof 2.8 | 274-290, 343-369 |
| Front ledge (walkway roof) | x -19.9..19.6, z 28..32.8 | 3.9 | 185-332, 382-400 |
| Actibase office (Dom A) | x -7.6..10.6, z 36.3..52 | 0 | 230-298, 413-471 |
| Actibase stairs to the tunnel | x -12..-9.6, z 46..52 | 0 to -3.2 | 214-226, 455-470 |
| Reception lobby (team 0 spawn) | x 18.3..27.6, z 49.6..59.7 | 0 | 328-362, 465-505 |
| South roof | building footprint | 7.6 | |
| Crane jib A (walkable) | (-25, -7.2) to (-38.5, -15.9) | 4.9 | jib (a): 5,189 to 165,292 |
| Crane jib C (walkable) | (-38.5, -15.9) to (-31.3, -31.3) | 5.8 | jib (c): 150,162 to 55,365 |

## Sightlines

These are checked in `tests/maps-highrise.test.ts`.
- **The south roof** sees more than 60% of the open rooftop. It is the power position, as the wiki
  says ("see almost the entire map").
- **The upper ledge and the cranes** look over the north half of the roof, the helipad deck and the
  B lane.
- **Building to building:** from the Phonic hall's windows you can see the Actibase walkway, down
  the lane between the Pit and the roof edge.
- **The Pit floor** is hidden from the open roof and from the deck by its walls. The tunnels are
  hidden from everything above.
- **The Actibase flag** sits behind walls and cubicles, out of sight of the roof. The Phonic flag is
  exposed through the glass front. MWIII's guide makes the same point about its A (Phonic) and C
  (Actibase).
- **Close quarters:** both offices, the tunnels, the pits, the Mechanical Room and the shacks.

## Spawns and objectives

- **TDM:** team 1 is MW2's Spetsnaz side, in the north building. Six of its spawns are in the
  elevator lobby and the rest are in the hall, the back room and storage. Team 0 is the Rangers side,
  in the south building: the reception lobby, the reception room, the front corridor and the offices.
  Team 1 is the north because the S&D convention below needs team 1 to defend.
- **Domination:** one flag in each office and B in the lane between the Pit and the Helipad, as in
  the remaster. MWIII letters them A = Phonic, B = centre, C = Actibase. We re-letter them so that A
  is on team 0's side:
  - **A = Actibase office (3.5, 45)**;
  - **B = centre lane (-1, -0.5)**;
  - **C = Phonic hall (-0.4, -37.2)**.
- **Search and Destroy:** both sites are on the rooftop. **A** is beside the skip, north-east of the
  helipad (13.8, -13.6). **B** is on the B lane over the underpass (-9.8, -4.6). The attackers come
  out of Actibase (`modeSpawns.sd.attackers` = team 0's spawns, `objectives.sdBomb` in the reception
  lobby). The defenders are in the north.
- **Headquarters** uses the remaster's five hardpoints: the Substation (3.2, -13), the Mechanical
  Room (8.4, 0.8), the Propane Tank (22.8, 7.4), the Red Pit (-14.5, -3.2 m, 8.5) and the Green Shack
  (12.8, 20.5).
- **FFA:** 19 points spread over the roof, both pits and both buildings.

## Simplifications

- **Ladders** are steep ship-ladder ramps, as on the other maps. That way players and the bots' nav
  grid can both climb them.
- **The cranes:**
  - The walkable jibs are flat gratings on top of the lattice. Their collision is a chain of
    overlapping axis-aligned pieces along the diagonal.
  - The towers, cabs, counterweights and the two other jibs are scenery.
  - MW2's exact climb onto the crane is approximated by the plank from the shaft's roof. The jump
    from jib A up onto jib C stands in for MW2's crossing of the two jibs.
- **Chamfered pit ends** are diagonal walls drawn rotated, with stepped collision.
- **The skip** is drawn turned 43° and collides as four boxes.
- **Inside the offices** the main walls follow the minimap, but the furniture is generic: cubicles,
  desks and shelves. The second floor of each building is out of bounds, as in the original.
- **The Mi-8** is built from boxes and cylinders. You can't board it.
- **Windows** are open frames, so you can shoot and jump through them. There is no breakable glass.
- **No fall damage:** dropping from a ledge onto the roof doesn't hurt. Falling off the map kills
  through the bounds floor.
- **The MWIII additions are left out:** the Phonic rear platforms, the crane platforms that hang
  from the helipad, the Sign perch, and the drop from the north-east corner onto a lower platform.
