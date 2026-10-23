/**
 * Blackout in the menus: a main-menu entry and the Quick Play playlist "Blackout (100)" both start
 * a solo game at once (`blackout.solo`: you plus 99 bots); the matchmade playlist exists for when
 * more people play.
 */
import { net } from '../../net';
import { registerMenuItem } from '../../registry';
import { navigate } from '../../router';

/** Start a solo Blackout game and go to it. */
export async function playBlackout(): Promise<void> {
  const r = await net.rpc('blackout.solo', {});
  navigate('match', { room: r.roomId });
}

registerMenuItem({ id: 'blackout.play', label: 'Blackout', hint: '100 players · solo', order: 16, action: () => void playBlackout().catch((err) => console.error('[blackout]', err)) });
