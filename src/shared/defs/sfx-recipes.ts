/**
 * Recorded sound effects: how each shipped file is cut from the approved raw recordings
 * (docs/audio/sfx-manifest.md), and which game sound id plays which files.
 *
 * - `SFX_RECIPES` is the build input for `scripts/sfx-build.ts` (ffmpeg): trim, align to the attack,
 *   fade, mono, 44.1 kHz, optional gentle high/low-pass, loudness-normalise to the level's target
 *   through a gentle limiter (a few dB at most), MP3 128/112 kbps. Output: `assets/sfx/<file>.mp3`,
 *   served at `/sfx/<file>.mp3`. Processing is deliberately conservative: no echo, no bitcrush, no
 *   reversing, no pitching beyond +-3%; the recordings keep their natural tails.
 * - `SFX_BINDINGS` maps a sound id (what `sfx.play(id)` / `sfx.gunshot()` use) to its variants and
 *   per-id playback tweaks. The client registers them with `sfx.registerSample`; the synthesized
 *   voice for the same id stays as the fallback until a sample has loaded (or if it fails).
 * - `SFX_SYNTH_ONLY` lists ids that intentionally stay synthesized (no fitting recording).
 *
 * Pure data, no DOM: shared by the build script, the client and the tests.
 */
import { SFX_CUES } from './sfx-cues';
import { WEAPONS, type WeaponClass } from './weapons';

/**
 * Loudness classes. Files are normalised towards `lufs` (EBU R128 momentary max, 400 ms) through a
 * look-ahead limiter whose ceiling sits 0.5 dB under `peak` (dBTP), taking off at most `limit` dB
 * (recordings with very sharp transients simply land a little under the target rather than being
 * squashed). `kbps`: MP3 bit rate (MPEG-1 layer III, mono, 44.1 kHz).
 */
export type SfxLevel = 'gun' | 'gunSup' | 'distant' | 'boom' | 'mech' | 'foley' | 'step' | 'ui' | 'alert' | 'vehicle';

export const SFX_LEVELS: Record<SfxLevel, { lufs: number; peak: number; limit: number; kbps: number }> = {
  gun: { lufs: -24, peak: -1, limit: 6, kbps: 128 },
  gunSup: { lufs: -24, peak: -3, limit: 4, kbps: 128 },
  distant: { lufs: -23, peak: -3, limit: 4, kbps: 128 },
  boom: { lufs: -16, peak: -1, limit: 5, kbps: 128 },
  mech: { lufs: -26, peak: -4, limit: 4, kbps: 112 },
  foley: { lufs: -24, peak: -3, limit: 4, kbps: 112 },
  step: { lufs: -34, peak: -8, limit: 3, kbps: 112 },
  ui: { lufs: -26, peak: -6, limit: 3, kbps: 112 },
  alert: { lufs: -24, peak: -5, limit: 3, kbps: 112 },
  vehicle: { lufs: -22, peak: -3, limit: 4, kbps: 112 },
};

/** Build-time pitch changes are only allowed within this fraction (tested). */
export const MAX_BUILD_RATE_CHANGE = 0.03;
/** Per-weapon playback rates stay within this fraction of 1, and per-shot jitter within these (tested). */
export const MAX_WEAPON_RATE_CHANGE = 0.06;
export const MAX_SHOT_PITCH_JITTER = 0.03;
export const MAX_SHOT_VOL_JITTER_DB = 1.5;

export interface SfxRecipe {
  /** Output name: `assets/sfx/<file>.mp3`. */
  file: string;
  /**
   * Raw source, relative to the raw folder (see scripts/sfx-sources.ts `rawName`; Kenney files are
   * inside the unpacked zip folder), or `synth/<cue>` for a synthesized cue from sfx-cues.ts.
   */
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
  /** Tiny pitch/speed correction baked in (within +-MAX_BUILD_RATE_CHANGE; 1 = none). */
  rate?: number;
  highpass?: number;
  lowpass?: number;
  /** Override the level's loudness target (LUFS, momentary max). */
  lufs?: number;
}

