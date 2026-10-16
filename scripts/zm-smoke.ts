/** Zombies smoke run: one idle survivor on a map, rounds tick by. `npx tsx scripts/zm-smoke.ts [map] [seconds]` */
import { FEATURES } from '../src/server/features/index';
import { zombiesGameOf } from '../src/server/features/zombies/index';
import { survivorOf, undeadOf } from '../src/server/features/zombies/state';
import { Lobby } from '../src/server/lobby';
import { registerMode } from '../src/server/modes/index';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import { newProfile } from '../src/shared/profile';

const [map = 'nuketown', secArg = '120'] = process.argv.slice(2);
const store = new Store(':memory:');
const lobby = new Lobby({ store, features: FEATURES, log: (m) => console.log(m), autoTick: false });
for (const f of FEATURES) f.setup?.({ lobby, store, rpc: { handle() {}, has: () => false, dispatch: async () => ({}) } as never, registerMode, registerWeaponBehavior: () => {}, sessions: () => [], log: () => {} });
const room = lobby.createRoom({ mode: 'zombies', map, closeWhenEmpty: false });
const s = new Session('s1', null, newProfile('p1', 'Tester'), 'tok');
const h = room.addHuman(s);
const g = zombiesGameOf(room)!;
let last = '';
const t0 = performance.now();
let maxTick = 0;
for (let i = 0; i < Math.round(Number(secArg) / TICK_DT); i++) {
  const a = performance.now();
  room.step();
  maxTick = Math.max(maxTick, performance.now() - a);
  const line = `t=${room.time.toFixed(1)} phase=${room.phase}/${g.phase} round=${g.round} queue=${g.queue} alive=${g.aliveUndead().length} bodies=${g.bodies.length} me alive=${h.alive} hp=${Math.round(h.health)} down=${g.isDown(h)} pts=${survivorOf(h)?.points}`;
  if (i % 300 === 0 || (line.split(' ').slice(1).join(' ') !== last && g.phase !== 'active')) {
    console.log(line);
  }
  last = line.split(' ').slice(1).join(' ');
  if (room.phase === 'ended') {
    console.log('ENDED', JSON.stringify(room.results?.ext.zombies));
    break;
  }
}
const nearest = g.aliveUndead().map((z) => Math.hypot(z.move.x - h.move.x, z.move.z - h.move.z).toFixed(1));
console.log('zombie distances', nearest.join(' '), 'gaits', g.aliveUndead().map((z) => undeadOf(z)!.gait).join(','));
console.log('stats', JSON.stringify(g.horde.stats), 'ms', Math.round(performance.now() - t0), 'max tick ms', maxTick.toFixed(2));
lobby.shutdown();
