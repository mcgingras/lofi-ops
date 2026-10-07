/**
 * Client-wide state holder for features and HUD widgets: the renderer and the current match
 * (null in menus). `currentMatch()` is the read side; core sets `client.match`.
 */
import type { Match } from './game/match';
import type { Renderer } from './render/renderer';

export const client: { match: Match | null; renderer: Renderer | null } = { match: null, renderer: null };

export const currentMatch = (): Match | null => client.match;
