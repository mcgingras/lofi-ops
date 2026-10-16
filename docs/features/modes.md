# Modes (feature area: `modes`)

Team Deathmatch and Free-for-All polish, plus Domination, Search and Destroy, Headquarters, Kill Confirmed and Infected (MW3's party mode). Each mode has objective props in the world, HUD widgets and announcer lines, an end-of-match summary screen (with a final killcam), a per-death killcam ("see who killed you"), and objective hooks bots can use.

## What's in it

| mode | id | win | rules |
|---|---|---|---|
| Team Deathmatch | `tdm` | 75 kills, 10 min | +1 team score per enemy kill. A tie at the time limit is a draw (no overtime). |
| Free-for-All | `ffa` | 30 kills, 10 min | Kills count toward the limit. Score is 100 per kill. |
| Domination | `dom` | 200, 10 min | Flags A/B/C. You capture a neutral flag in 10 s. You must neutralise an enemy flag first (5 s), then capture it. Extra capturers add +50 % each, up to 2x. If both teams stand on a flag it is contested and progress stops. Partial progress fades over 8 s when nobody is on the flag. Each held flag gives 1 point every 5 s. Kills give player score only. |
| Search and Destroy | `sd` | first to 4 rounds | One life per round. A round runs 5 s prep (frozen, no damage), then 2:30 live, then a 45 s bomb timer once planted, then 5 s post. Plant: 5 s holding USE (F) in a site. Defuse: 7.5 s holding USE within 2 m of the bomb. You can't move while planting or defusing. Letting go, leaving or dying resets progress. The bomb starts on a random attacker. If the carrier dies it drops where they fell, and an attacker picks it up by walking over it. The detonation kills everyone within 10 m. Sides switch after round 3. Team 0 attacks first. Where plant/defuse is possible USE belongs to it (`useClaimed`, `SdRules.canUseObjective`): weapon pickups stand aside; dropped guns are cleared each round. |
| Headquarters | `hq` | 250, 10 min | One HQ at a time, rotating through the map's HQ points. The first comes online 5 s after the start, later ones 5 s after the previous one goes. Capturing takes 10 s. The owners then score 1 point/s for up to 60 s, and their dead do not respawn while it stands. Enemies destroy it in 10 s by standing in it with no defenders present. When the HQ is destroyed or expires, its dead defenders respawn. An unclaimed HQ moves after 60 s. |
| Kill Confirmed | `kc` | 65, 10 min | Every death drops the victim's dog tags. An enemy who grabs them confirms the kill (+1 team score and +150). A teammate who grabs them denies it (+100). Kills give only player score (100). Tags vanish after 60 s. |
| Infected | `infected` | no score limit, 10 min | Everyone starts a Survivor. 9 s in, a random player becomes the First Infected. Every Survivor who dies comes back Infected. The Infected win when nobody is left to infect; the Survivors win if one of them is alive at the time limit. See "Infected" below. |

All numbers live in `MODE_TUNING` and `MODE_XP` (`src/shared/defs/modes.ts`), so the HUD and the server agree. Change them there.

## Infected

Rules from the Call of Duty Wiki's MW3 "Infected" section (MediaWiki API, page `Infected_(gamemode)`), adapted. Data: `src/shared/defs/infected.ts` (`INFECTED`, `INFECTED_XP`, the loadouts). Rules: `src/server/features/modes/infected.ts`. Bots: `infected-bots.ts`.

- **Teams by role.**
  - Team 0 is the Survivors and team 1 the Infected (`ModeDef.teamsByRules`, `teamNames: ['Survivors', 'Infected']`).
  - The rules own the teams. Bot and lobby balancing leave them alone, and the rules re-assert a player's team from their role at every spawn.
  - Late joiners join the Infected once the infection has started (MW3).
- **Start.**
  - Everyone starts a Survivor.
  - After `firstSec` (9 s, MW3's countdown) a random living player becomes the First Infected where they stand.
  - The pick needs `minPlayers` (2). A lone player waits ("WAITING FOR PLAYERS").
  - Deaths before the pick respawn as Survivors.
- **Converting.** After the pick, any Survivor death makes them Infected at once: a kill by an Infected, a fall, leaving the map. The team switch goes out in the roster, and they respawn Infected after the normal 3 s.
- **Loadouts.** Forced in `beforeSpawn` at priority -60, after progression's gate, the frontend's trim and the economy's check.
  - Survivors: SPAS-12 and M1911, Scavenger and Steady Aim, no grenades or streaks, double reserve. MW3 gave a shotgun, a pistol and Scavenger.
  - Infected: the knife alone in hand (`WeaponDef` `knife`: the melee lunge, one hit) and one retrievable tomahawk, Lightweight and Marathon, and a x1.04 speed boost. MW3 gave a tactical knife, a throwing knife, Extreme Conditioning and Lightweight/Juiced.
  - First Infected: keeps the Survivor guns and gets the tomahawk and the Infected perks. MW3: "uses the current Survivor loadout" with the throwing knife.
  - While they are the only Infected, the First Infected also wears body armour: half damage, like the Juggernaut suit of MW3's Striker-vs-Jugg variant.
  - When a second player is infected, the First Infected drops to the knife where they stand.
- **Last one standing.**
  - The last Survivor gets "LAST ONE STANDING": an RPK with an extended magazine in place of the pistol, a full magazine, and a radar showing every Infected.
  - The Infected see the last Survivor in a 3 s radar sweep every 30 s. This is Ghosts' last-survivor sweep; MW3's page lists no last-survivor bonus.
- **Scoring.**
  - Kills, headshots and assists score as usual.
  - Infected: +100 per infection.
  - Every living Survivor: +50 when another Survivor is infected (MW3's "Survivor" points), and +50 every 30 s alive.
  - The last Survivor: +100.
  - At the time limit, each living Survivor gets +200 (OUTLASTED). A lone last Survivor also gets +500 (FINAL STAND).
  - Team scores carry the live counts `[Survivors, Infected]`.
- **Winning.**
  - Nobody left to infect: the Infected win (reason `score`). Everybody is Infected by then, so everybody wins, as in MW3.
  - Time limit with a Survivor alive: the Survivors win (reason `time`). The rules decide it a tick before core's own check, so the end awards land while the match is still playing.
  - The time limit is the room's (`room.mode.timeLimitSec`): 10 min by default. MW3 used 5.
- **Disconnects.**
  - Every Infected left: a new First Infected is picked after `repickSec` (4 s, "ALL INFECTED LEFT").
  - Down to one Infected after a leave: that one is the First Infected again, guns back in hand (MW3).
  - The last Survivor leaving ends the match for the Infected.
- **Spawns.**
  - Survivors spawn anywhere safe: all spawn points, ranked by `spawns.ts`.
  - Infected get the hard rules (never within 12 m of a Survivor or in their sight) and the usual scoring. When there is a choice, they spawn no further than about 28 m from the nearest Survivor.
- **HUD.**
  - `modes.infected` (order 53): a role badge, "N SURVIVORS · N INFECTED", the "INFECTION IN 7" countdown, and lines for the First Infected, the last Survivor and the radar sweep.
  - The score corner (`core.score` wrap) shows the clock and the two counts as bars.
  - Holding the knife, `core.ammo` shows KNIFE and the lunge key, and `core.status` drops "NO AMMO".
  - Announcer: "YOU ARE INFECTED", "FIRST INFECTED", "<NAME> IS INFECTED", "LAST ONE STANDING", "ONE SURVIVOR LEFT", "FINAL STAND", "ALL INFECTED LEFT", and "SURVIVOR +50" popups.
  - The scoreboard and the summary say Survivors / Infected. The summary words the end as "Everyone was infected" or "The survivors outlasted the infection".
- **Look.** Infected soldiers are tinted a sickly green: their body's look materials are multiplied by `(0.62, 0.95, 0.42)` (the gun or knife in their hands keeps its colours: `isWornMaterial`). A green "INFECTED" tag floats over the ones you can see within 40 m. Your own knife viewmodel has a green glove. Remote Infected hold a third-person combat knife (`WORLD_ONLY.knife` in `client/features/weapons/worldmodels.ts`: blade raised out of the fist, worn at x1.6 so it reads at range); the kit's knife is a first-person prop and showed as a sliver.
- **Viewmodel.** The first-person gun is whatever the server's snapshot says you hold (`heldWeapon(me.weapons, slot)` in `client/game/slots.ts`, falling back to the primary when the slot you ask for no longer exists), so the mode's forced classes show without any mode code: the SPAS-12 and M1911 as a Survivor, the RPK as the last one standing, the knife once infected. `tests/infected-viewmodel.client.test.ts` drives a real Room and reads the snapshots a human receives.
- **Bots** (`infected-bots.ts`, through `registerBotGoal('infected')` and `registerBotStyle('infected')`):
  - Infected hunt the nearest Survivor the team knows about, sprinting, at priority 0.95. The team knows a Survivor's position when any Infected sees them (bots' sight rules), when they fire unsuppressed, and from the last-Survivor sweep. A spot reached with nobody there is forgotten.
  - With no lead, Infected search the places the team hasn't looked at for longest, nearer ones first.
  - Infected style: melee-happy rushers. They knife-lunge up close and never back off to "reload" a knife. They lob the tomahawk at a Survivor in sight 6-18 m away: on half the chances, every 5-8 s, with a scatter from their aim error. Out of tomahawks, they pick theirs up when it lies within 20 m.
  - Survivors spread out before the pick. After it they group at a shared rally point and hold it; the brain's hold behaviour watches the angles. A rally point is a reachable spot with walls around it, near the other Survivors and away from the Infected.
  - The rally point moves when an Infected gets within 8 m of it, at most every 10 s.
  - In a fight Survivors kite: they never close in, and they back away from anyone inside 4 m.
  - Balance from bot-only sims (8 regular bots, 6 maps, 2 seeds each): the Infected win in 40 s to 6 min, about 100 s on average. Humans hold out much longer than bots.
- **Progression.**
  - Objective kinds: `infected.infect` (100 XP, INFECTED), `infected.survive` (50, SURVIVOR), `infected.last_alive` (100, LAST ONE STANDING), `infected.outlast` (200, OUTLASTED), `infected.final_stand` (500, FINAL STAND). `infected.first` and `infected.countdown` pay nothing.
  - Challenges: Patient Zero (infect 10 / 50 / 250 / 1000 Survivors), Last One Standing (survive to the end as the last one 1 / 5 / 25 times), Outbreak Survivor (still a Survivor at the end of 3 / 15 / 50 matches), Contagious (melee kills), plus the generated wins / kills / matches / MVP.
- **Maps.** Every map with TDM or FFA spawns. The Yard and the MW2 maps list `infected` in `MapDef.modes`; the BO maps take every mode.
- **Frontend.** The Quick Play playlist `infected` (category `party`), the private lobby's mode list, the core menu's Quick Play entry (`modes.infected`, order 34), and lobby bot fill (`DEFAULT_TARGET_PLAYERS.infected` = 12).


**Spawns.** For their first 4 s, team modes use each team's own spawns. After that a spawn is picked from every spawn point on the map:
- not within 10 m of a living enemy
- out of enemy sight within 32 m
- close to teammates

On top of that, each mode has its own preference:
- DOM leans towards flags you own and away from enemy ones.
- HQ keeps spawns 12 m or more from the HQ, but not across the map.
- S&D uses fixed sides. Attackers spawn on the side away from the sites; defenders spawn on the sites' side.

### Playing it

- Main menu: **Quick Play → Domination / Search and Destroy / Headquarters / Kill Confirmed / Infected** (menu items `modes.dom|sd|hq|kc|infected`, orders 30–34).
- Rooms: `api.lobby.createRoom({ mode: 'sd', map: 'yard', ... })`, or `navigate('match', { mode: 'dom' })` from the client.
- The Yard supports all seven modes. It has DOM flags, S&D sites A/B (`team: 1` = defended by team 1's spawn side) and six HQ points.

## Code map

```
src/shared/defs/modes.ts        ModeDefs (dom/sd/hq/kc/infected added; teamsByRules, teamNames), MODE_TUNING, MODE_XP,
                                OBJECTIVE_MODE_IDS, teamNamesFor
src/shared/defs/infected.ts     Infected tuning (INFECTED, INFECTED_XP), loadouts, InfectedStatePayload
src/shared/defs/deathcam.ts     per-death killcam: DEATHCAM timing, deathcamWindow, DeathcamPayload,
                                packClip / unpackClip (quantised, delta-coded clip + gear, frost, teams,
                                projectiles), gearKey / parseGear
src/shared/defs/killcam.ts      final killcam: FINAL_KILLCAM (BO1 timing), finalTimeline (slow motion),
                                finalClock, FinalKillcamPayload
src/shared/defs/modestate.ts    wire types + FeatureMessages: modes.state, modes.event, modes.killcam, modes.deathcam;
                                MatchSummaryExt (results.ext.modes); MODE_ENTITY kinds
src/server/features/modes/
  index.ts      Feature: registers rules (setup), state push / killcam / summary (room)
  common.ts     controller registry, award/scoreKill/announce, spawn ranking, objective points
  zone.ts       capture-zone logic shared by DOM flags and the HQ
  tdm.ts dom.ts sd.ts hq.ts kc.ts infected.ts   rules (ModeRules + ModeController)
  infected-bots.ts  Infected bot goals (hunt / search / rally), per-bot style, team intel
  bots.ts       objective hooks for bots (objectivesFor / bestObjective)
  summary.ts    MVP + XP breakdown (progression adapter, else derived)
  killcam.ts    20 Hz pose history (+ health %, gear, frost, projectiles, hitscan shots), kill captures,
                final killcam choice (pickFinalKill) and clip (buildFinalClip)
  deathcam.ts   per-death killcam: killer card, clip cut to the respawn, nearby players only, streak views;
                describe(kill) = the card / viewmodel / streak camera both killcams use
  ext.ts        PlayerExt.modes, events modes.roundStart / modes.roundEnd
src/client/features/modes/
  index.ts      menu items, wraps of core.scoreboard / core.phase / core.death
  store.ts      latest state, announcer banner/feed/popups, results, killcam clip
  text.ts       team-relative announcer wording (pure)
  hud.ts        widgets: modes.waypoints 6, modes.panel 52, modes.progress 62, modes.popups 63,
                modes.announcer 72, modes.spectate 81
  infected.ts   Infected HUD (modes.infected 53, modes.infected.tags 7), core.score/ammo/status wraps,
                green soldiers, knife viewmodel, menu entry
  props.ts      entity renderers: modes.flag, modes.bomb, modes.hq, modes.tag (+ texture recipes
                modes.white, modes.cloth, modes.bomb)
  sounds.ts     sfx: modes.good / bad / horn / alarm / pickup / beep / boom (synth fallbacks; recordings and radio cues in shared/defs/sfx-recipes.ts: good/bad/horn/alarm are short radio pips, no air horn or klaxon; pickup is a dog-tag clink)
  killcam.ts    final / S&D round killcam playback: BO1 slow motion, fades, banner, winner, card;
                HUD widget modes.killcam 95
  deathcam.ts   per-death killcam playback (+ deathcam-math.ts, pure): timeline, skip; HUD widget
                modes.deathcam 94 (KILLCAM banner, timer, killer card; band/drawCard shared)
  replay-view.ts the replay renderer both killcams use (camera, viewmodel, ADS/scope, shots, sounds,
                projectiles, streak views, live audio ducked)
  replay.ts     stand-in soldiers shared by both killcams (real weapons, Infected look, frost, flung/shattered)
  killcam-math.ts pure: spline pose interpolation, replayGun, killProjectile, deathEffects
  summary.ts    summary overlay screen `modes.summary` (+ summary-data.ts, pure; modes.css)
tests/modes.test.ts              rules for every mode, summary, killcam, objective points, bot hooks
tests/modes.integration.test.ts  DOM capture, S&D plant over the wire + summary, KC tags (real server)
tests/modes.client.test.ts       announcer wording, summary view model, killcam timeline
tests/deathcam.test.ts           per-death killcam server side: victim only, cut to respawn, none for suicide/fall/world,
                                 S&D full clip, streak view, nearby filter; window maths and clip codec
tests/deathcam.client.test.ts    per-death killcam timeline (beat, play, cut at respawn), timer, aim, card text
tests/finalkillcam.test.ts       final killcam: kill choice per mode (TDM, FFA, DOM, S&D, KC, Infected, Gun Game),
                                 Nuke, clip contents, spawn trim, leavers, S&D round killcam, post-match wait,
                                 timeline and codec, bandwidth
tests/finalkillcam.client.test.ts  clock, spline interpolation, respawn jump, leavers held, killer's gun from a
                                 real clip, projectile follow, Thundergun / Winter's Howl deaths, winner line
tests/finalkillcam.integration.test.ts  TDM ended by a shot over real sockets: clip with killer, weapon, shots
tests/infected.test.ts           Infected rules: pick and countdown, conversion, loadouts, First Infected bonus, last
                                 Survivor, wins, disconnects, spawns, XP/challenges, listing, quick play and private lobbies
tests/infected.integration.test.ts  Infected over real sockets: first infected, infection, last survivor, the end
tests/infected.bots.test.ts      Infected bots: hunting on three maps, the tomahawk lob, bot-only matches keep moving,
                                 Survivors holding a rally point
tests/infected.client.test.ts    Infected announcer wording, summary team names and end reasons
```

## Integration notes for other areas

### Bots: objective hooks (`src/server/features/modes/bots.ts`)

These hooks are pull-based and need no registration. Call them from the brain every few hundred ms:

```ts
import { bestObjective, objectivesFor, hasObjectives } from '../modes/bots';
const goal = bestObjective(room, self);   // null in TDM/FFA/wager modes, while dead, outside 'playing'
if (goal && rng() < skill.objectivePlay) {
  // walk to goal.pos; when within goal.radius:
  //   goal.holdUse -> hold Buttons.USE (S&D plant/defuse; progress resets if released)
  //   goal.stay    -> keep standing inside until it completes (captures)
}
```

The goal kinds are:
- `capture` (DOM flag, neutral HQ)
- `destroy` (enemy HQ)
- `defend` (your flag or HQ, a bomb site, or the planted bomb when you are attacking)
- `pickup` (dropped bomb, attackers only)
- `plant` (the carrier, one entry per site; the preferred site has priority 1)
- `defuse` (defenders while the bomb is planted)
- `escort` (attackers follow the carrier)
- `collect` (KC tags within 40 m; enemy tags rank higher than your own)

`priority` runs 0..1. `bestObjective` weighs priority against distance. Bots plant and defuse by holding the `USE` bit in the command their brain returns, exactly as humans do. Bots in S&D play one life, the same as humans.

S&D joins: a bot or human who joins during prep spawns for that round. If the round started with no attackers, the first attacker to arrive gets the bomb. Anyone who joins later waits for the next round.

### Progression / challenges

- Every objective action emits the core `objective` event: `{ kind, team, player, data: { obj?, reason?, points? } }`. The kinds are the `ModeEventKind` values in `modestate.ts`:
  - `dom.capture`, `dom.neutralize`, `dom.defend`
  - `sd.plant`, `sd.defuse`, `sd.explode`, `sd.pickup`, `sd.drop`, `sd.round_start`, `sd.round_end`, `sd.halftime`, `sd.last_alive`
  - `hq.online`, `hq.capture`, `hq.destroy`, `hq.expire`, `hq.move`, `hq.defend`
  - `kc.confirm`, `kc.deny`
  - `infected.first`, `infected.infect` (player = the infector or null, reason = the victim), `infected.survive`, `infected.last_alive`, `infected.outlast`, `infected.final_stand`, `infected.countdown`
- Use these events for per-mode challenges.
- The S&D room events `modes.roundStart { round, attackers, carrier }` and `modes.roundEnd { round, winner, reason }` are declared in `src/server/features/modes/ext.ts`.
- Per-player tallies are kept in `player.ext.modes`:
  - `stats`: captures, neutralizes, defends, plants, defuses, destroys, confirms, denies
  - `xp`: player score per reason (kill, headshot, assist, capture, plant, ...)
- **matchSummary.** The summary (`results.ext.modes`, written in a `matchEnd` handler at priority -10, so after yours) prefers XP lines from `results.ext.progression.players[playerId | profileId].breakdown | xp` (an array of `{ label, amount | xp }`). If progression publishes that, the summary screen shows its numbers (`xpSource: 'progression'`). Otherwise it derives the lines from the tallies plus the match bonus in `XP_SOURCES` (time played, victory).

### Frontend / lobby

- **Leave button.** The summary screen's Leave goes to a screen with id `lobby` if one is registered, otherwise to `menu`.
- **Summary overlay.** The summary opens as an overlay (`openOverlay('modes.summary')`) after the final killcam (or right away if there is none), once per match. It closes when the room's phase leaves `ended` (next match, or back to `lobby`).
- **Pointer lock.** The summary releases pointer lock.
- **Lobby defaults.** `DEFAULT_TARGET_PLAYERS` in `defs/bots.ts` already lists dom/sd/hq/kc.
- **Mode-specific spawns.** A lobby that calls `room.setMode()` gets the new rules, including their spawns.

### Maps (maps-bo, maps-mw2)

- To support a mode, add its id to `MapDef.modes`. Also add objective points in `MapData.objectives`:
  - `dom`: three points, `A`, `B`, `C`, radius about 3.
  - `sd`: two sites, `A` and `B`, radius about 2.5. Give each site `team: <spawn index of the defenders>`. Attackers use the other team's spawns.
  - `hq`: 4 to 8 points.
- Maps without these points still work. `objectivePoints()` derives them from the spawn centroids and hotspots, then snaps each one to free ground:
  - DOM: points near each team's spawns plus the middle.
  - S&D: two sites on team 1's half.
  - HQ: the hotspots.
- `tests/modes.test.ts` checks that every authored objective point of the Yard is free standing ground. Add your map id to that loop.

### Core touch points (minimal)

Infected (outside the modes folders):
- `src/server/features/bots/hooks.ts`: `registerBotStyle(modeId, fn)` / `botStyleFor(room, bot)` (per-bot style on top of the mode's) and two optional `BotModeStyle` flags, `kite` and `throwAtRange`; `api.ts` re-exports `registerBotStyle`.
- `src/server/features/bots/brain.ts`: reads `botStyleFor` instead of `botModeStyle`; a melee-happy bot with nothing to shoot goes in instead of backing off to cover; `kite`; `throwAtRange` (the lob, its own cooldown, `pitchBias` on the output pitch during the wind-up). Aim, perception and spawns are untouched.
- `src/server/features/bots/roster.ts`: no team balancing when `room.mode.teamsByRules`.
- `src/shared/defs/bots.ts`: `DEFAULT_TARGET_PLAYERS.infected = 12`.
- `src/shared/frontend/playlists.ts`: the `infected` playlist (category `party`).
- `src/shared/defs/maps.ts`: `infected` on the Yard and the MW2 maps.
- `src/shared/defs/progression.ts`: Infected objective aliases, XP, labels; `src/shared/defs/challenges.ts`: `MODE_CHALLENGE_TEMPLATES.infected`.
- `src/client/hud/widgets.ts`: the scoreboard headers use `teamNamesFor(mode)`.

Earlier modes:

- `src/shared/maps/yard.ts`: added `objectives.sd` and `objectives.hq`.
- `src/shared/defs/maps.ts`: the Yard's `modes` now lists `dom`, `sd`, `hq` and `kc`.
- No edits to `room.ts`, `combat.ts`, `protocol.ts` or `events.ts`. Everything goes through mode rules, the bus, modifiers (S&D freeze: `speedMultiplier`/`sprintMultiplier` 0 during prep and while planting or defusing), entities, feature messages and client registries.
- Client: re-registered three core HUD widget ids, with the same orders, as thin wrappers that delegate to the core draw:
  - `core.scoreboard` and `core.phase` are hidden during the final killcam and while the summary is open.
  - `core.death` steps aside while the per-death killcam plays.
  - `core.death` shows "respawn when your HQ falls" in HQ.
- A match hook copies `me.respawnAt` into `match.death.respawnAt` when a respawn is granted after death (an HQ falling).

### Wire

- `modes.state` is pushed to each human every 0.25 s and on change. It is team-relative: the S&D bomb carrier is only sent to attackers, and pickup/drop announcements only go to attackers.
- World props are snapshot entities. Their `s` fields:
  - `modes.flag`: `{ id, r, o, c, ct, x }` (owner / cap / capTeam / contested)
  - `modes.hq`: the same fields plus `st`
  - `modes.bomb`: `{ st, site, end }`
  - `modes.tag`: `team` = the victim's team
- `modes.killcam` (`FinalKillcamPayload`, `src/shared/defs/killcam.ts`) goes to everyone once at match end when a kill qualifies (see "Final killcam"), and in S&D at the end of a non-final round (`round` set). Fields: `killer`, `victim`, `weapon`, `means`, `headshot`, `at` (kill), `to` (= at + 2 s, the replay's end), `card`, `vname` (victim's name), `view` (`eyes` | `streak`), `cam`, `vm`, `clip` (`PackedClip`, as the deathcam's, from max(kill - 5 s, the killer's spawn) to the match end) and `endsAt` (the post-match / post-round end after the server's wait, or null).
- `PackedClip` optional fields (both killcams): `w` gear table (`weaponId|camo|attachments`) + `g` changes `[ms, player, gear]`, `x` frost changes `[ms, player, %]`, `tm` team per player at the kill, `pk` / `pj` / `pe` projectiles (string table; `[entity, kind, owner, sub]`; positions `[ms, entity, x, y, z cm]`). A 7 s clip of 12 moving players is ~37 KB of JSON (6 players ~20 KB).
- `modes.deathcam` (`DeathcamPayload`, `src/shared/defs/deathcam.ts`) goes **only to the victim**, `postSec` (0.5 s) after a kill by an enemy player. It is never sent for suicides, falls, out of bounds or world deaths, to bots, or once the match has ended (the final killcam takes over). Fields: `killer`, `victim`, `weapon`, `means`, `headshot`, `at` (kill, room time), `playAt` (= at + 1 s death view), `respawnAt`, `card` (`KillerCard`: name, level, prestige, weapon, attachments, health / maxHealth at the kill, streak), `view` (`eyes` | `streak` | `none`), `cam` (streak view: camera position or `top`), `vm` (the gun in the killer's hands: id, attachments, camo, suppressed) and `clip` (`PackedClip`: frame times in ms from `t0`, players as indices into `ids`, positions in cm and angles in mrad delta-coded per player, flags, health %, and hitscan shots `[ms, index, end cm xyz, hit]`).

## Final killcam

BO1 behaviour (T5 scripts, `maps/mp/gametypes/_killcam.gsc` and `_globallogic_player.gsc`, plutoniummod/t5-scripts; Call of Duty Wiki, "KillCam"):
- `finalKillcam()` replays 5 s before the death (`calcKillcamTime` with no respawn) and 2 s after (`calcPostDelay`).
- `waitFinalKillcamSlowdown()`: `SetTimeScale(0.25, deathTime - 500)`, back to 1.0 half a second after a 3 s wait that began 2 s before the death: 0.25x from 0.5 s before the kill to 1.5 s after.
- Not skippable: the final killcam threads no `waitSkipKillcamButton` (the per-death one does).
- Which kill: a death checks `game["state"]` after its 0.25 + 1.75 s death delay and, if the game is over, calls `startFinalKillcam`: the kill that ended the match, or one within ~2 s of the end. A time-out or objective end with no such kill has none (S&D's elimination ends call `startLastKillcam`, which is the eliminating kill). It plays after every round in round modes (`postRoundFinalKillcam` is a post-round event; match flag `round_end_killcam` vs `final_killcam`). The wiki adds that MW3 (and BO2) show the last kill by the winning team.
- The Nuke: no final killcam (MW2).

Here:
- **Which kill.** Every enemy kill opens a capture (5 s before, frames keep coming for 2 s after). TDM, FFA, DOM, S&D, HQ and the wagers use BO1's rule: the latest kill if it came at most 2 s (`FINAL_KILLCAM.recentSec`) before the end. Kill Confirmed and Infected (MW3 modes, `WINNING_TEAM_KILLCAM_MODES`) show the winning team's last kill however long ago. The Nuke skips it. The killcams' death handler runs at bus priority 100, ahead of the mode rules (the kill that reaches the limit ends the match inside the rules' handler; before, the final killcam showed the kill before it).
- **S&D rounds.** A round that ends on (or within 2 s of) a kill gets a ROUND KILLCAM; the last round's is the FINAL KILLCAM.
- **Waiting for it.** The post-match (or S&D post-round) is extended by the killcam's length (~13 s for a full clip), so the summary keeps its full time; not in rooms without humans or with a post-match under 5 s (test rooms).
- **Playback** (replay-view.ts, shared with the per-death killcam): the killer's eyes, eye height eased through crouch / prone, their real gun (what they held at that moment, camo and attachments), ADS zoom and the scope overlay when scoped, kick, flash, tracers, impacts and gunshots from the recorded shots (wonder weapons through `shotFxs`), stand-ins holding their own weapons (Infected tinted, frost, Thundergun flings, shatters), projectiles drawn with the weapons feature's models and followed for grenade / launcher / thrown kills, streak kills from the streak camera.
- **Presentation.** Fade in from black (0.35 s), 1x then 0.25x around the kill (0.2 s ramps), the body falls in slow motion, fade to black (0.5 s), 0.4 s black, then the summary fades in. Red bands: "FINAL KILLCAM", who won ("BLACK OPS WIN · VICTORY"), a timer, and the killer's card ("KILLED <VICTIM>"). The player's own HUD (crosshair, ammo, killfeed, XP and CoD Points popups) is hidden. Live game audio is muted (`sfx.duckLive(0)`) and the replay's sounds play on their own bus, pitched down with the slow motion. Not skippable (BO1).
- **Robustness.** Poses are a Catmull-Rom spline through the 20 Hz frames; a jump of more than 3 m between frames (a respawn) is not interpolated, and the clip starts at the killer's spawn if it came inside the window. A killer or victim who left keeps their last pose; the card and victim name come from the kill.

## Per-death killcam

BO1 / MW2 behaviour (Call of Duty Wiki, "KillCam"; BO1 and MW2 reference screenshots): after you are killed the game shows your death from the killer's perspective, through their optic; the action button skips it, and if you can respawn, skipping does so, otherwise you go to spectating; killstreak kills are followed from the air support or dogs; the HUD has translucent red bands with "KILLCAM" and a timer at the top and the killer's playercard ("Killed By", emblem, rank, name) with their weapon at the bottom, plus a "Respawn"/skip prompt. BO1 also shows the killer's injuries as the red damage tint.

Here:
- **When.** A human killed by an enemy player sees the normal death view for 1 s (`DEATHCAM.beatSec`), then the replay at 1x, ending 0.5 s after the kill. Room-time anchored: a clip that arrives late starts part-way.
- **Respawn never gets later.** The server cuts the clip to fit between the death view and the respawn (`deathcamWindow`): TDM's 3 s respawn leaves 2 s of replay (1.5 s before the kill, 0.5 s after); with less than 1 s of room there is no replay, only the killer card on the death screen. The server still respawns you at `respawnAt` as before, which ends the replay. No respawn (S&D, an HQ that still stands) gets the full 4 s, then the death view / spectating as before.
- **Skip.** F (the `use` key, or gamepad X / Square) skips back to the death screen and its respawn countdown.
- **View.** The shared replay renderer (see "Final killcam" above): first person from the killer's recorded pose with their real gun, ADS and the scope overlay, shots, grenade kills following the projectile, stand-ins holding their real weapons. A melee kill swings the knife. The killer's health tints the screen. The live game is ducked to 20 %.
- **Killstreak kills** (`isStreakWeapon`): watched from the killer's helicopter, chopper gunner, sentry, dog or RC-XD entity at the kill, or from the blast for others; strikes and crates (`TOP_DOWN_STREAKS`: napalm, rolling thunder, mortar, care package, valkyrie) from high above the victim. No viewmodel.
- **Bandwidth.** Only players within 40 m of the killer or the victim at the kill (max 10), quantised and delta coded: a 4 s clip of six moving players is ~10 KB of JSON, sent to one player once per death.

## Known limits / next steps

- **Killcams.** Streak views use a fixed camera at the streak's position at the kill (no recorded helicopter / dog path). Live entities (helicopters, fires, other features' props) are not part of the clip and show as they are now. Shots are hitscan traces; muzzle flashes of others come from the stand-ins' FIRING flag. Effects (tracers, puffs) run at real speed in slow motion. Grenade kills follow the recorded projectile but the throw itself isn't animated. Stand-ins wear no uniform camo. The CoD Points popup (`economy.award`) is hidden while the final killcam plays and its timer runs out under it. Hardcore has no killcam in BO1; there is no hardcore playlist yet, so nothing turns it off.
- **No bot brains here.** Bots stand still until the bots feature uses the hooks above. A solo human in S&D with an empty enemy team plays rounds that end on time (an empty team cannot be eliminated).
- **No objective sounds for the bomb carrier on the defender side** (by design, defenders aren't told who carries).
- **Infected.** No Tactical Insertion, death zones or Juggernaut variants. Remote Infected show no knife in their hands (the weapons feature has no third-person knife model). Bot-only matches lean to the Infected (about 100 s on average with 8 regular bots). Infected bots know where Survivors are only by sight, gunfire and the last-Survivor sweep, then search; a silent human camper can hold out until they reach the spot.
- **Flaky core test under load.** `tests/playtest.client.test.ts`' lag-compensation control shot is timing sensitive. On a heavily loaded machine (10 parallel agents) it occasionally hits when it should miss. It passes when run alone.
