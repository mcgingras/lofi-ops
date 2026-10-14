/**
 * Controller input maths and mapping (pure: no DOM, no clocks; unit-tested in tests/pad.test.ts).
 *
 * `PadMapper` turns one normalised gamepad snapshot per frame into what the keyboard and mouse
 * produce: held actions (the same names as KEYMAP actions, plus 'fire' / 'ads'), edge presses,
 * a look delta (radians) and the move stick. `padButtons()` packs a frame into `Buttons` bits, so
 * prediction, netcode, killstreaks, pickups and modes see a controller exactly like a keyboard.
 *
 * Layout (BO1/MW2 console, Gamepad API "standard" mapping): see `PAD_LAYOUT`.
 *
 * Movement stays digital because the input command carries button bits only (`InputCmd.buttons`)
 * and `movement.ts` has no analog speed. The left stick picks one of 8 directions (cardinal
 * sectors a little wider than diagonals, with hysteresis so a stick on a boundary doesn't
 * flicker) once it is pushed past `MOVE_STICK.on`; any push walks at full walk speed, L3 sprints.
 */
import { Buttons } from '../../shared/input';

/** Standard-mapping button indices. */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
  HOME: 16,
} as const;
export type PadButton = keyof typeof PAD;

/** One gamepad read: button values 0..1 (a digital press reads 1) and axes -1..1. */
export interface PadSnapshot {
  id: string;
  buttons: number[];
  axes: number[];
}

/** Actions a pad holds. Same names as `KEYMAP` actions so `controls.isHeld()` works for both. */
export type PadHeld = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'use' | 'melee' | 'lethal' | 'tactical' | 'streak' | 'prone' | 'scores' | 'fire' | 'ads';
/** One-shot presses (consumed once, like `controls.consume`). */
export type PadPress = 'reload' | 'weaponNext' | 'equipment' | 'streakNext' | 'streakPrev' | 'pause';

/** Look tuning. Sensitivity 1..10 maps to a max yaw rate; pitch is a bit slower, like CoD. */
export const PAD_LOOK = {
  /** Response curve exponent: fine aim near the centre, full speed at the edge. */
  exponent: 2,
  /** Outer deadzone: a cheap stick rarely reaches 1.0 on the diagonal. */
  outer: 0.95,
  /** Max yaw rate (deg/s) = base + perSens x sensitivity: sens 5 = 180 deg/s. */
  baseDegPerSec: 40,
  perSensDegPerSec: 28,
  /** Pitch rate relative to yaw. */
  pitchRatio: 0.66,
  /** Edge ramp: after `delay` s pinned at the edge, yaw speeds up to x(1 + extra) over `time` s. */
  ramp: { edge: 0.97, minX: 0.7, delay: 0.12, time: 0.3, extra: 0.6 },
};

export const DEFAULT_DEADZONE = 0.13;

/** Left stick: push past `on` to walk; let go below `off` to stop. Sector half-widths in degrees. */
export const MOVE_STICK = { on: 0.3, off: 0.22, cardinal: 25, hysteresis: 6 };

/** Triggers (analog value thresholds with hysteresis). */
export const TRIGGERS = { fireOn: 0.4, fireOff: 0.3, adsOn: 0.3, adsOff: 0.2 };

/** L3 clicked up to this long (s) before pushing forward still sprints. */
export const SPRINT_GRACE = 0.25;

/** Hold timings (s). */
export const PAD_HOLD = {
  /** B held this long goes prone (tap = crouch toggle). */
  prone: 0.35,
  /** X released before this counts as a tap (reload) when a USE prompt is up. */
  useTap: 0.3,
};

/** Look rate for a stick deflection: radial deadzone, then the response curve. */
export function radialDeadzone(x: number, y: number, inner: number, outer = PAD_LOOK.outer): { x: number; y: number; m: number } {
  const r = Math.hypot(x, y);
  if (!(r > inner)) return { x: 0, y: 0, m: 0 };
  const m = Math.min(1, (r - inner) / Math.max(1e-6, outer - inner));
  return { x: (x / r) * m, y: (y / r) * m, m };
}

