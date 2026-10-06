/**
 * Server side of the 'frontend' feature area (owner: frontend). See docs/CONTRACTS.md.
 * TODO(frontend): implement. Register RPCs/modes/weapon behaviours in setup(), and per-room
 * bus handlers / modifiers in room().
 */
import type { Feature } from '../../feature';

const feature: Feature = {
  id: 'frontend',
  setup(_api) {},
  room(_room) {},
};

export default feature;
