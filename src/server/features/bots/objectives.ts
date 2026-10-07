/**
 * Bridge from the modes area's pull-based objective hooks (src/server/features/modes/bots.ts:
 * DOM flags, HQ, S&D bomb/sites, Kill Confirmed tags) to the bots goal registry (hooks.ts).
 *
 * One '*' goal source asks modes for the player's best objective; modes without objectives
 * (TDM, FFA, wagers) return null, so bots there roam and hunt as before.
 */
import { Buttons } from '../../../shared/input';
import { bestObjective, type BotObjective } from '../modes/bots';
import { registerBotGoal, type BotGoal } from './hooks';

/** Map a modes objective onto a bot goal. */
export function goalFromObjective(o: BotObjective): BotGoal {
  return {
    at: { ...o.pos },
    radius: o.radius,
    hold: !!o.stay,
    priority: Math.max(0, Math.min(1, o.priority)),
    holdButtons: o.holdUse ? Buttons.USE : 0,
    sprint: o.priority >= 0.8,
    label: `${o.kind} ${o.id}`,
  };
}

let wired = false;

/** Register the modes objective source once (idempotent). */
export function wireModeObjectives(): void {
  if (wired) return;
  wired = true;
  registerBotGoal('*', (room, bot) => {
    const o = bestObjective(room, bot);
    return o ? goalFromObjective(o) : null;
  });
}
