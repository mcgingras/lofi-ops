# Nacht der Untoten (World at War, 2008; Black Ops re-release): layout reference

What `src/shared/maps/nacht.ts` and its Zombies layer `src/shared/maps/zombies/nacht.ts` are traced from, in our metre space. Images were only viewed for measurement; none are in the repo.

## Sources

- Call of Duty Wiki, "Nacht der Untoten" (MediaWiki API, `action=parse&prop=wikitext`): the three areas (Starting Room, "Help!" Room, Upstairs split into two rooms), window counts (five in the start room, two plus the barricaded cave in the Help room, four upstairs), the door costs (the "HELP" door 1000, the stair debris 1000, the sofa barricade on the start room stairs), wall weapons and prices, the box in the Help room, the Black Ops changes (Cold War box weapons plus the Thundergun and Monkey Bombs, Carpenter added, Mule Kick in the start room from patch 1.15), no perks, power or Pack-a-Punch in the original. https://callofduty.fandom.com/wiki/Nacht_der_Untoten
- The same page's gallery: the community floor plans "Nacht der Untoten - DNST.jpg" (downstairs) and "Nacht der Untoten - UPST.jpg" (upstairs), 954 x 763 px, with the chalk numbers (1 Kar98k, 2 M1 Carbine, 3 Thompson, 4 double-barrel, M Mule Kick; upstairs 1 sawed-off, 2 BAR, 3 Trench Gun, 4 Stielhandgranates, 5 sniper cabinet). These are the main measuring reference.
- The same gallery's in-game shots: the map overview (the L-shaped bunker from above, the crashed B-17 off the east side, telegraph poles, trees, the field), the ground floor from the Help door (square pillars, the spiral stair with railings, rubble, tiled floor, board-formed concrete), upstairs (hanging lamps, rubble, holes in the floor), the Help room (metal shelves of crates, the box in the far corner), the crashed B-17 burning in the mud, the Black Ops shot of the start room ("YOU MUST ASCEND FROM DARKNESS" chalked on the wall by the stairs).
- T5 (Black Ops) script dump, plutoniummod/t5-scripts `ZM/Common/maps/_zombiemode_blockers.gsc` (`blocker_trigger_think`: one board per `wait(1)`, `zombie_cost` default 10 points, `rebuild_barrier_reward` checked against `rebuild_barrier_cap_per_round`, Speed Cola faster), `_zombiemode.gsc` (`round_think`: cap = min(50 x round, 500), reset each round), `_zombiemode_spawner.gsc` (`tear_into_building`: one chunk per tear animation, attack spots, then the zombie enters).
- Call of Duty Wiki "Carpenter" (repairs every barrier, 200 points, needs five destroyed windows, added to the Black Ops Nacht) and "Points (Zombies)" (10 per board, at most 60 a window).

## Frame and scale

- Game frame: +x east (right on the plans), +z south (down), y up, yaw 0 faces north. Origin at plan px (505, 420), the middle of the building.
- Scale: 28 px per metre (0.036 m per px). From the plans: the start room's square pillars are about 20 px (0.7 m) on 100 px centres (3.6 m); the windows about 30 px (1.1 m; built 1.3 to 1.4 m so a zombie fits); the HELP doorway 65 px (2.3 m); the stairs 45 px (1.6 m). That gives a start room of 17.1 x 9.8 m and a Help room of 5.9 x 17.7 m, which matches the in-game shots (about five pillar spacings down the start room, a 3 m ceiling).
- Plan lines (px -> m): x 160 -12.3, 205 -10.7, 370 -4.8, 647 5.1, 735 8.2, 850 12.3; y 170 -8.9, 393 -1.0, 600 6.4, 665 8.8.

## Layout in words

An L-shaped two-storey concrete bunker. The start room is the long east-west hall (x -4.8..12.3, z -1.0..8.8) with a notch cut out of its south wall (x 5.1..8.2); the Help room is the north-south wing on its west side (x -10.7..-4.8, z -8.9..8.8). The top floor covers the Help wing and the west half of the start room as two rooms; the rest is one storey.

