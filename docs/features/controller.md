# Controller (Gamepad API)

Full controller play in the BO1/MW2 console layout, light aim assist, controller prompts and menu navigation. Everything is client-side: the controller produces the same `Buttons` bits and view angles as the keyboard and mouse, so prediction, netcode, killstreaks, pickups and modes need no changes, and the server has no idea which device you use. Contracts: CONTRACTS.md section 12, "Controller".

Tested against the Gamepad API "standard" mapping (Chrome, a USB Xbox-style pad on macOS). Glyphs are Xbox names.

## Layout

| Control | Action |
|---|---|
| Left stick | Move (8-way, full walk speed past the threshold) |
| Right stick | Look |
| LT | Aim down sights |
| RT | Fire (analog: on at 40%, off below 30%); throws the Care Package marker while it is up; fires the Valkyrie launcher, and detonates its rocket in flight |
| LB | Tactical; boosts a Valkyrie rocket while held (BO1's boost is the tactical button) |
| RB | Lethal (hold to raise, release to throw; a frag cooks while held; like G) |
| A | Jump. Held at a ledge, window sill or low wall with the stick forward: mantle (climb onto it or vault over it). From crouch or prone: stands up instead |
| B | Tap: crouch toggle (prone -> crouch). Hold 0.35 s: prone. While sprinting: dolphin dive (lands prone) |
| X | Reload on press, and USE while held (crates, weapon swap, plant/defuse, revive). When a "HOLD [X]" prompt is up (crate, weapon on the floor, plant/defuse): tap = reload on release, hold = use |
| Y | Switch weapon (primary <-> secondary); on the death screen: change class |
| L3 | Sprint, CoD style: click to sprint, it stops when you stop pushing forward, aim, fire or crouch. From prone it stands you up into the sprint. Held while scoped: hold breath (you stay down) |
| R3 | Melee |
| D-pad up | Killstreak (STREAK) |
| D-pad left / right | Cycle ready killstreaks |
| D-pad down | Underbarrel attachment toggle (grenade launcher slot); scoped with a variable-zoom scope: cycle zoom |
| Start | Pause (and resume from the pause menu) |
| Back / View | Scoreboard (held) |

The same table is on Settings → Controller (`PAD_LAYOUT` in `src/client/game/pad.ts`).

Tactical map (killstreak radio): left stick / D-pad move the cursor, right stick X rotates, A marks, X undoes, B cancels.

Valkyrie rocket cam: right stick steers (the rocket turns at its own rate, 60 deg/s, slower when boosted; the view can't lead its nose by more than 0.45 rad), RT detonates, hold LB to boost (LT works too). While steering, the pad's LB / LT go out as the boost bit and RB / R3 do nothing, so the soldier left standing doesn't throw a grenade or knife. No aim assist while steering.

## Prone and mantling on the pad

- **Prone:** B hold latches prone. The `PRONE` bit stays on until B is tapped, A is pressed or L3 sprints. A B tap from prone goes to crouch.
- **Dive:** B pressed while sprinting on the ground latches prone at once, and the movement turns it into the dive.
- **The body's state:** the mapper gets the predicted body through `MapperContext.sprinting` / `prone` (from `Controls.stanceHint`). If the body refused to go prone (no room for the legs), the latch lets go after 0.3 s, so it doesn't drop you later.
- **Mantling:** nothing extra; press A with the stick forward at a ledge.
- Rules and numbers: docs/features/movement.md.

## Movement: why it stays digital

`InputCmd` carries only button bits plus yaw/pitch, and `movement.ts` turns FORWARD/BACK/LEFT/RIGHT into a normalised wish direction at a single speed (walk 5.0 m/s, sprint, crouch and ADS multipliers). There is no analog speed or direction in the protocol, so adding one would change the server movement rules and the wire format. Instead:

- The left stick picks one of 8 directions. Cardinal sectors are 50° wide and diagonals 40°, so a slightly off-centre push still walks straight; a 6° hysteresis keeps a stick on a boundary from flickering.
- Movement starts past 0.30 deflection and stops below 0.22 (hysteresis). Any push past the threshold walks at full walk speed, which is how BO1/MW2 felt on a stick anyway (there is no slow-walk in this movement model). Sprint is L3.
- Pulse-width tricks (toggling FORWARD to fake half speed) were rejected: ground acceleration is 70 m/s², so it would visibly stutter.

If analog movement is wanted later, the clean way is an optional `move: [x, z]` on `InputCmd` that `stepMove` uses when present (both sides share `movement.ts`).

## Look

`stickLook()` in `pad.ts`:
- Radial deadzone (setting, default 0.13), outer deadzone at 0.95 so a cheap stick's diagonal reaches full speed.
- Response curve: magnitude^2.0 (fine aim near the centre).
- Max yaw rate = 40 + 28 × sensitivity deg/s (sensitivity 5 = 180°/s); pitch at 0.66× yaw.
- Edge ramp: pinned sideways at the edge for 0.12 s, yaw speeds up to 1.6× over 0.3 s (CoD's turn boost). Not vertical.
- ADS: the controller look scale is the mouse ADS scale divided by the current zoom (iron sights about 0.65× at default ADS sensitivity, a 4× scope about 0.19×). Stun and nuke slow-downs that features apply to `controls.lookScale` carry over.

## Aim assist

`src/client/game/aim-assist.ts`, a pure function: view angles, the stick's look delta, the move stick, the target list and dt in, adjusted angles out. The match applies it to the controller look only.

| | Light (default) | Standard |
|---|---|---|
| Slowdown over/near an enemy | 25% | 35% |
| Rotational follow (fraction of the target's relative angular motion) | 25% | 40% |
| Rotational cap | 0.12 rad/s (6.9°/s) | 0.22 rad/s (12.6°/s) |
| ADS snap | none | none |

Why these numbers ("nothing crazy, but something might be nice"):
- **Slowdown** is the help that matters most on a stick (it stops you overshooting a target) and gives nothing away: it only slows your own input. 25% is at the low end of what CoD-era games used.
- **Zone**: the target's body (a 0.3 m half-width column from shins to head) plus a cone of `atan(0.45 m / distance)`, clamped to 0.8°..6°, fading smoothly to nothing at its edge. Up close the zone is generous, at range it shrinks to roughly the body, so it scales with distance and target size. Max range 60 m.
- **Rotational** only follows *relative motion* while you are moving (left stick past 0.3): the target's strafe and yours. It never pulls towards the target, so a target that isn't moving relative to you gets no rotation at all: no snap, no magnetism. It eases in (rate 10/s) and decays fast (25/s: under 5% within 0.15 s), and the cap is low enough that it can't track a strafing enemy by itself (a 5 m/s strafe at 8 m is ~36°/s; Light follows at most 6.9°/s).
- **ADS snap**: none (`AIM_ASSIST.adsSnap = 0`). It's the part that feels like the game playing for you.

Targets: alive enemies from the interpolated soldiers, velocity from their smoothed positions, with world line of sight (`CollisionWorld.lineOfSight(…, 'sight')`, so see-through fences don't block and walls do) to the chest or head, and no registered sight blocker (`registerSightBlocker`: there is no smoke grenade in the game yet; a future one should register here). Teammates and the dead never count.

Never for mouse/keyboard: it runs only on the controller look delta and also checks the last-used device. Moving the mouse switches the device (and the prompts) back to keyboard/mouse.

Settings → Controller: Off / Light / Standard. Private lobbies: the host's **Aim assist allowed** rule (on by default; matchmade lobbies always allow it). The rule is honoured by the client (there is nothing server-side to enforce: the assist is local view smoothing).

Debug overlay: add `?aimdebug=1` to the URL: device, strength, slowdown, rotation speed, target and a ring round the crosshair while slowed.

## Prompts and device switching

- Last-used device (`inputDevice()` in `game/gamepad.ts`): any pad button or a stick past 0.3 switches to the pad; a key, mouse button, wheel or real mouse travel (6 px within 250 ms) switches back. `<body data-input>` follows it.
- `promptKey(action)` in `game/prompts.ts` is the one place prompts get key labels: "HOLD F" → "HOLD [X]", "[4] NAPALM" → "[↑] NAPALM", "[5] NEXT" → "[→] NEXT", "PRESS [F] TO SKIP" → "PRESS [X] TO SKIP", "PRESS R TO RELOAD" → "PRESS [X] TO RELOAD", the class hint ("PRESS [Y] TO CHANGE CLASS"), the tomahawk ([RB]), scope zoom ([↓]), the streak driving hint ([RT]), the Care Package marker ("[RT] THROW MARKER  [↑] PUT AWAY") and the Valkyrie ("[RT] FIRE ROCKET  [↑] PUT AWAY"; in flight "[RT] DETONATE", "[LB] BOOST"). The HUD draws ↑ ↓ ← → as pixel glyphs.

## Menus

`src/client/menus/padnav.ts`: a focus ring over the existing DOM menus (main menu, lobby incl. Ready and the host settings, Create a Class, Settings, Store, Barracks, the in-match class picker, pause menu and post-match summary).
- D-pad / left stick: spatial navigation (nearest focusable in that direction, with repeat when held). Sliders: left/right change the value. Selects: left/right change the option when there's nothing on that side to move to; A steps to the next option.
- A: activate. B: back (a visible `[data-pad-back]` element, else the Escape key the screens already handle; resume from the pause menu). LB/RB: switch tabs. Start: resume.
- Match screen: the deploy banner reads "Press A to deploy" on a pad and any pad press engages (no pointer lock needed); Start pauses; the pause menu opens with Resume focused; B or Start resumes. A click on the canvas later takes real pointer lock.

## Vibration

`rumble(kind, amount)` through `gamepad.vibrationActuator.playEffect('dual-rumble')` when available, only while the pad is the last-used device and Settings → Controller → Vibration is on; silent where unsupported. Subtle: firing 45 ms weak motor at ~0.2 (scaled by recoil), hits taken 140 ms at 0.35/0.25, explosions 320 ms at up to 0.6/0.4 fading with distance (grenades within 16 m, killstreak blasts within 30 m).

## Files

- `src/client/game/pad.ts`: pure mapping and maths (`PadMapper`, `padButtons`, `stickLook`, `radialDeadzone`, `moveSector`, `nextDevice`, `PAD_LAYOUT`).
- `src/client/game/gamepad.ts`: the shared pad module (polling, active pad, device, rumble, USE prompt context, `PadEdges`).
- `src/client/game/prompts.ts`: `promptKey`, `actionGlyph`, `registerPromptKey`, `keyCodeLabel`.
- `src/client/game/aim-assist.ts`: the assist.
- `src/client/menus/padnav.ts`: menu focus navigation.
- Core touched: `game/controls.ts` (pad merge, virtual lock), `game/match.ts` (pad look through aim assist, Y / D-pad down weapon presses, rumble), `menus/match-screen.ts` (deploy/pause text, focus), `hud/draw.ts` (pixel arrows), `hud/widgets.ts` (reload prompt, aim debug), `hud/waypoints.ts` (`useKey`), `registry.ts` (aim assist gate, sight blockers), `settings.ts` (pad settings), `main.ts` (one import).

## Tests

- `tests/pad.test.ts`: deadzone, curve, ramp, 8-way movement, the button layout → Buttons, triggers, X tap/hold, B crouch/prone, L3 sprint, suppression, device switching.
- `tests/movement.client.test.ts`: B hold → prone, B tap → crouch, A → stand, L3 + B → dive, through the real `Controls` and `MatchNet` against a real server; also the keyboard's Z / C / Space.
- `tests/aim-assist.test.ts`: off for mouse/keyboard, slowdown only near visible alive enemies, cone vs distance, walls (a real `CollisionWorld`), rotation direction and the move requirement, the cap and easing, no pull without relative motion, decay, visible target preferred.
- `tests/controller.client.test.ts`: prompt labels per device and after rebinding, the gamepad module's device switching, and a fake `Gamepad` through the real `Controls` loop into the real `MatchNet` against a real server (buttons, movement, look, X reload/use, Y, D-pad, engage without pointer lock, Start pauses).
- `tests/frontend-lobby.test.ts`: the lobby's aim assist rule.

## Gaps

- Movement is 8-way at full walk speed (see above); no analog speed.
- Reviving a teammate in Second Chance has no "HOLD [X]" prompt on the reviver's side (the perks HUD only shows the downed player's bar), so the X press that starts a revive also asks for a reload.
- Glyphs are Xbox names for every pad (a PlayStation pad shows A/B/X/Y too).
- Only the "standard" mapping is laid out; a pad Chrome doesn't map as standard gets raw indices.
- No smoke grenade exists yet; `registerSightBlocker` is where one should stop aim assist.
- The lobby rule is honoured client-side only (aim assist is local view smoothing; nothing to enforce on the server).
- No in-game rebinding for the controller (the layout is fixed); sensitivity, invert, deadzone, vibration and aim assist strength are settings.
