/**
 * Recorded sound effects: how each shipped file is cut from the approved raw recordings
 * (docs/audio/sfx-manifest.md), and which game sound id plays which files.
 *
 * - `SFX_RECIPES` is the build input for `scripts/sfx-build.ts` (ffmpeg): trim, align to the attack,
 *   fade, mono, 22050 Hz, optional pitch / filters / light bitcrush, loudness-normalise to the
 *   recipe's level, MP3. Output: `assets/sfx/<file>.mp3`, served at `/sfx/<file>.mp3`.
 * - `SFX_BINDINGS` maps a sound id (what `sfx.play(id)` / `sfx.gunshot()` use) to its variants and
 *   per-id playback tweaks. The client registers them with `sfx.registerSample`; the synthesized
 *   voice for the same id stays as the fallback until a sample has loaded (or if it fails).
 * - `SFX_SYNTH_ONLY` lists ids that intentionally stay synthesized (no fitting recording).
 *
 * Pure data, no DOM: shared by the build script, the client and the tests.
 */
import { WEAPONS, type WeaponClass } from './weapons';

/**
 * Loudness classes. Files are normalised to `lufs` (EBU R128 momentary max, 400 ms) and run through a
 * look-ahead limiter at `peak` (dBFS), taking off at most `limit` dB (recordings with a sharp
 * transient, like near-mic gunshots, get their crack tamed so the body comes up; CoD-style).
 */
export type SfxLevel = 'gun' | 'gunSup' | 'distant' | 'boom' | 'mech' | 'foley' | 'step' | 'ui' | 'alert' | 'vehicle';

export const SFX_LEVELS: Record<SfxLevel, { lufs: number; peak: number; limit: number; crush?: { bits: number; mix: number }; kbps: number }> = {
  gun: { lufs: -14, peak: -2, limit: 22, crush: { bits: 11, mix: 0.35 }, kbps: 64 },
  gunSup: { lufs: -17, peak: -4, limit: 14, crush: { bits: 11, mix: 0.3 }, kbps: 56 },
  distant: { lufs: -16, peak: -3, limit: 14, crush: { bits: 10, mix: 0.3 }, kbps: 48 },
  boom: { lufs: -12, peak: -1.5, limit: 8, crush: { bits: 10, mix: 0.35 }, kbps: 64 },
  mech: { lufs: -20, peak: -5, limit: 6, crush: { bits: 12, mix: 0.25 }, kbps: 48 },
  foley: { lufs: -18, peak: -4, limit: 6, crush: { bits: 12, mix: 0.25 }, kbps: 48 },
  step: { lufs: -27, peak: -8, limit: 12, kbps: 48 },
  ui: { lufs: -20, peak: -6, limit: 6, kbps: 48 },
  alert: { lufs: -18, peak: -5, limit: 6, crush: { bits: 10, mix: 0.3 }, kbps: 48 },
  vehicle: { lufs: -16, peak: -3, limit: 6, crush: { bits: 10, mix: 0.3 }, kbps: 48 },
};

export interface SfxRecipe {
  /** Output name: `assets/sfx/<file>.mp3`. */
  file: string;
  /** Raw source, relative to the raw folder (see scripts/sfx-sources.ts `rawName`; Kenney files are inside the unpacked zip folder). */
  src: string;
  /** Seconds into the source, and length. */
  start: number;
  dur: number;
  level: SfxLevel;
  /**
   * Snap the start to the attack: the first sample louder than this many dB below the slice's
   * peak, minus 3 ms. `false` keeps `start` as is (loops, swells). Default -30.
   */
  align?: number | false;
  /** Fade-in / fade-out seconds (fade-out default: 40% of the length, at most 0.3 s). */
  fadeIn?: number;
  fadeOut?: number;
  /** Pitch/speed change baked in (1 = none; 0.8 = lower and longer). */
  rate?: number;
  highpass?: number;
  lowpass?: number;
  /**
   * Slap-back echoes added to a dry recording (ffmpeg aecho: delays ms, decays), e.g. the FFSL near
   * mics, which are a 30 ms crack with almost no room; CoD layers a tail on every gun.
   */
  echo?: { delays: number[]; decays: number[] };
  /** Play the slice backwards (the ear-ring swells in the recording; reversed it rings then fades). */
  reverse?: boolean;
  /** Override the level's loudness target (LUFS, momentary max). */
  lufs?: number;
  /** Override the level's bitcrush (`false` = none). */
  crush?: { bits: number; mix: number } | false;
}

