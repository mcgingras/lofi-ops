/**
 * One match session on the client: owns the map scene, the local player (prediction, firing,
 * weapon state), remote soldiers, effects, the viewmodel and the HUD state, and runs the frame
 * loop. Read-only state for HUD widgets and features: `currentMatch()` (state.ts).
 *
 * Local weapon state is predicted (ammo, reload, switch) until the server acks the input that
 * caused it, then follows the server's `me` snapshot.
 */
import * as THREE from 'three';
import { effectiveWeapon, type EffectiveWeapon } from '../../shared/defs/attachments';
import { getMapData, MAP_BY_ID } from '../../shared/defs/maps';
import { MODE_BY_ID } from '../../shared/defs/modes';
import { WEAPON_BY_ID } from '../../shared/defs/weapons';
import { shotSeed, spreadDegrees, spreadDirection, stanceSpread } from '../../shared/ballistics';
import { playerHitboxes, rayHitboxes } from '../../shared/collision';
import { PRONE, type Team } from '../../shared/constants';
import { PERK_TUNING } from '../../shared/defs/perks';
import { penetrationMaterial, penetrationType, traceBullet } from '../../shared/penetration';
import type { MatchPhase, MatchResults } from '../../shared/events';
import { Buttons } from '../../shared/input';
import { hashString, viewDir, type Vec3 } from '../../shared/math';
import { eyeHeight, fullyProne, moveBusy, type MoveState } from '../../shared/movement';
import type { EntitySnap, MeSnap, RosterEntry, ScoreEntry, ServerMsgOf } from '../../shared/protocol';
import { MatchNet, net, type Net } from '../net';
import { MapScene } from '../render/mapbuilder';
import type { Renderer } from '../render/renderer';
import { develop, prioritize } from '../render/textures';
import { aimAssistGates, buttonFilters, entityRenderers, matchHooks, onFeature, shotFxs, sightBlockers, type EntityView } from '../registry';
import { settings } from '../settings';
import { client } from '../state';
import { drawHud } from '../hud/hud';
import { aimAssist, newAimState, type AimResult, type AimTarget } from './aim-assist';
import { sfx } from './audio';
import { Controls } from './controls';
import { inputDevice, rumble } from './gamepad';
import { Effects } from './effects';
import { Remotes } from './remotes';
import { frameSlot, SPAWN_SLOT } from './slots';
import { ViewmodelRig } from './viewmodel';

export interface KillfeedEntry {
  t: number;
  attacker: string | null;
  victim: string;
  weapon: string;
  headshot: boolean;
  means: string;
  attackerTeam: Team | null;
  victimTeam: Team | null;
  /** Through a wall (bullet penetration). */
  pen?: boolean;
}

export interface DeathInfo {
  attacker: string | null;
  weapon: string;
  respawnAt: number | null;
  /** Local time of death. */
  at: number;
  pos: Vec3;
}

const DEG = Math.PI / 180;
/** WeaponDef.recoil degrees -> view kick per shot (tuned so a BO-style spray is controllable). */
const RECOIL_SCALE = 0.6;
const nowSec = () => performance.now() / 1000;

export class Match {
  net: MatchNet;
  joined: ServerMsgOf<'joined'>;
  map: MapScene | null = null;
  /** Loading text while the map builds/bakes (null when ready). */
  loading: string | null = 'Loading';
  readonly roster = new Map<string, RosterEntry>();
  readonly scores = new Map<string, ScoreEntry>();
  teamScores: [number, number] | null = null;
  phase: MatchPhase;
  phaseEndsAt: number | null = null;
  timeLeft: number | null = null;
  results: MatchResults | null = null;
  killfeed: KillfeedEntry[] = [];
  notices: { t: number; text: string }[] = [];
  /** Hitmarker: local time of the last confirmed hit, and whether it killed. */
  hitAt = -9;
  hitKill = false;
  hitHead = false;
  /** The last confirmed hit went through a wall. */
  hitPen = false;
  /** This life's penetration depth multiplier (Hardened), for predicted impacts. */
  private penDepth = 1;
  /** Damage direction markers: local time and world yaw towards the source. */
  damageMarks: { t: number; yaw: number }[] = [];
  death: DeathInfo | null = null;
  /** Local seconds since this session started (HUD animation). */
  time = 0;
  /** Local time the title card started. */
  cardAt = 0;
  /** Last frame's crosshair spread (degrees). */
  spread = 0;
  /** Current yaw/pitch including recoil (camera). */
  yaw = 0;
  pitch = 0;
  readonly controls: Controls;
  readonly viewmodel: ViewmodelRig;
  readonly remotes: Remotes;
  readonly effects: Effects;
  /** Fps, smoothed. */
  fps = 60;
  /** Last frame's aim assist result (debug overlay, `?aimdebug=1`), or null when not on the pad. */
  aimDebug: AimResult | null = null;

