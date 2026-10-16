/**
 * Glitch killstreak, client side: the `killstreaks.glitch` state push turns the glitched screen on
 * (renderer glitch, vertex snap and affine boosts) for the glitched side only and off again when the
 * push says it ended; the banner reads by side; the caller's side sees glitched enemies trail
 * colour-shifted ghosts.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { glitchClient, iAmGlitched } from '../src/client/features/killstreaks/glitch';
import { dispatchFeature, matchHooks } from '../src/client/registry';
import { client } from '../src/client/state';
import { GLITCH } from '../src/shared/defs/glitch';

function fakeMatch(myTeam: 0 | 1) {
  const scene = new THREE.Scene();
  const renderer = { glitch: 0, glitchBurst: 0, snapBoost: 0, warpBoost: 0, holdFrame: false, scene };
  const m = { myId: 'me', myTeam, serverTime: 100, time: 100, alive: true, renderer, remotes: { views: new Map<string, unknown>() } };
  client.match = m as never;
  return m;
}
const hook = () => matchHooks.get('killstreaks.glitch')!;
const at = (m: ReturnType<typeof fakeMatch>, t: number) => {
  m.serverTime = t;
  m.time = t;
  hook().frame!(m as never, 1 / 60);
};

afterEach(() => {
  dispatchFeature('killstreaks.glitch', { active: [] });
  client.match = null;
});

describe('Glitch client', () => {
  it('the state push turns the glitched screen on for the glitched side, and off when it ends', () => {
    const m = fakeMatch(1);
    hook().start?.(m as never);
    dispatchFeature('killstreaks.glitch', { active: [{ owner: 'enemy', team: 0, until: 100 + GLITCH.durationSec }] });
    expect(iAmGlitched()).toBe(true);
    expect(glitchClient.banner?.text).toBe('ENEMY GLITCH — SYSTEMS CORRUPTED');
    at(m, 103);
    expect(m.renderer.glitch).toBe(1);
    expect(m.renderer.warpBoost).toBe(1);
    expect(m.renderer.snapBoost).toBeGreaterThan(1);
    // Held frames and bursts come and go over a few seconds.
    let held = 0;
    for (let t = 103; t < 110; t += 1 / 60) {
      at(m, t);
      if (m.renderer.holdFrame) held++;
    }
    expect(held).toBeGreaterThan(0);
    dispatchFeature('killstreaks.glitch', { active: [] });
    expect(iAmGlitched()).toBe(false);
    at(m, 110.1);
    expect(m.renderer).toMatchObject({ glitch: 0, glitchBurst: 0, snapBoost: 0, warpBoost: 0, holdFrame: false });
  });

  it('expires on its own at `until` even without the push', () => {
    const m = fakeMatch(1);
    dispatchFeature('killstreaks.glitch', { active: [{ owner: 'enemy', team: 0, until: 120 }] });
    at(m, 110);
    expect(m.renderer.glitch).toBe(1);
    at(m, 120.01);
    expect(m.renderer.glitch).toBe(0);
  });

  it('the caller’s side: no glitched screen, the DEPLOYED banner, glitched enemies trail ghosts', () => {
    const m = fakeMatch(0);
    const root = new THREE.Group();
    const lie = new THREE.Group();
    root.add(lie);
    lie.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3), new THREE.MeshBasicMaterial()));
    m.remotes.views.set('e1', { id: 'e1', team: 1, alive: true, yaw: 0, soldier: { root, lie } });
    m.remotes.views.set('f1', { id: 'f1', team: 0, alive: true, yaw: 0, soldier: { root: new THREE.Group(), lie: new THREE.Group() } });
    dispatchFeature('killstreaks.glitch', { active: [{ owner: 'me', team: 0, until: 120 }] });
    expect(iAmGlitched()).toBe(false);
    expect(glitchClient.banner?.text).toBe('GLITCH DEPLOYED');
    for (let t = 101; t < 102; t += 1 / 60) at(m, t);
    expect(m.renderer.glitch).toBe(0);
    const ghosts = m.renderer.scene.children.filter((o) => o !== root);
    expect(ghosts.length).toBeGreaterThan(0);
    expect(ghosts.length).toBeLessThanOrEqual(3);
    // It ends: the ghosts go, the body is shown.
    dispatchFeature('killstreaks.glitch', { active: [] });
    at(m, 102.1);
    expect(m.renderer.scene.children.length).toBe(0);
    expect(lie.visible).toBe(true);
  });
});
