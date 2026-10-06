/**
 * Server side of the 'weapons' feature area (owner: weapons). See docs/CONTRACTS.md.
 * TODO(weapons): implement. Register RPCs/modes/weapon behaviours in setup(), and per-room
 * bus handlers / modifiers in room().
 */
import type { Feature } from '../../feature';

const feature: Feature = {
  id: 'weapons',
  setup(_api) {},
  room(_room) {},
};

export default feature;