const FFSL = (name: string) => `ffsl/${name}.wav`;
const FS = (id: number) => `fs/${id}.mp3`;
const IMPACT = (name: string) => `kenney/impact-sounds/Audio/${name}.ogg`;
const SYNTH = (cue: keyof typeof SFX_CUES) => `synth/${cue}`;

const R = (file: string, src: string, start: number, dur: number, level: SfxLevel, o: Partial<SfxRecipe> = {}): SfxRecipe => ({ file, src, start, dur, level, ...o });

export const SFX_RECIPES: SfxRecipe[] = [
  // ---- Gunshots: class recordings with their natural tails. The FFSL near mics have 2-4 clean
  // shots per file and decay to -50 dB in 0.6-1.0 s; the Freesound shots carry their own room. ----
  R('gun_ar_a', FFSL('AR-15_D_32P'), 0.6, 1.1, 'gun', { highpass: 40, fadeOut: 0.4 }),
  R('gun_ar_b', FFSL('AR-15_D_32P'), 5.55, 1.1, 'gun', { highpass: 40, fadeOut: 0.4 }),
  R('gun_ar_c', FS(737569), 0, 1.5, 'gun', { highpass: 40, fadeOut: 0.6 }),
  R('gun_ak_a', FFSL('AK-47_C_28P'), 0.5, 1.1, 'gun', { highpass: 40, fadeOut: 0.4 }),
  R('gun_ak_b', FFSL('AK-47_C_28P'), 3.15, 1.1, 'gun', { highpass: 40, fadeOut: 0.4 }),
  R('gun_ak_c', FFSL('AK-47_C_28P'), 5.92, 1.1, 'gun', { highpass: 40, fadeOut: 0.4 }),
  R('gun_ak_d', FFSL('AK-47_C_28P'), 9.05, 1.1, 'gun', { highpass: 40, fadeOut: 0.4 }),
  R('gun_ak_e', FS(163457), 0, 0.6, 'gun', { highpass: 40, fadeOut: 0.15 }),
  R('gun_smg_a', FFSL('Carl_Gustav_M45_G_31P'), 0.2, 0.95, 'gun', { highpass: 50, fadeOut: 0.35 }),
  R('gun_smg_b', FFSL('Carl_Gustav_M45_G_31P'), 3.38, 0.95, 'gun', { highpass: 50, fadeOut: 0.35 }),
  R('gun_smg_c', FFSL('Carl_Gustav_M45_G_31P'), 6.62, 0.95, 'gun', { highpass: 50, fadeOut: 0.35 }),
  R('gun_sniper_a', FFSL('Tikka_W_29P'), 0.5, 1.5, 'gun', { highpass: 30, fadeOut: 0.5 }),
  R('gun_sniper_b', FFSL('Tikka_W_29P'), 5.58, 1.5, 'gun', { highpass: 30, fadeOut: 0.5 }),
  R('gun_sniper_c', FS(855606), 0, 1.4, 'gun', { highpass: 30, fadeOut: 0.3 }),
  R('gun_dragunov_a', FS(163460), 0, 0.67, 'gun', { highpass: 30, fadeOut: 0.15 }),
  R('gun_shotgun_a', FFSL('Nova_O_21P'), 0.35, 1.3, 'gun', { highpass: 30, fadeOut: 0.45 }),
  R('gun_shotgun_b', FFSL('Nova_O_21P'), 3.38, 1.3, 'gun', { highpass: 30, fadeOut: 0.45 }),
  R('gun_olympia_a', FS(405504), 0, 1.9, 'gun', { highpass: 30, fadeOut: 0.7 }),
  R('gun_olympia_b', FS(163455), 0, 0.69, 'gun', { highpass: 30, fadeOut: 0.15 }),
  R('gun_spas_a', FS(473846), 0, 1.8, 'gun', { highpass: 30, fadeOut: 0.7 }),
  R('gun_m1911_a', FS(163456), 0, 0.46, 'gun', { highpass: 50, fadeOut: 0.12 }),
  R('gun_m1911_b', FS(740897), 0, 1.4, 'gun', { highpass: 50, fadeOut: 0.6 }),
  R('gun_asp_a', FS(734061), 0, 1.4, 'gun', { highpass: 50, fadeOut: 0.6 }),
  R('gun_asp_b', FS(427592), 0.08, 1.2, 'gun', { highpass: 50, fadeOut: 0.4 }),
  R('gun_python_a', FFSL('Smith_Wesson_642_V_27P'), 0.7, 0.9, 'gun', { highpass: 40, fadeOut: 0.35 }),
  R('gun_python_b', FFSL('Smith_Wesson_642_V_27P'), 6.12, 0.9, 'gun', { highpass: 40, fadeOut: 0.35 }),
  R('gun_gl_a', FS(163458), 0, 0.19, 'gun', { highpass: 30, fadeOut: 0.07 }),
  R('gun_gl_b', FS(162402), 0, 0.5, 'gun', { highpass: 30, fadeOut: 0.12 }),
  // Suppressed (the SIG file has three shots ~0.72 s apart; each slice stops before the next).
  R('sup_pistol_a', FS(827945), 0, 0.6, 'gunSup', { highpass: 60, fadeOut: 0.25 }),
  R('sup_pistol_b', FS(828790), 0, 0.68, 'gunSup', { highpass: 60, fadeOut: 0.3 }),
  R('sup_pistol_c', FS(828790), 0.7, 0.66, 'gunSup', { highpass: 60, fadeOut: 0.3 }),
  R('sup_pistol_d', FS(828790), 1.4, 0.7, 'gunSup', { highpass: 60, fadeOut: 0.3 }),
  R('sup_rifle_a', FS(737570), 0, 0.85, 'gunSup', { highpass: 50, fadeOut: 0.5 }),
  // Distant layer (AR-15 mid-distance mic, ~2 s natural tail): crossfaded in at range.
  R('gun_distant_a', FFSL('AR-15_D_24P'), 0.45, 2.2, 'distant', { highpass: 60, fadeOut: 0.8 }),
  R('gun_distant_b', FFSL('AR-15_D_24P'), 3.8, 2.2, 'distant', { highpass: 60, fadeOut: 0.8 }),

  // ---- Weapon handling: one clean mag out / mag in per class (rifle: the qubodup AR reload's
  // first two actions; pistol: the dedicated pistol mag-out and mag-insert recordings). The AR
  // reload's last pair of clacks (pull, then a louder slam 0.24 s later) is the charging handle.
  R('mech_magout_rifle', FS(815879), 0.02, 0.38, 'mech', { fadeOut: 0.08 }),
  R('mech_magin_rifle', FS(815879), 0.54, 0.44, 'mech', { fadeOut: 0.1 }),
  R('mech_charge', FS(815879), 1.32, 0.52, 'mech', { fadeOut: 0.12 }),
  R('mech_magout_pistol', FS(719243), 0, 0.46, 'mech', { fadeOut: 0.08 }),
  R('mech_magin_pistol', FS(379977), 0, 0.6, 'mech', { fadeOut: 0.12 }),
  R('mech_shell', FS(379977), 0.2, 0.22, 'mech', { fadeOut: 0.08 }),
  // Mosin bolt: lift, back, forward, lock (1.1-2.45 s). Its first and last clacks double as the
  // break-action open/close (real gun metal, replacing the pitched-down toy shotgun).
  R('mech_bolt', FS(267895), 1.08, 1.4, 'mech', { fadeOut: 0.15 }),
  R('mech_break_open', FS(267895), 1.08, 0.36, 'mech', { fadeOut: 0.12 }),
  R('mech_break_close', FS(267895), 2.24, 0.3, 'mech', { fadeOut: 0.1 }),
  R('mech_pump', FS(613801), 0.08, 0.6, 'mech', { fadeOut: 0.15 }),
  R('mech_dryfire_a', FS(725402), 0, 0.2, 'mech', { fadeOut: 0.08 }),
  R('mech_dryfire_b', FS(842748), 0, 0.1, 'mech', { fadeOut: 0.04 }),

  // ---- Equipment, melee ----
  R('foley_knife', FS(389690), 0.4, 0.4, 'foley', { align: -24, fadeIn: 0.02, fadeOut: 0.15, lufs: -27 }),
  R('foley_stab', FS(504615), 0, 0.42, 'foley', { fadeOut: 0.15 }),
  // Garand clip ping, cut short so the metallic ring doesn't hang (stand-in for a pin pull).
  R('foley_pin', FS(725398), 0, 0.3, 'foley', { fadeOut: 0.18, lufs: -27 }),
  R('foley_bounce', FS(389420), 0.4, 0.5, 'foley', { fadeOut: 0.2 }),
  R('boom_frag_a', FS(855798), 0, 1.7, 'boom', { fadeOut: 0.8 }),
  R('boom_frag_b', FS(609587), 0, 1.6, 'boom', { fadeOut: 0.8 }),
  R('boom_flash', FS(693421), 0, 1.0, 'boom', { fadeOut: 0.5, highpass: 80 }),
  // The ear-ringing recording swells up and stops dead at 7.65 s; take its loud part forwards (a
  // sudden ring after the bang) and fade it out slowly.
  R('ui_ring', FS(365956), 6.0, 1.45, 'ui', { align: false, fadeIn: 0.03, fadeOut: 1.1, lowpass: 6000, lufs: -27 }),

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
  R('ui_tick_a', 'kenney/interface-sounds/Audio/tick_004.ogg', 0, 0.08, 'ui', { fadeOut: 0.02, lufs: -30 }),
  R('ui_tick_b', 'kenney/interface-sounds/Audio/tick_001.ogg', 0, 0.06, 'ui', { fadeOut: 0.02, lufs: -30 }),
  // Kill confirmed / denied: a few small brass clinks (a dog-tag jingle), from the unclipped part
  // of the casings recording.
  R('ui_tags', FS(620929), 0.7, 0.32, 'ui', { fadeOut: 0.12 }),

  // ---- Radio cues (synthesized: see sfx-cues.ts) ----
  R('cue_good', SYNTH('cue_good'), 0, 1, 'alert', { align: false, fadeIn: 0, fadeOut: 0.01, highpass: 300, lowpass: 3400, lufs: -26 }),
  R('cue_bad', SYNTH('cue_bad'), 0, 1, 'alert', { align: false, fadeIn: 0, fadeOut: 0.01, highpass: 300, lowpass: 3400, lufs: -26 }),
  R('cue_round', SYNTH('cue_round'), 0, 1, 'alert', { align: false, fadeIn: 0, fadeOut: 0.01, highpass: 300, lowpass: 3400, lufs: -26 }),
  R('cue_warn', SYNTH('cue_warn'), 0, 1, 'alert', { align: false, fadeIn: 0, fadeOut: 0.01, highpass: 300, lowpass: 3400, lufs: -26 }),
  R('cue_ready', SYNTH('cue_ready'), 0, 1, 'alert', { align: false, fadeIn: 0, fadeOut: 0.01, highpass: 300, lowpass: 3400, lufs: -26 }),

  // ---- Killstreaks ----
  R('ks_static', FS(524204), 1.0, 0.4, 'alert', { align: false, fadeIn: 0.03, fadeOut: 0.15 }),
  // Roger beep: a 90 ms 2 kHz tone and a burst of static (confirm); the tone alone marks a target.
  R('ks_roger', FS(321906), 0, 0.17, 'alert', { fadeOut: 0.03, lufs: -26 }),
  R('ks_mark', FS(321906), 0, 0.1, 'alert', { fadeOut: 0.02, lufs: -28 }),
  R('ks_call', FS(524205), 0, 0.24, 'alert', { fadeOut: 0.06 }),
  R('ks_jet', FS(189446), 3.6, 4.0, 'vehicle', { align: false, fadeIn: 0.6, fadeOut: 1.4 }),
  R('ks_prop', FS(403316), 4.6, 0.5, 'vehicle', { align: false, fadeIn: 0.04, fadeOut: 0.08 }),
  R('ks_rotor_a', FS(854493), 0.3, 0.13, 'vehicle', { align: false, fadeIn: 0.01, fadeOut: 0.05 }),
  R('ks_rotor_b', FS(854493), 1.7, 0.13, 'vehicle', { align: false, fadeIn: 0.01, fadeOut: 0.05 }),
  R('ks_sentry_a', FS(239138), 0.1, 0.13, 'gun', { fadeOut: 0.05 }),
  R('ks_sentry_b', FS(239138), 0.44, 0.13, 'gun', { fadeOut: 0.05 }),
  R('ks_sentry_c', FS(239138), 1.12, 0.13, 'gun', { fadeOut: 0.05 }),
  R('ks_launch', FS(854476), 0, 0.9, 'boom', { fadeOut: 0.4 }),
  // Incoming mortar: a rushing noise swell (no whistle tone in this recording).
  R('ks_whistle', FS(241840), 0.05, 1.55, 'vehicle', { align: -36, fadeOut: 0.3 }),
  R('boom_big', FS(741173), 0, 2.6, 'boom', { fadeOut: 1.4 }),
  R('boom_medium', FS(516914), 0.3, 1.7, 'boom', { fadeOut: 0.9 }),
  R('ks_bark', FS(277058), 0, 0.25, 'foley', { fadeOut: 0.06 }),
  R('ks_bite', FS(483190), 0.4, 0.45, 'foley', { fadeOut: 0.15 }),

  // ---- Modes ----
  // Bomb beep: the recording is quiet with hiss around the 4 kHz beep; band-limit it.
  R('alert_beep', FS(138108), 0.13, 0.14, 'alert', { fadeOut: 0.03, highpass: 2500, lowpass: 6000, lufs: -27 }),
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
  /** Most simultaneous voices of this id (oldest fades out first). */
  maxVoices?: number;
  /** Synth id to play until the files load, when this id has no synthesized voice of its own. */
  fallback?: string;
}

