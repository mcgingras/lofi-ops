# Hijacked (Black Ops II, 2012): layout reference

What the rebuilt `src/shared/maps/hijacked.ts` is traced from, in our metre space. Images were only viewed (in the browser) for measurement; no game assets are in the repo. `docs/maps/hijacked/` holds our own renders: the overhead with my tracing of the minimap laid over it, and in-engine screenshots.

## Sources

- BO2 in-game minimap, `Hijacked_minimap_BOII.png` (231 x 480 px, bow up), on https://callofduty.fandom.com/wiki/Hijacked (gallery). This is the main measuring reference. I read it pixel by pixel on a 5 px grid.
- BO2 bird's-eye render, `Hijacked_From_Above_BOII.png` (1920 x 1080, bow to the right, wake behind the stern), same page. Used to identify what the minimap shapes are: the tenders, the shower block, the hot tub in its curved bay, the cabana with its shelves, the radar arch with its wings, the pool, the raised forepeak with the emblem. The view is in perspective, so positions come from the minimap.
- Wiki overview text, same page: two two-storey "buildings" with an open area and shower block between them; upper windows that look over the port structure and the centre courtyard, partly blocked by the shower block; open areas at the bow and stern, the stern the most open; walkways down both sides; "an underground passage through the engine room", reached through hatches in both buildings; "a large container bay at the bottom of the map"; a vent under the hot tub into the boiler room (a Hardpoint is there); the hull name "Vahn Boyage" at both ends.
- Call of Duty Mobile map snapshot, https://blog.activision.com/call-of-duty/2019-11/Call-of-Duty-Mobile-Map-Snapshot-Hijacked: helipad/bow and pool/stern spawns; cabana on starboard, jacuzzi and catwalk on port, showers in the centre; the stateroom toward the stern, the dining area, galley and office toward the bow; the "emergency catwalk" on port as a flank; below deck as the main flank between spawns.
- Gamer Guides BO2 map guide, https://www.gamerguides.com/call-of-duty-black-ops-ii/guide/multiplayer-guide/maps-and-tactics/hijacked: Bow and Stern spawns, Bow and Stern cabins (three rooms downstairs plus an upper level, stairs up from the deck), the walkways the full length of both sides, the maintenance deck below; Domination at the Bow, the Central Deck and the Stern; S&D / Demolition on the Central Deck's east side and in the Stern Cabin; HQ round the Central Deck, both cabins, the maintenance deck, bow and stern.
- BO2 gameplay on YouTube (frames captured in the browser): "Call Of Duty Black Ops 2: Domination (Hijacked)" (`watch?v=mfXwVfc3CYI`) for the Domination A flag position before the Bow Cabin and the bow spawn; "Call Of Duty Black Ops 2: Free For All (Hijacked)" (`watch?v=wRLDKbatC4U`) for the wide exterior stairs with solid side walls, the pool at deck level, the narrow side walkway with glass railings and deck lamps, the curved hot tub walls, the louvred shower block, the interior stairs and rooms.

## Frame and scale

- Game frame: bow north (-z), stern south (+z), +x starboard. The minimap is drawn bow up, so minimap x maps to our x and minimap y to our z. Origin at the shower block (minimap 121.5, 235).
- Scale: 0.19 m per minimap px. Checks: beam 85 px = 16.2 m (a 70-80 m superyacht has a 13-16 m beam); the tenders 17 x 28 px = 3.2 x 5.3 m (jet tenders are 5-6 m); the hot tub 14 px = 2.7 m; the shower stalls 12 px = 2.3 m; the walkways 9-11 px = 1.7-2.1 m (built a little wider, 2.5-2.7 m, to fit a 0.6 m player past railings and pillars). The From Above render gives the same proportions (length to beam 4.7 vs 4.6 on the minimap).
- Overall: 83 m from the bow tip (z -41.8) to the transom (z 41.2), 16.2 m beam from z -23.75 to 23.9. The bow tapers to the point; the stern narrows to a 5.2 m transom.

## Layout in words

The yacht runs bow to stern with a cabin block on each half and an open Central Deck between them.

