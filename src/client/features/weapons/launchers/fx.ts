/**
 * Launcher projectiles and their looks (entity kind `LAUNCHER_ENTITY`, `weapons.rocket`): a China
 * Lake grenade tumbling on its arc (a China Beach bomblet smaller and blinking red), a rocket or
 * missile with its motor glow and a smoke trail (a homing missile's glow is green-white), a dud
 * dropping dark. Someone else's launch plays its gunshot where it leaves; a rocket passing close
 * whooshes. Your own pull (`registerShotFx(id).local`): backblast smoke behind the tube and a flash
 * at the muzzle, so the shot never waits for the server.
 */
import * as THREE from 'three';
import { LAUNCHER_ENTITY, LAUNCHER_IDS, LAUNCHERS } from '../../../../shared/defs/launchers';
import { sfx } from '../../../game/audio';
import type { Match } from '../../../game/match';
import { registerEntityRenderer, registerShotFx } from '../../../registry';
import { makeLookMaterial, setDynLight, type LookMaterial } from '../../../render/shader';
import { getTexture, unbindTexture } from '../../../render/textures';

registerEntityRenderer(LAUNCHER_ENTITY, (e, m) => {
  const id = String(e.s?.w ?? 'rpg');
  const t = LAUNCHERS[id];
  const bomblet = e.s?.c === 1;
  const mats: LookMaterial[] = [];
  const mk = (texture: string, tint = 0xffffff, emissive = 0) => {
    const mt = makeLookMaterial({ texture, tint, emissive, dyn: true, rep: 0.1 });
    mats.push(mt);
    return mt;
  };
  const obj = new THREE.Group();
  const body = new THREE.Group();
  obj.add(body);
  const add = (g: THREE.BufferGeometry, mt: THREE.Material, z = 0) => {
    const mesh = new THREE.Mesh(g, mt);
    mesh.position.z = z;
    body.add(mesh);
    return mesh;
  };
  let blink: THREE.Mesh | null = null;
  const grenade = t?.kind === 'grenade' || bomblet;
  if (grenade) {
    const r = bomblet ? 0.025 : 0.032;
    add(new THREE.CylinderGeometry(r, r, bomblet ? 0.05 : 0.11, 6).rotateX(Math.PI / 2), mk(bomblet ? 'gunmetal' : 'weapons.olive'));
    add(new THREE.CylinderGeometry(r * 0.6, r, 0.03, 6).rotateX(Math.PI / 2), mk('weapons.brass'), bomblet ? -0.035 : -0.065);
    if (bomblet) blink = add(new THREE.BoxGeometry(0.02, 0.02, 0.02), mk('weapons.red', 0xffffff, 1), 0);
  } else {
    const missile = t?.kind === 'missile';
    const r = missile ? 0.035 : id === 'rpg' ? 0.05 : 0.035;
    const len = missile ? 0.7 : id === 'rpg' ? 0.55 : 0.5;
    add(new THREE.CylinderGeometry(r * 0.6, r * 0.6, len, 6).rotateX(Math.PI / 2), mk(missile ? 'weapons.tan' : 'weapons.olive'));
    // Nose cone pointing along -z (the cylinder's thin end).
    add(new THREE.CylinderGeometry(0.01, r, 0.16, 6).rotateX(-Math.PI / 2), mk(missile ? 'weapons.lens' : 'weapons.olive'), -len / 2 - 0.08);
    for (let i = 0; i < 4; i++) {
      const fin = add(new THREE.BoxGeometry(0.004, r * 2.2, 0.08), mk('gunmetal'), len / 2 - 0.05);
      fin.rotation.z = (i / 4) * Math.PI;
    }
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getTexture('glow'), color: e.s?.h ? 0xd8ffd0 : 0xffb050, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  glow.position.z = 0.35;
  glow.scale.setScalar(grenade ? 0 : 0.8);
  body.add(glow);
  // Someone else fired: the launch sound where it left (your own already played on the pull).
  if (m.myId !== e.owner && !bomblet && !e.s?.d && LAUNCHER_IDS.includes(id)) sfx.gunshot(id, { x: e.x, y: e.y, z: e.z });
  let spin = 0;
  let trailAt = 0;
  let whooshed = false;
  let dud = !!e.s?.d;
  return {
    object: obj,
    update(s, dt, match: Match) {
      body.rotation.x = typeof s.s?.p === 'number' ? s.s.p : 0;
      const nowDud = !!s.s?.d;
      if (nowDud && !dud) {
        dud = true;
        sfx.play('weapons.dud', { at: { x: s.x, y: s.y, z: s.z }, volume: 0.7 });
        match.effects.puff('spark', { x: s.x, y: s.y, z: s.z }, undefined, 4);
      }
      glow.visible = !dud && !grenade;
      if (grenade || dud) {
        spin += dt * (dud ? 6 : 12);
        body.rotation.x += spin;
      } else {
        glow.scale.setScalar(0.6 + Math.random() * 0.5);
        // Smoke trail: a puff every few centimetres of flight.
        trailAt -= dt;
        if (trailAt <= 0) {
          trailAt = 0.03;
          match.effects.puff('dust', { x: s.x, y: s.y, z: s.z }, { x: 0, y: 0.3, z: 0 }, 1);
        }
        const cam = match.renderer.cam.position;
        if (!whooshed && s.owner !== match.myId && Math.hypot(cam.x - s.x, cam.y - s.y, cam.z - s.z) < 8) {
          whooshed = true;
          sfx.play('weapons.rocket.whoosh', { at: { x: s.x, y: s.y, z: s.z }, volume: 0.8 });
        }
      }
      if (blink) blink.visible = Math.floor(match.time * 8) % 2 === 0;
      if (match.map) setDynLight(mats, match.map.lightAt(s.x, s.y + 0.2, s.z));
    },
    dispose() {
      obj.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      glow.material.dispose();
      for (const mt of mats) {
        unbindTexture(mt);
        mt.dispose();
      }
    },
  };
});

// Your own pull: backblast behind the shoulder (rockets and missiles), a flash at the muzzle.
for (const id of LAUNCHER_IDS) {
  registerShotFx(id, {
    local(m, origin, dir) {
      const muzzle = { x: origin.x + dir.x * 0.9, y: origin.y + dir.y * 0.9 - 0.05, z: origin.z + dir.z * 0.9 };
      m.effects.puff('spark', muzzle, dir, 5);
      m.effects.puff('dust', muzzle, dir, 3);
      if (LAUNCHERS[id]?.kind !== 'grenade') {
        const back = { x: origin.x - dir.x * 0.8, y: origin.y - dir.y * 0.8, z: origin.z - dir.z * 0.8 };
        m.effects.puff('dust', back, { x: -dir.x, y: 0.2, z: -dir.z }, 8);
      }
    },
    replay(m, _shooter, from, to) {
      m.effects.puff('dust', from, undefined, 3);
      m.effects.puff('spark', to, undefined, 6);
    },
  });
}