- Start room: two rows of three square pillars plus one by the stairs; the spiral stairs up in the north of its middle (built as two flights round the corner: east along the north wall, a landing, south to the top floor), blocked at the foot by a sofa barricade (1000). Five windows: S1 and S2 in the south wall west of the notch, S3 east of it, S4 in the east wall, S5 in the north wall east of the stairs. The Kar98k (200) chalk on the south wall between S1 and S2, the M1A1 Carbine (600) on the notch wall. The HELP door (1000) in the west wall.
- Help room: a line of four pillars down the middle, metal shelves of crates, a table with the radio, two windows (H1 north, H2 east onto the yard north of the start room), the boarded hole into the dead-end cave (west, behind it a short rock pocket under the earth mound). The Thompson (1200) and the double-barrel (1200) on the walls, the Mystery Box in the south-east corner, the debris-choked stair tower in the south-west corner (1000) climbing north to a landing over the cave and into the upper left room.
- Upstairs: the left room over the Help wing (pillars, a fallen concrete beam, the sniper cabinet in the middle, the Trench Gun 1500 and the BAR 1800 on its walls, two windows on the west side over the earth mound, one east onto the balcony), joined by a gap to the right room over the start room (the sawed-off 1200 by its north window onto the balcony, holes in the floor over the spiral stairs with railings). Roofs with holes where they have fallen in.
- Outside: the airfield's crater field all round. An earth mound against the west wall ramps up from the field to the upper west windows (and holds the cave). Exterior stairs along the north wall climb west to a balcony that serves the two upper north/east windows. The crashed B-17 burns off the east side (fuselage, broken wings, engines), wrecked trucks north and west, shell craters, sandbags, barbed-wire fence posts, telegraph poles, dead trees, burning debris, fog and a tree line on the horizon.

## Faithful vs deviations

Faithful: the room plan, wall lines, window counts and placement per room, the three doors and their 1000 cost, the order of opening (start -> Help -> upstairs, or start -> upstairs via the spiral), the box starting in the Help room, the wall weapons' rooms and prices, the outside approach (field, mound, exterior stairs), no hellhounds, Carpenter (added in Black Ops), the night look with the B-17 fire.

Deviations (documented in the layer):

- Perks: the original had none (Black Ops added only Mule Kick in the start room). We add the four BO1 perks: Quick Revive where Mule Kick stood (start room, south-east corner), Juggernog in the Help room, Speed Cola and Double Tap upstairs. No power switch is needed.
- Mystery Box: the original's single fixed spot in the Help room is the first spot; two more (start room by the stairs, upstairs right room) let the teddy bear move it. The box pool is ours (every gun plus the wonder weapons).
- Guns: World War II guns we don't have map to ours: Kar98k -> L96A1, M1A1 Carbine -> M16, Thompson -> AK-74u, double-barrel and sawed-off -> Olympia, M1897 Trench Gun -> Stakeout, BAR -> AK-47, the sniper cabinet's scoped Kar98k -> Dragunov (a chalk on the cabinet). The MP5K (Help room) and MPL (upstairs) are added from the BO1 lineup the other layers carry. The MP40 was box-only in Nacht, so it has no wall spot. No Stielhandgranate wall-buy (grenades are topped up every round).
- The spiral staircase is two straight flights and a landing; the floor hole round it is rectangular; the cave is a box pocket. The exterior staircase on the plans' north side is used as the zombies' route to the upper windows (with a small balcony).
- Windows are a little wider than the plans (1.3 to 1.4 m) so a zombie body climbs through.

## Key distances

- Start room spawn to the HELP door about 6 m; to the sofa barricade about 5 m.
- Zombie spawns 11 to 22 m out from their windows; a round-1 walker reaches the start room windows in about 10 s, tears six boards in about 9 s, climbs in in 1.3 s.
- Heights: ground floor ceiling 3.0 m, top floor 3.3 m, top ceiling 6.0 m, roofs 3.3 / 6.3 m; window sills 0.9 m (the cave hole 0.35 m), openings 1.3 m tall.
