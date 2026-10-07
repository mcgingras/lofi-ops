/**
 * The look shader (ported from reference/yard-lab.html): optional vertex snap (PS1 wobble) and
 * affine texture warp, baked per-vertex light (vertex colours) or a per-object light sampled from
 * the bake (`dyn`, for players and the viewmodel), emissive, fog. Global uniforms (`G`) are shared
 * by every material, so time of day / look toggles are one assignment.
 *
 * Atmosphere (all retro presets): the sky dome fades to the fog colour at the horizon so the world
 * dissolves into the sky instead of meeting it at a seam, and unfogged backdrops (mountains, hills)
 * take a partial haze by distance (aerial perspective) instead of standing out as dark cut-outs.
 */
import * as THREE from 'three';
import { bindTexture } from './textures';

THREE.ColorManagement.enabled = false;

/** Shared uniforms (objects shared by reference across all look materials). */
export const G = {
  uSnap: { value: new THREE.Vector2(320, 180) },
  /** 0 off, 1 pixel, 2.5 heavy. */
  uJitter: { value: 0 },
  uAffine: { value: 0 },
  /** 1 baked light, 0 realtime sun/ambient (debug). */
  uBake: { value: 1 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSun: { value: new THREE.Color() },
  uAmb: { value: new THREE.Color() },
  uFogColor: { value: new THREE.Color() },
  uFogNear: { value: 20 },
  uFogFar: { value: 80 },
  /** Retro strength fog distance multiplier (1 = the map's own fog). */
  uFogScale: { value: 1 },
  /** Max haze on unfogged backdrops (0..1), per time of day (render/grade.ts). */
  uHaze: { value: 0.6 },
  /** Sky horizon band: fully fog-coloured below x, pure sky above y (dome elevation, -1..1). */
  uHorizon: { value: new THREE.Vector2(-0.03, 0.2) },
  /** Muzzle flash light around the camera. */
  uFlash: { value: 0 },
  uUnlit: { value: 0 },
  uUnlitColor: { value: new THREE.Color(1, 1, 1) },
};

const VS = /* glsl */ `
uniform vec2 uSnap, uRepeat;
uniform float uJitter, uSnapMul, uAffine, uAffMul, uBake, uDynOn, uFogNear, uFogFar, uFogScale, uNoFog, uHaze, uHazeOn, uSky, uFlash, uUnlit;
uniform vec2 uHorizon;
uniform vec3 uUnlitColor;
uniform vec3 uSunDir, uSun, uAmb, uDyn;
varying vec3 vLight;
varying vec3 vUvA;
varying float vFog;
#ifdef SNAP_DEPTH
varying vec3 vView, vViewS, vNormV;
#endif
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  vec4 p = projectionMatrix * mv;
#ifdef SNAP_DEPTH
  vec2 p0 = p.xy;
#endif
  if (uJitter * uSnapMul > 0.0) { vec2 s = uSnap / uJitter; p.xy = floor(p.xy / p.w * s + 0.5) / s * p.w; }
  gl_Position = p;
  vec3 n = normalize(mat3(modelMatrix) * normal);
#ifdef SNAP_DEPTH
  // The snapped vertex as a view-space point (same depth, moved sideways), so the fragment shader
  // can rebuild the pixel's camera ray.
  vView = mv.xyz;
  vViewS = mv.xyz + vec3((p.xy - p0) / vec2(projectionMatrix[0][0], projectionMatrix[1][1]), 0.0);
  vNormV = mat3(viewMatrix) * n;
#endif
  vec3 light = uAmb + uSun * max(dot(n, uSunDir), 0.0);
#ifdef USE_COLOR
  light = mix(light, color, uBake);
#endif
  if (uDynOn > 0.5) light = mix(light, uDyn * (0.7 + 0.3 * max(n.y, 0.0)), uBake);
  light = mix(light, uUnlitColor, uUnlit);
  light *= 1.0 - 0.07 * hash(floor(wp.xyz * 1.7)) * (1.0 - uUnlit) * (1.0 - uDynOn);
  vLight = light + vec3(1.0, 0.8, 0.5) * uFlash * (1.0 - smoothstep(0.0, 9.0, length(mv.xyz)));
  float w = mix(1.0, p.w, uAffine * uAffMul);
  vUvA = vec3(uv * uRepeat * w, w);
  float d = length(mv.xyz);
  if (uSky > 0.5) vFog = 1.0 - smoothstep(uHorizon.x, uHorizon.y, normalize(position).y);
  else if (uNoFog > 0.5) vFog = uHazeOn * uHaze * clamp(d / (2.0 * uFogFar * uFogScale), 0.0, 1.0);
  else vFog = smoothstep(uFogNear * uFogScale, uFogFar * uFogScale, d);
}`;

const FS = /* glsl */ `
uniform sampler2D tMap;
uniform vec3 uTint, uFogColor;
uniform float uEmissive, uOpacity;
varying vec3 vLight;
varying vec3 vUvA;
varying float vFog;
#ifdef SNAP_DEPTH
uniform mat4 projectionMatrix;
varying vec3 vView, vViewS, vNormV;
#endif
void main() {
#ifdef SNAP_DEPTH
  // Vertex snap moves triangles but must not move depth: layered coplanar surfaces (decals on the
  // ground) would otherwise fight. Intersect this pixel's ray with the unsnapped surface plane
  // (interpolated unsnapped positions stay on it) and write that depth.
  vec3 nn = normalize(vNormV);
  float den = dot(nn, vViewS);
  float z = gl_FragCoord.z;
  if (abs(den) > 1e-5 * length(vViewS)) {
    float t = dot(nn, vView) / den;
    if (t > 0.0) {
      vec4 c = projectionMatrix * vec4(vViewS * t, 1.0);
      z = clamp(0.5 * c.z / c.w + 0.5, 0.0, 1.0);
    }
  }
  gl_FragDepth = z;
#endif
  vec4 t = texture2D(tMap, vUvA.xy / vUvA.z);
  if (t.a < 0.5) discard;
  vec3 c = t.rgb * uTint * mix(vLight, vec3(1.0), uEmissive);
  gl_FragColor = vec4(mix(c, uFogColor, vFog), uOpacity);
}`;

export interface LookMaterialOpts {
  /** Texture recipe id. */
  texture: string;
  /** UV multiplier (MaterialDef.uvMul). Default [1, 1]. */
  uvMul?: [number, number];
  /** Prototype `rep`: one texture tile every `rep` metres (sets uvMul = 1/rep). */
  rep?: number | [number, number];
  tint?: number;
  emissive?: number;
  side?: 'front' | 'back' | 'double';
  /** Uses vertex colours from the bake (default true unless `dyn`). */
  bake?: boolean;
  fog?: boolean;
  /** Affine warp multiplier (default 1; 0 for the sky). */
  affine?: number;
  /** Lit by a per-object light (`setDynLight`) instead of vertex colours: players, viewmodel. */
  dyn?: boolean;
  /** The sky dome: fades to the fog colour at the horizon. */
  sky?: boolean;
  /** Vertex snap on/off (default on, except the viewmodel: `dyn` + `fog: false`, which would jitter while it sways). */
  snap?: boolean;
  /**
   * Distance haze for `fog: false` materials (0..1). Default 1 for baked world materials (map
   * backdrops such as mountains), 0 for the sky, `dyn` objects and unbaked ones.
   */
  haze?: number;
}

export type LookMaterial = THREE.ShaderMaterial & { uniforms: { tMap: { value: THREE.Texture }; uTint: { value: THREE.Color }; uDyn: { value: THREE.Color }; uOpacity: { value: number }; uSnapMul: { value: number } } };

const SIDES = { front: THREE.FrontSide, back: THREE.BackSide, double: THREE.DoubleSide } as const;

/** Snapping look materials, so the depth fix-up (SNAP_DEPTH) compiles in only while snap is on. */
const snapping = new Set<LookMaterial>();
let snapDepth = false;
function applySnapDepth(m: LookMaterial): void {
  if (Boolean(m.defines.SNAP_DEPTH) === snapDepth) return;
  if (snapDepth) m.defines.SNAP_DEPTH = '';
  else delete m.defines.SNAP_DEPTH;
  m.needsUpdate = true;
}
/** Vertex snap on/off (renderer). Writing gl_FragDepth costs early-z, so it is only compiled in while snapping. */
export function setSnapDepth(on: boolean): void {
  if (on === snapDepth) return;
  snapDepth = on;
  for (const m of snapping) applySnapDepth(m);
}

export function makeLookMaterial(o: LookMaterialOpts): LookMaterial {
  let mul: [number, number] = o.uvMul ?? [1, 1];
  if (o.rep !== undefined) mul = Array.isArray(o.rep) ? [1 / o.rep[0], 1 / o.rep[1]] : [1 / o.rep, 1 / o.rep];
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...G,
      tMap: { value: null },
      uTint: { value: new THREE.Color(o.tint ?? 0xffffff) },
      uEmissive: { value: o.emissive ?? 0 },
      uRepeat: { value: new THREE.Vector2(mul[0], mul[1]) },
      uNoFog: { value: o.fog === false ? 1 : 0 },
      uHazeOn: { value: o.haze ?? (o.fog === false && !o.dyn && !o.sky && o.bake !== false ? 1 : 0) },
      uSky: { value: o.sky ? 1 : 0 },
      uSnapMul: { value: (o.snap ?? !(o.dyn && o.fog === false)) ? 1 : 0 },
      uAffMul: { value: o.affine ?? 1 },
      uDynOn: { value: o.dyn ? 1 : 0 },
      uDyn: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 1 },
    },
    vertexShader: VS,
    fragmentShader: FS,
    side: SIDES[o.side ?? 'front'],
    vertexColors: !o.dyn && o.bake !== false,
  }) as LookMaterial;
  m.defines ??= {};
  if (m.uniforms.uSnapMul.value) {
    snapping.add(m);
    m.addEventListener('dispose', () => snapping.delete(m));
    applySnapDepth(m);
  }
  bindTexture(m, o.texture);
  return m;
}

/** Set the per-object light of `dyn` materials. */
export function setDynLight(mats: readonly LookMaterial[], rgb: readonly number[], add = 0.05): void {
  for (const m of mats) m.uniforms.uDyn.value.setRGB(rgb[0]! + add, rgb[1]! + add, rgb[2]! + add);
}