const FFSL = (name: string) => `ffsl/${name}.wav`;
const FS = (id: number) => `fs/${id}.mp3`;
const IMPACT = (name: string) => `kenney/impact-sounds/Audio/${name}.ogg`;
const UI = (name: string) => `kenney/interface-sounds/Audio/${name}.ogg`;

/** Outdoor slap-back for the dry FFSL near mics (short for small arms, long for the big calibres). */
const SLAP = { delays: [35, 80, 135, 220], decays: [0.5, 0.34, 0.22, 0.12] };
const SLAP_LONG = { delays: [55, 130, 240, 380], decays: [0.5, 0.36, 0.24, 0.14] };

const R = (file: string, src: string, start: number, dur: number, level: SfxLevel, o: Partial<SfxRecipe> = {}): SfxRecipe => ({ file, src, start, dur, level, ...o });

export const SFX_RECIPES: SfxRecipe[] = [
  // ---- Gunshots: class recordings (FFSL near mics have 2-4 clean shots per file) ----
  R('gun_ar_a', FFSL('AR-15_D_32P'), 0.6, 0.8, 'gun', { echo: SLAP, highpass: 60 }),
  R('gun_ar_b', FFSL('AR-15_D_32P'), 5.55, 0.8, 'gun', { echo: SLAP, highpass: 60 }),
  R('gun_ar_c', FS(737569), 0, 0.8, 'gun', { highpass: 60 }),
  R('gun_ak_a', FFSL('AK-47_C_28P'), 0.5, 0.85, 'gun', { echo: SLAP, highpass: 50 }),
  R('gun_ak_b', FFSL('AK-47_C_28P'), 3.15, 0.85, 'gun', { echo: SLAP, highpass: 50 }),
  R('gun_ak_c', FFSL('AK-47_C_28P'), 5.92, 0.85, 'gun', { echo: SLAP, highpass: 50 }),
  R('gun_ak_d', FFSL('AK-47_C_28P'), 9.05, 0.85, 'gun', { echo: SLAP, highpass: 50 }),
  R('gun_ak_e', FS(163457), 0, 0.6, 'gun', { highpass: 50 }),
  R('gun_smg_a', FFSL('Carl_Gustav_M45_G_31P'), 0.2, 0.6, 'gun', { echo: SLAP, highpass: 80 }),
  R('gun_smg_b', FFSL('Carl_Gustav_M45_G_31P'), 3.38, 0.6, 'gun', { echo: SLAP, highpass: 80 }),
  R('gun_smg_c', FFSL('Carl_Gustav_M45_G_31P'), 6.62, 0.6, 'gun', { echo: SLAP, highpass: 80 }),
  // The machine-gun burst's last round has a clean tail.
  R('gun_rpk_a', FS(482122), 1.22, 0.38, 'gun', { highpass: 50, fadeOut: 0.15 }),
  R('gun_sniper_a', FFSL('Tikka_W_29P'), 0.5, 1.3, 'gun', { echo: SLAP_LONG, highpass: 40, fadeOut: 0.6 }),
  R('gun_sniper_b', FFSL('Tikka_W_29P'), 5.58, 1.3, 'gun', { echo: SLAP_LONG, highpass: 40, fadeOut: 0.6 }),
  R('gun_sniper_c', FS(855606), 0, 1.3, 'gun', { highpass: 40, fadeOut: 0.6 }),
  R('gun_dragunov_a', FS(163460), 0, 0.67, 'gun', { highpass: 40 }),
  R('gun_shotgun_a', FFSL('Nova_O_21P'), 0.35, 0.95, 'gun', { echo: SLAP_LONG, highpass: 40, fadeOut: 0.45 }),
  R('gun_shotgun_b', FFSL('Nova_O_21P'), 3.38, 0.95, 'gun', { echo: SLAP_LONG, highpass: 40, fadeOut: 0.45 }),
  R('gun_olympia_a', FS(405504), 0, 1.1, 'gun', { highpass: 40, fadeOut: 0.5 }),
  R('gun_olympia_b', FS(163455), 0, 0.69, 'gun', { highpass: 40 }),
  R('gun_spas_a', FS(473846), 0, 1.0, 'gun', { highpass: 40, fadeOut: 0.45 }),
  R('gun_m1911_a', FS(163456), 0, 0.46, 'gun', { highpass: 70 }),
  R('gun_m1911_b', FS(740897), 0, 0.7, 'gun', { highpass: 70 }),
  R('gun_asp_a', FS(734061), 0, 0.42, 'gun', { highpass: 90, fadeOut: 0.2 }),
  R('gun_asp_b', FS(427592), 0.08, 0.55, 'gun', { highpass: 90 }),
  R('gun_python_a', FFSL('Smith_Wesson_642_V_27P'), 0.7, 0.9, 'gun', { echo: SLAP, highpass: 50, fadeOut: 0.45 }),
  R('gun_python_b', FFSL('Smith_Wesson_642_V_27P'), 6.12, 0.9, 'gun', { echo: SLAP, highpass: 50, fadeOut: 0.45 }),
  R('gun_gl_a', FS(163458), 0, 0.44, 'gun', { highpass: 40 }),
  R('gun_gl_b', FS(162402), 0, 0.45, 'gun', { highpass: 40 }),
  // Suppressed.
  R('sup_pistol_a', FS(827945), 0, 0.35, 'gunSup', { highpass: 80 }),
  R('sup_pistol_b', FS(828790), 0, 0.5, 'gunSup', { highpass: 80 }),
  R('sup_pistol_c', FS(828790), 0.7, 0.5, 'gunSup', { highpass: 80 }),
  R('sup_pistol_d', FS(828790), 1.4, 0.5, 'gunSup', { highpass: 80 }),
  R('sup_rifle_a', FS(737570), 0, 0.45, 'gunSup', { highpass: 60, fadeOut: 0.25 }),
  R('sup_smg_a', FS(740120), 0, 0.13, 'gunSup', { highpass: 80, fadeOut: 0.07 }),
  // Distant layer (AR-15 mid-distance mic): blended in by distance.
  R('gun_distant_a', FFSL('AR-15_D_24P'), 0.45, 1.6, 'distant', { highpass: 80, lowpass: 5000, fadeOut: 0.9 }),
  R('gun_distant_b', FFSL('AR-15_D_24P'), 3.8, 1.6, 'distant', { highpass: 80, lowpass: 5000, fadeOut: 0.9 }),

  // ---- Weapon handling ----
  R('mech_bolt', FS(267895), 1.1, 1.38, 'mech', { fadeOut: 0.15 }),
  R('mech_pump', FS(613801), 0.08, 0.6, 'mech', { fadeOut: 0.15 }),
  // A full M16 reload and a short AR reload, split into mag out / mag in / charging handle.
  R('mech_magout_a', FS(719243), 0.12, 0.35, 'mech', { fadeOut: 0.1 }),
  R('mech_magout_b', FS(725397), 0.14, 0.6, 'mech', { fadeOut: 0.15 }),
  R('mech_magout_c', FS(815879), 0.02, 0.36, 'mech', { fadeOut: 0.1 }),
  R('mech_magin_a', FS(379977), 0.04, 0.6, 'mech', { fadeOut: 0.15 }),
  R('mech_magin_b', FS(725397), 2.05, 0.8, 'mech', { fadeOut: 0.15 }),
  R('mech_magin_c', FS(815879), 0.55, 0.42, 'mech', { fadeOut: 0.1 }),
  R('mech_charge_a', FS(725397), 4.85, 0.6, 'mech', { fadeOut: 0.15 }),
  R('mech_charge_b', FS(815879), 1.63, 0.24, 'mech', { fadeOut: 0.08 }),
  R('mech_handle', FS(815879), 1.32, 0.3, 'mech', { fadeOut: 0.1 }),
  R('mech_shell', FS(379977), 0.2, 0.22, 'mech', { fadeOut: 0.08 }),
  R('mech_brass_a', FS(620929), 0.05, 0.5, 'foley', { fadeOut: 0.2 }),
  R('mech_brass_b', FS(620929), 0.3, 0.6, 'foley', { fadeOut: 0.25 }),
  // Toy break-action, pitched down a fourth so it reads as a real shotgun.
  R('mech_break_open', 'oga/toy-double-barrel-shotgun-uncocked.wav', 0, 0.5, 'mech', { rate: 0.75, fadeOut: 0.1 }),
  R('mech_break_close', 'oga/toy-double-barrel-shotgun-cocked.wav', 0, 0.42, 'mech', { rate: 0.75, fadeOut: 0.1 }),
  R('mech_dryfire_a', FS(725402), 0, 0.16, 'mech', { fadeOut: 0.06 }),
  R('mech_dryfire_b', FS(842748), 0, 0.1, 'mech', { fadeOut: 0.04 }),

  // ---- Equipment, melee ----
  R('foley_knife', FS(389690), 0.4, 0.4, 'foley', { align: -24, fadeIn: 0.02, fadeOut: 0.15 }),
  R('foley_stab', FS(504615), 0, 0.6, 'foley', { fadeOut: 0.2 }),
  R('foley_pin', FS(725398), 0, 0.75, 'foley', { fadeOut: 0.35 }),
  R('foley_bounce', FS(389420), 0.4, 0.5, 'foley', { fadeOut: 0.2 }),
  R('boom_frag_a', FS(855798), 0, 1.7, 'boom', { fadeOut: 0.8 }),
  R('boom_frag_b', FS(609587), 0, 1.6, 'boom', { fadeOut: 0.8 }),
  R('boom_flash', FS(693421), 0, 1.0, 'boom', { fadeOut: 0.5, highpass: 120 }),
  R('ui_ring', FS(365956), 4.6, 3.0, 'ui', { align: false, reverse: true, fadeIn: 0.01, fadeOut: 1.2, crush: false }),

  // ---- Player: footsteps (Kenney impact pack; metal from BlondPanda + Kenney plates), hurt, UI ----
  ...[0, 1, 2, 3, 4].flatMap((i) => [
    R(`step_concrete_${i}`, IMPACT(`footstep_concrete_00${i}`), 0, 0.35, 'step', { fadeOut: 0.1 }),
    R(`step_grass_${i}`, IMPACT(`footstep_grass_00${i}`), 0, 0.35, 'step', { fadeOut: 0.1 }),
    R(`step_wood_${i}`, IMPACT(`footstep_wood_00${i}`), 0, 0.35, 'step', { fadeOut: 0.1 }),
    R(`step_carpet_${i}`, IMPACT(`footstep_carpet_00${i}`), 0, 0.35, 'step', { fadeOut: 0.1 }),
  ]),
  R('step_metal_0', FS(778437), 0, 0.45, 'step', { fadeOut: 0.15 }),
  R('step_metal_1', IMPACT('impactPlate_light_000'), 0, 0.3, 'step', { fadeOut: 0.12, lowpass: 6000 }),
  R('step_metal_2', IMPACT('impactPlate_light_002'), 0, 0.3, 'step', { fadeOut: 0.12, lowpass: 6000 }),
  R('foley_hurt_a', FS(138481), 0, 0.22, 'foley', { fadeOut: 0.08 }),
  R('foley_hurt_b', IMPACT('impactPunch_medium_000'), 0, 0.3, 'foley', { fadeOut: 0.1 }),
  R('ui_tick_a', UI('tick_004'), 0, 0.08, 'ui', { fadeOut: 0.03, lufs: -26 }),
  R('ui_tick_b', UI('tick_001'), 0, 0.06, 'ui', { fadeOut: 0.02, lufs: -26 }),
  R('ui_good', UI('confirmation_002'), 0, 0.6, 'ui', { fadeOut: 0.15 }),
  R('ui_bad', UI('error_003'), 0, 0.5, 'ui', { fadeOut: 0.15 }),

  // ---- Killstreaks ----
  R('ks_static', FS(524204), 1.0, 0.4, 'alert', { align: false, fadeIn: 0.03, fadeOut: 0.15 }),
  R('ks_confirm', FS(701326), 0, 0.6, 'alert', { fadeOut: 0.15 }),
  R('ks_mark', FS(321906), 0, 0.15, 'alert', { fadeOut: 0.04 }),
  R('ks_ready', FS(701327), 0, 0.59, 'alert', { fadeOut: 0.12 }),
  R('ks_call', FS(524205), 0, 0.24, 'alert', { fadeOut: 0.06 }),
  R('ks_jet', FS(189446), 3.6, 4.0, 'vehicle', { align: false, fadeIn: 0.6, fadeOut: 1.4 }),
  R('ks_prop', FS(403316), 4.6, 0.5, 'vehicle', { align: false, fadeIn: 0.04, fadeOut: 0.08 }),
  R('ks_rotor_a', FS(854493), 0.3, 0.13, 'vehicle', { align: false, fadeIn: 0.01, fadeOut: 0.05 }),
  R('ks_rotor_b', FS(854493), 1.7, 0.13, 'vehicle', { align: false, fadeIn: 0.01, fadeOut: 0.05 }),
  R('ks_sentry_a', FS(239138), 0.1, 0.15, 'gun', { fadeOut: 0.07 }),
  R('ks_sentry_b', FS(239138), 0.44, 0.15, 'gun', { fadeOut: 0.07 }),
  R('ks_sentry_c', FS(239138), 1.12, 0.15, 'gun', { fadeOut: 0.07 }),
  R('ks_gunner', FS(163119), 1.0, 0.22, 'gun', { align: false, fadeIn: 0.02, fadeOut: 0.08 }),
  R('ks_launch', FS(854476), 0, 0.9, 'boom', { fadeOut: 0.4 }),
  R('ks_whistle', FS(241840), 0.05, 1.55, 'vehicle', { align: -36, fadeOut: 0.3 }),
  R('boom_big', FS(741173), 0, 2.6, 'boom', { fadeOut: 1.4 }),
  R('boom_medium', FS(516914), 0.3, 1.7, 'boom', { fadeOut: 0.9 }),
  R('ks_bark', FS(277058), 0, 0.25, 'foley', { fadeOut: 0.06 }),
  R('ks_bite', FS(483190), 0.4, 0.45, 'foley', { fadeOut: 0.15 }),
  R('alert_klaxon', FS(514982), 0.1, 1.25, 'alert', { align: -36, fadeOut: 0.25 }),

  // ---- Modes ----
  R('alert_horn', FS(131930), 0.3, 1.2, 'alert', { fadeOut: 0.35 }),
  R('alert_beep', FS(138108), 0.13, 0.14, 'alert', { fadeOut: 0.03, highpass: 400 }),
  R('ui_pickup', FS(678384), 0, 0.18, 'ui', { align: false, fadeOut: 0.04 }),
];

