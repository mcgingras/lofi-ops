/**
 * Server side of the 'killstreaks' feature area (owner: perks-streaks). See docs/CONTRACTS.md.
 * TODO(perks-streaks): implement. Register RPCs/modes/weapon behaviours in setup(), and per-room
 * bus handlers / modifiers in room().
 */
import type { Feature } from '../../feature';

const feature: Feature = {
  id: 'killstreaks',
  setup(_api) {},
  room(_room) {},
};

export default feature;