/**
 * Per-weapon gun voices. Guns are told apart mainly by which recordings/variants they use, plus
 * gentle EQ and gain; playback rate stays within +-6% (bigger shifts sound honky). `sup` is the
 * suppressed pool. Every WEAPONS entry with a gunshot appears here (tested).
 */
export const WEAPON_SHOTS: Record<string, { files: string[]; rate: number; gain?: number; lowpass?: number; highpass?: number; sup: string[]; supRate?: number }> = {
  m16: { files: ['gun_ar_a', 'gun_ar_b', 'gun_ar_c'], rate: 1.0, sup: ['sup_rifle_a', 'sup_pistol_b', 'sup_pistol_c'], supRate: 0.97 },
  famas: { files: ['gun_ar_a', 'gun_ar_b'], rate: 1.04, gain: 0.9, highpass: 150, sup: ['sup_rifle_a', 'sup_pistol_c', 'sup_pistol_d'], supRate: 1.03 },
  commando: { files: ['gun_ar_b', 'gun_ar_a'], rate: 0.97, lowpass: 8000, sup: ['sup_rifle_a', 'sup_pistol_b'], supRate: 0.96 },
  aug: { files: ['gun_ar_c', 'gun_ar_a', 'gun_ar_b'], rate: 1.02, lowpass: 9000, highpass: 90, sup: ['sup_rifle_a', 'sup_pistol_d'], supRate: 1.0 },
  // MW2 additions: class pools with their own EQ (the ACR a touch brighter and lighter, the M16A4 a
  // little darker than the BO1 M16).
  acr: { files: ['gun_ar_b', 'gun_ar_c', 'gun_ar_a'], rate: 1.03, gain: 0.92, lowpass: 9000, highpass: 140, sup: ['sup_rifle_a', 'sup_pistol_c'], supRate: 1.0 },
  m16a4: { files: ['gun_ar_c', 'gun_ar_a', 'gun_ar_b'], rate: 0.98, lowpass: 8500, highpass: 100, sup: ['sup_rifle_a', 'sup_pistol_b'], supRate: 0.96 },
  ak47: { files: ['gun_ak_a', 'gun_ak_b', 'gun_ak_c', 'gun_ak_d'], rate: 1.0, sup: ['sup_rifle_a', 'sup_pistol_b', 'sup_pistol_d'], supRate: 0.95 },
  galil: { files: ['gun_ak_b', 'gun_ak_c', 'gun_ak_e'], rate: 1.04, lowpass: 8000, sup: ['sup_rifle_a', 'sup_pistol_c'], supRate: 0.97 },
  mp5k: { files: ['gun_smg_a', 'gun_smg_b', 'gun_smg_c'], rate: 1.04, gain: 0.9, sup: ['sup_pistol_b', 'sup_pistol_c', 'sup_pistol_a'], supRate: 1.04 },
  ak74u: { files: ['gun_smg_a', 'gun_smg_c', 'gun_ak_e'], rate: 1.0, gain: 0.95, lowpass: 8000, sup: ['sup_pistol_d', 'sup_pistol_b'], supRate: 1.0 },
  mpl: { files: ['gun_smg_b', 'gun_smg_c'], rate: 1.06, gain: 0.85, highpass: 160, sup: ['sup_pistol_c', 'sup_pistol_d'], supRate: 1.06 },
  rpk: { files: ['gun_ak_a', 'gun_ak_d', 'gun_ak_c'], rate: 0.95, gain: 1.05, sup: ['sup_rifle_a', 'sup_pistol_b'], supRate: 0.94 },
  l96a1: { files: ['gun_sniper_a', 'gun_sniper_b', 'gun_sniper_c'], rate: 1.0, gain: 1.1, sup: ['sup_rifle_a'], supRate: 0.95 },
  dragunov: { files: ['gun_dragunov_a', 'gun_sniper_c', 'gun_sniper_a'], rate: 1.03, highpass: 70, sup: ['sup_rifle_a'], supRate: 0.98 },
  intervention: { files: ['gun_sniper_b', 'gun_sniper_a', 'gun_sniper_c'], rate: 0.95, gain: 1.12, lowpass: 7500, highpass: 55, sup: ['sup_rifle_a'], supRate: 0.95 },
  olympia: { files: ['gun_olympia_a', 'gun_olympia_b'], rate: 1.0, gain: 1.05, sup: ['sup_rifle_a'], supRate: 0.94 },
  stakeout: { files: ['gun_shotgun_a', 'gun_shotgun_b'], rate: 1.0, gain: 1.05, sup: ['sup_rifle_a'], supRate: 0.95 },
  spas12: { files: ['gun_spas_a', 'gun_shotgun_a', 'gun_shotgun_b'], rate: 0.97, gain: 1.05, lowpass: 7000, sup: ['sup_rifle_a'], supRate: 0.94 },
  m1911: { files: ['gun_m1911_a', 'gun_m1911_b'], rate: 1.0, gain: 0.85, sup: ['sup_pistol_a', 'sup_pistol_b', 'sup_pistol_c', 'sup_pistol_d'], supRate: 1.0 },
  python: { files: ['gun_python_a', 'gun_python_b'], rate: 0.97, gain: 1.3, sup: ['sup_pistol_a', 'sup_rifle_a'], supRate: 0.95 },
  asp: { files: ['gun_asp_a', 'gun_asp_b'], rate: 1.04, gain: 0.8, highpass: 150, sup: ['sup_pistol_a', 'sup_pistol_c', 'sup_pistol_d'], supRate: 1.05 },
  gl: { files: ['gun_gl_a', 'gun_gl_b'], rate: 1.0, sup: ['gun_gl_a', 'gun_gl_b'], supRate: 1.0 },
};

