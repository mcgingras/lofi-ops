# Modes (feature area: `modes`)

Team Deathmatch and Free-for-All polish, plus Domination, Search and Destroy, Headquarters and Kill Confirmed. Each mode has objective props in the world, HUD widgets and announcer lines, an end-of-match summary screen (with a final killcam), a per-death killcam ("see who killed you"), and objective hooks bots can use.

## What's in it

| mode | id | win | rules |
|---|---|---|---|
| Team Deathmatch | `tdm` | 75 kills, 10 min | +1 team score per enemy kill. A tie at the time limit is a draw (no overtime). |
| Free-for-All | `ffa` | 30 kills, 10 min | Kills count toward the limit. Score is 100 per kill. |
| Domination | `dom` | 200, 10 min | Flags A/B/C. You capture a neutral flag in 10 s. You must neutralise an enemy flag first (5 s), then capture it. Extra capturers add +50 % each, up to 2x. If both teams stand on a flag it is contested and progress stops. Partial progress fades over 8 s when nobody is on the flag. Each held flag gives 1 point every 5 s. Kills give player score only. |
| Search and Destroy | `sd` | first to 4 rounds | One life per round. A round runs 5 s prep (frozen, no damage), then 2:30 live, then a 45 s bomb timer once planted, then 5 s post. Plant: 5 s holding USE (F) in a site. Defuse: 7.5 s holding USE within 2 m of the bomb. You can't move while planting or defusing. Letting go, leaving or dying resets progress. The bomb starts on a random attacker. If the carrier dies it drops where they fell, and an attacker picks it up by walking over it. The detonation kills everyone within 10 m. Sides switch after round 3. Team 0 attacks first. |
| Headquarters | `hq` | 250, 10 min | One HQ at a time, rotating through the map's HQ points. The first comes online 5 s after the start, later ones 5 s after the previous one goes. Capturing takes 10 s. The owners then score 1 point/s for up to 60 s, and their dead do not respawn while it stands. Enemies destroy it in 10 s by standing in it with no defenders present. When the HQ is destroyed or expires, its dead defenders respawn. An unclaimed HQ moves after 60 s. |
| Kill Confirmed | `kc` | 65, 10 min | Every death drops the victim's dog tags. An enemy who grabs them confirms the kill (+1 team score and +150). A teammate who grabs them denies it (+100). Kills give only player score (100). Tags vanish after 60 s. |

All numbers live in `MODE_TUNING` and `MODE_XP` (`src/shared/defs/modes.ts`), so the HUD and the server agree. Change them there.

**Spawns.** For their first 4 s, team modes use each team's own spawns. After that a spawn is picked from every spawn point on the map:
- not within 10 m of a living enemy
- out of enemy sight within 32 m
- close to teammates

On top of that, each mode has its own preference:
- DOM leans towards flags you own and away from enemy ones.
- HQ keeps spawns 12 m or more from the HQ, but not across the map.
- S&D uses fixed sides. Attackers spawn on the side away from the sites; defenders spawn on the sites' side.

### Playing it

