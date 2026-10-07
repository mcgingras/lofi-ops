/**
 * The tactical map's picture: the real map rendered straight down with our own renderer (an
 * orthographic camera over `map.bounds`, the same baked lighting and developed textures, sky and
 * fog off), read back at the panel's pixel size and given a satellite-feed treatment (a little
 * desaturated, green tint, scanlines, vignette). Cached per map + time preset + size; re-taken when
 * more photos finish developing.
 */
import * as THREE from 'three';
import type { MapScene } from '../../render/mapbuilder';
import type { Renderer } from '../../render/renderer';
import { G } from '../../render/shader';
import { onDevelopProgress } from '../../render/textures';

let developed = 0;
onDevelopProgress((done) => {
  developed = done;
});

const cache = new Map<string, HTMLCanvasElement>();

/** The satellite picture of `scene` at `w x h` pixels (north up). */
export function overheadImage(renderer: Renderer, scene: MapScene, w: number, h: number): HTMLCanvasElement {
  const key = `${scene.map.id}|${scene.time.id}|${w}x${h}|${developed}`;
  let c = cache.get(key);
  if (!c) {
    // Older pictures of this map/size are superseded (more photos developed, or a new size).
    for (const k of [...cache.keys()]) if (k.startsWith(`${scene.map.id}|`)) cache.delete(k);
    c = capture(renderer, scene, w, h);
    satellite(c);
    cache.set(key, c);
  }
  return c;
}

function capture(renderer: Renderer, scene: MapScene, w: number, h: number): HTMLCanvasElement {
  const gl = renderer.gl;
  const b = scene.map.bounds;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const top = b.max.y + 60;
  const cam = new THREE.OrthographicCamera(-(b.max.x - b.min.x) / 2, (b.max.x - b.min.x) / 2, (b.max.z - b.min.z) / 2, -(b.max.z - b.min.z) / 2, 0.1, top - b.min.y + 20);
  cam.up.set(0, 0, -1); // north (-z) at the top, +x to the right
  cam.position.set(cx, top, cz);
  cam.lookAt(cx, b.min.y - 1, cz);
  cam.updateMatrixWorld();
  const rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: true });
  const saved = { near: G.uFogNear.value, far: G.uFogFar.value, jitter: G.uJitter.value, affine: G.uAffine.value, flash: G.uFlash.value, sky: scene.sky.visible };
  const prevTarget = gl.getRenderTarget();
  const pixels = new Uint8Array(w * h * 4);
  try {
    G.uFogNear.value = 1e5;
    G.uFogFar.value = 2e5;
    G.uJitter.value = 0;
    G.uAffine.value = 0;
    G.uFlash.value = 0;
    scene.sky.visible = false;
    gl.setRenderTarget(rt);
    gl.setClearColor(0x161a14, 1);
    gl.clear();
    gl.render(scene.root, cam);
    gl.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
  } finally {
    G.uFogNear.value = saved.near;
    G.uFogFar.value = saved.far;
    G.uJitter.value = saved.jitter;
    G.uAffine.value = saved.affine;
    G.uFlash.value = saved.flash;
    scene.sky.visible = saved.sky;
    gl.setRenderTarget(prevTarget);
    rt.dispose();
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  // GL rows run bottom-up.
  for (let y = 0; y < h; y++) img.data.set(pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  g.putImageData(img, 0, 0);
  return c;
}

/** Satellite feed: desaturate, green-grey tint, a touch of contrast, scanlines, vignette. */
function satellite(c: HTMLCanvasElement): void {
  const g = c.getContext('2d')!;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const w = c.width;
  const h = c.height;
  for (let y = 0; y < h; y++) {
    const scan = y % 2 ? 0.84 : 1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = d[i]! / 255;
      const gg = d[i + 1]! / 255;
      const bb = d[i + 2]! / 255;
      const l = r * 0.299 + gg * 0.587 + bb * 0.114;
      const qx = x / w - 0.5;
      const qy = y / h - 0.5;
      const vig = 1 - (qx * qx + qy * qy) * 0.9;
      const k = scan * vig;
      const f = (v: number, tint: number) => Math.max(0, Math.min(255, ((((v * 0.62 + l * 0.38) - 0.5) * 1.12 + 0.5) * tint + 0.02) * k * 255));
      d[i] = f(r, 0.88);
      d[i + 1] = f(gg, 1.02);
      d[i + 2] = f(bb, 0.86);
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}
