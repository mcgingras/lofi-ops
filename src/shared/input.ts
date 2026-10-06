/** Player input: the button bitmask and the command the client sends at frame rate. */

export const Buttons = {
  FORWARD: 1 << 0,
  BACK: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  JUMP: 1 << 4,
  /** Held = crouched (the client turns a toggle setting into held state). */
  CROUCH: 1 << 5,
  SPRINT: 1 << 6,
  ADS: 1 << 7,
  /** Trigger held. Shots themselves go as `fire` messages; this bit is for animation/bots. */
  FIRE: 1 << 8,
  RELOAD: 1 << 9,
  USE: 1 << 10,
  MELEE: 1 << 11,
  LETHAL: 1 << 12,
  TACTICAL: 1 << 13,
  /** Use/activate the selected killstreak (feature: perks-streaks). */
  STREAK: 1 << 14,
  PRONE: 1 << 15,
} as const;
export type ButtonName = keyof typeof Buttons;

/** One client input command. Server applies them in `seq` order with `movement.ts`. */
export interface InputCmd {
  /** Increasing per connection. The server acks the last applied seq in each snapshot. */
  seq: number;
  /** Seconds this command covers (clamped to MAX_CMD_DT on the server). */
  dt: number;
  buttons: number;
  /** Quantised with `quantizeAngle` (math.ts) before use on both sides. */
  yaw: number;
  pitch: number;
  /** 0 primary, 1 secondary. Features may define more slots. */
  weaponSlot: number;
}

export const has = (buttons: number, b: number) => (buttons & b) !== 0;
