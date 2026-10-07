/**
 * Client-side prediction of the local player (pattern from Blockyard's Predictor, MIT): every
 * input command moves the body at once with the same `stepMove` the server will run, and is kept
 * until the server acks it. On each snapshot the body restarts from the server's state and
 * replays the unacked commands; any remaining difference is eased away (or snapped when it is
 * larger than RECONCILE_SNAP_M). Pure (no DOM).
 */
import type { CollisionWorld } from '../../shared/collision';
import { MAX_CMD_DT, RECONCILE_SNAP_M } from '../../shared/constants';
import type { InputCmd } from '../../shared/input';
import { copyMoveState, createMoveState, DEFAULT_MOVE_PARAMS, stepMove, type MoveParams, type MoveState } from '../../shared/movement';

export class Predictor {
  state: MoveState = createMoveState();
  params: MoveParams = { ...DEFAULT_MOVE_PARAMS };
  private pending: InputCmd[] = [];
  /** Shown minus predicted, fading. */
  readonly error = { x: 0, y: 0, z: 0 };
  /** Size of the last correction (m): ~0 when prediction holds. */
  lastCorrection = 0;
  /** Corrections that were big enough to snap. */
  snaps = 0;

  constructor(private world: CollisionWorld) {}

  /** Hard reset (spawn, teleport): no smoothing, pending inputs kept for replay. */
  reset(state: MoveState): void {
    this.state = copyMoveState(state);
    this.error.x = this.error.y = this.error.z = 0;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Predict one command now and remember it until acked. */
  apply(cmd: InputCmd, predict = true): void {
    this.pending.push(cmd);
    if (this.pending.length > 240) this.pending.shift();
    if (predict) stepMove(this.world, this.state, cmd.buttons, cmd.yaw, Math.min(cmd.dt, MAX_CMD_DT), this.params);
  }

  /** Server says: after applying `ack`, you were at `server`. Returns the correction (m). */
  reconcile(ack: number, server: MoveState, params: MoveParams, predict = true): number {
    this.params = params;
    while (this.pending.length && this.pending[0]!.seq <= ack) this.pending.shift();
    const shown = { x: this.state.x + this.error.x, y: this.state.y + this.error.y, z: this.state.z + this.error.z };
    const before = { x: this.state.x, y: this.state.y, z: this.state.z };
    this.state = copyMoveState(server);
    if (predict) for (const c of this.pending) stepMove(this.world, this.state, c.buttons, c.yaw, Math.min(c.dt, MAX_CMD_DT), params);
    this.lastCorrection = Math.hypot(this.state.x - before.x, this.state.y - before.y, this.state.z - before.z);
    const ex = shown.x - this.state.x;
    const ey = shown.y - this.state.y;
    const ez = shown.z - this.state.z;
    if (Math.hypot(ex, ey, ez) > RECONCILE_SNAP_M) {
      this.error.x = this.error.y = this.error.z = 0;
      this.snaps++;
    } else {
      this.error.x = ex;
      this.error.y = ey;
      this.error.z = ez;
    }
    return this.lastCorrection;
  }

  /** Ease the correction away (call every frame). */
  decay(dt: number): void {
    const k = Math.exp(-dt * 12);
    this.error.x *= k;
    this.error.y *= k;
    this.error.z *= k;
  }

  /** Where to draw the local player (feet). */
  shown(): { x: number; y: number; z: number } {
    return { x: this.state.x + this.error.x, y: this.state.y + this.error.y, z: this.state.z + this.error.z };
  }
}