/** Response curve on a 0..1 magnitude. */
export const lookCurve = (m: number, exponent = PAD_LOOK.exponent) => Math.pow(Math.max(0, Math.min(1, m)), exponent);

/** Max yaw rate (rad/s) for a sensitivity setting. */
export const maxYawRate = (sensitivity: number) => ((PAD_LOOK.baseDegPerSec + PAD_LOOK.perSensDegPerSec * sensitivity) * Math.PI) / 180;

export interface LookConfig {
  deadzone: number;
  sensitivity: number;
  invertY: boolean;
}

/**
 * Right stick -> look delta for this frame (radians; yaw + = turn left, pitch + = look up, like
 * the mouse path). `edgeT` is the ramp timer state, returned updated.
 */
export function stickLook(rx: number, ry: number, dt: number, cfg: LookConfig, edgeT: number, scale = 1): { yaw: number; pitch: number; m: number; edgeT: number; boost: number } {
  const d = radialDeadzone(rx, ry, cfg.deadzone);
  if (d.m === 0) return { yaw: 0, pitch: 0, m: 0, edgeT: 0, boost: 1 };
  const k = lookCurve(d.m) / d.m;
  const vx = d.x * k;
  const vy = d.y * k;
  const R = PAD_LOOK.ramp;
  const atEdge = d.m >= R.edge && Math.abs(d.x / d.m) >= R.minX;
  const t = atEdge ? edgeT + dt : 0;
  const boost = 1 + R.extra * Math.max(0, Math.min(1, (t - R.delay) / R.time));
  const yawRate = maxYawRate(cfg.sensitivity) * boost;
  const pitchRate = maxYawRate(cfg.sensitivity) * PAD_LOOK.pitchRatio;
  return { yaw: -vx * yawRate * dt * scale, pitch: -vy * pitchRate * dt * scale * (cfg.invertY ? -1 : 1), m: d.m, edgeT: t, boost };
}

