/**
 * Controller maths and mapping (src/client/game/pad.ts): deadzone and response curve, the look
 * ramp, 8-way movement, the console button layout -> Buttons bits, and last-used-device switching.
 */
import { describe, expect, it } from 'vitest';
import { Buttons } from '../src/shared/input';
import { lookCurve, maxYawRate, moveSector, nextDevice, PAD, PAD_HOLD, PAD_LOOK, PadMapper, padActive, padButtons, radialDeadzone, sectorDir, stickLook, type PadFrame, type PadSnapshot } from '../src/client/game/pad';

const DEG = Math.PI / 180;
const LOOK = { deadzone: 0.13, sensitivity: 5, invertY: false };
const CTX = { lookScale: 1, useContext: false };

/** A standard-mapping snapshot: 17 buttons, 4 axes. */
function pad(over: { buttons?: Partial<Record<keyof typeof PAD, number>>; axes?: [number, number, number, number] } = {}): PadSnapshot {
  const buttons = new Array(17).fill(0);
  for (const [k, v] of Object.entries(over.buttons ?? {})) buttons[PAD[k as keyof typeof PAD]] = v;
  return { id: 'test pad (STANDARD GAMEPAD)', buttons, axes: over.axes ?? [0, 0, 0, 0] };
}

/** Run the mapper over a sequence of (snapshot, seconds) steps at 60 fps; returns the last frame and every press. */
function run(m: PadMapper, steps: [PadSnapshot, number][], ctx = CTX): { last: PadFrame; presses: string[] } {
  let last: PadFrame | null = null;
  const presses: string[] = [];
  for (const [s, sec] of steps) {
    const n = Math.max(1, Math.round(sec * 60));
    for (let i = 0; i < n; i++) {
      last = m.step(s, 1 / 60, LOOK, ctx);
      presses.push(...last.presses);
    }
  }
  return { last: last!, presses };
}

describe('deadzone and curve', () => {
  it('radial deadzone: nothing inside, rescaled outside, direction kept', () => {
    expect(radialDeadzone(0.1, 0.05, 0.13).m).toBe(0);
    expect(radialDeadzone(0.09, 0.09, 0.13).m).toBe(0); // 0.127 radius: still inside
    const just = radialDeadzone(0.15, 0, 0.13);
    expect(just.m).toBeGreaterThan(0);
    expect(just.m).toBeLessThan(0.03);
    const full = radialDeadzone(0, -1, 0.13);
    expect(full.m).toBe(1);
    expect(full.y).toBeCloseTo(-1);
    // A cheap stick's diagonal (0.7, 0.7) still reaches full deflection (outer deadzone).
    expect(radialDeadzone(0.7, 0.7, 0.13).m).toBe(1);
    const d = radialDeadzone(0.3, 0.4, 0.13);
    expect(d.x / d.y).toBeCloseTo(0.75);
  });

  it('response curve: precise near the centre, full at the edge', () => {
    expect(PAD_LOOK.exponent).toBeGreaterThanOrEqual(1.8);
    expect(PAD_LOOK.exponent).toBeLessThanOrEqual(2.2);
    expect(lookCurve(0)).toBe(0);
    expect(lookCurve(1)).toBe(1);
    expect(lookCurve(0.5)).toBeCloseTo(0.25);
    for (let m = 0.05; m < 1; m += 0.05) expect(lookCurve(m)).toBeLessThan(m);
  });

  it('look rate: sensitivity 5 is 180 deg/s; small pushes are much slower than linear', () => {
    expect(maxYawRate(5)).toBeCloseTo(180 * DEG);
    const full = stickLook(1, 0, 1 / 60, LOOK, 0);
    expect(-full.yaw * 60).toBeCloseTo(180 * DEG, 3); // right stick right -> yaw decreases (turn right)
    const half = stickLook(0.565, 0, 1 / 60, LOOK, 0); // ~half deflection after the deadzone
    expect(-half.yaw / -full.yaw).toBeLessThan(0.3);
    // Up on the stick (negative y) looks up; invert flips it. Pitch is slower than yaw.
    const up = stickLook(0, -1, 1 / 60, LOOK, 0);
    expect(up.pitch).toBeGreaterThan(0);
    expect(up.pitch).toBeCloseTo(-full.yaw * PAD_LOOK.pitchRatio);
    expect(stickLook(0, -1, 1 / 60, { ...LOOK, invertY: true }, 0).pitch).toBeCloseTo(-up.pitch);
    // ADS / zoom scale.
    expect(stickLook(1, 0, 1 / 60, LOOK, 0, 0.5).yaw).toBeCloseTo(full.yaw * 0.5);
  });

  it('edge ramp: pinned sideways the turn speeds up after a short delay, never vertically', () => {
    let edge = 0;
    let rate0 = 0;
    let rateEnd = 0;
    for (let i = 0; i < 60; i++) {
      const l = stickLook(1, 0, 1 / 60, LOOK, edge);
      edge = l.edgeT;
      if (i === 0) rate0 = -l.yaw;
      rateEnd = -l.yaw;
    }
    expect(rate0).toBeCloseTo(maxYawRate(5) / 60);
    expect(rateEnd / rate0).toBeCloseTo(1 + PAD_LOOK.ramp.extra, 2);
    // Just short of the edge: no ramp.
    let e2 = 0;
    for (let i = 0; i < 60; i++) e2 = stickLook(0.85, 0, 1 / 60, LOOK, e2).edgeT;
    expect(stickLook(0.85, 0, 1 / 60, LOOK, e2).boost).toBe(1);
    // Straight up at the edge: no ramp either.
    let e3 = 0;
    for (let i = 0; i < 60; i++) e3 = stickLook(0, -1, 1 / 60, LOOK, e3).edgeT;
    expect(stickLook(0, -1, 1 / 60, LOOK, e3).boost).toBe(1);
  });
});

