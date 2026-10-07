/**
 * Server side of the 'perks' feature area (owner: perks-streaks). BO1 perks with Pro versions,
 * implemented through the modifier registry and room events:
 *
 *   T1 Lightweight (speed; Pro no fall damage), Flak Jacket (explosives x0.65; Pro fire immune, fuse
 *      reset), Scavenger (resupply packs from the dead; Pro extra mags + grenade resupply event),
 *      Ghost (hidden from Spy Plane/Blackbird unless firing loud; Pro ignored by air support and
 *      sentries), Hardline (streaks -1 kill; Pro care package reroll, in killstreaks).
 *   T2 Hardened (penetration key; Pro x1.5 vs killstreaks, less flinch), Scout (hold breath key; Pro
 *      faster swap), Steady Aim (hip spread x0.65; Pro faster sprint-out and knife), Sleight of Hand
 *      (reload x0.5; Pro ADS x0.5), Warlord (attachmentSlots 2; Pro +1 lethal/tactical).
 *   T3 Tactical Mask (stun x0.35; Pro reveals stunned enemies), Marathon (sprint x2; Pro unlimited),
 *      Ninja (silent footsteps; Pro louder enemy steps), Second Chance (last stand with the pistol;
 *      Pro longer + revive), Hacker (see enemy hardware; Pro hack it, in killstreaks).
 *
 * Sprint stamina (BO1: sprint runs out) is part of Marathon's rules and applies to everyone.
 */
import { KS_ENTITY } from '../../../shared/defs/killstreaks';
import { PERK_TUNING as T } from '../../../shared/defs/perks';
import { viewDir } from '../../../shared/math';
import { currentWeapon } from '../../player';
import type { PlayerState } from '../../player';
import type { Feature } from '../../feature';
import type { Room } from '../../room';
import { hasPerk, inLastStand, isPro, perksOf, progress, proPerks } from './common';
import { setupLastStand } from './laststand';
import { setupScavenger } from './scavenger';
import { PERK_PRO_CHALLENGES } from '../../../shared/defs/perks';

export { hasPerk, isPro, inLastStand, perksOf, proUnlocked, proPerks } from './common';

const RADAR_REVEAL_SEC = 1.5;

