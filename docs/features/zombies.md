# Zombies (feature area: `zombies`)

BO1-style round-based survival against waves of zombies and hellhounds: solo first, co-op for 2-4 players. Earn points, buy guns off the walls, roll the Mystery Box, drink Perk-a-Colas, grab power-ups, revive each other, and see how many rounds you last. Reference: BO1 Zombies (Kino der Toten / Five / Nacht der Untoten mechanics).

## Playing it

- Main menu → **Zombies** (`zombies` screen): **Solo** starts a game in one click (the `zombies.solo` RPC opens a private Zombies lobby and starts it as soon as you are in). Under it, **Play with a bot partner** (on by default): 1-3 AI partners and their skill (Recruit / Regular / Veteran), remembered in `lofi.zombies.allies`; unticked, you play alone. **Co-op lobby** (`zombies.coop`) gives you a lobby code to share; the host starts. **Find a co-op game** matchmakes the `zombies` Quick Play playlist (category `party`). Join a party by code. Pick the map (remembered in `lofi.zombies.map`); your best round shows from `profile.stats['zombies.bestRound']`.
- The private lobby's mode list also has Zombies, so a private match can switch to it.
- Maps: **Nuketown** (dusk, a nod to BO2's Nuketown Zombies), **Firing Range** (evening), **Yard** (night).
- Solo comes with one AI partner by default (see "AI allies" below). In a co-op lobby the host can turn bot fill on: AI allies fill the survivors up to the target (at most 4 survivors in all), at the lobby's difficulty (Hardened plays as Veteran).

## Rules and numbers

All tuning and formulas are in `src/shared/defs/zombies.ts`, with the source of each number in comments. Sources: the T5 script dump (plutoniummod/t5-scripts `ZM/Common/maps/_zombiemode*.gsc`) and the Call of Duty Wiki (MediaWiki API: "Points (Zombies)", "Juggernog", "Quick Revive", "Mystery Box", "Hellhound", power-up pages).

| what | BO1 rule (source) | ours |
|---|---|---|
| Zombie health | 150, +100 a round to round 9, then +10% (truncated) a round (`ai_calculate_health`) | `zombieHealth(round)`: 150, 250 ... 950, 1045, 1149 ... |
| Zombies per round | 24 + per player (solo +0.5 x 6, co-op +(n-1) x 6) x max(1, round/5) (x round x 0.15 from 10); rounds 1-5 take 25/30/50/70/90% (`round_spawning`, `default_max_zombie_func`) | `zombiesForRound(round, players)`: solo 6, 8, 13, 18, 24, 27 ... 33 at 10; 4 players 10 at round 1. AI allies count as players (BO1 counts every player in the game, so the partner carries its weight): you + 1 partner is the 2-player count (7 in round 1). Hellhound counts and the power-up score threshold count them too |
| Alive at once | 24 (`level.zombie_ai_limit`); the rest wait | the director queues the rest |
| Spawn delay | 2.0 s, x0.95 after each round while above 0.08 (`round_think`) | `spawnDelay(round)` |
| Run speed | base = (round - 1) x 8 (1 in round 1); roll in [base, base+35): <= 35 walk, <= 70 run, else sprint (`set_run_speed`) | `rollGait`, `gaitOdds`; 1.35 / 3.1 / 4.7 m/s (players walk 5.0) |
| Last zombie | rounds 4-9, the last one sprints (`zombie_speed_up`) | same |
| Swipe | 50 a hit (`player_damage_override`): 2 hits down you, 5 with Juggernog (wiki) | 50 every 1.1 s after a 0.45 s wind-up, 1.25 m reach; hellhound bite 40 |
| Points | +10 a non-lethal hit; kill 50 + head 50 / neck 20 / torso 10 / melee 80 (`player_add_points`, `player_add_points_kill_bonus`); wiki: 60 torso, 100 head, 50 limb or explosive, 130 knife | `killPoints`; rounded up to 5, doubled by Double Points; no points while down |
| Start | 500 points (mp/zombiemode.csv), the M1911, 2 frags | M1911 with 8 + 32 (`STARTING_WEAPON`), frags topped up each round to at most 4 (`award_grenades_for_survivors`) |
| Downed | lose 5% (`penalty_downed`); the reviver gets it (wiki); bleed out 30 s; teammates lose 10% if you bleed out (`penalty_no_revive`) | same; revive 3 s hold, 1.5 s with Quick Revive |
| Power-up drops | max 4 a round; the next kill drops when the team's total score passes a threshold (start: players x 500 + 2000, step x1.14), or 3% at random; picked from a shuffled cycle (`watch_for_drop`, `powerup_drop`, `get_next_powerup`) | `newDropTracker`, `updateDropTracker`, `rollDrop`, `PowerupCycle` |
| Power-ups | Max Ammo, Insta-Kill 30 s, Double Points 30 s, Nuke (all zombies die, +400 each, no kill points), Carpenter (5+ broken windows); on the ground 15 s then blinking | same (Carpenter only on layers with barriers: none yet), 15 s solid + 11 s blinking |
| Perk-a-Colas | Juggernog 2500, Speed Cola 3000 (reload x0.5), Double Tap 2000 (rate x1/0.75), Quick Revive 1500 / 500 solo (solo: revived after 10 s, sold at most 3 times) (`_zombiemode_perks.gsc`, wiki) | same; Juggernog 250 health (wiki; the T5 script's `zombie_perk_juggernaut_health` is 160, which would be 4 hits: we follow the wiki and the "5 hits" rule); perks are lost when you go down; a ~2.6 s drink lowers the gun |
| Mystery Box | 950; the weapon floats 12 s (`timer_til_despawn`); teddy bear: never before the 4th use since the last move, 15% on uses 4-7, always by the 8th at the first spot, 30% on 8-12 and 50% from 13 after a move (`treasure_chest_weapon_spawn`) | `teddyRoll`; every classable gun but the M1911 (weight 1), the Ray Gun 0.6, other wonder weapons 0.3 (`boxPool`, `rollBoxWeapon`); the teddy refunds the 950, the box flies up its beam and lands at another spot 6 s later |
| Hellhound rounds | first at round 5-7, then every 4-5; players x 6 dogs (x 8 from the 3rd dog round); 2 alive per living player; health 400 / 900 / 1300 / 1600; spawn waits 3 / 2.5 / 2 / 1.5 s minus count/max; the last dog drops a Max Ammo (`_zombiemode_ai_dogs.gsc`) | same; 7 s intro, the fog closes in and turns burning orange |
| Breaks | 10 s between rounds | 8 s (short breaks) |
| Game over | everyone down or dead | every survivor down (no self-revive coming) or dead, AI allies included: an ally up keeps the game going (it revives you; bled out, you are back next round). "GAME OVER / YOU SURVIVED N ROUNDS", results 8.5 s later |

Wall-buy prices (`WALL_PRICES`, Kino tiers on the guns we have; there is no M14 or PM63): Olympia 500, MP5K 1000, MPL 1000, AK-74u 1200, M16 1200, Stakeout 1500 (also ASP 500, Commando 1400 for future layers). Ammo costs half. You carry two guns: a third replaces the one in hand (BO1).

Damage against the undead: our guns are tuned for 100-health players, BO1's zombie weapon files hit far harder. `ZOMBIE_DAMAGE` multiplies damage dealt to zombies by class (ARs x2.6, SMGs x2.5, shotguns x3, snipers x4, pistols x2.2, specials x6) with overrides: the M1911 x0.5 (BO1's 20 a round), the Ray Gun x6, the Thundergun / Wunderwaffe x40, Winter's Howl x30. That lands body damage on BO1's numbers (MP5K 100 vs BO1 100-50, AK-74u 100 vs 120-80, M16 104 vs 100-70). The knife already does BO1's 150.

**Headshots** use BO1 Zombies' hit-part multipliers (`ZOMBIE_PARTS`, applied by `zombiePartMult` in the `zombies.damage` modifier in place of the gun's multiplayer ones). Source: the Call of Duty Wiki's per-weapon Zombies infoboxes (`regmultiplier`; page "Upgraded Weapons/Black Ops"):