  // Local weapon prediction.
  slot = 0;
  private shot = 0;
  private lastShotAt = -9;
  private burstLeft = 0;
  private burstQueued = false;
  private triggerWas = false;
  private pendingShots: { seq: number; slot: number }[] = [];
  private reload = { seq: -1, end: 0, dur: 1 };
  private swap = { seq: -1, end: 0, dur: 0.5 };
  /** Slot + gun in hand at the last snapshot (spots the server swapping it). */
  private heldKey = '';
  private recoil = { pitch: 0, yaw: 0 };
  private wantReload = false;
  private eye = 1.6;
  private raf = 0;
  private last = nowSec();
  private offs: (() => void)[] = [];
  private hookCleanups: (() => void)[] = [];
  private entityViews = new Map<number, { view: EntityView; kind: string; pos: THREE.Vector3; yaw: number; snap: EntitySnap }>();
  private weaponCache = new Map<string, EffectiveWeapon>();
  private disposed = false;
  private loadToken = 0;
  private aimState = newAimState();
  /** Smoothed remote velocities for aim assist (from interpolated positions). */
  private remoteVel = new Map<string, { x: number; y: number; z: number; vx: number; vy: number; vz: number }>();
  /** Last frame: scoped (the scope sets its own look scale) and the mouse look scale before hooks. */
  private scopedLast = false;

  constructor(
    readonly renderer: Renderer,
    joined: ServerMsgOf<'joined'>,
    private socket: Net = net,
  ) {
    this.joined = joined;
    this.phase = joined.phase;
    this.net = new MatchNet(socket, joined);
    this.controls = new Controls(renderer.canvas);
    this.viewmodel = new ViewmodelRig(renderer.vmScene);
    this.remotes = new Remotes(renderer.scene);
    this.effects = new Effects(renderer.scene);
    this.listen();
    client.match = this;
    void this.loadMap(joined.map);
    this.raf = requestAnimationFrame(() => this.frame());
  }

  // -------------------------------------------------------------------------------------------
  // Accessors for HUD/features
  // -------------------------------------------------------------------------------------------

  get myId(): string {
    return this.joined.you;
  }
  get me(): MeSnap | null {
    return this.net.me;
  }
  get myTeam(): Team | null {
    return this.roster.get(this.myId)?.team ?? this.joined.team;
  }
  get mode() {
    return MODE_BY_ID.get(this.joined.mode);
  }
  get mapName(): string {
    return MAP_BY_ID.get(this.joined.map)?.name ?? this.joined.map;
  }
  /** Estimated room time now. */
  get serverTime(): number {
    return this.socket.serverTime();
  }
  nameOf(id: string | null): string {
    if (!id) return '';
    return this.roster.get(id)?.name ?? id;
  }
  isEnemy(id: string): boolean {
    if (id === this.myId) return false;
    const team = this.roster.get(id)?.team ?? null;
    const mine = this.myTeam;
    return team === null || mine === null || team !== mine;
  }

  /** The effective weapon in a slot (attachments applied). */
  weapon(slot = this.slot): EffectiveWeapon | null {
    const w = this.me?.weapons[slot];
    if (!w) return null;
    const key = `${w.id}|${w.attachments.join(',')}`;
    let e = this.weaponCache.get(key);
    if (!e) {
      const def = WEAPON_BY_ID.get(w.id);
      if (!def) return null;
      e = effectiveWeapon(def, w.attachments);
      this.weaponCache.set(key, e);
    }
    return e;
  }

  /** Displayed ammo for a slot (server value minus shots it hasn't processed, reload predicted). */
  ammo(slot = this.slot): { mag: number; reserve: number } {
    const w = this.me?.weapons[slot];
    if (!w) return { mag: 0, reserve: 0 };
    let mag = w.mag;
    let reserve = w.reserve;
    const now = this.serverTime;
    const end = this.reloadEnd();
    if (slot === this.slot && end > 0 && now >= end) {
      const def = this.weapon(slot);
      const take = Math.min((def?.magazine ?? mag) - mag, reserve);
      mag += take;
      reserve -= take;
    }
    for (const s of this.pendingShots) if (s.slot === slot) mag--;
    return { mag: Math.max(0, mag), reserve };
  }

  private reloadEnd(): number {
    const ack = this.net.lastSnap?.ack ?? 0;
    if (this.reload.seq > ack) return this.reload.end;
    return this.me?.reloadEnd ?? 0;
  }

  private swapEnd(): number {
    const ack = this.net.lastSnap?.ack ?? 0;
    return this.swap.seq > ack ? this.swap.end : (this.me?.swapEnd ?? 0);
  }

