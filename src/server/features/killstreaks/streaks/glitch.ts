/**
 * Glitch (original, EMP-like; tuning and the wire type in shared/defs/glitch.ts). For 20 s every
 * enemy of the caller is glitched:
 *
 * - radar: `radarVisible` false and `radarJammed` true for them (their minimap is static, a Spy
 *   Plane or Blackbird stops showing them anyone; bots lose their radar knowledge the same way);
 * - bots: the bots feature's skill modifiers (`botSkillMultiplier` / `botSkillOffset`, GLITCH.bot)
 *   slow their reactions and noticing, widen their aim error and sway, slow their turns, narrow
 *   their view and dull their hearing; `botFrozen` stutters them in place now and then;
 * - hardware: their sentries and SAMs are stunned for the duration, and `KsRoom.hardwareStunned`
 *   (this active's `stuns`) holds helicopter fire, stalls RC-XDs and dogs, cuts rocket guidance and
 *   Counter-Spy Plane jamming; their hardware entities carry `s.st = 1` for the client; and they
 *   can't call streaks until it ends (api.ts);
 * - clients: `killstreaks.glitch` lists the running glitches (the glitched screen, minimap and HUD,
 *   and the glitched look of enemy soldiers for the caller's side).
 *
 * It can't be shot down. Several can run at once (each lasts its own 20 s).
 */
import { GLITCH, type GlitchStateMsg } from '../../../../shared/defs/glitch';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import type { Active, KsRoom } from '../world';
import { turretsOf } from './turrets';
import type { CallArgs } from './types';

/** Per-room glitch bookkeeping: bots' stutter schedule and hardware entities tagged stunned. */
interface GlitchRoom {
  freeze: WeakMap<PlayerState, { next: number; until: number }>;
  tagged: Set<number>;
  last: string;
}

const rooms = new WeakMap<Room, GlitchRoom>();
const glitchRoom = (room: Room): GlitchRoom => {
  let g = rooms.get(room);
  if (!g) rooms.set(room, (g = { freeze: new WeakMap(), tagged: new Set(), last: '' }));
  return g;
};

const running = (ctx: KsRoom) => ctx.actives.filter((a) => !a.done && a.streak === 'glitch');

/** Is `p` glitched right now (an enemy of a running Glitch's owner)? */
export function isGlitched(ctx: KsRoom, p: PlayerState): boolean {
  return running(ctx).some((a) => ctx.room.isEnemy(a.owner, p));
}

/** The glitches running now (what `killstreaks.glitch` carries). */
export function glitchState(ctx: KsRoom): GlitchStateMsg {
  return { active: running(ctx).map((a) => ({ owner: a.owner.id, team: a.owner.team, until: (a as GlitchActive).until })) };
}

/** Push the glitch list to everyone when it changed (`force`: always, e.g. a join). */
export function pushGlitch(ctx: KsRoom, to: PlayerState | null = null): void {
  const msg = glitchState(ctx);
  const g = glitchRoom(ctx.room);
  const key = JSON.stringify(msg);
  if (to) {
    if (to.session) ctx.room.sendFeature(to, 'killstreaks.glitch', msg);
    return;
  }
  if (key === g.last) return;
  g.last = key;
  ctx.room.sendFeature(null, 'killstreaks.glitch', msg);
}

type GlitchActive = Active & { until: number };

export function callGlitch(ctx: KsRoom, p: PlayerState, _args: CallArgs): string | null {
  const room = ctx.room;
  const until = room.time + GLITCH.durationSec;
  const g = glitchRoom(room);
  const act: GlitchActive = {
    streak: 'glitch',
    owner: p,
    entities: [],
    until,
    stuns: (o) => room.isEnemy(p, o),
    update() {
      if (room.time >= until) return false;
      // Sentries and SAMs of the glitched side stay stunned (a short stun renewed every tick, so
      // it ends with the glitch); everything else of theirs is tagged for the client.
      for (const t of turretsOf(ctx)) if (t.alive && room.isEnemy(p, t.owner)) t.stun(0.2);
      tagHardware(ctx, g);
      return true;
    },
    cleanup() {
      // Already out of `actives` here: untag its victims' hardware and tell everyone.
      tagHardware(ctx, g);
      pushGlitch(ctx);
    },
  };
  ctx.add(act);
  // Bots already on the glitched side start their stutter schedule a little apart.
  for (const q of room.players.values()) if (q.isBot && room.isEnemy(p, q)) g.freeze.set(q, { next: room.time + 0.4 + Math.random() * GLITCH.freeze.gapMin, until: 0 });
  tagHardware(ctx, g);
  pushGlitch(ctx);
  return null;
}

/** Tag (`s.st = 1`) every killstreak entity whose owner's hardware is knocked out; untag the rest. */
function tagHardware(ctx: KsRoom, g: GlitchRoom): void {
  const want = new Set<number>();
  for (const a of ctx.actives) {
    if (a.done || a.streak === 'glitch' || !ctx.hardwareStunned(a.owner)) continue;
    for (const id of a.entities) want.add(id);
  }
  for (const id of want) {
    const e = ctx.room.entities.get(id);
    if (e && e.s?.st !== 1) e.s = { ...e.s, st: 1 };
  }
  for (const id of g.tagged) {
    if (want.has(id)) continue;
    const e = ctx.room.entities.get(id);
    if (e && e.s?.st === 1) e.s = { ...e.s, st: 0 };
  }
  g.tagged = want;
}

/** The bot is in a stutter right now (rolls the next one when due). */
function frozenNow(ctx: KsRoom, bot: PlayerState): boolean {
  const room = ctx.room;
  const g = glitchRoom(room);
  let f = g.freeze.get(bot);
  if (!f) g.freeze.set(bot, (f = { next: room.time + GLITCH.freeze.gapMin * Math.random(), until: 0 }));
  if (room.time >= f.next) {
    const F = GLITCH.freeze;
    f.until = room.time + F.min + Math.random() * (F.max - F.min);
    f.next = f.until + F.gapMin + Math.random() * (F.gapMax - F.gapMin);
  }
  return room.time < f.until;
}

/** Radar, bot skill and stutter modifiers, registered once per room. */
export function registerGlitchModifiers(room: Room, ctx: KsRoom): void {
  const any = () => ctx.actives.some((a) => !a.done && a.streak === 'glitch');
  room.modifiers.add('radarVisible', (_target, viewer) => (any() && isGlitched(ctx, viewer) ? false : undefined), 'killstreaks.glitch');
  room.modifiers.add('radarJammed', (viewer) => (any() && isGlitched(ctx, viewer) ? true : undefined), 'killstreaks.glitch');
  room.modifiers.add('botSkillMultiplier', (bot, knob) => {
    const m = (GLITCH.bot as Partial<Record<string, { mul: number; add: number }>>)[knob];
    return m && bot.isBot && any() && isGlitched(ctx, bot) ? m.mul : undefined;
  }, 'killstreaks.glitch');
  room.modifiers.add('botSkillOffset', (bot, knob) => {
    const m = (GLITCH.bot as Partial<Record<string, { mul: number; add: number }>>)[knob];
    return m && m.add && bot.isBot && any() && isGlitched(ctx, bot) ? m.add : undefined;
  }, 'killstreaks.glitch');
  room.modifiers.add('botFrozen', (bot) => (bot.isBot && bot.alive && any() && isGlitched(ctx, bot) && frozenNow(ctx, bot) ? true : undefined), 'killstreaks.glitch');
}