- Main menu: **Quick Play → Domination / Search and Destroy / Headquarters / Kill Confirmed** (menu items `modes.dom|sd|hq|kc`, orders 30–33).
- Rooms: `api.lobby.createRoom({ mode: 'sd', map: 'yard', ... })`, or `navigate('match', { mode: 'dom' })` from the client.
- The Yard supports all six modes. It has DOM flags, S&D sites A/B (`team: 1` = defended by team 1's spawn side) and six HQ points.

## Code map

```
src/shared/defs/modes.ts        ModeDefs (dom/sd/hq/kc added), MODE_TUNING, MODE_XP, OBJECTIVE_MODE_IDS
src/shared/defs/deathcam.ts     per-death killcam: DEATHCAM timing, deathcamWindow, DeathcamPayload,
                                packClip / unpackClip (quantised, delta-coded clip)
src/shared/defs/modestate.ts    wire types + FeatureMessages: modes.state, modes.event, modes.killcam, modes.deathcam;
                                MatchSummaryExt (results.ext.modes); MODE_ENTITY kinds
src/server/features/modes/
  index.ts      Feature: registers rules (setup), state push / killcam / summary (room)
  common.ts     controller registry, award/scoreKill/announce, spawn ranking, objective points
  zone.ts       capture-zone logic shared by DOM flags and the HQ
  tdm.ts dom.ts sd.ts hq.ts kc.ts   rules (ModeRules + ModeController)
  bots.ts       objective hooks for bots (objectivesFor / bestObjective)
  summary.ts    MVP + XP breakdown (progression adapter, else derived)
  killcam.ts    20 Hz pose history (+ health %, hitscan shots) + final kill clip
  deathcam.ts   per-death killcam: killer card, clip cut to the respawn, nearby players only, streak views
  ext.ts        PlayerExt.modes, events modes.roundStart / modes.roundEnd
src/client/features/modes/
  index.ts      menu items, wraps of core.scoreboard / core.phase / core.death
  store.ts      latest state, announcer banner/feed/popups, results, killcam clip
  text.ts       team-relative announcer wording (pure)
  hud.ts        widgets: modes.waypoints 6, modes.panel 52, modes.progress 62, modes.popups 63,
                modes.announcer 72, modes.spectate 81
  props.ts      entity renderers: modes.flag, modes.bomb, modes.hq, modes.tag (+ texture recipes
                modes.white, modes.cloth, modes.bomb)
  sounds.ts     sfx: modes.good / bad / horn / alarm / pickup / beep / boom
  killcam.ts    final killcam playback (+ killcam-math.ts, pure); HUD widget modes.killcam 95
  deathcam.ts   per-death killcam playback (+ deathcam-math.ts, pure): killer's eyes + viewmodel, shots,
                streak views, skip; HUD widget modes.deathcam 94 (KILLCAM banner, timer, killer card)
  replay.ts     stand-in soldiers shared by both killcams
  summary.ts    summary overlay screen `modes.summary` (+ summary-data.ts, pure; modes.css)
tests/modes.test.ts              rules for every mode, summary, killcam, objective points, bot hooks
tests/modes.integration.test.ts  DOM capture, S&D plant over the wire + summary, KC tags (real server)
tests/modes.client.test.ts       announcer wording, summary view model, killcam timeline
tests/deathcam.test.ts           per-death killcam server side: victim only, cut to respawn, none for suicide/fall/world,
                                 S&D full clip, streak view, nearby filter; window maths and clip codec
tests/deathcam.client.test.ts    per-death killcam timeline (beat, play, cut at respawn), timer, aim, card text
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
- `modes.killcam` is sent once at match end, when the match ended within 8 s of a credited kill. It carries poses at 20 Hz for the 3.5 s up to the kill (each pose now also carries the player's health %, which the final killcam ignores).
- `modes.deathcam` (`DeathcamPayload`, `src/shared/defs/deathcam.ts`) goes **only to the victim**, `postSec` (0.5 s) after a kill by an enemy player. It is never sent for suicides, falls, out of bounds or world deaths, to bots, or once the match has ended (the final killcam takes over). Fields: `killer`, `victim`, `weapon`, `means`, `headshot`, `at` (kill, room time), `playAt` (= at + 1 s death view), `respawnAt`, `card` (`KillerCard`: name, level, prestige, weapon, attachments, health / maxHealth at the kill, streak), `view` (`eyes` | `streak` | `none`), `cam` (streak view: camera position or `top`), `vm` (the gun in the killer's hands: id, attachments, camo, suppressed) and `clip` (`PackedClip`: frame times in ms from `t0`, players as indices into `ids`, positions in cm and angles in mrad delta-coded per player, flags, health %, and hitscan shots `[ms, index, end cm xyz, hit]`).

## Per-death killcam

BO1 / MW2 behaviour (Call of Duty Wiki, "KillCam"; BO1 and MW2 reference screenshots): after you are killed the game shows your death from the killer's perspective, through their optic; the action button skips it, and if you can respawn, skipping does so, otherwise you go to spectating; killstreak kills are followed from the air support or dogs; the HUD has translucent red bands with "KILLCAM" and a timer at the top and the killer's playercard ("Killed By", emblem, rank, name) with their weapon at the bottom, plus a "Respawn"/skip prompt. BO1 also shows the killer's injuries as the red damage tint.

Here:
- **When.** A human killed by an enemy player sees the normal death view for 1 s (`DEATHCAM.beatSec`), then the replay at 1x, ending 0.5 s after the kill. Room-time anchored: a clip that arrives late starts part-way.
- **Respawn never gets later.** The server cuts the clip to fit between the death view and the respawn (`deathcamWindow`): TDM's 3 s respawn leaves 2 s of replay (1.5 s before the kill, 0.5 s after); with less than 1 s of room there is no replay, only the killer card on the death screen. The server still respawns you at `respawnAt` as before, which ends the replay. No respawn (S&D, an HQ that still stands) gets the full 4 s, then the death view / spectating as before.
- **Skip.** F (the `use` key, or gamepad X / Square) skips back to the death screen and its respawn countdown.
- **View.** First person from the killer's recorded pose (crouch eye height, ADS zoom of their weapon and attachments; scoped ADS hides the gun). The killer's gun is the viewmodel (their camo and attachments), kicking and flashing on their recorded hitscan shots with gunshots, tracers and impacts (blood on hits); a melee kill swings the knife. Other nearby players are stand-in soldiers with tracers and positional gunshots. The killer's health tints the screen.
- **Killstreak kills** (`isStreakWeapon`): watched from the killer's helicopter, chopper gunner, sentry, dog or RC-XD entity at the kill, or from the blast for others; strikes and crates (`TOP_DOWN_STREAKS`: napalm, rolling thunder, mortar, care package, valkyrie) from high above the victim. No viewmodel.
- **Bandwidth.** Only players within 40 m of the killer or the victim at the kill (max 10), quantised and delta coded: a 4 s clip of six moving players is ~10 KB of JSON, sent to one player once per death.

## Known limits / next steps

- **Final killcam.** It replays poses only: no tracers or gunshots, no third-person killer model, no viewmodel (the per-death killcam has those; the final clip doesn't carry shots or the killer's weapon yet).
- **Per-death killcam.** Stand-ins carry the default rifle (remote weapon models are only dressed on live remotes); grenades, launchers and other non-hitscan kills are seen from the killer's eyes without following the projectile; no scope overlay when the killer is scoped (the gun is hidden); streak views use a fixed camera at the streak's position at the kill. Live gunfire and entities in the real match keep playing (sounds included) underneath the replay. Hardcore has no killcam in BO1; there is no hardcore playlist yet, so nothing turns it off.
- **No bot brains here.** Bots stand still until the bots feature uses the hooks above. A solo human in S&D with an empty enemy team plays rounds that end on time (an empty team cannot be eliminated).
- **No objective sounds for the bomb carrier on the defender side** (by design, defenders aren't told who carries).
- **Flaky core test under load.** `tests/playtest.client.test.ts`' lag-compensation control shot is timing sensitive. On a heavily loaded machine (10 parallel agents) it occasionally hits when it should miss. It passes when run alone.