describe('movement stick', () => {
  it('8-way with a walk threshold and hysteresis', () => {
    expect(moveSector(0.1, -0.2, -1)).toBe(-1);
    expect(moveSector(0, -1, -1)).toBe(0); // forward
    expect(sectorDir(0)).toEqual([1, 0]);
    expect(moveSector(0.7, -0.7, -1)).toBe(1); // forward-right
    expect(sectorDir(1)).toEqual([1, 1]);
    expect(moveSector(1, 0, -1)).toBe(2); // right
    expect(moveSector(0, 1, -1)).toBe(4); // back
    expect(moveSector(-1, 0, -1)).toBe(6); // left
    // Cardinal sectors are a bit wider: 22 degrees off forward is still forward.
    const a = 22 * DEG;
    expect(moveSector(Math.sin(a), -Math.cos(a), -1)).toBe(0);
    // Hysteresis: 28 degrees stays forward if it was forward, starts as a diagonal otherwise.
    const b = 28 * DEG;
    expect(moveSector(Math.sin(b), -Math.cos(b), -1)).toBe(1);
    expect(moveSector(Math.sin(b), -Math.cos(b), 0)).toBe(0);
    // Walk threshold hysteresis: 0.25 starts nothing but keeps walking.
    expect(moveSector(0, -0.25, -1)).toBe(-1);
    expect(moveSector(0, -0.25, 0)).toBe(0);
  });
});

