/**
 * The look shader (ported from reference/yard-lab.html): optional vertex snap (PS1 wobble) and
 * affine texture warp, baked per-vertex light (vertex colours) or a per-object light sampled from
 * the bake (`dyn`, for players and the viewmodel), emissive, fog. Global uniforms (`G`) are shared
 * by every material, so time of day / look toggles are one assignment.
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
  /** Muzzle flash light around the camera. */
  uFlash: { value: 0 },
  uUnlit: { value: 0 },
  uUnlitColor: { value: new THREE.Color(1, 1, 1) },
};

const VS = /* glsl */ `
uniform vec2 uSnap, uRepeat;
uniform float uJitter, uAffine, uAffMul, uBake, uDynOn, uFogNear, uFogFar, uNoFog, uFlash, uUnlit;
uniform vec3 uUnlitColor;
uniform vec3 uSunDir, uSun, uAmb, uDyn;
varying vec3 vLight;
varying vec3 vUvA;
varying float vFog;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  vec4 p = projectionMatrix * mv;
  if (uJitter > 0.0) { vec2 s = uSnap / uJitter; p.xy = floor(p.xy / p.w * s + 0.5) / s * p.w; }
  gl_Position = p;
  vec3 n = normalize(mat3(modelMatrix) * normal);
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
  vFog = uNoFog > 0.5 ? 0.0 : smoothstep(uFogNear, uFogFar, length(mv.xyz));
}`;

const FS = /* glsl */ `
uniform sampler2D tMap;
uniform vec3 uTint, uFogColor;
uniform float uEmissive, uOpacity;
varying vec3 vLight;
varying vec3 vUvA;
varying float vFog;
void main() {
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
}

export type LookMaterial = THREE.ShaderMaterial & { uniforms: { tMap: { value: THREE.Texture }; uTint: { value: THREE.Color }; uDyn: { value: THREE.Color }; uOpacity: { value: number } } };

const SIDES = { front: THREE.FrontSide, back: THREE.BackSide, double: THREE.DoubleSide } as const;

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
  bindTexture(m, o.texture);
  return m;
}

/** Set the per-object light of `dyn` materials. */
export function setDynLight(mats: readonly LookMaterial[], rgb: readonly number[], add = 0.05): void {
  for (const m of mats) m.uniforms.uDyn.value.setRGB(rgb[0]! + add, rgb[1]! + add, rgb[2]! + add);
}
