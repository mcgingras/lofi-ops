/**
 * Small side-on gun pictures for the store's gun list. One shared offscreen WebGL renderer draws
 * each model once (the real viewmodel builder, as in the Create-a-Class turntable) at a low
 * resolution; the result is copied into a 2D canvas per row, so the list holds no GL contexts.
 * Renders are queued and spread over animation frames. Without WebGL the row keeps a text plate.
 */
import * as THREE from 'three';
import { buildViewmodel } from '../../render/models/viewmodels';
import { setDynLight } from '../../render/shader';
import { unbindTexture } from '../../render/textures';
import { stripHands } from '../frontend/preview';

export const THUMB_W = 120;
export const THUMB_H = 45;

let gl: THREE.WebGLRenderer | null | undefined;
const done = new Map<string, HTMLCanvasElement>();
const waiting = new Map<string, Set<HTMLCanvasElement>>();
let raf = 0;

function renderer(): THREE.WebGLRenderer | null {
  if (gl !== undefined) return gl;
  try {
    const canvas = document.createElement('canvas');
    gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
    gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    gl.setPixelRatio(1);
    gl.setClearColor(0x000000, 0);
    gl.setSize(THUMB_W, THUMB_H, false);
  } catch {
    gl = null;
  }
  return gl;
}

function plate(c: HTMLCanvasElement, label: string): void {
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#ece2ce';
  g.font = '10px Silkscreen, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label.replace(/[^A-Za-z0-9]/g, '').slice(0, 7).toUpperCase(), c.width / 2, c.height / 2);
}

/** Render `model` side-on into a fresh 2D canvas (null without WebGL). */
function draw(model: string): HTMLCanvasElement | null {
  const r = renderer();
  if (!r) return null;
  const scene = new THREE.Scene();
  const aspect = THUMB_W / THUMB_H;
  const cam = new THREE.OrthographicCamera(-0.5 * aspect, 0.5 * aspect, 0.5, -0.5, 0.01, 20);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);
  const vm = buildViewmodel(model, [], 'none');
  stripHands(vm.group); // just the gun
  const turn = new THREE.Group();
  turn.add(vm.group);
  // Viewmodels point down -Z: turn the barrel to face right, tilted a touch towards the viewer.
  turn.rotation.set(0.06, -Math.PI / 2 + 0.1, 0);
  const holder = new THREE.Group();
  holder.add(turn);
  scene.add(holder);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(turn);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const s = Math.min((aspect * 0.94) / Math.max(0.05, size.x), 0.9 / Math.max(0.05, size.y));
  holder.scale.setScalar(s);
  holder.position.set(-centre.x * s, -centre.y * s, -centre.z * s);
  setDynLight(vm.mats, [1.0, 0.95, 0.86], 0.12);
  r.render(scene, cam);
  const out = document.createElement('canvas');
  out.width = THUMB_W;
  out.height = THUMB_H;
  out.getContext('2d')!.drawImage(r.domElement, 0, 0);
  vm.group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  for (const m of vm.mats) {
    unbindTexture(m);
    m.dispose();
  }
  return out;
}

function pump(): void {
  raf = 0;
  const t0 = performance.now();
  for (const [model, targets] of waiting) {
    waiting.delete(model);
    const img = draw(model);
    if (img) done.set(model, img);
    for (const c of targets) {
      if (!img) continue;
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0);
    }
    if (performance.now() - t0 > 12) break; // keep the menu responsive: the rest next frame
  }
  if (waiting.size) raf = requestAnimationFrame(pump);
}

/** A canvas showing `model` side-on (filled in on a later frame the first time a model is asked for). */
export function gunThumb(model: string, label: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = THUMB_W;
  c.height = THUMB_H;
  c.className = 'ec-thumb';
  const img = done.get(model);
  if (img) {
    c.getContext('2d')!.drawImage(img, 0, 0);
    return c;
  }
  plate(c, label);
  if (renderer() === null) return c;
  let set = waiting.get(model);
  if (!set) waiting.set(model, (set = new Set()));
  set.add(c);
  if (!raf) raf = requestAnimationFrame(pump);
  return c;
}

/** Free the shared GL context (finished pictures stay cached). */
export function releaseGunThumbs(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  waiting.clear();
  if (gl) {
    gl.dispose();
    gl.forceContextLoss();
  }
  gl = undefined;
}