/** Distant-layer pitch by class (the layer is one AR recording): kept within +-6% as well. */
export const DISTANT_RATE: Record<WeaponClass, number> = { ar: 1, smg: 1.04, lmg: 0.97, sniper: 0.95, shotgun: 0.94, pistol: 1.05, launcher: 0.94, special: 1 };

/** Per-shot variation (+-2.5% rate, +-1.5 dB) and voice cap: 4 overlapping tails per gun at most. */
const GUN = { pitchJitter: 0.025, volJitter: 1.5, maxVoices: 4 };
const steps = (surface: string, n: number, o: Partial<SfxBinding> = {}): SfxBinding => ({ files: Array.from({ length: n }, (_, i) => `step_${surface}_${i}`), gain: 1.25, pitchJitter: 0.04, volJitter: 2, maxVoices: 6, fallback: 'step', ...o });

export const SFX_BINDINGS: Record<string, SfxBinding> = {
  // Core.
  shot: { files: ['gun_ar_a', 'gun_ar_b', 'gun_ar_c'], ...GUN },
  'shot.distant': { files: ['gun_distant_a', 'gun_distant_b'], pitchJitter: 0.02, volJitter: 1.5, maxVoices: 3 },
  tick: { files: ['ui_tick_a', 'ui_tick_b'], gain: 1.6, pitchJitter: 0.02, maxVoices: 3 },
  thud: { files: ['foley_hurt_a', 'foley_hurt_b'], gain: 1.2, pitchJitter: 0.03, volJitter: 1, maxVoices: 3 },
  click: { files: ['mech_dryfire_a', 'mech_dryfire_b'], gain: 1.4, pitchJitter: 0.02, maxVoices: 2 },
  // A generic latch clack (supply-drop crate opening).
  reload: { files: ['mech_magin_rifle'], gain: 0.8, pitchJitter: 0.02, maxVoices: 2 },
  step: steps('concrete', 5, { gain: 1.5 }),
  'step.concrete': steps('concrete', 5, { gain: 1.5 }),
  'step.grass': steps('grass', 5),
  'step.dirt': steps('grass', 5, { rate: 0.97, lowpass: 5000 }),
  'step.wood': steps('wood', 5),
  'step.carpet': steps('carpet', 5, { gain: 1.4 }),
  'step.metal': steps('metal', 3, { gain: 1.1 }),
  // Weapons feature.
  'weapons.bolt': { files: ['mech_bolt'], pitchJitter: 0.02, maxVoices: 2 },
  'weapons.pump': { files: ['mech_pump'], pitchJitter: 0.02, maxVoices: 2 },
  'weapons.shell': { files: ['mech_shell'], pitchJitter: 0.03, volJitter: 1, maxVoices: 2 },
  'weapons.magout': { files: ['mech_magout_rifle'], pitchJitter: 0.02, maxVoices: 2 },
  'weapons.magin': { files: ['mech_magin_rifle'], pitchJitter: 0.02, maxVoices: 2 },
  'weapons.magout.pistol': { files: ['mech_magout_pistol'], pitchJitter: 0.02, maxVoices: 2, fallback: 'weapons.magout' },
  'weapons.magin.pistol': { files: ['mech_magin_pistol'], pitchJitter: 0.02, maxVoices: 2, fallback: 'weapons.magin' },
  'weapons.charge': { files: ['mech_charge'], gain: 0.8, pitchJitter: 0.02, maxVoices: 2, fallback: 'weapons.bolt' },
  'weapons.break': { files: ['mech_break_open'], pitchJitter: 0.02, maxVoices: 2 },
  'weapons.breakclose': { files: ['mech_break_close'], pitchJitter: 0.02, maxVoices: 2, fallback: 'weapons.break' },
  'weapons.knife': { files: ['foley_knife'], pitchJitter: 0.04, volJitter: 1, maxVoices: 3 },
  'weapons.stab': { files: ['foley_stab'], pitchJitter: 0.03, maxVoices: 3 },
  'weapons.pin': { files: ['foley_pin'], gain: 0.8, pitchJitter: 0.02, maxVoices: 3 },
  'weapons.bounce': { files: ['foley_bounce'], pitchJitter: 0.04, volJitter: 2, maxVoices: 4 },
  'weapons.boom': { files: ['boom_frag_a', 'boom_frag_b'], pitchJitter: 0.03, volJitter: 1, maxVoices: 4 },
  'weapons.flashbang': { files: ['boom_flash'], pitchJitter: 0.02, maxVoices: 3 },
  'weapons.ring': { files: ['ui_ring'], gain: 1.4, maxVoices: 1 },
  // Killstreaks.
  ks_ready: { files: ['cue_ready'], maxVoices: 1 },
  ks_call: { files: ['ks_call'], maxVoices: 2 },
  ks_alarm: { files: ['cue_warn'], maxVoices: 1 },
  ks_boom: { files: ['boom_medium', 'boom_frag_a'], pitchJitter: 0.03, maxVoices: 4 },
  ks_bigboom: { files: ['boom_big'], pitchJitter: 0.03, volJitter: 1, maxVoices: 4 },
  ks_whistle: { files: ['ks_whistle'], pitchJitter: 0.02, maxVoices: 4 },
  ks_jet: { files: ['ks_jet'], pitchJitter: 0.02, maxVoices: 2 },
  ks_rotor: { files: ['ks_rotor_a', 'ks_rotor_b'], gain: 0.9, pitchJitter: 0.01, maxVoices: 6 },
  ks_prop: { files: ['ks_prop'], gain: 0.8, pitchJitter: 0.01, maxVoices: 3 },
  ks_bark: { files: ['ks_bark'], pitchJitter: 0.04, maxVoices: 4 },
  ks_bite: { files: ['ks_bite'], pitchJitter: 0.03, maxVoices: 3 },
  ks_launch: { files: ['ks_launch'], pitchJitter: 0.03, maxVoices: 3 },
  ks_sentry: { files: ['ks_sentry_a', 'ks_sentry_b', 'ks_sentry_c'], gain: 0.6, pitchJitter: 0.02, volJitter: 1.5, maxVoices: 4 },
  // The Phalanx recording is badly clipped at the source; the chopper gunner borrows the .50 cal.
  ks_gunner: { files: ['ks_sentry_a', 'ks_sentry_b', 'ks_sentry_c'], gain: 0.6, rate: 1.04, pitchJitter: 0.02, maxVoices: 3, fallback: 'ks_sentry' },
  ks_static: { files: ['ks_static'], pitchJitter: 0.02, maxVoices: 2 },
  ks_mark: { files: ['ks_mark'], maxVoices: 2 },
  ks_confirm: { files: ['ks_roger'], maxVoices: 1 },
  // Modes.
  'modes.good': { files: ['cue_good'], maxVoices: 1 },
  'modes.bad': { files: ['cue_bad'], maxVoices: 1 },
  'modes.horn': { files: ['cue_round'], maxVoices: 1 },
  'modes.alarm': { files: ['cue_warn'], maxVoices: 1 },
  'modes.pickup': { files: ['ui_tags'], gain: 1.1, pitchJitter: 0.02, maxVoices: 2 },
  'modes.beep': { files: ['alert_beep'], maxVoices: 2 },
  'modes.boom': { files: ['boom_big'], maxVoices: 2 },
};

