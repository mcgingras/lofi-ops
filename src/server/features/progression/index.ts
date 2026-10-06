/**
 * Server side of the 'progression' feature area (owner: progression). See docs/CONTRACTS.md.
 * TODO(progression): implement. Register RPCs/modes/weapon behaviours in setup(), and per-room
 * bus handlers / modifiers in room().
 */
import type { Feature } from '../../feature';

const feature: Feature = {
  id: 'progression',
  setup(_api) {},
  room(_room) {},
};

export default feature;