- **Bow** (team 0 spawn): the raised forepeak (0.9 m, stairs on the centreline, the navy and red emblem, anchor windlasses), then the bow deck with two tenders on chocks against the railings (1.45 m tall, cover), the capstan between them, and Domination A in front of the Bow Cabin.
- **Bow Cabin** (x -5.4..5.4, z -20..-7.6, two storeys): the front door into the dining room (table, the bar cabinet of bottles on the back wall, side doors to both walkways). Behind it the lane with the chute down to the container bay along the port wall, and the galley (counters, island, stove, fridge) with the stairs up along the starboard wall. Upstairs the bridge (helm console under the wide front windows) and the office (desk, bookshelves) whose big rear window looks over the Central Deck. An exterior stair runs up the front wall to a landing and the bridge door (the "bow deck ladder"). Dome roof with the radome and mast.
- **Central Deck** (z -7.6..6.4): the louvred shower block with a glass stall at each end on the centreline (2.5 m, blocks the view between the cabin windows for anyone behind it). On port the hot tub bay: two curved white wings from the hull with the round hot tub in the bay between them; it closes the port deck, so the port flank is the **emergency catwalk** hung outside the hull from z -10.8 to 11.2. The vent grate by the tub opens into the engine room. On starboard the **cabana bar**: back wall on the hull, roof, the counter facing the middle and the bottle shelves behind it; the starboard walkway runs on through the cabana behind the counter (doorways in its end walls).
- **Stern Cabin** (x -5.6..5.6, z 6.4..17.4): fore door into the lounge bar (counter and bottles, sofas, stairs up along the starboard wall), two guest bedrooms, the aft lobby (aft door, side doors) and the stairwell down along the port wall. Upstairs the master stateroom (z 6.4..14.4) whose big front window looks back over the Central Deck at the bow office window, and the open aft terrace (to z 19.8) with two stair flights with solid side walls down to the stern deck. The radar arch on the roof reaches out over both walkways to wings past the hull.
- **Stern** (team 1 spawn, the most open area): the round hot tub, the curved sofas by the railings, the sunken pool (water 0.2 m below the deck, 1.2 m deep, steps at the fore end), the transom.
- **Below deck** (x -5.35..2.0, z -16..15.2, floor -3.4): the container bay under the Bow Cabin (a container, crates), a bulkhead, the engine room (two engines with lanes either side and a cross passage, the Hardpoint "boiler room"), a bulkhead, the generator room under the Stern Cabin with the stairwell's landing.
- **The sea**: open water all round, 3.6 m below the deck. The glass railings are 1 m high and can be jumped (as in BO2); falling in kills (`bounds.min.y` -4.6, below the engine room floor and above nothing).

## Callouts (game metres)

| Callout | Where (x, z) | Notes |
|---|---|---|
| Forepeak | z -41.3..-33.8 | deck 0.9, stairs x -2.1..2.1 |
| Bow deck / tenders | tenders x ±(3.7..6.3), z -30.6..-25 | team 0 spawn; Dom A (-1, -24.4) |
| Bow Cabin | x -5.4..5.4, z -20..-7.6 | front door x -2.4, rear doors x -2.4 / 1.6, side doors z -17.6 |
| Bow exterior stair | x 0.4..4.0, z -21.6..-20 | landing x 4..5.7, bridge door x 3.9..5.3 |
| Chute (down) | x -5.15..-3.8, z -14.2..-7.85 | to the container bay |
| Galley stairs (up) | x 3.85..5.15, z -14.6..-8.3 | to the office |
| Bridge / office | upper floor 3.2, z -19.75..-16 / -16..-7.85 | office window x -1.6..4.4 over the middle |
| Showers | x -2.2..0.9, z -4.2..2.85 | 2.5 m; Dom B (2.2, -1); HQ |
| Hot tub bay | x -8.1..-4.4, z -7.2..5.1 | tub (-6.2, -2.1); vent x -4.9..-4.4 |
| Emergency catwalk | x -10.4..-8.1, z -10.8..11.2 | port flank |
| Cabana bar | x 3.6..7.9, z -5.7..4.4 | S&D A (2.6, 3.4) in front of it |
| Stern Cabin | x -5.6..5.6, z 6.4..17.4 | fore door x -1.6, aft door x 0, side doors z 16 |
| Stairwell (down) | x -5.35..-3.95, z 9.2..15 | top at the aft lobby |
| Lounge stairs (up) | x 4.05..5.35, z 6.9..11.1 | to the stateroom; S&D B (1.4, 7.6) in the lounge |
| Stateroom / terrace | upper 3.2, z 6.65..14.15 / 14.4..19.8 | window x -3.6..3.2 over the middle |
| Terrace stairs | x ±(3.6..5.4), z 19.8..24.2 | down to the stern deck |
| Stern deck | hot tub (-0.3, 28.2), pool x -2.2..1.6, z 29.9..36.9 | team 1 spawn; Dom C (0, 25) |
| Below deck | x -5.35..2.0, z -16..15.2, y -3.4 | bulkheads z -6.2 and 6.1 |