for (const [id, w] of Object.entries(WEAPON_SHOTS)) {
  SFX_BINDINGS[`shot.${id}`] = { files: w.files, rate: w.rate, gain: w.gain, lowpass: w.lowpass, highpass: w.highpass, ...GUN };
  SFX_BINDINGS[`shot.${id}.sup`] = { files: w.sup, rate: w.supRate ?? 1, gain: w.gain, ...GUN };
}
// Wager specials (economy's crossbow and ballistic knife): no recordings of either, so a bolt
// clack and the charging-handle spring from the handling recordings rather than a gunshot.
SFX_BINDINGS['shot.crossbow'] = { files: ['mech_break_close'], gain: 1.6, pitchJitter: 0.02, volJitter: 1, maxVoices: 4, fallback: 'shot' };
SFX_BINDINGS['shot.ballistic_knife'] = { files: ['mech_charge'], gain: 1.6, pitchJitter: 0.02, volJitter: 1, maxVoices: 4, fallback: 'shot' };

/** Ids that stay synthesized on purpose (no fitting recording in the manifest, or unused). */
export const SFX_SYNTH_ONLY: Record<string, string> = {
  ks_buzz: 'RC-XD motor: no small-motor recording in the manifest',
  ks_fire: 'napalm fire crackle: no fire recording in the manifest',
  'weapons.thump': 'Sticks and Stones BANKRUPTED sting: a low thump, no fitting recording',
  'weapons.beep': 'stuck crossbow bolt beep: a synthesized chirp, like the semtex blink',
  'weapons.cook': 'frag cook tick: a short synthesized fuse tick, no fitting recording',
  ks_smoke: 'Care Package marker smoke hiss: synthesized noise, no smoke recording in the manifest',
};

/** Recorded-only ids with no synthesized fallback on purpose: extra layers that may simply be absent until loaded. */
export const SFX_SAMPLE_ONLY: Record<string, string> = {
  'shot.distant': 'distant gunfire layer, crossfaded in at range',
};

/** Weapon ids that need a gun voice in WEAPON_SHOTS: every weapon but the 'special' class (knife, wager crossbow / ballistic knife). */
export const gunWeaponIds = (): string[] => WEAPONS.filter((w) => w.class !== 'special').map((w) => w.id);
