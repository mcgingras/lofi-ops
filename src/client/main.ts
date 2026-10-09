/**
 * Client boot: styles, the shared renderer, settings wiring, core screens, texture recipes and
 * feature folders (both auto-imported, so new files need no edit here), routing, the socket, and
 * background photo developing.
 */
import './menus/menus.css';
import './render/shader';
import { Renderer } from './render/renderer';
import { developOptions, knobsOf } from './render/retro';
import { develop, setDevelopOptions, setLook, setTextureFilter } from './render/textures';
import { initRouter } from './router';
import { net } from './net';
import { onSettings } from './settings';
import { client } from './state';
import { sfx } from './game/audio';
import './menus/main-menu';
import './menus/settings';
import './menus/match-screen';
import './menus/padnav';

// Texture recipes (one file per map/area) and feature folders register themselves on import.
import.meta.glob('./render/recipes/*.ts', { eager: true });
// Features load after the core screens so they can replace them (see features.ts).
import './features';

const app = document.getElementById('app')!;
const screen = document.createElement('div');
screen.id = 'screen';
const overlay = document.createElement('div');
overlay.id = 'overlay';
overlay.hidden = true;
app.append(screen, overlay);

let renderer: Renderer | null = null;
try {
  renderer = new Renderer(app);
  client.renderer = renderer;
  renderer.clear();
} catch (err) {
  console.error(err);
  const msg = document.createElement('div');
  msg.className = 'lf-center lf-banner';
  msg.textContent = 'WebGL is not available in this browser.';
  app.append(msg);
}

onSettings((s, changed) => {
  renderer?.setOptions({ ...knobsOf(s), grade: s.grade, fov: s.fov });
  setLook(s.look);
  setTextureFilter(s.texFilter);
  setDevelopOptions(developOptions(s));
  sfx.setVolume(s.volume);
  if (changed.includes('time') && changed.length < 4) void client.match?.setTime(s.time);
});

initRouter(screen, overlay, 'menu');
net.connect();
void document.fonts?.load('16px Silkscreen').catch(() => {});

// Develop every registered photo texture in the background (cached in IndexedDB after the first time).
setTimeout(() => void develop(), 300);

// Dev-only console handle for debugging (window.__lofi.match, .renderer, net).
if (import.meta.env.DEV) (window as unknown as { __lofi: unknown }).__lofi = { client, net };