/** Modifiers for every perk. Exported for tests. */
export function registerPerkModifiers(room: Room): void {
  const m = room.modifiers;
  // Tier 1
  m.add('speedMultiplier', (p) => (hasPerk(p, 'lightweight') ? T.lightweightSpeed : undefined), 'perks.lightweight');
  m.add('damageTaken', (v, info) => (info.means === 'fall' && isPro(v, 'lightweight') ? 0 : undefined), 'perks.lightweight_pro');
  m.add(
    'damageTaken',
    (v, info) => {
      if (!hasPerk(v, 'flak_jacket')) return undefined;
      if (info.means === 'explosive') return T.flakExplosive;
      if (info.means === 'fire' && isPro(v, 'flak_jacket')) return 0;
      return undefined;
    },
    'perks.flak_jacket',
  );
  m.add('grenadeFuseReset', (p) => (isPro(p, 'flak_jacket') ? true : undefined), 'perks.flak_jacket_pro');
  m.add(
    'radarVisible',
    (target) => {
      if (!hasPerk(target, 'ghost')) return undefined;
      const loud = !target.lastFireSuppressed && room.time - target.lastFireTime < RADAR_REVEAL_SEC;
      return loud ? undefined : false;
    },
    'perks.ghost',
  );
  m.add('streakTargetable', (target, kind) => (isPro(target, 'ghost') && kind !== KS_ENTITY.dog && kind !== KS_ENTITY.rcxd ? false : undefined), 'perks.ghost_pro');
  m.add('streakCostOffset', (p) => (hasPerk(p, 'hardline') ? -1 : undefined), 'perks.hardline');
  // Tier 2
  m.add('penetrationMultiplier', (p) => (hasPerk(p, 'hardened') ? T.hardenedPenetration : undefined), 'perks.hardened');
  m.add('killstreakDamageDealt', (p) => (isPro(p, 'hardened') ? T.hardenedProStreakDamage : undefined), 'perks.hardened_pro');
  m.add('flinchMultiplier', (p) => (isPro(p, 'hardened') ? T.hardenedProFlinch : undefined), 'perks.hardened_pro_flinch');
  m.add('holdBreathMultiplier', (p) => (hasPerk(p, 'scout') ? T.scoutHoldBreath : undefined), 'perks.scout');
  m.add('swapMultiplier', (p) => (isPro(p, 'scout') ? T.scoutProSwap : undefined), 'perks.scout_pro');
  m.add('spreadMultiplier', (p) => (hasPerk(p, 'steady_aim') && p.move.ads < 0.5 ? T.steadyAimHipSpread : undefined), 'perks.steady_aim');
  m.add('sprintOutMultiplier', (p) => (isPro(p, 'steady_aim') ? T.steadyAimProSprintOut : undefined), 'perks.steady_aim_pro');
  m.add('meleeSpeedMultiplier', (p) => (isPro(p, 'steady_aim') ? T.steadyAimProMelee : undefined), 'perks.steady_aim_pro_melee');
  m.add('reloadMultiplier', (p) => (hasPerk(p, 'sleight_of_hand') ? T.sleightReload : undefined), 'perks.sleight_of_hand');
  m.add('adsMultiplier', (p) => (isPro(p, 'sleight_of_hand') ? T.sleightProAds : undefined), 'perks.sleight_of_hand_pro');
  m.add('attachmentSlots', (p) => (hasPerk(p, 'warlord') ? T.warlordAttachments : undefined), 'perks.warlord');
  m.add('lethalCountOffset', (p) => (isPro(p, 'warlord') ? 1 : undefined), 'perks.warlord_pro_lethal');
  m.add('tacticalCountOffset', (p) => (isPro(p, 'warlord') ? 1 : undefined), 'perks.warlord_pro_tactical');
  // Tier 3
  m.add('stunDurationMultiplier', (p) => (hasPerk(p, 'tactical_mask') ? T.maskStun : undefined), 'perks.tactical_mask');
  m.add(
    'radarVisible',
    (target, viewer) => {
      const st = target.ext.perks;
      if (!st || st.stunnedBy !== viewer.id || st.stunnedUntil <= room.time || !isPro(viewer, 'tactical_mask')) return undefined;
      return true;
    },
    'perks.tactical_mask_pro',
  );
  m.add('canSprint', (p) => (p.ext.perks?.exhausted && !isPro(p, 'marathon') ? false : undefined), 'perks.stamina');
  m.add('silentFootsteps', (p) => (hasPerk(p, 'ninja') ? true : undefined), 'perks.ninja');
  m.add('hearingMultiplier', (p) => (isPro(p, 'ninja') ? T.ninjaProFootsteps : undefined), 'perks.ninja_pro');
}

/** Sprint stamina (everyone) and Marathon. */
function setupStamina(room: Room): void {
  const maxFor = (p: PlayerState) => T.sprintSec * (hasPerk(p, 'marathon') ? T.marathonMult : 1);
  room.bus.on('spawn', ({ player }) => {
    const st = perksOf(player);
    st.sprintLeft = maxFor(player);
    st.exhausted = false;
  });
  room.bus.on('tick', ({ dt, time }) => {
    for (const p of room.players.values()) {
      if (!p.alive) continue;
      const st = perksOf(p);
      const max = maxFor(p);
      if (p.move.sprinting) {
        st.lastSprintAt = time;
        if (hasPerk(p, 'marathon')) st.marathonM += Math.hypot(p.move.vx, p.move.vz) * dt;
        if (!isPro(p, 'marathon')) {
          st.sprintLeft -= dt;
          if (st.sprintLeft <= 0) {
            st.sprintLeft = 0;
            st.exhausted = true;
          }
        }
      } else {
        st.sprintLeft = Math.min(max, st.sprintLeft + T.sprintRegen * dt);
        if (st.exhausted && st.sprintLeft >= Math.min(max, T.sprintRestart)) st.exhausted = false;
      }
    }
  });
}

