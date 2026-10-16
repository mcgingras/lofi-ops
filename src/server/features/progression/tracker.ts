/**
 * Per-room progression: XP on events (kills, headshots, assists, medals, objectives, match end,
 * challenges), live level-ups with unlocks, challenge tracking, combat record stats, loadout gating
 * at spawn, and the end-of-match summary in `results.ext.progression`.
 *
 * Only humans with a profile earn, only while a match is playing (match-end bonuses excepted), and
 * only in rooms that persist profiles (`RoomOptions.persist`, off for private customs). Bots never
 * earn; killing a bot is worth BOT_KILL_XP_MULT of a human kill so bot-filled lobbies still progress.
 *
 * Medal ideas (first blood, multi-kill window, revenge, assists) follow the Call of Blocky
 * progression in Blockyard (MIT, see NOTICE).
 */
import { currentGoal, progressMetric, tierCp, tierGoals, tierName, tiersDone, tierXp, type ChallengeAdvance, type MetricContext } from '../../../shared/defs/challenges';
import { camoName } from '../../../shared/defs/camos';
import { mw2CamosUnlockedBetween, weaponHeadshotCount, weaponKillCount } from '../../../shared/defs/camo-unlocks';
import { KILLSTREAK_BY_ID } from '../../../shared/defs/killstreaks';
import {
  addXp,
  BOT_KILL_XP_MULT,
  BUZZKILL_STREAK,
  canonicalObjective,
  OBJECTIVE_IGNORED,
  COMEBACK_DEATHS,
  LONGSHOT_M,
  MATCH_BONUS_CAP_SEC,
  MIN_MATCH_SEC,
  MULTI_WINDOW_SEC,
  objectiveLabel,
  objectiveXp,
  POINT_BLANK_M,
  progressionExt,
  rankFor,
  XP_SOURCES,
  type MatchXpSummary,
} from '../../../shared/defs/progression';
import { attachmentsUnlockedBetween, classForSelection, gateLoadout, syncUnlocks, unlocksAtLevel, type UnlockEntry } from '../../../shared/defs/unlocks';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import type { MatchResults, PlayerResult } from '../../../shared/events';
import { bumpStat, type Profile } from '../../../shared/profile';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import type { PlayerProgress } from './events';
import './events';

const ORDINAL = ['1ST', '2ND', '3RD'];

function freshProgress(p: PlayerState): PlayerProgress {
  return {
    xpStart: p.profile?.xp ?? 0,
    levelStart: p.profile?.level ?? 1,
    earned: 0,
    lines: new Map(),
    challenges: new Map(),
    unlocked: [],
    codPoints: 0,
    pending: [],
    killTimes: [],
    deathsSinceKill: 0,
    lastKiller: null,
  };
}

export interface ProgressionRoom {
  /** Award XP (no-op for bots / ineligible players). */
  award(p: PlayerState, key: string, label: string, xp: number, opts?: { atEnd?: boolean }): void;
  /** Count a challenge metric. */
  metric(p: PlayerState, name: string, amount: number, ctx?: MetricContext, opts?: { atEnd?: boolean }): void;
  /** Summary for a player so far (also what goes into results at match end). */
  summary(p: PlayerState, mode?: string): MatchXpSummary | null;
}