export const RECIPE_BY_FILE = new Map(SFX_RECIPES.map((r) => [r.file, r]));

/** How a sound id plays its recordings. */
export interface SfxBinding {
  /** Variant files (round-robin with no immediate repeat). */
  files: string[];
  /** Gain on top of the caller's volume. */
  gain?: number;
  /** Playback-rate multiplier (pitch). */
  rate?: number;
  /** Random pitch spread (+-fraction) and volume spread (+-dB) per play. */
  pitchJitter?: number;
  volJitter?: number;
  /** Per-id EQ: low-pass / high-pass cutoffs (Hz). */
  lowpass?: number;
  highpass?: number;
  /** Most simultaneous voices of this id (oldest stops first). */
  maxVoices?: number;
  /** Synth id to play until the files load, when this id has no synthesized voice of its own. */
  fallback?: string;
}

/**
 * Per-weapon gun voices: a class pool plus pitch/EQ so guns sharing a recording still differ.
 * `sup` is the suppressed pool. Every WEAPONS entry with a gunshot appears here (tested).
 */
export const WEAPON_SHOTS: Record<string, { files: string[]; rate: number; gain?: number; lowpass?: number; highpass?: number; sup: string[]; supRate?: number }> = {
  m16: { files: ['gun_ar_a', 'gun_ar_b', 'gun_ar_c'], rate: 1.05, highpass: 120, sup: ['sup_rifle_a', 'sup_pistol_b', 'sup_pistol_c'], supRate: 0.95 },
  famas: { files: ['gun_ar_a', 'gun_ar_b'], rate: 1.14, gain: 0.9, highpass: 180, sup: ['sup_rifle_a', 'sup_pistol_c', 'sup_pistol_d'], supRate: 1.05 },
  commando: { files: ['gun_ar_b', 'gun_ar_c'], rate: 0.97, lowpass: 7000, sup: ['sup_rifle_a', 'sup_pistol_b'], supRate: 0.92 },
  aug: { files: ['gun_ar_c', 'gun_ar_a'], rate: 1.0, lowpass: 8000, highpass: 90, sup: ['sup_rifle_a', 'sup_pistol_d'], supRate: 0.98 },
  // MW2 additions: class pools with their own pitch / EQ (the ACR a touch brighter and lighter, the
  // M16A4 a little lower and darker than the BO1 M16).
  acr: { files: ['gun_ar_b', 'gun_ar_c', 'gun_ar_a'], rate: 1.03, gain: 0.92, lowpass: 9000, highpass: 140, sup: ['sup_rifle_a', 'sup_pistol_c'], supRate: 1.0 },
  m16a4: { files: ['gun_ar_c', 'gun_ar_a', 'gun_ar_b'], rate: 0.98, lowpass: 8500, highpass: 100, sup: ['sup_rifle_a', 'sup_pistol_b'], supRate: 0.93 },
  ak47: { files: ['gun_ak_a', 'gun_ak_b', 'gun_ak_c', 'gun_ak_d'], rate: 1.0, sup: ['sup_rifle_a', 'sup_pistol_b', 'sup_pistol_d'], supRate: 0.88 },
  galil: { files: ['gun_ak_b', 'gun_ak_c', 'gun_ak_e'], rate: 1.07, lowpass: 7500, sup: ['sup_rifle_a', 'sup_pistol_c'], supRate: 0.92 },
  mp5k: { files: ['gun_smg_a', 'gun_smg_b', 'gun_smg_c'], rate: 1.1, gain: 0.85, sup: ['sup_smg_a', 'sup_pistol_b', 'sup_pistol_c'], supRate: 1.1 },
  ak74u: { files: ['gun_smg_a', 'gun_smg_c', 'gun_ak_e'], rate: 1.0, gain: 0.9, lowpass: 7500, sup: ['sup_smg_a', 'sup_pistol_d', 'sup_pistol_b'], supRate: 1.0 },
  mpl: { files: ['gun_smg_b', 'gun_smg_c', 'gun_smg_a'], rate: 1.24, gain: 0.8, highpass: 160, sup: ['sup_smg_a', 'sup_pistol_c', 'sup_pistol_d'], supRate: 1.2 },
  rpk: { files: ['gun_rpk_a', 'gun_ak_a', 'gun_ak_d'], rate: 0.9, sup: ['sup_rifle_a', 'sup_pistol_b'], supRate: 0.82 },
  l96a1: { files: ['gun_sniper_a', 'gun_sniper_b', 'gun_sniper_c'], rate: 1.0, gain: 1.1, sup: ['sup_rifle_a'], supRate: 0.85 },
  dragunov: { files: ['gun_dragunov_a', 'gun_sniper_c', 'gun_ak_c'], rate: 1.0, highpass: 70, sup: ['sup_rifle_a'], supRate: 0.95 },
  intervention: { files: ['gun_sniper_b', 'gun_sniper_a', 'gun_sniper_c'], rate: 0.95, gain: 1.12, lowpass: 7500, highpass: 55, sup: ['sup_rifle_a'], supRate: 0.82 },
  olympia: { files: ['gun_olympia_a', 'gun_olympia_b'], rate: 1.0, gain: 1.05, sup: ['sup_rifle_a'], supRate: 0.75 },
  stakeout: { files: ['gun_shotgun_a', 'gun_shotgun_b'], rate: 1.0, gain: 1.05, sup: ['sup_rifle_a'], supRate: 0.78 },
  spas12: { files: ['gun_spas_a', 'gun_shotgun_a', 'gun_shotgun_b'], rate: 0.93, gain: 1.05, lowpass: 6500, sup: ['sup_rifle_a'], supRate: 0.72 },
  m1911: { files: ['gun_m1911_a', 'gun_m1911_b'], rate: 1.0, gain: 0.85, sup: ['sup_pistol_a', 'sup_pistol_b', 'sup_pistol_c', 'sup_pistol_d'], supRate: 0.95 },
  python: { files: ['gun_python_a', 'gun_python_b'], rate: 0.95, gain: 1.35, sup: ['sup_pistol_a', 'sup_rifle_a'], supRate: 0.85 },
  asp: { files: ['gun_asp_a', 'gun_asp_b'], rate: 1.06, gain: 0.8, highpass: 150, sup: ['sup_pistol_a', 'sup_pistol_c', 'sup_pistol_d'], supRate: 1.12 },
  gl: { files: ['gun_gl_a', 'gun_gl_b'], rate: 1.0, sup: ['gun_gl_a', 'gun_gl_b'], supRate: 1.0 },
};