const SECTORS: [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

const wrapDeg = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/**
 * Left stick -> one of 8 directions (sector 0 = forward, clockwise), or -1 for none.
 * `prev` is last frame's sector (for the walk threshold hysteresis and the sector hysteresis).
 */
export function moveSector(x: number, y: number, prev: number): number {
  const r = Math.hypot(x, y);
  if (r < (prev >= 0 ? MOVE_STICK.off : MOVE_STICK.on)) return -1;
  const a = (Math.atan2(x, -y) * 180) / Math.PI; // 0 = up (forward), 90 = right
  const half = (s: number) => (s % 2 === 0 ? MOVE_STICK.cardinal : 45 - MOVE_STICK.cardinal);
  if (prev >= 0 && Math.abs(wrapDeg(a - prev * 45)) <= half(prev) + MOVE_STICK.hysteresis) return prev;
  for (let s = 0; s < 8; s++) if (Math.abs(wrapDeg(a - s * 45)) <= half(s)) return s;
  return Math.round((((a % 360) + 360) % 360) / 45) % 8;
}

/** Sector -> [forward, side] (-1..1 each). */
export const sectorDir = (s: number): [number, number] => (s < 0 ? [0, 0] : SECTORS[s % 8]!);

export interface PadFrame {
  held: Set<PadHeld>;
  /** Crouch latched (CROUCH bit); prone is in `held`. */
  crouch: boolean;
  presses: PadPress[];
  /** Look delta this frame (radians), before aim assist. */
  look: { yaw: number; pitch: number };
  /** Right stick magnitude after the deadzone (0..1). */
  lookMag: number;
  /** Left stick magnitude (raw, 0..1) and its sector (-1 = not walking). */
  move: { x: number; y: number; mag: number; sector: number };
}

export interface MapperContext {
  /** Look multiplier (ADS/zoom, stun). */
  lookScale: number;
  /** A "HOLD [X]" prompt is on screen: X tap = reload on release, hold = use. */
  useContext: boolean;
  /** The body is sprinting on the ground: B dives to prone (BO1 dolphin dive). */
  sprinting?: boolean;
  /** The body is prone (a refused B toggle gives way to it after STANCE_SYNC_SEC). */
  prone?: boolean;
}

/** Seconds a refused stance toggle waits before following the body (no room to lie down / stand up). */
const STANCE_SYNC = 0.3;

const val = (s: PadSnapshot, b: number) => s.buttons[b] ?? 0;
const down = (s: PadSnapshot, b: number) => val(s, b) >= 0.5;
const axis = (s: PadSnapshot, i: number) => {
  const v = s.axes[i] ?? 0;
  return Number.isFinite(v) ? v : 0;
};

/** Is this snapshot "doing something" (for last-used-device detection)? */
export function padActive(s: PadSnapshot, deadzone = 0.3): boolean {
  for (let i = 0; i < s.buttons.length; i++) if (i !== PAD.HOME && (s.buttons[i] ?? 0) >= 0.5) return true;
  return Math.hypot(axis(s, 0), axis(s, 1)) > deadzone || Math.hypot(axis(s, 2), axis(s, 3)) > deadzone;
}

/**
 * Snapshot -> frame, with the state a console layout needs (crouch latch, sprint latch, trigger
 * hysteresis, X tap vs hold, look ramp). Call `suppress(snapshot)` while the game isn't taking pad
 * input (paused, a feature owns the input): buttons held then must be released before they count.
 */
export class PadMapper {
  private prev: number[] = [];
  private suppressed = new Set<number>();
  private t = 0;
  private sector = -1;
  private edgeT = 0;
  private fire = false;
  private ads = false;
  private crouchLatch: 'none' | 'crouch' | 'prone' = 'none';
  private bDownAt = -1;
  private xDownAt = -1;
  private xDeferred = false;
  private sprintLatch = false;
  private sprintAt = -9;
  private jumpBlocked = false;
  private stanceOff = 0;

  /** Ignore buttons held now until they are released (and drop latches). */
  suppress(s: PadSnapshot | null): void {
    this.suppressed.clear();
    if (s) for (let i = 0; i < s.buttons.length; i++) if (down(s, i)) this.suppressed.add(i);
    if (s && val(s, PAD.RT) >= TRIGGERS.fireOff) this.suppressed.add(PAD.RT);
    if (s && val(s, PAD.LT) >= TRIGGERS.adsOff) this.suppressed.add(PAD.LT);
    this.prev = s ? s.buttons.map((v) => v) : [];
    this.fire = this.ads = false;
    this.sprintLatch = false;
    this.xDownAt = this.bDownAt = -1;
    this.xDeferred = false;
    this.sector = -1;
    this.edgeT = 0;
    this.jumpBlocked = false;
  }

  /** Forget the crouch latch (spawn). */
  resetLatches(): void {
    this.crouchLatch = 'none';
    this.sprintLatch = false;
    this.stanceOff = 0;
  }

  step(s: PadSnapshot, dt: number, look: LookConfig, ctx: MapperContext): PadFrame {
    this.t += dt;
    const held = new Set<PadHeld>();
    const presses: PadPress[] = [];
    for (const b of [...this.suppressed]) {
      const still = b === PAD.RT ? val(s, b) >= TRIGGERS.fireOff : b === PAD.LT ? val(s, b) >= TRIGGERS.adsOff : down(s, b);
      if (!still) this.suppressed.delete(b);
    }
    const live = (b: number) => !this.suppressed.has(b);
    const isDown = (b: number) => live(b) && down(s, b);
    const wasDown = (b: number) => (this.prev[b] ?? 0) >= 0.5;
    const pressed = (b: number) => isDown(b) && !wasDown(b);
    const released = (b: number) => !down(s, b) && wasDown(b);

    // Triggers (analog, hysteresis).
    const rt = live(PAD.RT) ? val(s, PAD.RT) : 0;
    const lt = live(PAD.LT) ? val(s, PAD.LT) : 0;
    const fireWas = this.fire;
    const adsWas = this.ads;
    this.fire = this.fire ? rt >= TRIGGERS.fireOff : rt >= TRIGGERS.fireOn;
    this.ads = this.ads ? lt >= TRIGGERS.adsOff : lt >= TRIGGERS.adsOn;
    if (this.fire) held.add('fire');
    if (this.ads) held.add('ads');

    // Move stick -> 8-way.
    const mx = axis(s, 0);
    const my = axis(s, 1);
    this.sector = moveSector(mx, my, this.sector);
    const [f, side] = sectorDir(this.sector);
    if (f > 0) held.add('forward');
    if (f < 0) held.add('back');
    if (side > 0) held.add('right');
    if (side < 0) held.add('left');

    // Crouch: B tap toggles crouch (prone -> crouch), B held goes prone; B while sprinting dives.
    if (pressed(PAD.B)) {
      if (ctx.sprinting) {
        this.crouchLatch = 'prone';
        this.bDownAt = -1;
      } else {
        this.bDownAt = this.t;
        this.crouchLatch = this.crouchLatch === 'crouch' ? 'none' : 'crouch';
      }
      this.sprintLatch = false;
    }
    if (isDown(PAD.B) && this.bDownAt >= 0 && this.t - this.bDownAt >= PAD_HOLD.prone) this.crouchLatch = 'prone';
    if (!isDown(PAD.B)) this.bDownAt = -1;
    // A refused toggle (no room for the legs, no headroom to get up) follows the body.
    if (ctx.prone !== undefined && (this.crouchLatch === 'prone') !== ctx.prone && this.bDownAt < 0) {
      this.stanceOff += dt;
      if (this.stanceOff >= STANCE_SYNC) this.crouchLatch = ctx.prone ? 'prone' : 'none';
    } else this.stanceOff = 0;

    // Jump: from crouch/prone, A stands up instead (and doesn't jump until released).
    if (pressed(PAD.A) && this.crouchLatch !== 'none') {
      this.crouchLatch = 'none';
      this.jumpBlocked = true;
    }
    if (!down(s, PAD.A)) this.jumpBlocked = false;
    if (isDown(PAD.A) && !this.jumpBlocked) held.add('jump');

    // Sprint: click L3 (CoD style); stops when you stop pushing forward, aim, fire or crouch.
    if (pressed(PAD.L3)) {
      this.sprintLatch = true;
      this.sprintAt = this.t;
      if (!this.ads) this.crouchLatch = 'none'; // aiming, L3 is hold breath: stay down
    }
    // A click just before pushing forward still counts (SPRINT_GRACE).
    if ((f <= 0 && this.t - this.sprintAt > SPRINT_GRACE) || (this.ads && !adsWas) || (this.fire && !fireWas) || this.crouchLatch !== 'none') this.sprintLatch = false;
    if (this.sprintLatch || isDown(PAD.L3)) held.add('sprint');

    // X: reload on press (use held too); with a USE prompt up, tap = reload on release, hold = use.
    if (pressed(PAD.X)) {
      this.xDownAt = this.t;
      this.xDeferred = ctx.useContext;
      if (!ctx.useContext) presses.push('reload');
    }
    if (isDown(PAD.X)) held.add('use');
    if (live(PAD.X) && released(PAD.X)) {
      if (this.xDeferred && this.xDownAt >= 0 && this.t - this.xDownAt < PAD_HOLD.useTap) presses.push('reload');
      this.xDeferred = false;
      this.xDownAt = -1;
    }

    if (isDown(PAD.LB)) held.add('tactical');
    if (isDown(PAD.RB)) held.add('lethal');
    if (isDown(PAD.R3)) held.add('melee');
    if (isDown(PAD.UP)) held.add('streak');
    if (isDown(PAD.BACK)) held.add('scores');
    if (this.crouchLatch === 'prone') held.add('prone');
    if (pressed(PAD.Y)) presses.push('weaponNext');
    if (pressed(PAD.DOWN)) presses.push('equipment');
    if (pressed(PAD.LEFT)) presses.push('streakPrev');
    if (pressed(PAD.RIGHT)) presses.push('streakNext');
    if (pressed(PAD.START)) presses.push('pause');

    const l = stickLook(axis(s, 2), axis(s, 3), dt, look, this.edgeT, ctx.lookScale);
    this.edgeT = l.edgeT;
    this.prev = s.buttons.map((v) => v);
    return {
      held,
      crouch: this.crouchLatch === 'crouch',
      presses,
      look: { yaw: l.yaw, pitch: l.pitch },
      lookMag: l.m,
      move: { x: mx, y: my, mag: Math.min(1, Math.hypot(mx, my)), sector: this.sector },
    };
  }
}

const HELD_BIT: Record<PadHeld, number> = {
  forward: Buttons.FORWARD,
  back: Buttons.BACK,
  left: Buttons.LEFT,
  right: Buttons.RIGHT,
  jump: Buttons.JUMP,
  sprint: Buttons.SPRINT,
  use: Buttons.USE,
  melee: Buttons.MELEE,
  lethal: Buttons.LETHAL,
  tactical: Buttons.TACTICAL,
  streak: Buttons.STREAK,
  prone: Buttons.PRONE,
  scores: 0,
  fire: Buttons.FIRE,
  ads: Buttons.ADS,
};

/** A pad frame as `Buttons` bits (what goes into the input command). */
export function padButtons(f: Pick<PadFrame, 'held' | 'crouch'>): number {
  let b = f.crouch ? Buttons.CROUCH : 0;
  for (const a of f.held) b |= HELD_BIT[a];
  return b;
}

/** The layout, for the Settings → Controller table and docs. */
export const PAD_LAYOUT: [string, string][] = [
  ['Left stick', 'Move (8-way, full walk speed past the threshold)'],
  ['Right stick', 'Look'],
  ['LT', 'Aim down sights'],
  ['RT', 'Fire (Valkyrie rocket: detonate)'],
  ['LB', 'Tactical (Valkyrie rocket: hold to boost)'],
  ['RB', 'Lethal (hold to raise, release to throw)'],
  ['A', 'Jump · mantle at a ledge or window (stands up from crouch / prone)'],
  ['B', 'Crouch (tap) · Prone (hold) · dive while sprinting'],
  ['X', 'Reload · hold: Use (crates, weapon swap, plant/defuse, revive)'],
  ['Y', 'Switch weapon · change class while dead'],
  ['L3', 'Sprint (click; stops when you stop) · hold breath when scoped'],
  ['R3', 'Melee'],
  ['D-pad up', 'Killstreak'],
  ['D-pad left / right', 'Cycle killstreaks'],
  ['D-pad down', 'Underbarrel attachment · scope zoom when scoped'],
  ['Start', 'Pause'],
  ['Back / View', 'Scoreboard'],
];

// -------------------------------------------------------------------------------------------
// Last-used input device
// -------------------------------------------------------------------------------------------

export type InputDevice = 'kbm' | 'pad';
export type DeviceEvent = { kind: 'pad' } | { kind: 'key' } | { kind: 'mouseButton' } | { kind: 'mouseMove'; dist: number } | { kind: 'wheel' };

/** Mouse travel (px) that counts as "using the mouse" (a desk bump shouldn't flip prompts). */
export const MOUSE_SWITCH_PX = 6;

/** Any pad input switches to the pad; keys, clicks, the wheel or real mouse travel switch back. */
export function nextDevice(prev: InputDevice, e: DeviceEvent): InputDevice {
  switch (e.kind) {
    case 'pad':
      return 'pad';
    case 'mouseMove':
      return e.dist >= MOUSE_SWITCH_PX ? 'kbm' : prev;
    default:
      return 'kbm';
  }
}
