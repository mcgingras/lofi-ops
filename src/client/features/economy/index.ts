/**
 * Client side of the "economy" feature (auto-imported by main.ts via import.meta.glob):
 * camo texture recipes + preview helper, STORE and WAGER screens, wager/award HUD widgets,
 * wager weapon viewmodels, projectile views, third-person camo, and the main menu entries.
 *
 * For other areas: `camoPreview(id, size)` (camos.ts) for camo pickers, `itemPreview(item)`
 * (store-screen.ts), `drawReticle` / `drawEmblemBackground` (paint.ts).
 */
import '../../../shared/defs/economy-net';
import { registerMenuItem } from '../../registry';
import { navigate } from '../../router';
import './economy.css';
import './camos';
import './store-screen';
import './wager-screen';
import './hud';
import './wager-results';
import './models';

export { camoPreview, camoTextureId } from './camos';
export { itemPreview } from './store-screen';
export { drawEmblemBackground, drawReticle, paintCamo } from './paint';

registerMenuItem({ id: 'economy.wager', label: 'Wager Match', hint: 'Bet CoD Points', order: 30, action: () => navigate('wager') });
registerMenuItem({ id: 'economy.store', label: 'Store', hint: 'Spend CoD Points', order: 60, action: () => navigate('store') });
