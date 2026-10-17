# Zombies (feature area: `zombies`)

BO1-style round-based survival against waves of zombies and hellhounds: solo first, co-op for 2-4 players. Earn points, buy guns off the walls, roll the Mystery Box, drink Perk-a-Colas, grab power-ups, revive each other, and see how many rounds you last. Reference: BO1 Zombies (Kino der Toten / Five / Nacht der Untoten mechanics).

## Playing it

- Main menu → **Zombies** (`zombies` screen): **Solo** starts a game in one click (the `zombies.solo` RPC opens a private Zombies lobby and starts it as soon as you are in). **Co-op lobby** (`zombies.coop`) gives you a lobby code to share; the host starts. **Find a co-op game** matchmakes the `zombies` Quick Play playlist (category `party`). Join a party by code. Pick the map (remembered in `lofi.zombies.map`); your best round shows from `profile.stats['zombies.bestRound']`.
- The private lobby's mode list also has Zombies, so a private match can switch to it.
- Maps: **Nacht der Untoten** (night; the World at War / BO1 original, Zombies only: boarded windows, debris doors, see docs/maps/nacht-reference.md), **Nuketown** (dusk, a nod to BO2's Nuketown Zombies), **Firing Range** (evening), **Yard** (night).
- Bots do not join by default (the mode's default bot target is 1, i.e. just you). In a co-op lobby the host can turn bot fill on: ally bots join the survivors (at most 4 survivors in all) with the soldier brain, a free gun each round and no points.

## Rules and numbers

All tuning and formulas are in `src/shared/defs/zombies.ts`, with the source of each number in comments. Sources: the T5 script dump (plutoniummod/t5-scripts `ZM/Common/maps/_zombiemode*.gsc`) and the Call of Duty Wiki (MediaWiki API: "Points (Zombies)", "Juggernog", "Quick Revive", "Mystery Box", "Hellhound", power-up pages).

| what | BO1 rule (source) | ours |
|---|---|---|
| Zombie health | 150, +100 a round to round 9, then +10% (truncated) a round (`ai_calculate_health`) | `zombieHealth(round)`: 150, 250 ... 950, 1045, 1149 ... |
| Zombies per round | 24 + per player (solo +0.5 x 6, co-op +(n-1) x 6) x max(1, round/5) (x round x 0.15 from 10); rounds 1-5 take 25/30/50/70/90% (`round_spawning`, `default_max_zombie_func`) | `zombiesForRound(round, players)`: solo 6, 8, 13, 18, 24, 27 ... 33 at 10; 4 players 10 at round 1 |
| Alive at once | 24 (`level.zombie_ai_limit`); the rest wait | the director queues the rest |
| Spawn delay | 2.0 s, x0.95 after each round while above 0.08 (`round_think`) | `spawnDelay(round)` |
| Run speed | base = (round - 1) x 8 (1 in round 1); roll in [base, base+35): <= 35 walk, <= 70 run, else sprint (`set_run_speed`) | `rollGait`, `gaitOdds`; 1.35 / 3.1 / 4.7 m/s (players walk 5.0) |
| Last zombie | rounds 4-9, the last one sprints (`zombie_speed_up`) | same |
| Swipe | 50 a hit (`player_damage_override`): 2 hits down you, 5 with Juggernog (wiki) | 50 every 1.1 s after a 0.45 s wind-up, 1.25 m reach; hellhound bite 40 |
| Points | +10 a non-lethal hit; kill 50 + head 50 / neck 20 / torso 10 / melee 80 (`player_add_points`, `player_add_points_kill_bonus`); wiki: 60 torso, 100 head, 50 limb or explosive, 130 knife | `killPoints`; rounded up to 5, doubled by Double Points; no points while down |
| Start | 500 points (mp/zombiemode.csv), the M1911, 2 frags | M1911 with 8 + 32 (`STARTING_WEAPON`), frags topped up each round to at most 4 (`award_grenades_for_survivors`) |
| Downed | lose 5% (`penalty_downed`); the reviver gets it (wiki); bleed out 30 s; teammates lose 10% if you bleed out (`penalty_no_revive`) | same; revive 3 s hold, 1.5 s with Quick Revive |
| Power-up drops | max 4 a round; the next kill drops when the team's total score passes a threshold (start: players x 500 + 2000, step x1.14), or 3% at random; picked from a shuffled cycle (`watch_for_drop`, `powerup_drop`, `get_next_powerup`) | `newDropTracker`, `updateDropTracker`, `rollDrop`, `PowerupCycle` |
| Power-ups | Max Ammo, Insta-Kill 30 s, Double Points 30 s, Nuke (all zombies die, +400 each, no kill points), Carpenter (5+ broken windows); on the ground 15 s then blinking | same (Carpenter in the cycle only on layers with barriers: every board back, +200 each), 15 s solid + 11 s blinking |
| Barriers | six boards a window; a zombie tears one off per tear animation, climbs in once all are down; holding USE puts one back per second (`blocker_trigger_think` `wait(1)`), 10 points while the round's running total stays under min(50 x round, 500) (`round_think`), reset each round (`_zombiemode_blockers.gsc`) | `BARRIER`: a board every 1.5 s (x0.85-1.15), up to 3 zombies tearing at a window, 1.3 s climb; rebuild 1 s (0.5 s with Speed Cola); `boardReward` |
| Doors / debris | hold USE to buy (`door_think`, `debris_think`); opening a door enables its zones' spawns (`enable_zone`) | layer `doors` (cost, zones), hold USE like a wall-buy |
| Perk-a-Colas | Juggernog 2500, Speed Cola 3000 (reload x0.5), Double Tap 2000 (rate x1/0.75), Quick Revive 1500 / 500 solo (solo: revived after 10 s, sold at most 3 times) (`_zombiemode_perks.gsc`, wiki) | same; Juggernog 250 health (wiki; the T5 script's `zombie_perk_juggernaut_health` is 160, which would be 4 hits: we follow the wiki and the "5 hits" rule); perks are lost when you go down; a ~2.6 s drink lowers the gun |
| Mystery Box | 950; the weapon floats 12 s (`timer_til_despawn`); teddy bear: never before the 4th use since the last move, 15% on uses 4-7, always by the 8th at the first spot, 30% on 8-12 and 50% from 13 after a move (`treasure_chest_weapon_spawn`) | `teddyRoll`; every classable gun but the M1911 (weight 1), the Ray Gun 0.6, other wonder weapons 0.3 (`boxPool`, `rollBoxWeapon`); the teddy refunds the 950, the box flies up its beam and lands at another spot 6 s later |
| Hellhound rounds | first at round 5-7, then every 4-5; players x 6 dogs (x 8 from the 3rd dog round); 2 alive per living player; health 400 / 900 / 1300 / 1600; spawn waits 3 / 2.5 / 2 / 1.5 s minus count/max; the last dog drops a Max Ammo (`_zombiemode_ai_dogs.gsc`) | same; 7 s intro, the fog closes in and turns burning orange |
| Breaks | 10 s between rounds | 8 s (short breaks) |
| Game over | everyone down or dead | every human down (no self-revive coming) or dead: "GAME OVER / YOU SURVIVED N ROUNDS", results 8.5 s later |

Wall-buy prices (`WALL_PRICES`, Kino tiers on the guns we have; there is no M14 or PM63): Olympia 500, MP5K 1000, MPL 1000, AK-74u 1200, M16 1200, Stakeout 1500 (also ASP 500, Commando 1400 for future layers). Ammo costs half. You carry two guns: a third replaces the one in hand (BO1).

Damage against the undead: our guns are tuned for 100-health players, BO1's zombie weapon files hit far harder. `ZOMBIE_DAMAGE` multiplies damage dealt to zombies by class (ARs x2.6, SMGs x2.5, shotguns x3, snipers x4, pistols x2.2, specials x6) with overrides: the M1911 x0.6 (BO1's "six shots and a knife" in round 1), the Ray Gun x6, the Thundergun / Wunderwaffe x40, Winter's Howl x30. The knife already does BO1's 150. Headshots use the weapons' own head multipliers.

## Code map

```
src/shared/defs/zombies.ts           tuning, formulas, perks / power-ups / box defs, ZM_ENTITY kinds, wire types
                                     (zombies.state, zombies.event, zombies.solo / zombies.coop RPCs), ZOMBIES_LOADOUT, XP
src/shared/maps/zombies/             one file per map: the Zombies layer (types.ts: wall-buys, box spots, perks,
  nacht.ts nuketown.ts firingrange.ts zombie spawns (zone, barrier), survivor spawns, time preset, optional barriers,
  yard.ts                            doors, zones, fires, dogs on/off); index.ts registry
src/server/features/zombies/
  index.ts      Feature: registers the mode, the RPCs, the ally-bot hooks
  rules.ts      ModeRules: teams by role, no respawn, layer spawns, ends after game over
  game.ts       the round director, undead bodies (pooled bots on team 1), points, downs / revives / bleed-out,
                game over, state push, results.ext.zombies
  brain.ts      ZombieBrain (BotBrain) and the per-room Horde (targets, path budget)
  spawner.ts    zombie spawn picking (out of sight, 10-40 m from the nearest survivor)
  buy.ts        wall-buys, Perk-a-Colas, the Mystery Box (USE holds, the box timeline, the teddy bear), door targets
  blockers.ts   barriers (boards, zombies walking to / tearing at / climbing through windows, rebuilding, Carpenter),
                doors (the room's own CollisionWorld with gates, buying, zones, the path cost round shut doors)
  powerups.ts   drops, grabs, effects (the Nuke)
  bots.ts       ally bots: registerBotGoal('zombies') (stay with the squad, cover the downed),
                registerBotStyle('zombies') (melee-happy, kite)
  state.ts      PlayerExt.zombies (survivor / undead) and the room events
src/client/features/zombies/
  index.ts      atmosphere: the layer's time preset, the hellhound fog
  store.ts      state, banners, point popups, stingers
  hud.ts        chalk tally (1-5) / round number, points, perks, power-up timers, prompts, downs, drink,
                game over; wraps of core widgets (killfeed, compass, minimap, streak ladder, XP popups,
                scoreboard, names, death screen, result title)
  props.ts      entity renderers: zm_wall (chalk gun + price), zm_perk (vending machine), zm_box, zm_boxspot,
                zm_powerup; textures
  blockers.ts   zm_barrier (six boards, torn off / slammed back), zm_door (debris, furniture, the HELP door, cleared
                when bought), rebuild / buy prompts, the prediction world's gates, flames over the layer's fires
  look.ts       zombie soldiers (tint, rags, glowing eyes, arms out, shamble, swipe, rising, head gibs),
                hellhounds (a charred dog in a burning halo), groans
  sounds.ts     every Zombies sound, synthesized and original (no Zombies music)
  screen.ts     the menu entry, the zombies screen, the game-over results (in place of the match summary)
scripts/zm-layout.ts  top-down PNG of a map's nav and Zombies layer (authoring aid)
scripts/zm-place.ts   snap rough targets to wall faces / free floor / nav cells (authoring aid)
scripts/zm-smoke.ts   a headless game with one idle survivor
tests/zombies.test.ts              formulas, cap and queue, points, wall-buys, box and teddy, perks, Quick Revive,
                                   co-op revives and bleed-out, power-ups, hellhounds, AI reach, 24-zombie tick cost, listing
tests/zombies.layers.test.ts       every layer's spots on free, reachable floor / real walls
tests/zombies.blockers.test.ts     barriers (tear rate, climb in, rebuild points and cap, Carpenter), doors (block, buy,
                                   zones, per-room worlds, path cost), the AI through a window on Nacht
tests/maps-nacht.test.ts           Nacht layout vs the floor plans, Zombies-only, reachability, doors gate areas, windows
tests/zombies.integration.test.ts  real server: one-click solo, points over the wire, a wall-buy, game over, results
```

### How it plugs in

- **Bodies are bots.** Zombies and hellhounds are core players (bots) on team 1, so every gun, grenade, the knife, the wonder weapons, hitboxes (headshots), lag compensation, hitmarkers and death events work on them unchanged. They carry no weapons (`weapons = []`), never regenerate (`regenDelayMultiplier`), move through `speedMultiplier` per gait (hellhounds run crouched: a low body), and are pooled (a corpse lies 2.5 s, then the body is reused). The bots feature attaches its soldier brain to every bot as it joins; the game drops that brain for its bodies (`getRoomBots(room).brains.delete`) and turns the room's bot count management off (`configureRoomBots(room, {}, { managed: false })`, core `botFill` 0), since either would trim the horde.
- **The brain** (`brain.ts`) knows where the survivors are (BO1 `find_flesh`), goes for the nearest one who is up, walks straight when close with a clear line, otherwise follows an A* path on the bots' nav grid (`navFor`) under a per-room budget (`PATH_SEARCHES_PER_TICK` 2, `PATH_EXPAND_PER_TICK` 16 000), re-planned every 1.5-2.5 s staggered, string-pulled every 0.3 s; it keeps a little space from the rest of the horde, hops and side-steps when stuck, and swipes (the swing shows as the FIRING flag in snapshots). A zombie that gets no closer to anyone for 30 s is put back in the queue (BO1 `round_spawn_failsafe`). Measured: 24 zombies on Nuketown average well under the 16.7 ms tick in the test.
- **Points** live in `player.ext.zombies` (`points`, `total`); `stats.score` mirrors the total for the core scoreboard. Point popups go to the player as `zombies.event { kind: 'points' }`.
- **Downs** reuse the Second Chance machinery (`perks/laststand.ts`): `enterLastStand(room, p, opts)` with Zombies' timer, `revivable`, `reviveSecFor` (Quick Revive halves it), `reviveScore: 0` and `onBleedOut`; `reviveFromLastStand(room, p, by)` for the solo Quick Revive. While down you hold your pistol (the Ray Gun if you have one, else a pistol, else a loaner M1911); your guns come back on revive. Zombies ignore downed players and damage to them is cancelled.
- **Double Tap** needs a fire-rate hook: core modifier `fireRateMultiplier` (combat `fire()` divides the shot interval by it), sent to the client as `me.params.fireRate` so the local trigger keeps up.
- **Progression**: `ModeDef.killXp` (10 a kill, +5 a headshot) replaces kill XP and skips medals, streak bonuses and weapon / attachment progress; each round survived pays `roundXp(round)` (`progression.xp`, line "ROUND SURVIVED") and reports `zombies_round` (`progression.metric`, aggregate max); revives pay 50. Challenges (`MODE_CHALLENGE_TEMPLATES.zombies`): Survivor (reach round 10 / 20 / 30), Undead Exterminator (kill 100 / 1000 / 5000 zombies), Brain Surgeon (100 / 500 / 2500 headshots), plus the generated per-mode ones.
- **Killcams**: bleed-outs and game-over deaths use `means: 'world'` with no attacker, and the match ends 8.5 s after the last kill, so neither the per-death nor the final killcam plays.
- **Barriers** (`blockers.ts`): a window opening is a players-only clip in the map, so nobody walks through it (zombies included) and bullets pass. A zombie that spawns at a spawn with `barrier: i` gets an entry: the brain (`Horde.entry`) walks it to the window's outside stand point, holds it there facing in (swiping anyone right inside), the blockers tick pulls boards on a timer, and with every board down one zombie at a time climbs by script (the brain returns null, the body is moved over the sill), then hunts normally. A survivor's USE at a window's inside rebuilds (it claims USE like a buyable).
- **Doors** (`blockers.ts`): map brushes with `gate: 'door:<id>'`. On a layer with doors the room gets its own `CollisionWorld` (`room.world`) whose `gateOn` says a gate is shut until its door is bought, so doors open per room; the shared map world (nav, tests, the client's bake) treats gates as open. The zombie A* multiplies the cost of nav cells inside shut doors (`Horde.pathCost`). Buying opens the door's zones: spawns and windows with that `zone` start working. The client sets the same `gateOn` on its prediction world from the `zm_door` entities.
- **Wire**: `zombies.state` (round, phase, dog round, left, solo, players' points / perks / down state / stats, power-up timers, dog ids, solo Quick Revive lives, survived) on change and every second; `zombies.event` for announcer lines and popups. Entities: `zm_wall { w, p, a }`, `zm_perk { k, p, off? }`, `zm_box` (the killstreak box's `BoxSnap` plus `c` cost, `tc` lid closing, `ty` teddy), `zm_boxspot`, `zm_powerup { k, t0, te }`, `zm_barrier { b boards, w, h, sl sill }`, `zm_door { c cost, k kind, w, h, o? opened at, l? label }`. Events: `board` (a board rebuilt), `door` (bought).

### Adding a map

1. Make `src/shared/maps/zombies/<map>.ts` (see nuketown.ts): `npx tsx scripts/zm-layout.ts <map> out.png` to see the walkable floor, `npx tsx scripts/zm-place.ts <map> wall:x,z[,n|s|e|w] perk:x,z free:x,z,yawDeg spawn:x,z` to snap spots.
2. Register it in `src/shared/maps/zombies/index.ts` and add `'zombies'` to the map's `modes` in `defs/maps.ts` (`withZombies`; a Zombies-only map lists just `['zombies']`, like Nacht).
3. `tests/zombies.layers.test.ts` checks the spots.
4. Barriers and doors (optional): put a players-only clip in each window opening and list it in `barriers` (centre on the wall line, yaw facing in, sill, zone); tie outside spawns to their window with `barrier: i`. For a door, add a brush with `gate: 'door:<id>'` filling the gap (noRender: the `zm_door` entity draws it) and list it in `doors` with its cost and the zones it opens. `dogs: false` turns hellhound rounds off; `fires` gets flames drawn.

## Visual check

Headless Chrome (muted), screenshots of round 1 with the tally, a horde coming, a wall-buy prompt, the box (idle, cycling, the Ray Gun offered), a Perk-a-Cola machine and the drink, power-ups on the ground, downed with Quick Revive, a hellhound round and the game-over card and results.

## Skipped / known limits

- **Barriers and doors on Nacht only**: Nuketown, Firing Range and Yard stay open maps (no windows, no doors, no Carpenter).
- **Barriers**: boards come off top-down and go back bottom-up (BO1 picks a random chunk); zombies don't use BO1's vault animation (the climb is a scripted move over the sill); one zombie climbs at a time.
- **No power switch, Pack-a-Punch, Fire Sale, Death Machine, Monkey Bombs, Bowie knife, PhD Flopper, Stamin-Up, Mule Kick.**
- **Zombie bodies are player-shaped**: hellhounds use the crouched hitbox (about 1.2 m tall); there are no crawlers, no limb gibs (a headshot kill pops the head, everything else topples like a soldier).
- **Zombies don't collide with each other or with players** (core movement has no body collision); they keep some space by steering.
- **Juggernog** follows the wiki's 250 (5 hits); the T5 script value is 160.
- **Box weapon pool** is every classable gun in Lo-Fi Ops plus the four wonder weapons, not BO1's per-map list.
- **Career stats** count zombie kills under `kills` and `mode.zombies.kills` (as BO1 kept zombies stats in the profile); career challenges that count kills (Killer) also count zombie kills.
- **Ally bots** don't buy, revive or pick up power-ups on purpose; they fight with a scavenged gun.
- **Weapons viewmodel**: the mode hands the M1911 in place of the loadout guns; another area is fixing a bug where mode-forced weapons were not drawn (it showed in Infected). In our checks the M1911 viewmodel showed.