  /** Reload progress 0..1, or -1 when not reloading. */
  reloadProgress(): number {
    const end = this.reloadEnd();
    const now = this.serverTime;
    if (end <= 0 || now >= end) return -1;
    let dur = this.reload.dur;
    if (Math.abs(end - this.reload.end) > 0.3) {
      // Started by the server (auto reload): estimate from the weapon.
      const def = this.weapon();
      dur = (def?.reloadEmptyMs ?? 2000) / 1000;
    }
    return Math.max(0, Math.min(1, 1 - (end - now) / dur));
  }

  /** Raise progress 0..1 after a switch/spawn, or -1. */
  raiseProgress(): number {
    const end = this.swapEnd();
    const now = this.serverTime;
    if (end <= 0 || now >= end) return -1;
    return Math.max(0, Math.min(1, 1 - (end - now) / this.swap.dur));
  }

  /** Round trip to the server (seconds). */
  get netRtt(): number {
    return this.socket.rtt;
  }

  get alive(): boolean {
    return this.me?.alive ?? false;
  }

  get scoreboardOpen(): boolean {
    return this.controls.isHeld('scores') || this.phase === 'ended';
  }

  // -------------------------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------------------------

  private async loadMap(mapId: string) {
    const token = ++this.loadToken;
    this.loading = `Loading ${MAP_BY_ID.get(mapId)?.name ?? mapId}`;
    this.map?.dispose();
    this.map = null;
    await new Promise((r) => setTimeout(r, 0));
    const scene = new MapScene(getMapData(mapId));
    if (this.disposed || token !== this.loadToken) return scene.dispose();
    const ids = scene.textureIds();
    prioritize(ids);
    void develop(ids);
    const timeId = settings.time !== 'map' && scene.map.times.some((t) => t.id === settings.time) ? settings.time : scene.map.defaultTime;
    this.loading = 'Baking light';
    await scene.setTime(timeId, (k) => {
      this.loading = `Baking light ${Math.round(k * 100)}%`;
    });
    if (this.disposed || token !== this.loadToken) return scene.dispose();
    this.map = scene;
    this.renderer.scene.add(scene.root);
    this.loading = null;
    this.cardAt = this.time;
    for (const c of this.hookCleanups.splice(0)) c();
    for (const [id, h] of matchHooks) {
      try {
        const c = h.start?.(this);
        if (c) this.hookCleanups.push(c);
      } catch (err) {
        console.error(`[match hook ${id}]`, err);
      }
    }
  }

  /** Change time of day (settings). */
  async setTime(id: string): Promise<void> {
    const m = this.map;
    if (!m) return;
    const t = id !== 'map' && m.map.times.some((x) => x.id === id) ? id : m.map.defaultTime;
    await m.setTime(t);
  }

  // -------------------------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------------------------

  private listen() {
    const s = this.socket;
    this.offs.push(
      s.on('joined', (m) => {
        const mapChanged = m.map !== this.joined.map;
        const roomChanged = m.roomId !== this.joined.roomId;
        this.joined = m;
        this.phase = m.phase;
        this.results = null;
        this.killfeed = [];
        this.death = null;
        this.pendingShots = [];
        if (roomChanged || mapChanged) {
          this.net.dispose();
          this.net = new MatchNet(s, m);
          this.remotes.dispose();
          this.clearEntities();
        }
        if (mapChanged) void this.loadMap(m.map);
        else this.cardAt = this.time;
      }),
      s.on('roster', (m) => {
        this.roster.clear();
        for (const r of m.players) this.roster.set(r.id, r);
      }),
      s.on('score', (m) => {
        this.teamScores = m.teams;
        this.scores.clear();
        for (const p of m.players) this.scores.set(p.id, p);
      }),
      s.on('phase', (m) => {
        this.phase = m.phase;
        this.phaseEndsAt = m.endsAt;
        if (m.phase !== 'ended') this.results = null;
        if (m.phase === 'playing') this.cardAt = this.time;
      }),
      s.on('matchEnd', (m) => {
        this.results = m.results;
      }),
      s.on('killfeed', (m) => {
        this.killfeed.unshift({ t: this.time, attacker: m.attacker, victim: m.victim, weapon: m.weapon, headshot: m.headshot, means: m.means, attackerTeam: m.attackerTeam, victimTeam: m.victimTeam, ...(m.pen ? { pen: true } : {}) });
        if (this.killfeed.length > 6) this.killfeed.length = 6;
      }),
      s.on('hit', (m) => {
        this.hitAt = this.time;
        this.hitKill = m.kill;
        this.hitHead = m.part === 'head';
        this.hitPen = !!m.pen;
        sfx.play('tick', { volume: m.kill ? 0.5 : 0.35, rate: m.kill ? 0.94 : 1 });
        const v = this.remotes.views.get(m.victim);
        if (v) this.effects.puff('blood', { x: v.x, y: v.y + (m.part === 'head' ? 1.65 : m.part === 'legs' ? 0.6 : 1.2) * (v.crouch > 0.5 ? 0.67 : 1), z: v.z });
      }),
      s.on('hurt', (m) => {
        rumble('hit', 1);
        if (m.from) {
          const st = this.net.predictor.state;
          this.damageMarks.push({ t: this.time, yaw: Math.atan2(-(m.from[0] - st.x), -(m.from[2] - st.z)) });
          if (this.damageMarks.length > 6) this.damageMarks.shift();
        }
        sfx.play('thud', { volume: 0.6 });
      }),
      s.on('died', (m) => {
        const st = this.net.predictor.shown();
        this.death = { attacker: m.attacker, weapon: m.weapon, respawnAt: m.respawnAt, at: this.time, pos: { x: st.x, y: st.y, z: st.z } };
        this.controls.ads = false;
      }),
      s.on('spawned', (m) => {
        this.death = null;
        this.penDepth = m.loadout.perks.includes('hardened') ? PERK_TUNING.hardenedPenetration : 1;
        this.controls.yaw = m.yaw;
        this.controls.pitch = 0;
        this.controls.clearPresses();
        this.recoil.pitch = this.recoil.yaw = 0;
        this.slot = SPAWN_SLOT;
        this.burstLeft = 0;
        this.burstQueued = false;
        this.pendingShots = [];
        this.reload = { seq: -1, end: 0, dur: 1 };
        this.swap = { seq: this.net.seq + 1, end: this.serverTime + 0.3, dur: 0.3 };
        this.eye = 1.6;
      }),
      s.on('snap', (m) => {
        this.teamScores = m.teams ?? this.teamScores;
        this.timeLeft = m.timeLeft;
        this.phase = m.phase;
        this.pendingShots = this.pendingShots.filter((x) => x.seq > m.ack);
        this.serverWeaponChange(m.me, m.ack);
        for (const shot of m.shots) this.remoteShot(shot.p, shot.o, shot.e, shot.w, !!shot.h, shot.x);
        this.syncEntities(m.ents);
      }),
      onFeature('core.notice', (d) => {
        this.notices.push({ t: this.time, text: d.text });
        if (this.notices.length > 4) this.notices.shift();
      }),
    );
  }

