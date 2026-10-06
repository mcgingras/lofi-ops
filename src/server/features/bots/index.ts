/**
 * Server side of the 'bots' feature area (owner: bots). See docs/CONTRACTS.md.
 * TODO(bots): implement. Register RPCs/modes/weapon behaviours in setup(), and per-room
 * bus handlers / modifiers in room().
 */
import type { Feature } from '../../feature';

const feature: Feature = {
  id: 'bots',
  setup(_api) {},
  room(_room) {},
};

export default feature;
