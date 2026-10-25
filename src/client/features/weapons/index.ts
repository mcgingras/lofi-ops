/**
 * Client side of the "weapons" feature (auto-imported by main.ts via import.meta.glob):
 * textures, viewmodels (all weapons, attachments, animations), third-person weapon models,
 * per-weapon sounds, scope overlay / sway / hold breath / variable zoom, equipment and melee, and
 * the Mystery Box's wonder weapons (wonder/), and the secondary launchers (launchers/).
 * See docs/features/weapons.md.
 */
import './textures';
import './viewmodels';
import './worldmodels';
import './sounds';
import './scope';
import './equipment';
import './killfeed';
import './wonder/index';
import './launchers/index';

export { equipState } from './equipment';
export { scopeState } from './scope';
export { dressSoldier } from './worldmodels';
export { actionHands, buildWeaponViewmodel } from './viewmodels';
export { tomahawkMesh } from './gunkit';