## Heights

Main deck 0; forepeak 0.9; cabin upper floors 3.2 (slab underside 2.95); cabin walls to 6.0, roofs 6.25; the bow dome to about 7.5, the mast to about 11.3; radar arch about 7.4-8; shower block 2.5; hot tub bay walls 3.0; cabana roof 2.95; tenders 1.45; railings 1.0; pool floor -1.2; engine room floor -3.4 (ceiling -0.3); sea -3.6.

## Key distances and timings

Measured with the movement code (walk 5 m/s, sprint 7.2 m/s):

- Bow spawn to Domination B by the starboard walkway: 8.0 s walking, 5.6 s sprinting. Stern spawn to B: 7.4 s / 5.1 s.
- Bow spawn to the stern spawn by the port catwalk: 13.0 s / 9.2 s; through the Bow Cabin, the chute, below deck and the stern stairwell: 11.9 s / 8.5 s.
- Office window to stateroom window: 15 m across the Central Deck.

## Sightlines

- The two upper windows (bow office, stern stateroom) look at each other over the shower block, and down into the hot tub bay and the starboard courtyard; a man standing right behind the shower block is hidden from both.
- The walkways run clear past both cabins; on starboard the line carries on through the cabana; on port the hot tub bay blocks it and the catwalk outside runs its full length.
- The two cabins block bow to stern along the centreline. Below deck the bulkheads break the passage; each engine-room lane is clear end to end.

## Modes

- TDM / KC / wagers: team 0 on the bow (forepeak and bow deck), team 1 on the stern deck (8 + 8). FFA: 17 points, on both decks, both walkways, the catwalk, the cabana, both cabins (both floors) and below deck.
- Domination: A on the bow deck in front of the Bow Cabin (seen in BO2 footage), B on the Central Deck, C on the stern deck.
- S&D: A on the Central Deck's starboard side by the cabana, B in the Stern Cabin (the lounge) (Gamer Guides). Attackers spawn on the bow, defenders on the stern deck and terrace (`modeSpawns.sd`).
- HQ: the Central Deck, the dining room, the lounge, the engine room (the "boiler room" Hardpoint), the bow deck, the stern deck, the bridge, the stateroom, the terrace.

## Known differences from BO2

- Collision is axis-aligned: the bow and stern tapers are 0.5 m steps under a smooth render-only hull skin and railings; the hot tub bay's curved wings are three steps each; the tenders are boxes.
- The room plans inside the cabins (which room is where, door and stair positions) are reconstructed from the descriptions ("three rooms downstairs", dining/galley/office in the bow block, stateroom in the stern block, hatches to the engine room) and the minimap's dashed lines; BO2's exact interior layout is not known. The minimap's below-deck dashes start at the Bow Cabin's aft end; the container bay forward of that, under the dining room, follows the wiki's "container bay" line.
- The cabana's walk-through doorways are an assumption (the minimap shows it against the starboard rail, and the guides say the starboard walkway runs the whole length).
- The two Zodiac boats "at the end of the pool side" (walkable in BO2) and any swim platform are not built.
- S&D sites and the HQ rotation come from Gamer Guides' descriptions, not a measured BO2 match.
