import { TICK_RATE } from '../src/shared/constants';
import { bx } from '../src/server/features/blackout/state';
import { BlackoutBrain } from '../src/server/features/blackout/brain';
import { townAt } from '../src/shared/maps/blackout';
import { blackoutRoom } from '../tests/blackout-harness';
const h = blackoutRoom({ seed: 7 });
for (let i = 0; i < 50 * TICK_RATE; i++) h.room.step();
const pos = new Map<string, { x: number; y: number; z: number }>();
for (const p of h.game.aliveEntrants()) pos.set(p.id, { ...p.move });
for (let i = 0; i < 30 * TICK_RATE; i++) h.room.step();
for (const p of h.game.aliveEntrants()) {
  const a = pos.get(p.id)!;
  if (Math.hypot(a.x - p.move.x, a.z - p.move.z) > 1) continue;
  const b = p.brain as BlackoutBrain;
  console.log(p.id, bx(p).stage, `(${p.move.x.toFixed(1)},${p.move.y.toFixed(1)},${p.move.z.toFixed(1)})`, townAt(p.move.x, p.move.z)?.name ?? 'open', 'goal', b.goal ? `${b.goal.kind} (${b.goal.x.toFixed(1)},${b.goal.y.toFixed(1)},${b.goal.z.toFixed(1)}) d=${Math.hypot(b.goal.x - p.move.x, b.goal.z - p.move.z).toFixed(1)}` : null, 'target', b.target?.id, 'heal', bx(p).healUntil, 'hp', p.health.toFixed(0), 'w', p.weapons.map((w) => w.def.base.id).join('/'), 'vel', Math.hypot(p.move.vx, p.move.vz).toFixed(2), 'onG', p.move.onGround);
}
h.close();
