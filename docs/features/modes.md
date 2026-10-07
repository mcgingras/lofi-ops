# Modes (feature area: `modes`)

Team Deathmatch and Free-for-All polish, plus Domination, Search and Destroy, Headquarters and Kill Confirmed. Each mode has objective props in the world, HUD widgets and announcer lines, an end-of-match summary screen (with a final killcam), and objective hooks bots can use.

## What's in it

| mode | id | win | rules |
|---|---|---|---|
| Team Deathmatch | `tdm` | 75 kills, 10 min | +1 team score per enemy kill. A tie at the time limit is a draw (no overtime). |
| Free-for-All | `ffa` | 30 kills, 10 min | Kills count toward the limit. Score is 100 per kill. |
| Domination | `dom` | 200, 10 min | Flags A/B/C. You capture a neutral flag in 10 s. You must neutralise an enemy flag first (5 s), then capture it. Extra capturers add +50 % each, up to 2x. If both teams stand on a flag it is contested and progress stops. Partial progress fades over 8 s when nobody is on the flag. Each held flag gives 1 point every 5 s. Kills give player score only. |
| Search and Destroy | `sd` | first to 4 rounds | One life per round. A round runs 5 s prep (frozen, no damage), then 2:30 live, then a 45 s bomb timer once planted, then 5 s post. Plant: 5 s holding USE (F) in a site. Defuse: 7.5 s holding USE within 2 m of the bomb. You can't move while planting or defusing. Letting go, leaving or dying resets progress. The bomb starts on a random attacker. If the carrier dies it drops where they fell, and an attacker picks it up by walking over it. The detonation kills everyone within 10 m. Sides switch after round 3. Team 0 attacks first. Where plant/defuse is possible USE belongs to it (`useClaimed`, `SdRules.canUseObjective`): weapon pickups stand aside; dropped guns are cleared each round. |
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
src/shared/defs/modestate.ts    wire types + FeatureMessages: modes.state, modes.event, modes.killcam;
                                MatchSummaryExt (results.ext.modes); MODE_ENTITY kinds
src/server/features/modes/
  index.ts      Feature: registers rules (setup), state push / killcam / summary (room)
  common.ts     controller registry, award/scoreKill/announce, spawn ranking, objective points
  zone.ts       capture-zone logic shared by DOM flags and the HQ
  tdm.ts dom.ts sd.ts hq.ts kc.ts   rules (ModeRules + ModeController)
  bots.ts       objective hooks for bots (objectivesFor / bestObjective)
  summary.ts    MVP + XP breakdown (progression adapter, else derived)
  killcam.ts    20 Hz pose history + final kill clip
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
  summary.ts    summary overlay screen `modes.summary` (+ summary-data.ts, pure; modes.css)
tests/modes.test.ts              rules for every mode, summary, killcam, objective points, bot hooks
tests/modes.integration.test.ts  DOM capture, S&D plant over the wire + summary, KC tags (real server)
tests/modes.client.test.ts       announcer wording, summary view model, killcam timeline
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
  - `core.death` shows "respawn when your HQ falls" in HQ.
- A match hook copies `me.respawnAt` into `match.death.respawnAt` when a respawn is granted after death (an HQ falling).

### Wire

- `modes.state` is pushed to each human every 0.25 s and on change. It is team-relative: the S&D bomb carrier is only sent to attackers, and pickup/drop announcements only go to attackers.
- World props are snapshot entities. Their `s` fields:
  - `modes.flag`: `{ id, r, o, c, ct, x }` (owner / cap / capTeam / contested)
  - `modes.hq`: the same fields plus `st`
  - `modes.bomb`: `{ st, site, end }`
  - `modes.tag`: `team` = the victim's team
- `modes.killcam` is sent once at match end, when the match ended within 8 s of a credited kill. It carries poses at 20 Hz for the 3.5 s up to the kill.

## Known limits / next steps

- **Final killcam.** It replays poses only: no tracers or gunshots, no third-person killer model. It shows only the match-ending kill, not per-death killcams.
- **No bot brains here.** Bots stand still until the bots feature uses the hooks above. A solo human in S&D with an empty enemy team plays rounds that end on time (an empty team cannot be eliminated).
- **No objective sounds for the bomb carrier on the defender side** (by design, defenders aren't told who carries).
- **Flaky core test under load.** `tests/playtest.client.test.ts`' lag-compensation control shot is timing sensitive. On a heavily loaded machine (10 parallel agents) it occasionally hits when it should miss. It passes when run alone.
