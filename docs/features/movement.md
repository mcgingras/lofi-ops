# Movement: mantling and prone

Two BO1 movement features on top of the shared player movement (`src/shared/movement.ts`): **mantling** (press jump at a ledge, window sill or low wall to climb onto it or vault over it) and **prone** (lie down and crawl, including BO1's dolphin dive). Both are part of `stepMove` and `MoveState`, so the server, client prediction and bots run exactly the same code and agree on every number. Contracts: CONTRACTS.md sections 6, 12 and 13.

## Reference values (BO1 / MW2)

Sources: decompiled engine code. KisakBlack is BO1 (`github.com/SwagSoftware/KisakBlack`, `src/bgame/bg_mantle.cpp`, `bg_pmove.cpp`, `bg_dtp.cpp`, `bg_misc.cpp`, `bg_perks.cpp`). KisakCOD is CoD4, which has the same mantle code. iw4L (`github.com/vladtrc/iw4L`, `crates/movement_iw4`) is MW2. Mantle animation lengths come from the CoD4 mod tools xanims (`github.com/promod/CoD4-Mod-Tools/tree/master/raw/xanim`); BO1 uses the same animation names. Weapon spread comes from CoD4/MW2 weapon files (`ak47_mp`), because no BO1 weapon files were found. The Call of Duty Wiki covers Dive to Prone, Lightweight, Marathon and Steady Aim. 1 unit = 1 inch = 0.0254 m.

| | BO1 / IW engine | Here |
|---|---|---|
| Mantle ledge height | 18–60 units above the feet (0.46–1.52 m), probed at 60/40/20 | above step height (0.45 m), at most **1.5 m above the floor** in front of the obstacle (`MANTLE.maxHeight`) |
| Mantle reach | `mantle_check_range` 20 units (0.51 m) to the wall | the face within 0.4 m of the front of the body (`MANTLE.reach`) |
| Trigger | jump held, standing (not crouched or prone), on the ground or in the air | the same, plus forward held |
| Climb time | up anims 21→0.30 s, 39→0.67 s, 57→0.83 s; a vault adds 0.4–0.7 s | 0.3 s + 0.3 s per metre risen + 0.2 s per metre forward (a 1 m sill ≈ 0.75 s, 1.45 m ≈ 0.85 s) |
| Up / over | "over" only on surfaces marked for it, landing 0.79 m past the ledge | depth at the top ≤ 0.5 m (`MANTLE.thin`) vaults over, deeper obstacles are climbed onto |
| Weapon while mantling | CoD4/MW2: down except for the lowest mantles; BO1: up for mantles ≤ 0.99 m | always down (as specified for this game) |
| Prone eye / box | eye 11 units (0.28 m), box 30 (0.76 m) | eye **0.4 m**, box **0.55 m** (`PLAYER.proneEye`, `proneHeight`) |
| Stance times | stand→crouch 200 ms, crouch→prone 400 ms, and the same back | stand/crouch→prone **0.6 s**, prone→stand **0.8 s**, prone→crouch **0.45 s** (`PRONE.downSec`, `upSec`, `toCrouchSec`) |
| Prone speed | `PM_CmdScaleForStance` prone 0.15, crouch 0.65 | crawl **×0.27** of walk (1.35 m/s), as specified (×0.25–0.30); crouch unchanged ×0.55 |
| Prone + ADS | non-sniper ADS while prone zeroes movement | ADS (past half) while prone stops the crawl (every weapon) |
| Sprint / jump from prone | no sprint; jump stands up (falls back to crouch with no headroom); sprint stands up into a sprint | the same |
| Crouch while prone | goes to crouch | the same |
| Hip spread | AK47 stand 3–7°, crouched 2.5–6°, prone 2–5° | ×**0.65** fully prone (`PRONE.spread`); crouch unchanged |
| Sway | `idleProneFactor` 0.4 | scope sway ×**0.4** fully prone (`PRONE.sway`); slower, smaller viewmodel look sway |
| Recoil | no prone-specific view kick in the weapon files | view kick ×0.6 fully prone, as specified (`PRONE.recoil`) |
| Prone look | `bg_prone_yawcap` 45°, the body turns at 55°/s | no cap (see Gaps) |
| Dolphin dive | prone while sprinting (≥ 250 ms), launch 12.7 m/s up capped at +0.99 m for 0.4 s, the sprint speed carries over, ≤ 300 ms slide, 1.5 s cooldown, no firing | prone (or crouch) while sprinting on the ground: the sprint speed (at least 7.2 m/s) carries over, 5 m/s up (0.6 m arc), a slide braking at 15 m/s², 0.9 s with the weapon down; about 5 m in all |
| Perks | Lightweight ×1.07 in every stance; Marathon Pro (MW2) fast mantle; no perk changes prone | Lightweight already scales every stance through `speedMultiplier`; no fast mantle |

## Mantle

`findMantle` (movement.ts) runs while jump is held, forward is held and the body is standing (not crouched, prone, diving or mid stance change), on the ground or in the air:

1. Candidates are the player-colliding solids along the facing, within 0.4 m of the front of the body. A candidate's top must be above step height (0.05 m above the feet in the air) and at most `MANTLE.maxHeight` above the floor in front of it. In the air, "the floor" is the ground under the player. A jump therefore never adds reach: anything out of reach from the ground stays out of reach.
2. **Never climbed:** invisible player clips (`Solid.clip`: noRender, players only), and brushes tagged `perimeter`, `roof`, `clip` or `glass`. Clips also block the path (below), so a perimeter clip above a low wall stops the vault too.
3. For each top, lowest first:
   - there must be room to rise in place, up to the ledge plus `MANTLE.clearance` (1.0 m);
   - the path across the top must be free at that height for the full clearance;
   - a top no deeper than 0.5 m along the facing is **vaulted**: the climb ends just past it, in the air, at ledge height, and you drop down the far side. A crouched body must fit there. If it doesn't (a desk right under a window), you climb onto the sill instead;
   - a deeper top is **climbed onto**: the climb ends with the whole footprint on top, standing, or crouched if only a crouch fits.

   The swept checks are exact (the footprint swept against each box grown by the radius), so diagonal approaches into window jambs fail cleanly.
4. The climb is `MoveState.mantle = { t, dur, from, to, over }`. The body rises straight up, then moves across, eased. Input is ignored, collision doesn't run (the path was checked when the climb started) and the weapon is down (`moveBusy`). A vault ends with a 2.5 m/s push off the far side. `copyMoveState` deep-copies the mantle, so replays and reconciliation are exact.

Windows: an opening needs at least 1.0 m above the sill (a Nuketown window, 1.2 m over a 0.95 m sill, works; a 0.9 m slot doesn't). Glass that is modelled as a clip (Estate) blocks the vault.

Feel on the client: the camera follows the predicted body, which rises and moves smoothly, so there's no extra camera animation. The viewmodel dips (down 0.2 m, tilted) over the climb. Remotes get `PlayerFlags.MANTLE`, and the soldier reaches up, leans in and pulls a knee up.

Bots: nav has no mantle links. Bots press jump at nav jump links (crates and ledges up to 0.98 m) and when stuck. With mantling, the jump-link climbs become mantles onto the same ledge, which is where the path expects them. Bots didn't get stuck in any bot test, simulation or map bot run.

RC-XD and attack dogs borrow player movement: `MoveParams.canMantle: false` and `canProne: false`.

## Prone

State: `MoveState.prone` (lying, or on the way down; a prone body is also `crouched`, so code that only knows crouch keeps it low), `proneT` (0 up → 1 down; drives eye height, hitboxes and the weapon), `proneHeld` (edge detection) and `dive`.

- **Down:** a *fresh* PRONE press on the ground, if there's room for the legs. The legs trail up to 1.6 m behind the eye and are checked from step height up, so ramps and steps pass under them. If the press is refused it doesn't fire later. The client toggles let go of a refused prone after 0.3 s.
- **Up:** releasing PRONE stands up if there's headroom, crouches if only a crouch fits, and otherwise stays down. Crouch held goes to crouch. Jump stands up (never jumps). Sprint (keys/L3, not while aiming) stands up into the sprint.
- **Speed:** crawl ×0.27 of walk during the transition and lying down; no sprint; no crawling while aiming.
- **Weapon down:** `moveBusy(s)` is true mid-mantle, mid-dive, and until the stance transition is within 15% of done (going down or getting up). The server refuses shots with `reason: 'stance'`, and the client doesn't send them.
- **Leg collision:** crawling, the legs stop at walls (boxes, not ramps). Turning in place is not stopped (see Gaps).
- **Movement box:** 0.55 m tall, the same 0.6 m footprint. You can crawl under anything higher than 0.55 m.

**Hitboxes** (`playerHitboxes(p, stance, yaw)`, `PRONE_BODY` in collision.ts): lying along the facing. The head (0.14–0.46 m up) is at the movement position, where the eye is. The torso runs 0.14–0.8 m behind and the legs 0.8–1.6 m behind. The boxes are turned boxes; `rayHitboxes` tests them exactly in the body's frame, and the world AABBs (`hb.head` etc.) bound them for code that needs boxes. Standing and crouched boxes are unchanged, and the old boolean argument still works. The pose stance (`stanceOf`) is prone once `proneT ≥ 0.5`.

Netcode and the rest of the server:
- Lag compensation (`HitboxHistory` poses) stores `prone` and `yaw` (yaw is interpolated) and rewinds the stance the shooter saw.
- Snapshots and killcam frames carry `PlayerFlags.PRONE` (256) and `MANTLE` (512) via `stanceFlags(move)`.
- Grenades, tomahawks, bolts and blades hit the lying hitboxes (`moveHitboxes`).
- Blast line-of-sight checks a prone body's back (0.33 m), not crouched chest height, so cover protects you.
- The knife reaches a prone body.

Bots see a prone target's real points: chest = the back behind the head, head = the head box, eye = 0.4 m (`bots/sight.ts`). A bot's shot at that chest lands. Bots holding a spot with a sniper rifle sometimes lie down and stay put (they stand to move or jump).

Client:
- **Camera:** eye height eases through `eyeHeight(state)`.
- **Viewmodel:** sits lower, with a slow, wide crawl bob while moving and slower, smaller look sway. It dips out of the way while going down or getting up.
- **Spread and recoil:** the crosshair spread includes the prone bonus, and the recoil kick is ×0.6.
- **Scope:** sway ×0.4.
- **Remotes:** soldiers lay down over 0.6 s and stand over 0.8 s, matching the body. The rig's `lie` group tips the body forward so the head lands at the player's position with the legs behind. They crawl with knees drawn up one side at a time. A soldier who dies lying down goes limp instead of toppling.
- **Aim assist:** prone targets are a 0.5 m column.
- **Killcam and deathcam:** use the prone eye; replays ease the pose.

## Controls

| | Keyboard | Controller |
|---|---|---|
| Prone | **Z** toggles: down, then up again. Toggling against the body means Z while prone stands, otherwise lies down | **B held** 0.35 s |
| From prone to crouch | C / Ctrl | B tap |
| Stand up | Z, Space (no jump until Space is released), Shift (sprint) | A (no jump until released), L3 (sprint) |
| Dolphin dive | C, Ctrl or Z while sprinting | B while sprinting |
| Mantle | Space with W held, at a ledge or window | A with the stick forward |

Held keys still go out as `Buttons` bits: `CROUCH` (held = crouched; the toggle setting is client-side) and `PRONE` (held = prone, latched by the toggles). `Controls.stanceHint` is set by the match each frame from the predicted body (sprinting, on the ground, prone). It is what makes crouch-while-sprinting a dive, and what lets a refused prone go after `STANCE_SYNC_SEC`. Scoped, Shift / L3 is hold breath and doesn't stand you up.

## Maps

Every map's walk flood mantles now. `tests/maps-mw2-walk.ts` does a running jump that mantles, holds jump in the air, and makes a standing mantle against whatever blocks the walk. The maps' own flood copies press jump into the obstacle too. `tests/maps-traps.test.ts` also mantles.

An audit (flood with and without mantling from both team spawns, clustering the newly reached high ground) found **no escapes on any map**. New high ground was reviewed case by case:

- **Clipped** (not reachable before, and not meant to be):
  - **Firing Range:** the sandbagged shed's roof by the Tower. Dropping off it behind the shed also led into a pit between the shed and the hill that `maps-traps` caught.
  - **Hijacked:** the cabana bar's roof (reached via its counter and bottle shelves) and the shower block's roof.
  - **Jungle:** every hut roof. Their solid eaves tier is a flat slab under the drawn tiers, so one mantle put you on an invisible flat roof.
  - **Highrise:** the south building's east window, which opens onto the void past the walkway's end. You could jump out of it to your death.
  Each clip is a players-only `clip` (tag `roof`), so bullets and sight pass and nothing is climbed onto it.
- **Allowed, as CoD allows them:**
  - crates, pallets, desks and counters (also the Terminal shop counters on the upper level);
  - cars, AC units, tanks, low walls, sandbags and rocks;
  - containers on Rust and Launch, the engines on Scrapyard, ammo crates on Afghan;
  - Terminal: the plane's wing ("crates to the wing", MW3 tips) and its seats;
  - Estate: log piles and rocks;
  - balcony and stair railings: you vault them, or stand on top.
- **Allowed, extensions of high ground that was already reachable (step ≤ 1.5 m):**
  - Summit: the Cable Car station roof (5.0 m) from its wing roof (3.6 m);
  - Launch: the two-door shed roof (4.75 m) from the red-roofed store next to it;
  - Nuketown: the green garage roof from the upstairs side window. The yellow garage roof was already reachable before mantling, by jumping out of its window.
  - Hanoi: the upstairs windows over the street can be vaulted (a drop to the street). The out-of-bounds roofs stay clipped.

The mantle height (1.5 m) was kept at the BO1 limit: no map needed it lower.

## Tests

- `tests/movement-mantle.test.ts` (pure):
  - climbing onto a crate; timing, rise-then-forward, weapon down;
  - vaulting through a window, including a Nuketown-sized one; too-low windows;
  - thin versus deep walls; the height limit, with a plain jump above it;
  - step-height ledges; forward required;
  - perimeter clips, plain clips and drawn railings;
  - headroom; catching a ledge in the air without extra reach;
  - determinism and deep copies, a Predictor replay through a mantle, sub-step independence.
- `tests/movement-prone.test.ts` (pure):
  - BO1 timings, eye and box heights, the weapon down while transitioning;
  - crawl speed with no sprint;
  - jump stands up; crouch from prone; the fresh-press rule;
  - headroom (stays prone, falls back to crouch, crawls under a 0.7 m gap);
  - the leg room check and leg collision; the dolphin dive; the spread bonus;
  - lying hitboxes hit and missed from front, side and above, turned exactly; the old boolean boxes.
- `tests/prone.integration.test.ts` (Room):
  - a prone target missed at standing chest height and hit in the legs;
  - lag compensation rewinding to the lying pose after the target stood (and a miss at the present);
  - shots refused while going prone;
  - bots' aim points inside the lying body, with a hit;
  - stance bits in killcam frames.
- `tests/movement.client.test.ts` (real server):
  - keyboard Z / C / Space / dive (pure `Controls`), and a refused prone letting go;
  - keyboard Z through `Controls` → `MatchNet` → server;
  - controller B hold → prone, B tap → crouch, A → stand, L3 + B → dive, with prediction agreeing;
  - a second client seeing the PRONE flag, and its `Remotes` soldier lying down (`lie` rotation), plus the server history's lying pose with yaw.
- `tests/maps-mantle.test.ts`:
  - mantling through a Highrise office window both ways and a Nuketown front window;
  - mantle floods on Yard and Hijacked staying in bounds.

## Files

- **Core:**
  - `shared/movement.ts`: mantle, prone, dive, `moveBusy`, `stanceOf`, `moveHitboxes`, `movePose`, `legsClear`.
  - `shared/constants.ts`: `PLAYER.proneHeight`, `proneEye`, `MOVE.prone`, `PRONE`, `MANTLE`.
  - `shared/collision.ts`: `Solid.clip` / `tag`, prone hitboxes, `poseStance`, `poseHitboxes`, widened `free` / `groundBelow` parameter types.
  - `shared/maps/types.ts`: `mapSolids` sets `clip` and `tag`.
  - `shared/ballistics.ts`: `stanceSpread`; `isLowerTorso` takes a stance.
  - `shared/protocol.ts`: `PlayerFlags.PRONE` / `MANTLE`, `stanceFlags`.
  - `server/lagcomp.ts`: `Pose.prone` / `yaw`.
  - `server/room.ts`: history poses, snapshot flags.
  - `server/combat.ts`: shots refused while busy, stance spread and hitboxes, blast chest height.
  - `client/game/controls.ts`, `pad.ts`: stance toggles, dive, sync.
  - `client/game/match.ts`: stance hint, firing gate, spread / recoil, viewmodel pose, remote hit tests, aim assist targets.
  - `client/game/remotes.ts`, `viewmodel.ts`, `aim-assist.ts`.
  - `client/render/models/soldier.ts`: the `lie` group, prone and mantle poses.
- **Features:**
  - bots: `sight.ts`, `brain.ts`;
  - weapons: `equipment.ts`, `melee.ts`, client `scope.ts`;
  - economy: `projectiles.ts`;
  - modes: server `killcam.ts`; client `killcam.ts`, `deathcam.ts`, `deathcam-math.ts`, `replay.ts`;
  - killstreaks: `dogs.ts` and `vehicles.ts` (one params line each).
- **Maps:** `firingrange.ts`, `hijacked.ts`, `jungle.ts`, `highrise.ts` (clips).

## Knockback

`MoveState.knock` and `applyKnock(move, impulse, sec)` (shared `movement.ts`): a velocity impulse from the server (the Thundergun's launch, docs/features/weapons.md) that takes control away for `sec`. While knocked the body keeps its velocity (no input acceleration, no jump, sprint or mantle; gravity as usual); once grounded it slides to a stop at `KNOCK.slide` (16 m/s²) and control comes back early when it is slower than `KNOCK.settle` (1.2 m/s), or when the time runs out. A knock cancels a mantle or a dive. The snapshot carries `knock` and the velocities, so the owner's `Predictor` replays the same flight: the first snapshot that carries a launch corrects the prediction (the client couldn't know), later ones agree (`tests/knockback.test.ts`, also over real sockets).

## Gaps

- **No prone yaw cap:** BO1 caps prone yaw at 45° with a 55°/s body turn. Turning in place while prone can swing the legs through a wall; crawling into one is stopped.
- **Weapon-agnostic rules:** BO1 lets sniper scopes crawl while aiming; here ADS stops the crawl for every weapon (`MoveParams` doesn't know the weapon). BO1 keeps the weapon up for mantles of 0.99 m or less; here the weapon is always down while mantling, as specified.
- **Partial dive rules:** the dive has no 1.5 s cooldown and no 250 ms sprint start-up, and no fall damage exists in the game.
- **Mantle direction:** it uses the view's facing, not the surface normal (BO1 needs the view within 60° of the normal and caps the view yaw during the climb).
- **Bots:** nav has no mantle links (bots don't plan routes through windows), and bots don't dive.
- **Prone heights:** the eye (0.4 m) and box (0.55 m) follow this game's spec, not BO1's 0.28 m / 0.76 m.
- **Crouch spread:** BO1 lerps spread by eye height, so crouching also tightens it; here only fully prone does.