/** Distant-layer pitch by class (the layer is one AR recording). */
export const DISTANT_RATE: Record<WeaponClass, number> = { ar: 1, smg: 1.12, lmg: 0.92, sniper: 0.82, shotgun: 0.78, pistol: 1.2, launcher: 0.7, special: 1 };

const GUN = { pitchJitter: 0.035, volJitter: 1.5, maxVoices: 6 };
const steps = (surface: string, n: number, o: Partial<SfxBinding> = {}): SfxBinding => ({ files: Array.from({ length: n }, (_, i) => `step_${surface}_${i}`), gain: 1.25, pitchJitter: 0.06, volJitter: 2, maxVoices: 6, fallback: 'step', ...o });

export const SFX_BINDINGS: Record<string, SfxBinding> = {
  // Core.
  shot: { files: ['gun_ar_a', 'gun_ar_b', 'gun_ar_c'], ...GUN },
  'shot.distant': { files: ['gun_distant_a', 'gun_distant_b'], pitchJitter: 0.04, volJitter: 1.5, maxVoices: 4 },
  tick: { files: ['ui_tick_a', 'ui_tick_b'], gain: 1.6, pitchJitter: 0.02, maxVoices: 3 },
  thud: { files: ['foley_hurt_a', 'foley_hurt_b'], gain: 1.2, pitchJitter: 0.05, volJitter: 1, maxVoices: 3 },
  click: { files: ['mech_dryfire_a', 'mech_dryfire_b'], gain: 1.4, pitchJitter: 0.03, maxVoices: 2 },
  reload: { files: ['mech_handle'], gain: 0.8, pitchJitter: 0.04, maxVoices: 2 },
  step: steps('concrete', 5, { gain: 1.5 }),
  'step.concrete': steps('concrete', 5, { gain: 1.5 }),
  'step.grass': steps('grass', 5),
  'step.dirt': steps('grass', 5, { rate: 0.86, lowpass: 5000 }),
  'step.wood': steps('wood', 5),
  'step.carpet': steps('carpet', 5, { gain: 1.4 }),
  'step.metal': steps('metal', 3, { gain: 1.1 }),
  // Weapons feature.
  'weapons.bolt': { files: ['mech_bolt'], pitchJitter: 0.02, maxVoices: 2 },
  'weapons.pump': { files: ['mech_pump'], pitchJitter: 0.02, maxVoices: 2 },
  'weapons.shell': { files: ['mech_shell'], pitchJitter: 0.05, volJitter: 1, maxVoices: 2 },
  'weapons.brass': { files: ['mech_brass_a', 'mech_brass_b'], gain: 0.5, pitchJitter: 0.08, volJitter: 3, maxVoices: 2 },
  'weapons.magout': { files: ['mech_magout_a', 'mech_magout_b', 'mech_magout_c'], pitchJitter: 0.03, maxVoices: 2 },
  'weapons.magin': { files: ['mech_magin_a', 'mech_magin_b', 'mech_magin_c'], pitchJitter: 0.03, maxVoices: 2 },
  'weapons.charge': { files: ['mech_charge_a', 'mech_charge_b'], pitchJitter: 0.03, maxVoices: 2, fallback: 'weapons.bolt' },
  'weapons.break': { files: ['mech_break_open'], pitchJitter: 0.02, maxVoices: 2 },
  'weapons.breakclose': { files: ['mech_break_close'], pitchJitter: 0.02, maxVoices: 2, fallback: 'weapons.break' },
  'weapons.knife': { files: ['foley_knife'], pitchJitter: 0.08, volJitter: 1, maxVoices: 3 },
  'weapons.stab': { files: ['foley_stab'], pitchJitter: 0.06, maxVoices: 3 },
  'weapons.pin': { files: ['foley_pin'], gain: 0.8, pitchJitter: 0.04, maxVoices: 3 },
  'weapons.bounce': { files: ['foley_bounce'], pitchJitter: 0.1, volJitter: 2, maxVoices: 4 },
  'weapons.boom': { files: ['boom_frag_a', 'boom_frag_b'], pitchJitter: 0.04, volJitter: 1, maxVoices: 4 },
  'weapons.flashbang': { files: ['boom_flash'], pitchJitter: 0.03, maxVoices: 3 },
  'weapons.ring': { files: ['ui_ring'], gain: 1.4, maxVoices: 1 },
  // Killstreaks.
  ks_ready: { files: ['ks_ready'], gain: 1.2, maxVoices: 1 },
  ks_call: { files: ['ks_call'], maxVoices: 2 },
  ks_alarm: { files: ['alert_klaxon'], maxVoices: 1 },
  ks_boom: { files: ['boom_medium', 'boom_frag_a'], pitchJitter: 0.04, maxVoices: 4 },
  ks_bigboom: { files: ['boom_big'], pitchJitter: 0.04, volJitter: 1, maxVoices: 4 },
  ks_whistle: { files: ['ks_whistle'], pitchJitter: 0.03, maxVoices: 4 },
  ks_jet: { files: ['ks_jet'], pitchJitter: 0.03, maxVoices: 2 },
  ks_rotor: { files: ['ks_rotor_a', 'ks_rotor_b'], gain: 0.9, pitchJitter: 0.01, maxVoices: 6 },
  ks_prop: { files: ['ks_prop'], gain: 0.8, pitchJitter: 0.01, maxVoices: 3 },
  ks_bark: { files: ['ks_bark'], pitchJitter: 0.08, maxVoices: 4 },
  ks_bite: { files: ['ks_bite'], pitchJitter: 0.06, maxVoices: 3 },
  ks_launch: { files: ['ks_launch'], pitchJitter: 0.04, maxVoices: 3 },
  ks_sentry: { files: ['ks_sentry_a', 'ks_sentry_b', 'ks_sentry_c'], gain: 0.6, pitchJitter: 0.03, volJitter: 1.5, maxVoices: 4 },
  ks_gunner: { files: ['ks_gunner'], gain: 0.6, pitchJitter: 0.02, maxVoices: 3, fallback: 'ks_sentry' },
  ks_static: { files: ['ks_static'], pitchJitter: 0.05, maxVoices: 2 },
  ks_mark: { files: ['ks_mark'], pitchJitter: 0.02, maxVoices: 2 },
  ks_confirm: { files: ['ks_confirm'], maxVoices: 1 },
  // Modes.
  'modes.good': { files: ['ui_good'], gain: 1.2, maxVoices: 1 },
  'modes.bad': { files: ['ui_bad'], gain: 1.2, maxVoices: 1 },
  'modes.horn': { files: ['alert_horn'], maxVoices: 1 },
  'modes.alarm': { files: ['alert_klaxon'], maxVoices: 1 },
  'modes.pickup': { files: ['ui_pickup'], gain: 1.2, maxVoices: 2 },
  'modes.beep': { files: ['alert_beep'], maxVoices: 2 },
  'modes.boom': { files: ['boom_big'], maxVoices: 2 },
};

