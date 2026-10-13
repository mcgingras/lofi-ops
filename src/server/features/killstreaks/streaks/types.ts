import type { MarkerLaunch } from '../../../../shared/defs/care-marker';
import type { Vec3 } from '../../../../shared/math';

/**
 * Where a streak was aimed. `target`: the designated point; `targets`: every mark; `yaw`: the
 * caller's facing; `launch`: a thrown marker (Care Package canister) leaving the hand, with the
 * thrower's feet in `from`.
 */
export interface CallArgs {
  target: Vec3 | null;
  targets: Vec3[];
  yaw: number;
  launch?: { throw: MarkerLaunch; from: Vec3 };
}
