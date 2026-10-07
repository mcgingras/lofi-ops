/**
 * Sticks and Stones (BO1 wager): crossbow with explosive bolts, ballistic knife, one tomahawk per
 * life (lethal button). Kills score; a tomahawk kill also bankrupts the victim (score to 0).
 *
 * The crossbow behaviour (bolt projectile, sticks and explodes, direct hits kill) is registered
 * globally from the feature setup (`crossbowBehavior`), the tomahawk lives here.
 */
import { STICKS } from '../../../../shared/defs/economy';
import { Buttons } from '../../../../shared/input';
import type { WeaponBehavior } from '../../../combat';
import type { Entity } from '../../../entities';
import type { Room } from '../../../room';
import { byScore, giveWeapons, pushHud, rankedResults, stepProjectile, throwFrom, wagerMelee, wx, type Projectile, type WagerRules } from './common';

const TOMAHAWK_SPEED = 24;
const BOLT_SPEED = 70;

export function sticksRules(): WagerRules {
  const rules: WagerRules = {
    id: 'sticks',
    setup(room) {
      room.bus.on('spawn', ({ player }) => {
        giveWeapons(room, player, [STICKS.primary, STICKS.secondary]);
        wx(player).tomahawks = STICKS.tomahawksPerLife;
        pushHud(room, rules, player);
      });
      room.bus.on('buttons', ({ player, pressed }) => {
        if (pressed & Buttons.MELEE) wagerMelee(room, player);
        if (pressed & Buttons.LETHAL) throwTomahawk(room, player.id);
      });
      room.bus.on('death', (e) => {
        const a = e.attacker;
        if (!a || a === e.victim) return;
        if (e.weapon === 'tomahawk') {
          room.addPlayerScore(a, STICKS.tomahawkScore, 'tomahawk');
          if (e.victim.stats.score > 0) room.addPlayerScore(e.victim, -e.victim.stats.score, 'bankrupt');
          room.sendFeature(null, 'core.notice', { text: `${e.victim.name} was BANKRUPTED by ${a.name}` });
        } else room.addPlayerScore(a, STICKS.killScore, 'kill');
      });
      room.bus.on('tick', ({ dt }) => {
        for (const e of room.entities.byKind('tomahawk')) stepTomahawk(room, e, dt);
      });
    },
    assignTeam: () => null,
    rank(room) {
      return [...room.players.values()].sort(byScore);
    },
    results(room, reason) {
      return rankedResults(room, reason, rules.rank(room));
    },
    hud(_room, p) {
      return { mode: 'sticks', tomahawks: wx(p).tomahawks ?? 0 };
    },
  };

  function throwTomahawk(room: Room, id: string) {
    const p = room.players.get(id);
    if (!p || !p.alive || room.phase !== 'playing') return;
    const st = wx(p);
    if ((st.tomahawks ?? 0) <= 0) return;
    st.tomahawks = (st.tomahawks ?? 0) - 1;
    const { origin, vel } = throwFrom(p, TOMAHAWK_SPEED, 2);
    const data: Projectile = { vel, gravity: 9.8, owner: p.id, born: room.time, life: 4 };
    room.entities.add({ kind: 'tomahawk', x: origin.x, y: origin.y, z: origin.z, yaw: p.yaw, owner: p.id, data });
    pushHud(room, rules, p);
  }

  function stepTomahawk(room: Room, e: Entity, dt: number) {
    const hit = stepProjectile(room, e, dt);
    if (!hit) return;
    room.entities.remove(e.id);
    if ('player' in hit) {
      const owner = room.players.get((e.data as Projectile).owner) ?? null;
      room.damage({ victim: hit.player, attacker: owner, amount: 1000, weapon: 'tomahawk', part: hit.part, means: 'thrown', from: hit.at, distance: owner ? Math.hypot(owner.move.x - hit.at.x, owner.move.z - hit.at.z) : 0 });
    }
  }

  return rules;
}

/** Crossbow: a fast bolt; a direct hit kills, otherwise it sticks and explodes after a short fuse. */
export const crossbowBehavior: WeaponBehavior = {
  fire(room, player, _weapon, shot) {
    const vel = { x: shot.dir.x * BOLT_SPEED, y: shot.dir.y * BOLT_SPEED, z: shot.dir.z * BOLT_SPEED };
    const data: Projectile = { vel, gravity: 3, owner: player.id, born: room.time, life: 3 };
    room.entities.add({ kind: 'bolt', x: shot.origin.x, y: shot.origin.y, z: shot.origin.z, yaw: player.yaw, owner: player.id, data });
    ensureBoltTicker(room);
  },
};

const tickers = new WeakSet<Room>();
function ensureBoltTicker(room: Room) {
  if (tickers.has(room)) return;
  tickers.add(room);
  room.bus.on('tick', ({ dt }) => {
    for (const e of room.entities.byKind('bolt')) stepBolt(room, e, dt);
  });
}

function stepBolt(room: Room, e: Entity, dt: number) {
  const pr = e.data as Projectile;
  const owner = room.players.get(pr.owner) ?? null;
  if (pr.stuckAt !== undefined) {
    if (room.time - pr.stuckAt >= STICKS.boltFuseSec) {
      room.entities.remove(e.id);
      room.radiusDamage({ x: e.x, y: e.y, z: e.z }, STICKS.boltRadius, 160, 40, { attacker: owner, weapon: 'crossbow', means: 'explosive', hitSelf: true });
    }
    return;
  }
  const hit = stepProjectile(room, e, dt);
  if (!hit) return;
  if ('player' in hit) {
    room.entities.remove(e.id);
    room.damage({ victim: hit.player, attacker: owner, amount: 1000, weapon: 'crossbow', part: hit.part, means: 'bullet', from: hit.at, distance: owner ? Math.hypot(owner.move.x - hit.at.x, owner.move.z - hit.at.z) : 0 });
    return;
  }
  pr.stuckAt = room.time;
  e.s = { stuck: true };
}
