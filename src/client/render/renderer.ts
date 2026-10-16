/**
 * The look pipeline (reference/yard-lab.html): the world and the viewmodel render into a low-res
 * target (240/360/480/720 lines or full), then a post pass upscales it with nearest filtering,
 * grades it (the per-map grade by default, render/grade.ts), optionally quantises to a 15-bit
 * framebuffer with a 4x4 ordered screen dither (Retro strength palette '15bit'), and composites the
 * pixel HUD canvas (drawn at the same low resolution) on top.
 */
import * as THREE from 'three';
import { GRADE } from './grade';
import { screenOptions, type DitherType, type PaletteDepth } from './retro';
import { G, setSnapDepth } from './shader';

export type ResSetting = '240' | '360' | '480' | '720' | 'full';
export type Grade = 'map' | 'natural' | 'warm' | 'duotone';

/** The retro knobs the renderer applies (render/retro.ts); texture filter and palette develop live in textures.ts. */
export interface LookOptions {
  res: ResSetting;
  /** Vertex snap grid in internal pixels (0 off). */
  vertexSnap: number;
  /** 0..1 affine texture warp. */
  affineWarp: number;
  palette: PaletteDepth;
  ditherType: DitherType;
  ditherStrength: number;
  /** Fog distance multiplier. */
  fogScale: number;
  grade: Grade;
  /** Vertical field of view, degrees. */
  fov: number;
}

