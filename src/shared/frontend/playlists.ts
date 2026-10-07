/**
 * Quick Play playlists (owner: frontend). A playlist is what the main menu offers under
 * Multiplayer -> Quick Play; the server's matchmaker groups lobbies by playlist id. Modes that are
 * not registered yet (the modes feature adds dom/sd/hq/kc) show as "coming soon".
 */
import { MODE_BY_ID } from '../defs/modes';
import { indexById } from '../defs/registry';

export interface PlaylistDef {
  id: string;
  name: string;
  description: string;
  /** Mode ids in rotation order; the first registered one is used. */
  modes: string[];
  category: 'core' | 'objective';
}

export const PLAYLISTS: PlaylistDef[] = [
  { id: 'tdm', name: 'Team Deathmatch', description: 'Two teams, first to the kill limit.', modes: ['tdm'], category: 'core' },
  { id: 'ffa', name: 'Free-for-All', description: 'Everyone for themselves.', modes: ['ffa'], category: 'core' },
  { id: 'dom', name: 'Domination', description: 'Hold the A, B and C flags.', modes: ['dom'], category: 'objective' },
  { id: 'sd', name: 'Search & Destroy', description: 'One life. Plant or defuse the bomb.', modes: ['sd'], category: 'objective' },
  { id: 'hq', name: 'Headquarters', description: 'Capture and hold the HQ.', modes: ['hq'], category: 'objective' },
  { id: 'kc', name: 'Kill Confirmed', description: 'Collect dog tags to score.', modes: ['kc'], category: 'objective' },
];

export const PLAYLIST_BY_ID = indexById(PLAYLISTS);

/** The mode a playlist plays now, or null if none of its modes is registered. */
export function playlistMode(p: PlaylistDef): string | null {
  return p.modes.find((m) => MODE_BY_ID.has(m)) ?? null;
}

export const playlistAvailable = (p: PlaylistDef) => playlistMode(p) !== null;
