/**
 * Local control of streaks: key 5 (or D-pad right / left on a controller) cycles the selected
 * ready streak; while designating the weapon
 * is lowered; while driving an RC-XD (chase cam) or working a Chopper Gunner (camera in the gunner
 * seat) the camera follows the entity and mouse look aims it. Input still goes out through the
 * normal command stream (movement keys, FIRE, STREAK). The Valkyrie rocket cam is in valkyrie.ts.
 */
import * as THREE from 'three';
import { viewDir } from '../../../shared/math';
import { net } from '../../net';
import { registerMatchHook } from '../../registry';
import type { Match } from '../../game/match';
import { registerPromptKey } from '../../game/prompts';
import { ksClient, refreshState, resetClient } from './store';

registerPromptKey('streakNext', () => 'Digit5');

/** Select the next (+1) or previous (-1) ready streak. */
function cycle(dir: 1 | -1): void {
  const st = ksClient.state;
  if (!st || st.ready.length < 2) return;
  const n = st.ready.length;
  void net.rpc('killstreaks.select', { index: (((st.selected + dir) % n) + n) % n }).catch(() => {});
}

const pos = new THREE.Vector3();
let followId = -1;
let startedFor = -1;

function entityPos(m: Match, id: number): THREE.Vector3 | null {
  const e = m.net.lastSnap?.ents.find((x) => x.id === id);
  if (!e) return null;
  return new THREE.Vector3(e.x, e.y, e.z);
}

registerMatchHook('killstreaks.control', {
  start(m) {
    resetClient();
    void refreshState();
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Digit5' || !m.controls.locked || e.repeat) return;
      cycle(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  },
  frame(m, dt) {
    if (m.controls.consume('streakNext')) cycle(1);
    if (m.controls.consume('streakPrev')) cycle(-1);
    const st = ksClient.state;
    if (st?.armed && m.alive) m.viewmodel.visible = false;
    const ctl = st?.control;
    if (!ctl || !m.alive || ctl.id === 'valkyrie') {
      followId = -1;
      return;
    }
    const target = entityPos(m, ctl.entity);
    if (!target) return;
    if (followId !== ctl.entity) {
      followId = ctl.entity;
      pos.copy(target);
      // Look down from the gunner seat when it starts.
      if (ctl.id === 'chopper_gunner' && startedFor !== ctl.entity) {
        startedFor = ctl.entity;
        m.controls.pitch = -0.75;
      }
    }
    pos.lerp(target, 1 - Math.exp(-dt * 14));
    const cam = m.renderer.cam;
    if (ctl.id === 'rcxd') {
      const f = viewDir(m.yaw, 0);
      cam.position.set(pos.x - f.x * 2.2, pos.y + 1.1, pos.z - f.z * 2.2);
      cam.rotation.set(Math.max(-0.6, Math.min(0.3, m.pitch)) - 0.18, m.yaw, 0, 'YXZ');
    } else {
      cam.position.set(pos.x, pos.y - 1.6, pos.z);
      cam.rotation.set(m.pitch, m.yaw, 0, 'YXZ');
    }
    m.viewmodel.visible = false;
  },
});