const QVS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const QFS = /* glsl */ `uniform sampler2D tSrc, tHud; uniform vec2 uLow; uniform float uLevels, uDither, uRed, uWhite, uFeed, uTime, uSat, uGamma, uGlitch, uBurst; uniform int uGrade, uPattern; uniform vec3 uLift, uGain; varying vec2 vUv;
const float BAYER[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
const float PATTERN[16] = float[16](0.,5.,10.,15.,7.,8.,13.,2.,10.,15.,0.,5.,13.,2.,7.,8.);
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 px = floor(vUv * uLow), hpx = px;
  float lv = uLevels, dth = uDither; bool bayer = uPattern != 1;
  // Glitch (killstreak): bands of rows torn sideways (HUD too), the world at half the internal
  // resolution, colour bursts split the channels, banding to a few levels with a Bayer dither.
  if (uGlitch > 0.0) {
    float ft = floor(uTime * 14.0);
    float band = floor(px.y / 6.0);
    float r = h21(vec2(band, ft));
    if (r < 0.08 * uGlitch + 0.3 * uBurst) { px.x += floor((fract(r * 91.7) - 0.5) * 56.0 * uGlitch); hpx.x = px.x; }
    px = floor(px / 2.0) * 2.0;
    lv = min(lv, mix(32.0, 7.0, uGlitch));
    dth = max(dth, 0.9 * uGlitch);
    bayer = true;
  }
  vec2 uv = (px + 0.5) / uLow;
  vec3 c = texture2D(tSrc, uv).rgb;
  if (uBurst > 0.0) { vec2 o = vec2((2.0 + 6.0 * uBurst) / uLow.x, 0.0); c.r = texture2D(tSrc, uv + o).r; c.b = texture2D(tSrc, uv - o).b; }
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  if (uGrade == 3) {
    // Map grade: rein in only the loudest colours, lift shadows towards the fog, tint highlights.
    float ch = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
    c = mix(vec3(l), c, mix(1.0, uSat, smoothstep(0.12, 0.5, ch)));
    c = pow(max(uLift + c * (uGain - uLift), 0.0), vec3(uGamma));
  } else if (uGrade == 1) c = pow(max(c, 0.0), vec3(0.88)) * vec3(1.07, 1.0, 0.88) + vec3(0.025, 0.015, 0.03);
  else if (uGrade == 2) c = mix(vec3(0.12, 0.04, 0.08), vec3(1.0, 0.82, 0.58), smoothstep(0.02, 0.8, l));
  vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.5;
  // Damage: desaturate and redden towards the edges.
  if (uRed > 0.0) { float e = smoothstep(0.15, 0.75, length(q * vec2(1.6, 1.0))); c = mix(c, vec3(l * 0.6 + 0.25, l * 0.25, l * 0.2), uRed * (0.35 + 0.65 * e)); }
  // White-out (Tactical Nuke flash): towards a warm white before the dither, so the fade is dithered too.
  if (uWhite > 0.0) c = mix(c, vec3(1.0, 0.98, 0.93), uWhite);
  // Camera feed (Valkyrie rocket cam, BO1's grainy tow_filter_overlay): green-grey monochrome,
  // scanlines, a slow rolling band and per-pixel grain that changes every frame. After the
  // white-out, so its "no signal" white (tow_filter_overlay_no_signal) is static too.
  if (uFeed > 0.0) {
    float n = fract(sin(dot(px + floor(uTime * 24.0) * vec2(17.0, 41.0), vec2(12.9898, 78.233))) * 43758.5453);
    float band = smoothstep(0.0, 0.08, abs(fract(vUv.y * 0.6 - uTime * 0.17) - 0.5));
    float lw = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 mono = vec3(lw * 0.82 + 0.06, lw * 0.95 + 0.08, lw * 0.76 + 0.05);
    vec3 f = mono * (mod(px.y, 2.0) < 1.0 ? 0.8 : 1.0) * (0.92 + 0.08 * band) + (n - 0.5) * 0.16;
    c = mix(c, f, uFeed);
  }
  if (uGlitch > 0.0) {
    // Static: grain all the time, noisy scanlines and dropout lines in the bursts.
    float n = h21(px + floor(uTime * 30.0) * vec2(17.0, 41.0));
    float line = h21(vec2(px.y, floor(uTime * 20.0)));
    c += (n - 0.5) * 0.12 * uGlitch;
    if (line < 0.35 * uBurst) c = mix(c, vec3(n), 0.75);
    if (line > 1.0 - 0.012 * uGlitch) c = mod(px.x + floor(uTime * 60.0), 9.0) < 4.5 ? vec3(1.0, 0.1, 0.9) : vec3(0.1, 1.0, 0.9);
  }
  int di = int(mod(px.x, 4.0)) + int(mod(px.y, 4.0)) * 4;
  float d = dth > 0.0 ? ((bayer ? BAYER[di] : PATTERN[di]) + 0.5) / 16.0 - 0.5 : 0.0;
  d *= dth;
  c = floor(clamp(c, 0.0, 1.0) * (lv - 1.0) + 0.5 + d) / (lv - 1.0);
  vec4 h = texture2D(tHud, (hpx + 0.5) / uLow);
  if (h.a > 0.5) c = h.rgb;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const GRADES: Record<Grade, number> = { natural: 0, warm: 1, duotone: 2, map: 3 };

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /**
   * Near plane 0.1 m (was 0.05): with the 24-bit depth target the smallest resolvable depth step
   * at distance d is about d^2 / (near * 2^24), so this halves it: 6 mm at 100 m, 2 cm at 190 m
   * (the farthest fog). The eye is never closer than 0.3 m to a wall (PLAYER.radius) or 0.2 m to a
   * ceiling, and the near plane's corners reach 1.6 x near at 16:9 (1.9 x at 21:9), so nothing
   * clips. Far barely matters (it only has to clear the 450 m sky dome). Coplanar faces are
   * settled separately, by depth levels (mapbuilder).
   */
  readonly cam = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
  readonly vmScene = new THREE.Scene();
  readonly vmCam = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
  readonly hud: HTMLCanvasElement;
  readonly hudCtx: CanvasRenderingContext2D;
  private rt: THREE.WebGLRenderTarget;
  private hudTex: THREE.CanvasTexture;
  private post: THREE.ShaderMaterial;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private opts: LookOptions = { res: '360', vertexSnap: 0, affineWarp: 0, palette: '16', ditherType: 'pattern', ditherStrength: 0.75, fogScale: 1, grade: 'map', fov: 70 };
  /** Current low-res size. */
  width = 640;
  height = 360;
  /** Extra zoom (ADS): effective fov = fov / zoom-ish. */
  zoom = 1;
  /** 0..1 red damage overlay. */
  damage = 0;
  /** 0..1 white-out of the world (under the HUD): the Tactical Nuke flash. Owners reset it to 0. */
  white = 0;
  /** 0..1 camera-feed look (monochrome, scanlines, grain): the Valkyrie rocket cam. Owners reset it to 0. */
  feed = 0;
  /**
   * Glitch killstreak (killstreaks/glitch.ts drives these and resets them): `glitch` 0..1 corrupts
   * the post pass (torn rows, half resolution, banding, static), `glitchBurst` 0..1 adds channel
   * split and noise lines, `snapBoost` / `warpBoost` raise vertex snap (internal px) and affine warp
   * above the player's own setting, and `holdFrame` keeps last frame's world (a dropped frame).
   */
  glitch = 0;
  glitchBurst = 0;
  snapBoost = 0;
  warpBoost = 0;
  holdFrame = false;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'view';
    this.canvas.setAttribute('aria-label', 'Game view');
    parent.prepend(this.canvas);
    this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.setPixelRatio(1);
    this.gl.autoClear = false;
    this.rt = new THREE.WebGLRenderTarget(640, 360, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: true });
    this.hud = document.createElement('canvas');
    const g = this.hud.getContext('2d');
    if (!g) throw new Error('2d canvas unavailable');
    this.hudCtx = g;
    this.hudTex = new THREE.CanvasTexture(this.hud);
    this.hudTex.magFilter = this.hudTex.minFilter = THREE.NearestFilter;
    this.hudTex.generateMipmaps = false;
    this.hudTex.colorSpace = THREE.NoColorSpace;
    this.post = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: this.rt.texture }, tHud: { value: this.hudTex }, uLow: { value: new THREE.Vector2(640, 360) }, uLevels: { value: 256 }, uDither: { value: 0 }, uPattern: { value: 0 }, uGrade: { value: 3 }, uRed: { value: 0 }, uWhite: { value: 0 }, uFeed: { value: 0 }, uTime: { value: 0 }, uGlitch: { value: 0 }, uBurst: { value: 0 }, ...GRADE },
      vertexShader: QVS,
      fragmentShader: QFS,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post);
    quad.frustumCulled = false;
    this.postScene.add(quad);
    this.cam.rotation.order = 'YXZ';
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  setOptions(o: Partial<LookOptions>): void {
    this.opts = { ...this.opts, ...o };
    G.uJitter.value = this.opts.vertexSnap;
    setSnapDepth(this.opts.vertexSnap > 0);
    G.uAffine.value = this.opts.affineWarp;
    G.uFogScale.value = this.opts.fogScale;
    const scr = screenOptions(this.opts);
    this.post.uniforms.uDither!.value = scr.dither;
    this.post.uniforms.uPattern!.value = scr.type === 'pattern' ? 1 : 0;
    this.post.uniforms.uLevels!.value = scr.levels;
    this.post.uniforms.uGrade!.value = GRADES[this.opts.grade];
    this.resize();
  }

  get options(): Readonly<LookOptions> {
    return this.opts;
  }

  resize(): void {
    const w = Math.max(1, innerWidth);
    const h = Math.max(1, innerHeight);
    const lh = this.opts.res === 'full' ? Math.round(h * Math.min(devicePixelRatio || 1, 2)) : Number(this.opts.res);
    const lw = Math.max(1, Math.round((lh * w) / h));
    this.gl.setSize(w, h, false);
    this.rt.setSize(lw, lh);
    if (this.hud.width !== lw || this.hud.height !== lh) {
      this.hud.width = lw;
      this.hud.height = lh;
      // GPU storage is sized on first upload: a resized canvas needs a fresh texture.
      this.hudTex.dispose();
    }
    this.width = lw;
    this.height = lh;
    this.post.uniforms.uLow!.value.set(lw, lh);
    G.uSnap.value.set(lw / 2, lh / 2);
    this.cam.aspect = this.vmCam.aspect = w / h;
    this.updateFov();
  }

  updateFov(): void {
    const half = (this.opts.fov * Math.PI) / 360;
    this.cam.fov = (Math.atan(Math.tan(half) / Math.max(0.1, this.zoom)) * 360) / Math.PI;
    this.cam.updateProjectionMatrix();
    this.vmCam.updateProjectionMatrix();
  }

  /** Render one frame: world, viewmodel, then the post pass with the HUD drawn by `drawHud`. */
  render(drawHud: (g: CanvasRenderingContext2D, w: number, h: number) => void, showViewmodel = true): void {
    const gl = this.gl;
    const snap = Math.max(this.opts.vertexSnap, this.snapBoost);
    G.uJitter.value = snap;
    setSnapDepth(snap > 0);
    G.uAffine.value = Math.max(this.opts.affineWarp, this.warpBoost);
    if (!this.holdFrame) {
      gl.setRenderTarget(this.rt);
      gl.setClearColor(G.uFogColor.value, 1);
      gl.clear();
      gl.render(this.scene, this.cam);
      if (showViewmodel) {
        gl.clearDepth();
        gl.render(this.vmScene, this.vmCam);
      }
    }
    this.hudCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.hudCtx.clearRect(0, 0, this.width, this.height);
    drawHud(this.hudCtx, this.width, this.height);
    this.hudTex.needsUpdate = true;
    this.post.uniforms.uRed!.value = this.damage;
    this.post.uniforms.uWhite!.value = this.white;
    this.post.uniforms.uFeed!.value = this.feed;
    this.post.uniforms.uGlitch!.value = this.glitch;
    this.post.uniforms.uBurst!.value = this.glitchBurst;
    this.post.uniforms.uTime!.value = performance.now() / 1000;
    gl.setRenderTarget(null);
    gl.setClearColor(0x000000, 1);
    gl.clear();
    gl.render(this.postScene, this.postCam);
  }

  /** Blank the screen (menus). */
  clear(): void {
    this.gl.setRenderTarget(null);
    this.gl.setClearColor(0x08090d, 1);
    this.gl.clear();
  }
}