  /**
   * The server replaced the gun in my hand (a weapon pickup, a wager handing out the next gun):
   * drop the predictions made for the old one and raise the new one over its own swap time.
   */
  private serverWeaponChange(me: MeSnap | null, ack: number) {
    const w = me?.alive ? me.weapons[this.slot] : undefined;
    const key = w ? `${this.slot}|${w.id}|${w.attachments.join(',')}` : '';
    const prev = this.heldKey;
    this.heldKey = key;
    if (!w || !prev || prev === key || !prev.startsWith(`${this.slot}|`) || this.swap.seq > ack) return;
    const dur = (WEAPON_BY_ID.get(w.id)?.swapMs ?? 500) / 1000;
    this.swap = { seq: -1, end: me!.swapEnd, dur };
    this.reload = { seq: -1, end: 0, dur: 1 };
    this.pendingShots = this.pendingShots.filter((x) => x.slot !== this.slot);
    this.burstLeft = 0;
    this.burstQueued = false;
  }

  private remoteShot(id: string, o: [number, number, number], e: [number, number, number], weapon: string, hit: boolean, walls?: number[]) {
    const v = this.remotes.views.get(id);
    const from = v ? v.soldier.muzzle.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(o[0], o[1], o[2]);
    this.effects.tracer(from, { x: e[0], y: e[1], z: e[2] });
    if (!hit) this.effects.puff('dust', { x: e[0], y: e[1], z: e[2] }, undefined, 3);
    // Penetrated walls: a puff where it went in and where it came out.
    if (walls) for (let k = 0; k + 2 < walls.length; k += 3) this.effects.puff('dust', { x: walls[k]!, y: walls[k + 1]!, z: walls[k + 2]! }, undefined, 3);
    sfx.gunshot(weapon, { x: o[0], y: o[1], z: o[2] });
  }

  // -------------------------------------------------------------------------------------------
  // Entities
  // -------------------------------------------------------------------------------------------

  private syncEntities(ents: EntitySnap[]) {
    const seen = new Set<number>();
    for (const e of ents) {
      seen.add(e.id);
      let ev = this.entityViews.get(e.id);
      if (!ev || ev.kind !== e.kind) {
        if (ev) this.removeEntity(e.id);
        const fn = entityRenderers.get(e.kind);
        const view = fn?.(e, this);
        if (!view) continue;
        this.renderer.scene.add(view.object);
        ev = { view, kind: e.kind, pos: new THREE.Vector3(e.x, e.y, e.z), yaw: e.yaw, snap: e };
        view.object.position.copy(ev.pos);
        this.entityViews.set(e.id, ev);
      }
      ev.snap = e;
    }
    for (const id of [...this.entityViews.keys()]) if (!seen.has(id)) this.removeEntity(id);
  }

