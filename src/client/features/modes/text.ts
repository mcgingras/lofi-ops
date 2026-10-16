/**
 * Announcer lines: a `modes.event` worded for the viewer's team (pure, no DOM; tested in
 * tests/modes.client.test.ts). `big` lines are the centre banner; the rest go to the small feed.
 */
import type { Team } from '../../../shared/constants';
import { MODE_XP } from '../../../shared/defs/modes';
import type { ModeEventPayload } from '../../../shared/defs/modestate';

export type LineColor = 'friend' | 'enemy' | 'hi' | 'paper' | 'warn';

export interface AnnouncerLine {
  text: string;
  sub?: string;
  color: LineColor;
  big: boolean;
  /** sfx id to play. */
  sound?: 'modes.good' | 'modes.bad' | 'modes.alarm' | 'modes.horn' | 'modes.pickup';
  /** Personal score popup. */
  points?: number;
}

export interface LineCtx {
  myTeam: Team | null;
  myId: string;
  nameOf(id: string | null): string;
}

const ROUND_REASON: Record<string, string> = {
  eliminated: 'ENEMY ELIMINATED',
  time: 'TIME EXPIRED',
  detonated: 'BOMB DETONATED',
  defused: 'BOMB DEFUSED',
};
const ROUND_REASON_LOST: Record<string, string> = {
  eliminated: 'YOUR TEAM WAS ELIMINATED',
  time: 'TIME EXPIRED',
  detonated: 'BOMB DETONATED',
  defused: 'BOMB DEFUSED',
};

