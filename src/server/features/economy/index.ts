/**
 * Server side of the 'economy' feature area (owner: economy). See docs/CONTRACTS.md.
 * TODO(economy): implement. Register RPCs/modes/weapon behaviours in setup(), and per-room
 * bus handlers / modifiers in room().
 */
import type { Feature } from '../../feature';

const feature: Feature = {
  id: 'economy',
  setup(_api) {},
  room(_room) {},
};

export default feature;
