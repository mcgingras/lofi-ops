/**
 * Server side of the 'modes' feature area (owner: modes). See docs/CONTRACTS.md.
 * TODO(modes): implement. Register RPCs/modes/weapon behaviours in setup(), and per-room
 * bus handlers / modifiers in room().
 */
import type { Feature } from '../../feature';

const feature: Feature = {
  id: 'modes',
  setup(_api) {},
  room(_room) {},
};

export default feature;