describe('button layout -> Buttons', () => {
  it('maps the console layout onto the same bits as the keyboard', () => {
    const m = new PadMapper();
    m.suppress(pad());
    const f = m.step(pad({ buttons: { RT: 1, LT: 1, LB: 1, RB: 1, A: 1, R3: 1, UP: 1 }, axes: [0, -1, 0, 0] }), 1 / 60, LOOK, CTX);
    const b = padButtons(f);
    for (const bit of [Buttons.FIRE, Buttons.ADS, Buttons.TACTICAL, Buttons.LETHAL, Buttons.JUMP, Buttons.MELEE, Buttons.STREAK, Buttons.FORWARD]) expect(b & bit).toBe(bit);
    expect(b & (Buttons.BACK | Buttons.LEFT | Buttons.RIGHT | Buttons.CROUCH | Buttons.USE | Buttons.SPRINT)).toBe(0);
    expect(padButtons({ held: new Set(['scores']), crouch: false })).toBe(0); // scoreboard is local only
    expect(f.held.has('scores')).toBe(false);
  });

  it('triggers are analog with hysteresis', () => {
    const m = new PadMapper();
    m.suppress(pad());
    expect(m.step(pad({ buttons: { RT: 0.35 } }), 1 / 60, LOOK, CTX).held.has('fire')).toBe(false);
    expect(m.step(pad({ buttons: { RT: 0.45 } }), 1 / 60, LOOK, CTX).held.has('fire')).toBe(true);
    expect(m.step(pad({ buttons: { RT: 0.32 } }), 1 / 60, LOOK, CTX).held.has('fire')).toBe(true);
    expect(m.step(pad({ buttons: { RT: 0.2 } }), 1 / 60, LOOK, CTX).held.has('fire')).toBe(false);
    expect(m.step(pad({ buttons: { LT: 0.31 } }), 1 / 60, LOOK, CTX).held.has('ads')).toBe(true);
  });

  it('one-shot presses: Y, D-pad, Start', () => {
    const m = new PadMapper();
    m.suppress(pad());
    const { presses } = run(m, [
      [pad({ buttons: { Y: 1 } }), 0.1],
      [pad(), 0.05],
      [pad({ buttons: { DOWN: 1 } }), 0.05],
      [pad({ buttons: { LEFT: 1 } }), 0.05],
      [pad({ buttons: { RIGHT: 1 } }), 0.05],
      [pad({ buttons: { START: 1 } }), 0.05],
      [pad({ buttons: { BACK: 1 } }), 0.05],
    ]);
    expect(presses).toEqual(['weaponNext', 'equipment', 'streakPrev', 'streakNext', 'pause']);
  });

  it('X: reload on press and USE while held; with a USE prompt, tap reloads and hold uses', () => {
    const m = new PadMapper();
    m.suppress(pad());
    const tap = run(m, [[pad({ buttons: { X: 1 } }), 0.1]]);
    expect(tap.presses).toEqual(['reload']);
    expect(padButtons(tap.last) & Buttons.USE).toBe(Buttons.USE);
    run(m, [[pad(), 0.05]]);
    // Prompt up: a short tap reloads on release.
    const ctx = { lookScale: 1, useContext: true };
    const t2 = run(m, [[pad({ buttons: { X: 1 } }), 0.1], [pad(), 0.02]], ctx);
    expect(t2.presses).toEqual(['reload']);
    // Prompt up: a long hold is USE only, no reload.
    const hold = run(m, [[pad({ buttons: { X: 1 } }), PAD_HOLD.useTap + 0.4]], ctx);
    expect(hold.presses).toEqual([]);
    expect(padButtons(hold.last) & Buttons.USE).toBe(Buttons.USE);
    expect(run(m, [[pad(), 0.02]], ctx).presses).toEqual([]);
  });

  it('B: tap toggles crouch, hold goes prone; A from crouch stands without jumping', () => {
    const m = new PadMapper();
    m.suppress(pad());
    let r = run(m, [[pad({ buttons: { B: 1 } }), 0.1], [pad(), 0.1]]);
    expect(r.last.crouch).toBe(true);
    expect(padButtons(r.last) & Buttons.CROUCH).toBe(Buttons.CROUCH);
    r = run(m, [[pad({ buttons: { A: 1 } }), 0.1]]);
    expect(r.last.crouch).toBe(false);
    expect(padButtons(r.last) & Buttons.JUMP).toBe(0);
    r = run(m, [[pad(), 0.05], [pad({ buttons: { A: 1 } }), 0.05]]);
    expect(padButtons(r.last) & Buttons.JUMP).toBe(Buttons.JUMP);
    r = run(m, [[pad(), 0.05], [pad({ buttons: { B: 1 } }), PAD_HOLD.prone + 0.1], [pad(), 0.05]]);
    expect(padButtons(r.last) & Buttons.PRONE).toBe(Buttons.PRONE);
    expect(r.last.crouch).toBe(false);
    r = run(m, [[pad({ buttons: { B: 1 } }), 0.05], [pad(), 0.05]]);
    expect(r.last.crouch).toBe(true); // prone -> crouch
  });

  it('L3 sprints CoD style: click to start, stops when you stop pushing forward or aim', () => {
    const m = new PadMapper();
    m.suppress(pad());
    const fwd: [number, number, number, number] = [0, -1, 0, 0];
    let r = run(m, [[pad({ buttons: { L3: 1 }, axes: fwd }), 0.05], [pad({ axes: fwd }), 0.5]]);
    expect(padButtons(r.last) & Buttons.SPRINT).toBe(Buttons.SPRINT);
    r = run(m, [[pad(), 0.4], [pad({ axes: fwd }), 0.1]]);
    expect(padButtons(r.last) & Buttons.SPRINT).toBe(0);
    r = run(m, [[pad({ buttons: { L3: 1 }, axes: fwd }), 0.05], [pad({ axes: fwd }), 0.1], [pad({ axes: fwd, buttons: { LT: 1 } }), 0.05], [pad({ axes: fwd }), 0.1]]);
    expect(padButtons(r.last) & Buttons.SPRINT).toBe(0);
    // A click just before pushing the stick still counts.
    r = run(m, [[pad(), 0.1], [pad({ buttons: { L3: 1 } }), 0.05], [pad(), 0.1], [pad({ axes: fwd }), 0.3]]);
    expect(padButtons(r.last) & Buttons.SPRINT).toBe(Buttons.SPRINT);
  });

  it('suppress: buttons held when the game takes the pad must be released first', () => {
    const m = new PadMapper();
    const held = pad({ buttons: { A: 1, RT: 1, X: 1 } });
    m.suppress(held);
    const f = m.step(held, 1 / 60, LOOK, CTX);
    expect(padButtons(f) & (Buttons.JUMP | Buttons.FIRE | Buttons.USE)).toBe(0);
    expect(f.presses).toEqual([]);
    m.step(pad(), 1 / 60, LOOK, CTX);
    expect(padButtons(m.step(pad({ buttons: { A: 1 } }), 1 / 60, LOOK, CTX)) & Buttons.JUMP).toBe(Buttons.JUMP);
  });
});

describe('last-used device', () => {
  it('any pad input switches to the pad; keys, clicks, wheel or real mouse travel switch back', () => {
    expect(nextDevice('kbm', { kind: 'pad' })).toBe('pad');
    expect(nextDevice('pad', { kind: 'key' })).toBe('kbm');
    expect(nextDevice('pad', { kind: 'mouseButton' })).toBe('kbm');
    expect(nextDevice('pad', { kind: 'wheel' })).toBe('kbm');
    expect(nextDevice('pad', { kind: 'mouseMove', dist: 2 })).toBe('pad'); // a desk bump
    expect(nextDevice('pad', { kind: 'mouseMove', dist: 40 })).toBe('kbm');
  });

  it('pad activity: buttons or sticks past a drift threshold, not the guide button', () => {
    expect(padActive(pad())).toBe(false);
    expect(padActive(pad({ axes: [0.12, 0.05, 0, 0] }))).toBe(false); // stick drift
    expect(padActive(pad({ axes: [0, 0, 0.8, 0] }))).toBe(true);
    expect(padActive(pad({ buttons: { A: 1 } }))).toBe(true);
    expect(padActive(pad({ buttons: { HOME: 1 } }))).toBe(false);
  });
});