export function attachProgression(room: Room): ProgressionRoom {
  let firstBloodDone = false;

  const st = (p: PlayerState): PlayerProgress => (p.ext.progression ??= freshProgress(p));
  const earns = (p: PlayerState, atEnd = false): p is PlayerState & { profile: Profile } =>
    !p.isBot && !!p.profile && room.options.persist && (room.phase === 'playing' || (atEnd && room.phase === 'ended'));

  const pushUnlocked = (p: PlayerState, items: UnlockEntry[]) => {
    if (!items.length) return;
    st(p).unlocked.push(...items);
    room.sendFeature(p, 'progression.unlocked', { items });
  };

  function award(p: PlayerState, key: string, label: string, xp: number, opts: { atEnd?: boolean } = {}): void {
    if (!earns(p, opts.atEnd) || !(xp > 0)) return;
    const amount = Math.round(xp);
    const s = st(p);
    const prof = p.profile;
    s.earned += amount;
    const line = s.lines.get(key);
    if (line) {
      line.count += 1;
      line.xp += amount;
    } else s.lines.set(key, { key, label, count: 1, xp: amount });
    s.pending.push([label, amount]);
    const gained = addXp(prof, amount);
    if (!gained.length) return;
    syncUnlocks(prof);
    for (const level of gained) {
      const unlocks = unlocksAtLevel(level);
      s.unlocked.push(...unlocks);
      room.sendFeature(p, 'progression.levelUp', { level, prestige: prof.prestige, rank: rankFor(level).title, unlocks });
      room.bus.emit('progression.levelUp', { player: p, level, prestige: prof.prestige });
    }
    room.broadcastRoster();
  }

  function applyAdvances(p: PlayerState & { profile: Profile }, advances: ChallengeAdvance[], atEnd: boolean): void {
    const s = st(p);
    for (const a of advances) {
      const def = a.def;
      let line = s.challenges.get(def.id);
      if (!line) {
        line = { id: def.id, name: def.name, before: a.before, after: a.after, goal: 0, tiersDone: 0, tiers: tierGoals(def).length, completedTiers: [], xp: 0, codPoints: 0 };
        s.challenges.set(def.id, line);
      }
      line.after = a.after;
      line.goal = currentGoal(def, a.after);
      line.tiersDone = tiersDone(def, a.after);
      for (const i of a.completed) {
        const xp = tierXp(def, i);
        const cp = Math.max(0, Math.round(tierCp(def, i)));
        line.completedTiers.push(i + 1);
        line.xp += xp;
        line.codPoints += cp;
        if (cp > 0) {
          p.profile.codPoints += cp;
          s.codPoints += cp;
        }
        room.sendFeature(p, 'progression.challenge', { id: def.id, name: tierName(def, i), tier: i + 1, tiers: line.tiers, xp, codPoints: cp });
        room.bus.emit('progression.challengeComplete', { player: p, id: def.id, tier: i + 1 });
        award(p, 'challenge', 'CHALLENGE', xp, { atEnd });
        if (def.grants && i === 0) {
          const added = syncUnlocks(p.profile);
          if (added.includes(def.grants)) pushUnlocked(p, [{ level: 0, kind: def.grants.startsWith('pro:') ? 'pro' : 'feature', id: def.grants, name: def.name, detail: 'Challenge reward' }]);
        }
      }
    }
  }

  function metric(p: PlayerState, name: string, amount: number, ctx: MetricContext = {}, opts: { atEnd?: boolean } = {}): void {
    if (!earns(p, opts.atEnd)) return;
    const full: MetricContext = { mode: room.mode.id, perks: p.loadout?.perks ?? [], ...ctx };
    const adv = progressMetric(p.profile.challengeProgress, name, amount, full);
    if (adv.length) applyAdvances(p, adv, !!opts.atEnd);
  }

  const killCtx = (a: PlayerState, weapon: string, means: string): MetricContext => {
    const held = a.weapons.find((w) => w.def.base.id === weapon);
    return {
      mode: room.mode.id,
      weapon,
      weaponClass: WEAPON_BY_ID.get(weapon)?.class,
      attachments: held?.def.attachmentIds ?? [],
      perks: a.loadout?.perks ?? [],
      means,
      killstreak: means === 'killstreak' ? weapon : undefined,
    };
  };

  function summary(p: PlayerState, mode = room.mode.id): MatchXpSummary | null {
    if (!p.profile) return null;
    const s = st(p);
    const lines = [...s.lines.values()].sort((a, b) => b.xp - a.xp);
    const challenges = [...s.challenges.values()].sort((a, b) => b.completedTiers.length - a.completedTiers.length || b.after / Math.max(1, b.goal) - a.after / Math.max(1, a.goal));
    return {
      playerId: p.id,
      profileId: p.profile.id,
      mode,
      total: s.earned,
      xpBefore: s.xpStart,
      xpAfter: p.profile.xp,
      levelBefore: s.levelStart,
      levelAfter: p.profile.level,
      prestige: p.profile.prestige,
      lines: lines.map((l) => ({ ...l })),
      challenges: challenges.map((c) => ({ ...c, completedTiers: [...c.completedTiers] })),
      unlocked: [...s.unlocked],
      codPoints: s.codPoints,
    };
  }

  const flush = (p: PlayerState) => {
    const s = p.ext.progression;
    if (!s || !s.pending.length || !p.profile) return;
    room.sendFeature(p, 'progression.xp', { gains: s.pending, xp: p.profile.xp, level: p.profile.level, prestige: p.profile.prestige });
    s.pending = [];
  };

  // --- lifecycle -------------------------------------------------------------------------------

  room.bus.on('playerJoin', ({ player }) => {
    player.ext.progression = freshProgress(player);
    if (player.profile && !player.isBot) syncUnlocks(player.profile);
  });

  room.bus.on('matchStart', () => {
    firstBloodDone = false;
    for (const p of room.players.values()) p.ext.progression = freshProgress(p);
  });

  room.bus.on('tick', () => {
    for (const p of room.players.values()) flush(p);
  });

  // --- unlock gating (high priority: forced loadouts, e.g. wager modes, run later and win) ------

  room.bus.on(
    'beforeSpawn',
    (e) => {
      const p = e.player;
      const prof = p.profile;
      if (p.isBot || !prof) return;
      // Before Create-a-Class: the default class by index; after: the profile's class if the slot is usable.
      const loadout = p.nextLoadout ? e.loadout : classForSelection(prof, prof.selectedLoadout);
      const g = gateLoadout(prof, loadout);
      e.loadout = g.loadout;
      if (g.violations.length) room.sendFeature(p, 'progression.locked', { violations: g.violations });
    },
    { priority: 100 },
  );

  // --- combat ----------------------------------------------------------------------------------

  room.bus.on('fire', ({ player, weapon, hits }) => {
    if (!earns(player)) return;
    const prof = player.profile;
    bumpStat(prof, 'shots');
    bumpStat(prof, `weapon.${weapon}.shots`);
    if (hits.length) {
      bumpStat(prof, 'hits');
      bumpStat(prof, `weapon.${weapon}.hits`);
    }
  });

  room.bus.on('death', (e) => {
    const { victim, attacker } = e;
    const now = room.time;
    const vs = st(victim);
    if (attacker !== victim) vs.deathsSinceKill += 1;
    vs.lastKiller = attacker && attacker !== victim ? attacker.id : null;
    vs.killTimes = [];

    for (const a of e.assisters) {
      award(a, 'assist', 'ASSIST', XP_SOURCES.assist * (victim.isBot ? BOT_KILL_XP_MULT : 1));
      metric(a, 'assists', 1, killCtx(a, e.weapon, e.means));
    }

    if (!attacker || attacker === victim || !room.isEnemy(attacker, victim)) return;
    const as = st(attacker);
    const comeback = as.deathsSinceKill >= COMEBACK_DEATHS;
    as.deathsSinceKill = 0;
    if (!earns(attacker)) return;
    const prof = attacker.profile;
    const mult = victim.isBot ? BOT_KILL_XP_MULT : 1;
    const ctx = killCtx(attacker, e.weapon, e.means);
    const bullet = e.means === 'bullet';
    const flat = room.mode.killXp;
    if (flat) {
      // Modes with hordes of AI enemies (Zombies): flat XP, kill / headshot challenges only.
      award(attacker, 'kill', 'KILL', flat.kill);
      metric(attacker, 'kills', 1, ctx);
      if (e.headshot) {
        award(attacker, 'headshot', 'HEADSHOT', flat.headshot);
        metric(attacker, 'headshots', 1, ctx);
      }
      return;
    }

    award(attacker, 'kill', 'KILL', XP_SOURCES.kill * mult);
    metric(attacker, 'kills', 1, ctx);

    // Combat record + attachment progress (weapon kills only, not killstreak kills).
    if (WEAPON_BY_ID.has(e.weapon) && e.means !== 'killstreak') {
      const was = { kills: weaponKillCount(prof, e.weapon), headshots: weaponHeadshotCount(prof, e.weapon) };
      bumpStat(prof, `weapon.${e.weapon}.kills`);
      if (e.headshot) bumpStat(prof, `weapon.${e.weapon}.headshots`);
      // MW2 camos unlock per gun on this record (Expert challenges: headshots with that gun).
      const camos = mw2CamosUnlockedBetween(e.weapon, was, { kills: weaponKillCount(prof, e.weapon), headshots: weaponHeadshotCount(prof, e.weapon) });
      if (camos.length) pushUnlocked(attacker, camos.map((c) => ({ level: 0, kind: 'feature' as const, id: `camo:${e.weapon}:${c.id}`, name: `${WEAPON_BY_ID.get(e.weapon)!.name} ${camoName(c)}`, detail: c.weaponChallenge?.title ?? 'Camo' })));
      const ext = progressionExt(prof);
      const before = ext.weaponKills[e.weapon] ?? 0;
      ext.weaponKills[e.weapon] = before + 1;
      const opened = attachmentsUnlockedBetween(e.weapon, before, before + 1);
      if (opened.length) {
        syncUnlocks(prof);
        pushUnlocked(attacker, opened);
      }
    }
    if (e.means === 'melee') bumpStat(prof, 'meleeKills');

    if (e.headshot) {
      award(attacker, 'headshot', 'HEADSHOT', XP_SOURCES.headshot * mult);
      metric(attacker, 'headshots', 1, ctx);
    }
    if (bullet && e.distance >= LONGSHOT_M) {
      award(attacker, 'longshot', 'LONGSHOT', XP_SOURCES.longshot * mult);
      metric(attacker, 'longshots', 1, ctx);
      bumpStat(prof, 'longshots');
    }
    if (bullet && e.distance <= POINT_BLANK_M) metric(attacker, 'pointblank', 1, ctx);
    if (bullet && attacker.move.ads < 0.5) metric(attacker, 'hipfire', 1, ctx);
    if (!firstBloodDone) {
      firstBloodDone = true;
      award(attacker, 'firstblood', 'FIRST BLOOD', XP_SOURCES.firstBlood);
      metric(attacker, 'firstblood', 1, ctx);
      bumpStat(prof, 'firstBloods');
    }
    if (as.lastKiller === victim.id) {
      as.lastKiller = null;
      award(attacker, 'revenge', 'REVENGE', XP_SOURCES.revenge * mult);
      metric(attacker, 'revenge', 1, ctx);
      bumpStat(prof, 'revenges');
    }
    if (comeback) {
      award(attacker, 'comeback', 'COMEBACK', XP_SOURCES.comeback);
      metric(attacker, 'comeback', 1, ctx);
    }
    if (e.victimStreak >= BUZZKILL_STREAK) {
      award(attacker, 'buzzkill', 'BUZZKILL', XP_SOURCES.buzzkill * mult);
      metric(attacker, 'buzzkill', 1, ctx);
    }

    // Multi kills: chain kills inside the window.
    as.killTimes = as.killTimes.filter((t) => now - t <= MULTI_WINDOW_SEC);
    as.killTimes.push(now);
    const chain = as.killTimes.length;
    if (chain === 2) {
      award(attacker, 'double', 'DOUBLE KILL', XP_SOURCES.doubleKill);
      metric(attacker, 'multi2', 1, ctx);
      bumpStat(prof, 'doubleKills');
    } else if (chain === 3) {
      award(attacker, 'triple', 'TRIPLE KILL', XP_SOURCES.tripleKill);
      metric(attacker, 'multi3', 1, ctx);
      bumpStat(prof, 'tripleKills');
    } else if (chain >= 4) award(attacker, 'multi', 'MULTI KILL', XP_SOURCES.multiKill);

    // Streaks: best streak (max metric), a bonus every 5, killstreak rewards earned.
    const streak = e.attackerStreak;
    if (streak > 0) {
      metric(attacker, 'killstreak', streak, ctx);
      if (streak % 5 === 0) award(attacker, 'streak', `${streak} KILL STREAK`, XP_SOURCES.streakBonus * (streak / 5));
      const offset = room.modifiers.sum('streakCostOffset', attacker);
      for (const id of attacker.loadout?.killstreaks ?? []) {
        const def = KILLSTREAK_BY_ID.get(id);
        if (!def || streak !== Math.max(1, def.kills + offset)) continue;
        metric(attacker, 'streak_earned', 1, { mode: room.mode.id, killstreak: id });
        bumpStat(prof, 'streaksEarned');
      }
    }
  });

  room.bus.on('objective', ({ kind, player, data }) => {
    if (!player || !earns(player) || OBJECTIVE_IGNORED.has(kind)) return;
    const k = canonicalObjective(kind);
    award(player, `obj.${k}`, objectiveLabel(k), objectiveXp(kind, data));
    metric(player, `obj.${k}`, 1, { mode: room.mode.id });
    bumpStat(player.profile, `obj.${k}`);
    bumpStat(player.profile, `mode.${room.mode.id}.obj.${k}`);
  });

  // --- reports from other areas ------------------------------------------------------------------

  room.bus.on('progression.metric', (e) => {
    const ctx: MetricContext = { mode: room.mode.id };
    if (e.weapon !== undefined) ctx.weapon = e.weapon;
    if (e.killstreak !== undefined) ctx.killstreak = e.killstreak;
    if (e.means !== undefined) ctx.means = e.means;
    if (e.weapon) {
      ctx.weaponClass = WEAPON_BY_ID.get(e.weapon)?.class;
      ctx.attachments = e.player.weapons.find((w) => w.def.base.id === e.weapon)?.def.attachmentIds ?? [];
    }
    metric(e.player, e.metric, e.amount ?? 1, ctx);
  });

  room.bus.on('progression.xp', (e) => award(e.player, e.key ?? `x.${e.label.toLowerCase()}`, e.label, e.amount));

  // --- match end -------------------------------------------------------------------------------

  room.bus.on(
    'matchEnd',
    ({ results }) => {
      const out: Record<string, MatchXpSummary> = {};
      for (const r of results.players) {
        if (r.bot) continue;
        const p = room.players.get(r.id);
        if (!p || p.isBot || !room.options.persist || !earns(p, true)) continue;
        matchBonuses(p, r, results);
        flush(p);
        const s = summary(p, results.mode);
        if (!s) continue;
        out[r.id] = s;
        progressionExt(p.profile).lastMatch = s;
        room.sendFeature(p, 'progression.summary', s);
      }
      results.ext.progression = out;
    },
    { priority: -10 },
  );

  function matchBonuses(p: PlayerState & { profile: Profile }, r: PlayerResult, results: MatchResults) {
    const atEnd = { atEnd: true };
    const mode = results.mode;
    const ctx: MetricContext = { mode };
    const secs = Math.max(0, r.timePlayed);
    const prof = p.profile;
    bumpStat(prof, `mode.${mode}.timePlayed`, Math.round(secs));
    prof.stats[`mode.${mode}.bestStreak`] = Math.max(prof.stats[`mode.${mode}.bestStreak`] ?? 0, r.bestStreak);
    if (results.reason === 'aborted') return;
    const played = secs >= MIN_MATCH_SEC;
    if (played) award(p, 'complete', 'MATCH COMPLETE', XP_SOURCES.matchComplete, atEnd);
    const timeXp = Math.round(Math.min(secs, MATCH_BONUS_CAP_SEC) * XP_SOURCES.matchPerSecond);
    if (timeXp > 0) award(p, 'time', 'TIME PLAYED', timeXp, atEnd);
    if (r.won) {
      award(p, 'win', 'VICTORY', XP_SOURCES.matchWin, atEnd);
      metric(p, 'wins', 1, ctx, atEnd);
    }
    const many = results.players.length >= 2;
    if (!room.mode.teams && many && played && r.place >= 1 && r.place <= 3) {
      award(p, 'place', `${ORDINAL[r.place - 1]} PLACE`, XP_SOURCES.place[r.place - 1] ?? 0, atEnd);
      metric(p, 'top3', 1, ctx, atEnd);
    }
    if (room.mode.teams && many && played && r.place === 1) metric(p, 'mvp', 1, ctx, atEnd);
    if (played) metric(p, 'matches', 1, ctx, atEnd);
    if (r.score > 0) metric(p, 'score', r.score, ctx, atEnd);
  }

  return { award, metric, summary };
}