  private removeEntity(id: number) {
    const ev = this.entityViews.get(id);
    if (!ev) return;
    ev.view.object.removeFromParent();
    ev.view.dispose?.();
    this.entityViews.delete(id);
  }

  private clearEntities() {
    for (const id of [...this.entityViews.keys()]) this.removeEntity(id);
  }

  private updateEntities(dt: number) {
    const k = 1 - Math.exp(-dt * 12);
    for (const ev of this.entityViews.values()) {
      const e = ev.snap;
      const skip = ev.view.update?.(e, dt, this) === false;
      if (skip) continue;
      ev.pos.lerp(new THREE.Vector3(e.x, e.y, e.z), k);
      ev.view.object.position.copy(ev.pos);
      ev.view.object.rotation.y = e.yaw;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  private frame() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(() => this.frame());
    const now = nowSec();
    const dt = Math.min(0.1, Math.max(0, now - this.last));
    this.last = now;
    this.time += dt;
    if (dt > 0) this.fps = this.fps * 0.95 + (1 / dt) * 0.05;
    try {
      this.step(dt);
    } catch (err) {
      console.error('[match] frame failed', err);
    }
  }

  private step(dt: number) {
    const r = this.renderer;
    const c = this.controls;
    const me = this.me;
    const alive = this.alive;
    const playing = this.phase === 'playing';
    const server = this.serverTime;

    // Controller: buttons and presses for this frame, then look (zoom-scaled, through aim assist).
    // c.lookScale is last frame's mouse scale after hooks (ADS, scope zoom, stun); the pad divides
    // by the zoom for iron sights too, and undoes the mouse's scoped zoom/2.
    c.padLookScale = (c.lookScale * (this.scopedLast ? Math.max(1, r.zoom * 0.5) : 1)) / Math.max(1, r.zoom);
    // The stance toggles (Z, C, B) follow the predicted body: dive from a sprint, refused toggles.
    const pst = this.net.predictor.state;
    c.stanceHint = alive && playing ? { sprinting: pst.sprinting, onGround: pst.onGround, prone: pst.prone, crouched: pst.crouched } : null;
    c.update(dt);
    this.applyPadLook(dt);

    // Weapon switching (1/2, wheel, Y, D-pad down).
    const nWeapons = me?.weapons.length ?? 2;
    let want = this.slot;
    if (c.consume('weapon1')) want = 0;
    if (c.consume('weapon2')) want = 1;
    if (c.consume('weapon3')) want = 2; // underbarrel attachment slot (grenade launcher), when present
    if (c.consume('weaponNext')) want = this.slot === 0 ? 1 : 0;
    // D-pad down: the underbarrel (again: back to the primary). Scoped with a variable zoom it
    // belongs to the scope (weapons feature) instead.
    if (!(this.scopedLast && this.weapon()?.zoomLevels.length) && c.consume('equipment')) want = this.slot === 2 ? 0 : 2;
    const wheel = c.consumeWheel();
    if (wheel) want = (((this.slot + wheel) % nWeapons) + nWeapons) % nWeapons;
    // Dead (or the spawn not seen in a snapshot yet): ask for the primary every life starts on.
    const next = frameSlot({ slot: this.slot, want, alive, playing, weapons: nWeapons });
    this.slot = next.slot;
    if (next.switched) {
      const def = this.weapon(next.slot);
      const dur = (def?.swapMs ?? 500) / 1000;
      this.swap = { seq: this.net.seq + 1, end: server + dur, dur };
      this.reload = { seq: this.net.seq + 1, end: 0, dur: 1 };
      this.burstLeft = 0;
      this.burstQueued = false;
    }

    // Reload.
    const def = this.weapon();
    const ammo = this.ammo();
    const reloading = this.reloadProgress() >= 0;
    const switching = this.raiseProgress() >= 0;
    if ((c.consume('reload') || this.wantReload) && alive && playing && def && !reloading && !switching) this.startLocalReload(def, ammo);

    // Input command for this frame (aim includes recoil).
    let buttons = c.buttons();
    if (this.wantReload) {
      buttons |= Buttons.RELOAD;
      this.wantReload = false;
    }
    if (!c.locked) buttons &= Buttons.CROUCH | Buttons.PRONE; // paused: stand still (keep crouch / prone)
    for (const [id, f] of buttonFilters) {
      try {
        buttons = f(this, buttons);
      } catch (err) {
        console.error(`[button filter ${id}]`, err);
      }
    }
    this.yaw = c.yaw + this.recoil.yaw;
    this.pitch = Math.max(-1.5, Math.min(1.5, c.pitch + this.recoil.pitch));
    this.net.input(buttons, this.yaw, this.pitch, this.slot, dt);

    // Firing.
    const st = this.net.predictor.state;
    if (def && alive && playing && c.locked) this.tryFire(def, dt, st);
    this.triggerWas = c.triggerHeld;
    this.net.flush();

    // Recoil recovery: full speed once the trigger rests, partly while spraying (BO-style).
    if (def) {
      const rec = def.recoil.recovery * DEG * dt * (this.time - this.lastShotAt > 0.12 ? 1 : 0.35);
      this.recoil.pitch = Math.sign(this.recoil.pitch) * Math.max(0, Math.abs(this.recoil.pitch) - rec);
      this.recoil.yaw = Math.sign(this.recoil.yaw) * Math.max(0, Math.abs(this.recoil.yaw) - rec * 0.5);
    }
    this.net.predictor.decay(dt);

    // Camera.
    const shown = this.net.predictor.shown();
    const targetEye = eyeHeight(st);
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 14);
    const cam = r.cam;
    if (alive || !this.death) {
      cam.position.set(shown.x, shown.y + this.eye, shown.z);
      cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    } else {
      const k = Math.min(1, (this.time - this.death.at) * 1.5);
      const d = this.death.pos;
      cam.position.set(d.x, d.y + 1.6 - 1.2 * k * k, d.z);
      cam.rotation.set(this.pitch * (1 - k) - 0.25 * k, this.yaw, 0.35 * k, 'YXZ');
    }
    const ads = alive ? st.ads : 0;
    const zoom = 1 + ((def?.zoom ?? 1.15) - 1) * ads;
    r.zoom = zoom;
    r.updateFov();
    const scoped = !!def?.scope && ads > 0.85;
    this.scopedLast = scoped;
    c.lookScale = (1 + (settings.adsSensitivity - 1) * ads) / (scoped ? Math.max(1, zoom * 0.5) : 1);
    const moving = Math.hypot(st.vx, st.vz);
    this.spread = def ? spreadDegrees(def, ads, moving > 0.5, stanceSpread(st)) : 0;

    // Audio listener.
    const fwd = viewDir(this.yaw, this.pitch);
    sfx.listener(cam.position.x, cam.position.y, cam.position.z, fwd.x, fwd.y, fwd.z);

    // World.
    const rt = this.net.renderTime();
    this.remotes.update(dt, rt, this.net.interp, this.roster, this.myId, this.map, this.time);
    this.updateEntities(dt);
    this.effects.update(dt);
    this.map?.update(this.time, cam.position);

    // Viewmodel.
    const w = me?.weapons[this.slot];
    if (w) this.viewmodel.setWeapon(WEAPON_BY_ID.get(w.id)?.model ?? w.id, w.attachments, w.camo);
    this.viewmodel.visible = alive && !scoped && this.phase !== 'ended';
    const light = this.map ? this.map.lightAt(shown.x, shown.y + 1.3, shown.z) : [1, 1, 1];
    const mantle = st.mantle ? st.mantle.t / Math.max(1e-6, st.mantle.dur) : -1;
    this.viewmodel.update({ dt, time: this.time, ads, move: Math.min(1, moving / 5) * (st.onGround ? 1 : 0.2), sprint: st.sprinting, yaw: c.yaw, pitch: c.pitch, reload: this.reloadProgress(), raise: this.raiseProgress(), light, prone: alive ? st.proneT : 0, crawl: st.prone ? Math.min(1, moving / 1.2) : 0, mantle: alive ? mantle : -1 });

    // Damage overlay: from health.
    const hp = me && me.alive ? me.health / Math.max(1, me.maxHealth) : 1;
    r.damage += (Math.max(0, 0.85 - hp) / 0.85 - r.damage) * Math.min(1, dt * 6);

    for (const [id, h] of matchHooks) {
      try {
        h.frame?.(this, dt);
      } catch (err) {
        console.error(`[match hook ${id}]`, err);
      }
    }

    if (!this.map) {
      r.clear();
      return;
    }
    r.render((g, W, H) => drawHud(g, W, H, dt), this.viewmodel.visible);
  }