for (const [id, w] of Object.entries(WEAPON_SHOTS)) {
  SFX_BINDINGS[`shot.${id}`] = { files: w.files, rate: w.rate, gain: w.gain, lowpass: w.lowpass, highpass: w.highpass, ...GUN };
  SFX_BINDINGS[`shot.${id}.sup`] = { files: w.sup, rate: w.supRate ?? 1, gain: w.gain, ...GUN };
}
// Wager specials (economy's crossbow and ballistic knife): no recordings of either, so a snap and a
// spring clack from the handling recordings rather than a gunshot.
SFX_BINDINGS['shot.crossbow'] = { files: ['mech_break_close'], rate: 0.85, gain: 1.6, pitchJitter: 0.04, volJitter: 1, maxVoices: 4, fallback: 'shot' };
SFX_BINDINGS['shot.ballistic_knife'] = { files: ['mech_charge_b'], rate: 1.1, gain: 1.6, pitchJitter: 0.04, volJitter: 1, maxVoices: 4, fallback: 'shot' };

/** Ids that stay synthesized on purpose (no fitting recording in the manifest, or unused). */
export const SFX_SYNTH_ONLY: Record<string, string> = {
  ks_buzz: 'RC-XD motor: no small-motor recording in the manifest',
  ks_fire: 'napalm fire crackle: no fire recording in the manifest',
  'weapons.thump': 'registered but not played anywhere',
};

/** Recorded-only ids with no synthesized fallback on purpose: extra layers that may simply be absent until loaded. */
export const SFX_SAMPLE_ONLY: Record<string, string> = {
  'shot.distant': 'distant gunfire layer on top of the near shot',
  'weapons.brass': 'occasional casing tinkle after a shot',
};

/** Weapon ids that need a gun voice in WEAPON_SHOTS: every weapon but the 'special' class (knife, wager crossbow / ballistic knife). */
export const gunWeaponIds = (): string[] => WEAPONS.filter((w) => w.class !== 'special').map((w) => w.id);
