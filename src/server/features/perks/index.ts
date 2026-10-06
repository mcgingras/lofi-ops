/**
 * Server side of the 'perks' feature area (owner: perks-streaks). See docs/CONTRACTS.md.
 * TODO(perks-streaks): implement. Register RPCs/modes/weapon behaviours in setup(), and per-room
 * bus handlers / modifiers in room().
 */
import type { Feature } from '../../feature';

const feature: Feature = {
  id: 'perks',
  setup(_api) {},
  room(_room) {},
};

export default feature;