  /**
   * Apply this frame's controller look (Controls.update left it in `padLook`) through aim assist:
   * visible, alive enemies from the interpolated soldiers, line of sight from the world's sight
   * raycast plus any registered sight blockers (smoke). Mouse look never comes through here.
   */
  private applyPadLook(dt: number): void {
    const c = this.controls;
    this.trackRemoteVelocities(dt);
    const look = c.padLook;
    if (!look) {
      this.aimDebug = null;
      if (inputDevice() !== 'pad') this.aimState = newAimState();
      return;
    }
    const st = this.net.predictor.state;
    const alive = this.alive && this.phase === 'playing';
    let allowed = alive;
    for (const gate of aimAssistGates.values()) {
      try {
        if (!gate(this)) allowed = false;
      } catch (err) {
        console.error('[aim assist gate]', err);
      }
    }
    const targets: AimTarget[] = [];
    if (allowed) {
      for (const v of this.remotes.views.values()) {
        const vel = this.remoteVel.get(v.id);
        targets.push({ id: v.id, x: v.x, y: v.y, z: v.z, vx: vel?.vx ?? 0, vy: vel?.vy ?? 0, vz: vel?.vz ?? 0, crouched: v.crouch > 0.5, prone: v.prone > 0.5, yaw: v.yaw, alive: v.alive, enemy: this.isEnemy(v.id) });
      }
    }
    const world = this.net.world;
    const los = (a: Vec3, b: Vec3) => {
      if (!world.lineOfSight(a, b, 'sight')) return false;
      for (const fn of sightBlockers.values()) if (fn(a, b)) return false;
      return true;
    };
    const res = aimAssist(
      {
        device: inputDevice(),
        strength: settings.aimAssist,
        allowed,
        yaw: this.yaw,
        pitch: this.pitch,
        look,
        move: c.padMove,
        eye: { x: st.x, y: st.y + eyeHeight(st), z: st.z },
        vel: { x: st.vx, y: st.vy, z: st.vz },
        targets,
        los,
        dt,
      },
      this.aimState,
    );
    this.aimDebug = res;
    c.yaw += res.yaw - this.yaw;
    c.pitch = Math.max(-1.5, Math.min(1.5, c.pitch + (res.pitch - this.pitch)));
  }