| weapon (BO1 Zombies) | head | chest | ours |
|---|---|---|---|
| M16, Famas, Commando, Galil, AUG, G11, AK-74u, MP5K, MPL, PM63, Spectre | x4 | x1 | ARs and SMGs x4 (class default) |
| RPK, HK21 | x3 | x1 | LMGs x3 |
| M1911 | x3.5 | x1.25 | x3.5, chest x1.25 |
| CZ75 | x3.5 | x1 | pistols x3.5 (the ASP too) |
| Python | x1.5 | x1.5 | x1.5 / x1.5 (a head is no better than the chest, as in BO1) |
| Dragunov | x10 | x1.5 | x10 / x1.5 |
| L96A1 | x10 | | snipers x10 |
| Olympia, Stakeout, SPAS-12, HS-10 | N/A | | no head bonus (x1) |
| Ray Gun, Thundergun, Winter's Howl, Wunderwaffe | | | x1 |

Shots to kill at point blank, body / head (before, then after): MP5K and AK-74u round 1 2/2 then 2/1, round 10 11/8 then 11/3, round 20 28/20 then 28/7; M16 round 15 17/12 then 17/5; M1911 round 1 8/6 then 6/3; L96A1 round 20 7/7 then 7/1.

Why headshots felt no stronger (`tests/zombies.headshots.test.ts` proves both causes):
1. The multiplier: heads were x1.4 (x1 for shotguns) on top of the class multiplier, so an MP5K needed 2 to the head in round 1, as many as to the body.
2. The pose: the shamble leaned the whole soldier 0.12-0.37 rad about the feet, drawing the head 0.2-0.5 m in front of its hitbox (the hitboxes are the standing player's, axis aligned over the feet). Dead ahead that didn't matter, but from 30-45 degrees off a shot at the drawn head passed beside the head box (a miss, or a torso hit). The shamble now leans 0.05-0.09 rad about the hips with the head nodding and lolling (`ZOMBIE_POSE`, `zombiePose`), and the drawn head stays inside the head box at every speed, phase and facing. Climbing out of the ground the body is crouched for the first 0.55 s (the crouched hitbox follows the drawn head up) and stands still for the 1.1 s climb.

The hitmarker shows a head hit (the server's `hit.part`) as a bigger gold marker (red with a gold centre on a head kill), the head pops off on a headshot kill (killfeed `headshot`), and the kill pays 50 + 50 (`killPoints('head')`): the same part drives all three.

## AI allies ("partners")

`src/server/features/zombies/ally.ts` (`AllyBrain`); tuning `ZOMBIES_ALLY` in defs.

- **Asking for them.** Solo sends `zombies.solo { allies: 0-3, allyDifficulty }` (default 1, regular). `setZombiesAllies(room, count, difficulty)` stores the request per room (it survives `setMode`; a game under way takes them at once, and they come in at the next round like late joiners).
- **Rules.** They are bot survivors on team 0 with the BO1 start (500 points, the M1911, 2 frags) and their own points, earned like yours (+10 a hit, kills, revives). The same rules apply: they go down, bleed out in 30 s, lose perks, and come back the next round. With a partner the game is co-op, not solo: Quick Revive costs 1500 and halves revive time instead of self-reviving.

What the brain does each tick, in priority order:

1. **Down.** It shoots the nearest zombie with its last-stand pistol. "PARTNER <NAME> IS DOWN!" goes out with the down, "PARTNER NEEDS A REVIVE" 5 s later. You revive it with the co-op prompt (hold USE within 1.8 m for 3 s).
2. **A teammate down** (you first) is urgent: it goes to you and holds USE ("PARTNER: REVIVING YOU", to you).
   - Zombies within 6 m of it or of you count against `reviveSwarm` (recruit 1, regular 1, veteran 2).
   - Above that it clears them first, standing near you and shooting. It backs away instead with 2+ zombies within 3.5 m, or below 60% health.
   - With less than `reviveUrgentSec` of your bleed-out left (recruit 7 s, regular 10, veteran 14) it goes in whatever the swarm.
3. **Overwhelmed** (3+ zombies within 3.5 m): it backs away from them on reachable floor, toward you, shooting.
4. **Buying.** Only with no zombie it can see within 9 m (any within 3.5 m stops it), at most 28 m away and near you; one plan at a time, re-planned every second:
   - ammo for a wall gun it carries, under 35%;
   - a wall gun when it has only pistols: an SMG or better from the start; anything when it is dry (then it walks up to 56 m and through a little danger);
   - Juggernog, then Quick Revive, keeping `buyReserve` points (recruit 600, regular 300, veteran 100);
   - a clearly better wall gun (two ranks up) once it has Juggernog, or points for both;
   - the Mystery Box now and then (`boxChance` rolled once a round: 10 / 20 / 30%), taking the gun unless it is worse than the one in hand.

   It puts its worst gun in hand before buying (the new one replaces it, as for you), and calls it out ("PARTNER: GETTING JUGGERNOG").
5. **Power-ups** within 6 m. It goes for Max Ammo only when its own ammo is under 40%, so it doesn't spend yours early (power-ups are shared anyway).
6. **Following** the nearest human. It holds still while 4.5-15 m away and out of your line of fire (never within 0.45 rad of where you face, inside 25 m). Otherwise it walks to a spot about 9 m off to its side of you and a little behind, on reachable nav cells. It steps aside when you walk at it, so it doesn't block doorways.

**Fighting** runs alongside all of that except USE holds:
- Target: the visible zombie closest to you (anything within 2.5 m of the ally first; closer to the ally breaks ties), re-picked every 0.25 s.
- Aim: the bots' controller (`aim.ts`: reaction, springs, start error, sway, recoil) and noticing time. Sight: the bots' `sight.ts` (collision and drawn cover); zombies within 4 m are noticed from any side in 0.3 s.
- It goes for the head on `headAim` of engagements (recruit 25%, regular 55%, veteran 85%) and fires only with a line of fire.
- It paces semi-automatics like a person, reloads when dry or when nothing is in sight, swaps to the better gun with ammo (off a shotgun past 12 m), and knifes what is on top of it while dry or reloading.

Difficulties use the bots' presets (recruit / regular / veteran `BotSkill`, field of view at least 120 degrees) plus the zombie tuning above. Measured on Nuketown (`tests/zombies.ally.test.ts`, seeded):
- following stays inside 2.5-16 m in at least 90% of samples, and in your line of fire in at most 15%;
- a veteran with an MP5K kills 4+ zombies (with a headshot or more) in 90 s of round 1;
- it revives you from up to 15 m in under 12 s;
- with 3000 points it drinks Juggernog; with 1400 and only the M1911 it buys an SMG.

**HUD.** Partners are survivors in `zombies.state` (`ZombiesPlayerInfo.bot`):
- bottom right: name with a BOT tag, perks, points, and while down the bleed-out and revive bars;
- the downed marker (REVIVE, or REVIVING with a progress bar under it);
- the scoreboard and the results list them (BOT tag);
- banners: "PARTNER <NAME> IS DOWN!", "... IS BACK UP", "... BLED OUT / BACK NEXT ROUND", and the partner's `callout` events.

## Code map

```
src/shared/defs/zombies.ts           tuning, formulas, perks / power-ups / box defs, ZM_ENTITY kinds, wire types
                                     (zombies.state, zombies.event, zombies.solo / zombies.coop RPCs), ZOMBIES_LOADOUT, XP
src/shared/maps/zombies/             one file per map: the Zombies layer (types.ts: wall-buys, box spots, perks,
  nuketown.ts firingrange.ts yard.ts zombie spawns, survivor spawns, time preset, optional barriers); index.ts registry
src/server/features/zombies/
  index.ts      Feature: registers the mode, the RPCs, the ally-bot hooks
  rules.ts      ModeRules: teams by role, no respawn, layer spawns, ends after game over
  game.ts       the round director, undead bodies (pooled bots on team 1), points, downs / revives / bleed-out,
                game over, state push, results.ext.zombies
  brain.ts      ZombieBrain (BotBrain) and the per-room Horde (targets, path budget)
  spawner.ts    zombie spawn picking (out of sight, 10-40 m from the nearest survivor)
  buy.ts        wall-buys, Perk-a-Colas, the Mystery Box (USE holds, the box timeline, the teddy bear)
  powerups.ts   drops, grabs, effects (the Nuke)
  ally.ts       AI allies ("partners"): AllyBrain (follow, fight, revive, buy, power-ups, callouts)
  state.ts      PlayerExt.zombies (survivor / undead) and the room events
src/client/features/zombies/
  index.ts      atmosphere: the layer's time preset, the hellhound fog
  store.ts      state, banners, point popups, stingers
  hud.ts        chalk tally (1-5) / round number, points, perks, power-up timers, prompts, downs, drink,
                game over; wraps of core widgets (killfeed, compass, minimap, streak ladder, XP popups,
                scoreboard, names, death screen, result title)
  props.ts      entity renderers: zm_wall (chalk gun + price), zm_perk (vending machine), zm_box, zm_boxspot,
                zm_powerup; textures
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
tests/zombies.integration.test.ts  real server: one-click solo, points over the wire, a wall-buy, game over, results,
                                   solo's default partner
tests/zombies.headshots.test.ts    BO1 head multipliers across guns, shots to kill, the pose inside the hitboxes (and
                                   the old lean outside), real-room head shots from five angles, head kill points /
                                   hitmarker part / killfeed headshot, crouched while rising
tests/zombies.ally.test.ts         partner option, round size, following, killing, reviving (time bound, swarm),
                                   being revived, buying Jug and a wall gun, game over with allies, HUD state
tests/zombies-helpers.ts           shared room set-up for the two above
```

### How it plugs in

- **Bodies are bots.** Zombies and hellhounds are core players (bots) on team 1, so every gun, grenade, the knife, the wonder weapons, hitboxes (headshots), lag compensation, hitmarkers and death events work on them unchanged. They carry no weapons (`weapons = []`), never regenerate (`regenDelayMultiplier`), move through `speedMultiplier` per gait (hellhounds run crouched: a low body), and are pooled (a corpse lies 2.5 s, then the body is reused). The bots feature attaches its soldier brain to every bot as it joins; the game drops that brain for its bodies (`getRoomBots(room).brains.delete`) and turns the room's bot count management off (`configureRoomBots(room, {}, { managed: false })`, core `botFill` 0), since either would trim the horde.
- **The brain** (`brain.ts`) knows where the survivors are (BO1 `find_flesh`), goes for the nearest one who is up, walks straight when close with a clear line, otherwise follows an A* path on the bots' nav grid (`navFor`) under a per-room budget (`PATH_SEARCHES_PER_TICK` 2, `PATH_EXPAND_PER_TICK` 16 000), re-planned every 1.5-2.5 s staggered, string-pulled every 0.3 s; it keeps a little space from the rest of the horde, hops and side-steps when stuck, and swipes (the swing shows as the FIRING flag in snapshots). A zombie that gets no closer to anyone for 30 s is put back in the queue (BO1 `round_spawn_failsafe`). Measured: 24 zombies on Nuketown average well under the 16.7 ms tick in the test.
- **Points** live in `player.ext.zombies` (`points`, `total`); `stats.score` mirrors the total for the core scoreboard. Point popups go to the player as `zombies.event { kind: 'points' }`.
- **Downs** reuse the Second Chance machinery (`perks/laststand.ts`): `enterLastStand(room, p, opts)` with Zombies' timer, `revivable`, `reviveSecFor` (Quick Revive halves it), `reviveScore: 0` and `onBleedOut`; `reviveFromLastStand(room, p, by)` for the solo Quick Revive. While down you hold your pistol (the Ray Gun if you have one, else a pistol, else a loaner M1911); your guns come back on revive. Zombies ignore downed players and damage to them is cancelled.
- **Double Tap** needs a fire-rate hook: core modifier `fireRateMultiplier` (combat `fire()` divides the shot interval by it), sent to the client as `me.params.fireRate` so the local trigger keeps up.
- **Progression**: `ModeDef.killXp` (10 a kill, +5 a headshot) replaces kill XP and skips medals, streak bonuses and weapon / attachment progress; each round survived pays `roundXp(round)` (`progression.xp`, line "ROUND SURVIVED") and reports `zombies_round` (`progression.metric`, aggregate max); revives pay 50. Challenges (`MODE_CHALLENGE_TEMPLATES.zombies`): Survivor (reach round 10 / 20 / 30), Undead Exterminator (kill 100 / 1000 / 5000 zombies), Brain Surgeon (100 / 500 / 2500 headshots), plus the generated per-mode ones.
- **Killcams**: bleed-outs and game-over deaths use `means: 'world'` with no attacker, and the match ends 8.5 s after the last kill, so neither the per-death nor the final killcam plays.
- **Wire**: `zombies.state` (round, phase, dog round, left, solo, players' points / perks / down state / stats, power-up timers, dog ids, solo Quick Revive lives, survived) on change and every second; `zombies.event` for announcer lines and popups. Entities: `zm_wall { w, p, a }`, `zm_perk { k, p, off? }`, `zm_box` (the killstreak box's `BoxSnap` plus `c` cost, `tc` lid closing, `ty` teddy), `zm_boxspot`, `zm_powerup { k, t0, te }`.

### Adding a map

1. Make `src/shared/maps/zombies/<map>.ts` (see nuketown.ts): `npx tsx scripts/zm-layout.ts <map> out.png` to see the walkable floor, `npx tsx scripts/zm-place.ts <map> wall:x,z[,n|s|e|w] perk:x,z free:x,z,yawDeg spawn:x,z` to snap spots.
2. Register it in `src/shared/maps/zombies/index.ts` and add `'zombies'` to the map's `modes` in `defs/maps.ts` (`withZombies`).
3. `tests/zombies.layers.test.ts` checks the spots.

## Visual check

Headless Chrome (muted). Headshots and partners: the gold headshot hitmarker and the head pop, the partner following and shooting, the partner reviving you (BEING REVIVED with the bar and its callout), you reviving the partner (the prompt with its bar), the HUD with the partner (row, perks, scoreboard, downed marker), and the Zombies screen's partner option. Earlier checks: round 1 with the tally, a horde coming, a wall-buy prompt, the box (idle, cycling, the Ray Gun offered), a Perk-a-Cola machine and the drink, power-ups on the ground, downed with Quick Revive, a hellhound round and the game-over card and results.

## Skipped / known limits

- **Barriers and Carpenter**: no boarded windows. The maps are open (zombies come from every side rather than through windows), so the layer type has an optional `barriers` list but no map uses it and the Carpenter is left out of the power-up cycle until one does.
- **No power switch, doors / debris, Pack-a-Punch, Fire Sale, Death Machine, Monkey Bombs, Bowie knife, PhD Flopper, Stamin-Up, Mule Kick.**
- **Zombie bodies are player-shaped**: hellhounds use the crouched hitbox (about 1.2 m tall); there are no crawlers, no limb gibs (a headshot kill pops the head, everything else topples like a soldier).
- **Hellhound heads**: dogs keep the crouched body box (1.2 m) and their drawn head is ahead of and below its head part, so a shot at a dog's head usually registers on the body.
- **The soldier's drawn head** pokes about 10 cm above the standing head box (a core model / hitbox mismatch, in multiplayer too); the zombie pose keeps the head inside the box horizontally.
- **AI allies** don't throw grenades, don't rebuild boards (no map has barriers yet; a barriers map needs a rebuild goal), and buy only Juggernog and Quick Revive. A buy trip that meets a zombie on the way is dropped and tried again later. With an idle human (nobody else shooting) a round-1 partner with the M1911 can go down reviving.
- **Zombies don't collide with each other or with players** (core movement has no body collision); they keep some space by steering.
- **Juggernog** follows the wiki's 250 (5 hits); the T5 script value is 160.
- **Box weapon pool** is every classable gun in Lo-Fi Ops plus the four wonder weapons, not BO1's per-map list.
- **Career stats** count zombie kills under `kills` and `mode.zombies.kills` (as BO1 kept zombies stats in the profile); career challenges that count kills (Killer) also count zombie kills.
- **Weapons viewmodel**: the mode hands the M1911 in place of the loadout guns; another area is fixing a bug where mode-forced weapons were not drawn (it showed in Infected). In our checks the M1911 viewmodel showed.