export function eventLine(ev: ModeEventPayload, c: LineCtx): AnnouncerLine | null {
  const mine = ev.team !== null && ev.team === c.myTeam;
  const me = ev.player !== null && ev.player === c.myId;
  const obj = ev.obj ?? '';
  switch (ev.kind) {
    case 'dom.capture':
      return mine ? { text: `${obj} CAPTURED`, color: 'friend', big: true, sound: 'modes.good', points: me ? MODE_XP.capture : undefined } : { text: `ENEMY CAPTURED ${obj}`, color: 'enemy', big: true, sound: 'modes.bad' };
    case 'dom.neutralize':
      return mine ? { text: `${obj} NEUTRALIZED`, color: 'friend', big: false, points: me ? MODE_XP.neutralize : undefined } : { text: `WE LOST ${obj}`, color: 'enemy', big: true, sound: 'modes.bad' };
    case 'dom.defend':
      return me ? { text: `DEFENDED ${obj}`, color: 'hi', big: false, points: MODE_XP.defend } : null;
    case 'sd.round_start': {
      const attack = mine;
      const carrier = attack && ev.player ? (ev.player === c.myId ? 'YOU HAVE THE BOMB' : `${c.nameOf(ev.player).toUpperCase()} HAS THE BOMB`) : undefined;
      return { text: `ROUND ${ev.points ?? ''} · ${attack ? 'ATTACK' : 'DEFEND'}`, sub: carrier ?? (attack ? 'PLANT THE BOMB' : 'DEFEND BOTH SITES'), color: 'hi', big: true, sound: 'modes.horn' };
    }
    case 'sd.pickup':
      return mine ? { text: me ? 'YOU HAVE THE BOMB' : `${c.nameOf(ev.player).toUpperCase()} HAS THE BOMB`, color: 'friend', big: me } : null;
    case 'sd.drop':
      return mine ? { text: 'BOMB DROPPED', color: 'warn', big: false } : null;
    case 'sd.plant':
      return mine
        ? { text: 'BOMB PLANTED', sub: obj ? `SITE ${obj} · DEFEND IT` : undefined, color: 'friend', big: true, sound: 'modes.alarm', points: me ? MODE_XP.plant : undefined }
        : { text: 'BOMB PLANTED', sub: obj ? `SITE ${obj} · DEFUSE IT` : undefined, color: 'enemy', big: true, sound: 'modes.alarm' };
    case 'sd.defuse':
      return { text: 'BOMB DEFUSED', color: mine ? 'friend' : 'enemy', big: true, sound: mine ? 'modes.good' : 'modes.bad', points: me ? MODE_XP.defuse : undefined };
    case 'sd.explode':
      return null; // the round-end line says it
    case 'sd.round_end':
      if (c.myTeam === null) return null;
      return mine ? { text: 'ROUND WON', sub: ROUND_REASON[ev.reason ?? ''], color: 'friend', big: true, sound: 'modes.good' } : { text: 'ROUND LOST', sub: ROUND_REASON_LOST[ev.reason ?? ''], color: 'enemy', big: true, sound: 'modes.bad' };
    case 'sd.halftime':
      return { text: 'HALFTIME', sub: 'SWITCHING SIDES', color: 'hi', big: true, sound: 'modes.horn' };
    case 'sd.last_alive':
      if (me) return { text: 'LAST ONE STANDING', color: 'warn', big: true };
      return mine ? null : { text: 'ONE ENEMY LEFT', color: 'friend', big: false };
    case 'hq.online':
      return { text: 'HQ ONLINE', sub: 'CAPTURE IT', color: 'hi', big: true, sound: 'modes.horn' };
    case 'hq.capture':
      return mine ? { text: 'HQ CAPTURED', sub: 'DEFEND IT · NO RESPAWNS', color: 'friend', big: true, sound: 'modes.good', points: me ? MODE_XP.hqCapture : undefined } : { text: 'ENEMY HQ ESTABLISHED', sub: 'DESTROY IT', color: 'enemy', big: true, sound: 'modes.bad' };
    case 'hq.destroy':
      return mine ? { text: 'ENEMY HQ DESTROYED', color: 'friend', big: true, sound: 'modes.good', points: me ? MODE_XP.hqDestroy : undefined } : { text: 'HQ DESTROYED', color: 'enemy', big: true, sound: 'modes.bad' };
    case 'hq.expire':
      return { text: 'HQ EXPIRED', sub: 'RELOCATING', color: 'paper', big: false };
    case 'hq.move':
      return { text: 'HQ RELOCATING', color: 'paper', big: false };
    case 'hq.defend':
      return me ? { text: 'DEFENDED HQ', color: 'hi', big: false, points: MODE_XP.hqDefend } : null;
    case 'kc.confirm':
      return me ? { text: 'KILL CONFIRMED', color: 'hi', big: false, sound: 'modes.pickup', points: ev.points ?? MODE_XP.confirm } : null;
    case 'kc.deny':
      return me ? { text: 'KILL DENIED', color: 'hi', big: false, sound: 'modes.pickup', points: ev.points ?? MODE_XP.deny } : null;
    case 'infected.first':
      if (me) return { text: ev.reason === 'again' ? 'FIRST INFECTED AGAIN' : 'FIRST INFECTED', sub: 'INFECT A SURVIVOR', color: 'warn', big: true, sound: 'modes.alarm' };
      return { text: `${c.nameOf(ev.player).toUpperCase()} IS INFECTED`, sub: ev.reason === 'again' ? 'FIRST INFECTED AGAIN' : 'SURVIVE', color: 'enemy', big: true, sound: 'modes.horn' };
    case 'infected.infect': {
      const victim = ev.reason ?? null;
      if (victim === c.myId) return { text: 'YOU ARE INFECTED', sub: 'INFECT THE SURVIVORS', color: 'warn', big: true, sound: 'modes.bad' };
      if (me) return { text: `INFECTED ${c.nameOf(victim).toUpperCase()}`, color: 'hi', big: false, points: ev.points };
      return { text: `${c.nameOf(victim).toUpperCase()} WAS INFECTED`, color: c.myTeam === 1 ? 'friend' : 'enemy', big: false };
    }
    case 'infected.survive':
      return me ? { text: 'SURVIVOR', color: 'hi', big: false, points: ev.points } : null;
    case 'infected.last_alive':
      if (me) return { text: 'LAST ONE STANDING', sub: 'RPK AND RADAR · HOLD OUT', color: 'warn', big: true, sound: 'modes.alarm', points: ev.points };
      return { text: 'ONE SURVIVOR LEFT', sub: `FIND ${c.nameOf(ev.player).toUpperCase()}`, color: 'friend', big: true, sound: 'modes.good' };
    case 'infected.outlast':
      return me ? { text: 'OUTLASTED', color: 'hi', big: false, points: ev.points } : null;
    case 'infected.final_stand':
      return me ? { text: 'FINAL STAND', sub: 'YOU SURVIVED THE OUTBREAK', color: 'friend', big: true, sound: 'modes.good', points: ev.points } : { text: `${c.nameOf(ev.player).toUpperCase()} SURVIVED`, color: 'enemy', big: false };
    case 'infected.countdown':
      return { text: 'ALL INFECTED LEFT', sub: `NEW FIRST INFECTED IN ${ev.points ?? ''}`, color: 'hi', big: true, sound: 'modes.horn' };
    default:
      return null;
  }
}

/** How the HUD labels an objective for the viewer (waypoint captions). */
export function zoneVerb(owner: Team | null, myTeam: Team | null): 'CAPTURE' | 'DEFEND' {
  return owner !== null && owner === myTeam ? 'DEFEND' : 'CAPTURE';
}