  private trackRemoteVelocities(dt: number): void {
    if (!(dt > 0)) return;
    const k = 1 - Math.exp(-dt * 8);
    const seen = new Set<string>();
    for (const v of this.remotes.views.values()) {
      seen.add(v.id);
      const prev = this.remoteVel.get(v.id);
      if (!prev || !v.alive || Math.hypot(v.x - prev.x, v.z - prev.z) > 3) {
        this.remoteVel.set(v.id, { x: v.x, y: v.y, z: v.z, vx: 0, vy: 0, vz: 0 });
        continue;
      }
      prev.vx += ((v.x - prev.x) / dt - prev.vx) * k;
      prev.vy += ((v.y - prev.y) / dt - prev.vy) * k;
      prev.vz += ((v.z - prev.z) / dt - prev.vz) * k;
      prev.x = v.x;
      prev.y = v.y;
      prev.z = v.z;
    }
    for (const id of [...this.remoteVel.keys()]) if (!seen.has(id)) this.remoteVel.delete(id);
  }

  /** Predict a reload now and send RELOAD with this frame's command. */
  private startLocalReload(def: EffectiveWeapon, ammo: { mag: number; reserve: number }) {
    if (ammo.mag >= def.magazine || ammo.reserve <= 0) {
      this.wantReload = false;
      return;
    }
    const dur = ((ammo.mag === 0 ? def.reloadEmptyMs : def.reloadMs) / 1000) * this.reloadMultiplierGuess();
    this.reload = { seq: this.net.seq + 1, end: this.serverTime + dur, dur };
    this.wantReload = true;
    // No sound here: the weapons feature plays each gun's mag out / mag in (or shells, break
    // action, bolt) as the reload progresses.
  }

  private reloadMultiplierGuess(): number {
    // Perks may speed reloads (server-side modifiers); the server's reloadEnd corrects us on the next snapshot.
    return 1;
  }

