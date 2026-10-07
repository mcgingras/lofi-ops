import type { Vec3 } from '../../../../shared/math';

/** Where a streak was aimed. `target`: the designated point; `targets`: every mark; `yaw`: the caller's facing. */
export interface CallArgs {
  target: Vec3 | null;
  targets: Vec3[];
  yaw: number;
}