/** Pro challenge counters. */
function setupChallenges(room: Room): void {
  const enemyRadarUp = (p: PlayerState) =>
    [...room.entities.all()].some((e) => (e.kind === KS_ENTITY.uav || e.kind === KS_ENTITY.blackbird) && (p.team === null ? e.owner !== p.id : e.team !== p.team));
  room.bus.on('reload', ({ player }) => {
    perksOf(player).lastReloadAt = room.time;
  });
  room.bus.on('death', (e) => {
    const a = e.attacker;
    const v = e.victim;
    if (!a || a === v || !room.isEnemy(a, v)) return;
    const st = perksOf(a);
    const bullet = e.means === 'bullet';
    if (hasPerk(a, 'lightweight') && room.time - st.lastSprintAt <= 3) progress(room, a, 'lightweight_pro');
    if (hasPerk(a, 'ghost') && enemyRadarUp(a)) progress(room, a, 'ghost_pro');
    if (hasPerk(a, 'hardened') && bullet) progress(room, a, 'hardened_pro');
    if (hasPerk(a, 'scout') && e.headshot) progress(room, a, 'scout_pro');
    if (hasPerk(a, 'steady_aim') && bullet && a.move.ads < 0.5) progress(room, a, 'steady_aim_pro');
    if (hasPerk(a, 'sleight_of_hand') && room.time - st.lastReloadAt <= 5) progress(room, a, 'sleight_of_hand_pro');
    if (hasPerk(a, 'warlord') && bullet && (currentWeapon(a)?.def.attachmentIds.length ?? 0) >= 2) progress(room, a, 'warlord_pro');
    if (hasPerk(a, 'tactical_mask')) progress(room, a, 'tactical_mask_pro');
    if (hasPerk(a, 'ninja')) {
      // From behind: the attacker is outside the victim's 180-degree front.
      const f = viewDir(v.yaw, 0);
      const dx = a.move.x - v.move.x;
      const dz = a.move.z - v.move.z;
      if (f.x * dx + f.z * dz < 0) progress(room, a, 'ninja_pro');
    }
    if (inLastStand(a)) progress(room, a, 'second_chance_pro');
  });
  room.bus.on('damage', (e) => {
    if (e.means === 'explosive' && e.health > 0 && hasPerk(e.victim, 'flak_jacket')) progress(room, e.victim, 'flak_jacket_pro');
  });
  room.bus.on('killstreaks.earned', ({ player }) => {
    if (hasPerk(player, 'hardline')) progress(room, player, 'hardline_pro');
  });
  room.bus.on('killstreaks.destroyed', ({ by }) => {
    if (by && hasPerk(by, 'hacker')) progress(room, by, 'hacker_pro');
  });
  const flushMarathon = (p: PlayerState) => {
    const st = p.ext.perks;
    if (!st || st.marathonM < 1) return;
    const whole = Math.floor(st.marathonM);
    st.marathonM -= whole;
    progress(room, p, 'marathon_pro', whole);
  };
  room.every(5, () => {
    for (const p of room.players.values()) flushMarathon(p);
  });
  room.bus.on('matchEnd', () => {
    for (const p of room.players.values()) flushMarathon(p);
  }, { priority: 10 });
}

/** Ninja / Ghost Pro ids go to every client (footsteps, name tags). */
function setupPublic(room: Room): void {
  let last = '';
  const msg = () => {
    const alive = [...room.players.values()].filter((p) => p.alive);
    return { ninja: alive.filter((p) => hasPerk(p, 'ninja')).map((p) => p.id), ghostPro: alive.filter((p) => isPro(p, 'ghost')).map((p) => p.id) };
  };
  const push = (force = false) => {
    const m = msg();
    const key = JSON.stringify(m);
    if (!force && key === last) return;
    last = key;
    room.sendFeature(null, 'perks.public', m);
  };
  room.bus.on('spawn', () => push());
  room.bus.on('death', () => push());
  room.bus.on('playerLeave', () => push());
  room.bus.on('playerJoin', ({ player }) => {
    if (player.session) room.sendFeature(player, 'perks.public', msg());
  });
}

/** Tactical Mask Pro: remember who stunned whom. */
function setupStuns(room: Room): void {
  room.bus.on('perks.stunned', ({ victim, attacker, duration }) => {
    const st = perksOf(victim);
    st.stunnedBy = attacker?.id ?? null;
    st.stunnedUntil = room.time + Math.max(0, duration);
  });
}

const feature: Feature = {
  id: 'perks',
  setup(api) {
    api.rpc.handle('perks.pro', (ctx) => {
      const prof = ctx.session.profile;
      const progress: Record<string, number> = {};
      for (const c of PERK_PRO_CHALLENGES) progress[c.id] = prof.challengeProgress[c.id] ?? 0;
      return { pro: proPerks(prof), progress };
    });
  },
  room(room) {
    registerPerkModifiers(room);
    setupStamina(room);
    setupLastStand(room);
    setupScavenger(room);
    setupChallenges(room);
    setupPublic(room);
    setupStuns(room);
  },
};

export default feature;