  private tryFire(def: EffectiveWeapon, dt: number, st: MoveState) {
    const c = this.controls;
    const trigger = c.triggerHeld;
    const pressed = trigger && !this.triggerWas;
    const interval = 60 / Math.max(1, def.rpm);
    const ammo = this.ammo();
    const reloading = this.reloadProgress() >= 0;
    const switching = this.raiseProgress() >= 0;
    const sprintBlocked = st.sprinting || st.sinceSprint + 0.05 < def.sprintOutMs / 1000;
    if (pressed && def.mode === 'burst') this.burstQueued = true;
    if (this.burstQueued && this.burstLeft <= 0 && this.time - this.lastShotAt >= (def.burstDelayMs ?? 0) / 1000) {
      this.burstQueued = false;
      this.burstLeft = def.burst ?? 3;
    }
    const wantShot = def.mode === 'auto' ? trigger : def.mode === 'burst' ? this.burstLeft > 0 : pressed;
    if (!wantShot) return;
    // Mantling, diving, going prone or getting up: the weapon is down (the server refuses too).
    if (reloading || switching || sprintBlocked || moveBusy(st)) {
      if (def.mode !== 'burst') return;
      return;
    }
    if (ammo.mag <= 0) {
      if (pressed || def.mode === 'auto') {
        if (ammo.reserve > 0) this.wantReload = true;
        else if (pressed) sfx.play('click', { volume: 0.5 });
      }
      this.burstLeft = 0;
      this.burstQueued = false;
      return;
    }
    if (this.time - this.lastShotAt < interval * 0.98) return;
    void dt;
    this.lastShotAt = this.time;
    if (def.mode === 'burst') this.burstLeft--;
    this.shot = (this.shot + 1) >>> 0;
    const dir = viewDir(this.yaw, this.pitch);
    const origin: [number, number, number] = [st.x, st.y + eyeHeight(st), st.z];
    this.net.fire(origin, [dir.x, dir.y, dir.z], this.shot);
    this.pendingShots.push({ seq: this.net.seq, slot: this.slot });
    if (ammo.mag - 1 <= 0 && ammo.reserve > 0) this.wantReload = true; // the server auto-reloads an empty mag

    // Local feedback: kick, flash, sound, tracer and impact using the server's spread maths.
    const adsK = (1 - st.ads * 0.35) * RECOIL_SCALE * (fullyProne(st) ? PRONE.recoil : 1);
    this.recoil.pitch += def.recoil.vertical * DEG * adsK;
    this.recoil.yaw += (Math.random() - 0.5) * 2 * def.recoil.horizontal * DEG * adsK;
    this.viewmodel.shoot(this.time, Math.min(1.2, 0.5 + def.recoil.vertical * 0.4));
    rumble('fire', Math.min(1, 0.5 + def.recoil.vertical * 0.3));
    sfx.gunshot(def.base.id, undefined, def.suppressed);
    // Weapons with their own look (the wonder weapons) draw it on the pull.
    shotFxs.get(def.base.id)?.local?.(this, { x: origin[0], y: origin[1], z: origin[2] }, dir);
    const moving = Math.hypot(st.vx, st.vz) > 0.5;
    const spread = spreadDegrees(def, st.ads, moving, stanceSpread(st));
    const seed = hashString(this.myId);
    const o = { x: origin[0], y: origin[1], z: origin[2] };
    const pellets = def.projectile ? 0 : Math.max(1, def.pellets ?? 1);
    const mapData = this.map?.map;
    const pen = { type: mapData ? penetrationType(def) : ('none' as const), depthMultiplier: this.penDepth };
    const sparks = (mat: string) => mat.startsWith('container') || mat === 'steel' || mat === 'tank';
    for (let i = 0; i < pellets; i++) {
      const d = spreadDirection(dir, spread, shotSeed(seed, this.shot, i));
      const range = def.range ?? 200;
      // The server's trace (penetration included), so impacts show on both sides of a thin wall.
      const path = traceBullet(this.net.world, (s) => (mapData ? penetrationMaterial(mapData, s.mat) : 'solid'), o, d, { range, ...pen });
      const wall = path.hit;
      let maxT = path.t;
      let hitPlayer = false;
      for (const v of this.remotes.views.values()) {
        if (!v.alive) continue;
        const hb = rayHitboxes(o, d, playerHitboxes(v, v.prone > 0.5 ? 'prone' : v.crouch > 0.5, v.yaw), maxT);
        if (hb) {
          maxT = hb.t;
          hitPlayer = true;
        }
      }
      const end = { x: o.x + d.x * maxT, y: o.y + d.y * maxT, z: o.z + d.z * maxT };
      if (i === 0) {
        const m = this.viewmodelMuzzleWorld();
        this.effects.tracer(m ?? o, end);
      }
      for (const w of path.walls) {
        if (w.tIn >= maxT) break;
        this.effects.puff(sparks(w.mat) ? 'spark' : 'dust', w.point, w.normal, 3);
        if (w.tOut < maxT) this.effects.puff(sparks(w.mat) ? 'spark' : 'dust', w.exit, d, 3);
      }
      if (wall && !hitPlayer) this.effects.puff(sparks(wall.solid.mat) ? 'spark' : 'dust', end, wall.normal, 3);
    }
  }

  private viewmodelMuzzleWorld(): Vec3 | null {
    // The viewmodel lives in its own camera space; start tracers slightly in front of the eye instead.
    const cam = this.renderer.cam;
    const d = viewDir(this.yaw, this.pitch);
    return { x: cam.position.x + d.x * 0.8 - Math.cos(this.yaw) * 0.12, y: cam.position.y + d.y * 0.8 - 0.12, z: cam.position.z + d.z * 0.8 + Math.sin(this.yaw) * 0.12 };
  }

  /** Leave the room and tear down. */
  leave(): void {
    this.socket.leaveRoom();
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const cl of this.hookCleanups.splice(0)) cl();
    for (const off of this.offs) off();
    this.offs = [];
    this.net.dispose();
    this.controls.dispose();
    this.viewmodel.dispose();
    this.remotes.dispose();
    this.effects.dispose();
    this.clearEntities();
    this.map?.dispose();
    this.map = null;
    this.renderer.damage = 0;
    this.renderer.zoom = 1;
    this.renderer.updateFov();
    this.renderer.clear();
    if (client.match === this) client.match = null;
  }
}
