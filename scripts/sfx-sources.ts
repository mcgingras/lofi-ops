/**
 * The approved sound sources: every URL listed in docs/audio/sfx-manifest.md, and the local file
 * name each one is stored under in the raw folder. Fetching and building only ever use this list,
 * so nothing outside the manifest can sneak in.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const MANIFEST_PATH = resolve(import.meta.dirname, '../docs/audio/sfx-manifest.md');

/** Default raw-download folder (outside the repo). Override with SFX_RAW=/path. */
export const DEFAULT_RAW = '/private/tmp/claude-501/-Users-michaelgingras-Library-Application-Support-Claude-scratch-workspaces-d20cb7e9-1e85-4bd4-90e5-fc4c621b0940-e04bba9d-c970-458b-9bdc-220b4299ec65-scratch-2026-10-06-91bab5/7096f67a-e261-4f3f-b275-8e4ed141c615/scratchpad/sfx-raw';

export interface Source {
  /** Manifest "Sound" cell. */
  sound: string;
  url: string;
  /** Local file name in the raw folder, e.g. `fs/737569.mp3`, `ffsl/AR-15_D_32P.wav`, `kenney/impact-sounds.zip`. */
  file: string;
}

/** Local raw file name for an approved URL. */
export function rawName(url: string): string {
  const fs = /freesound\.org\/previews\/\d+\/(\d+)_\d+-hq\.mp3$/.exec(url);
  if (fs) return `fs/${fs[1]}.mp3`;
  const ffsl = /Prepared%20SFX%20Library%2F(.+)$/.exec(url);
  if (ffsl) return `ffsl/${decodeURIComponent(ffsl[1]!).replace(/[/ &]+/g, '_')}`;
  const kenney = /kenney_([a-z-]+)\.zip$/.exec(url);
  if (kenney) return `kenney/${kenney[1]}.zip`;
  const oga = /opengameart\.org\/.*\/([^/]+\.wav)$/.exec(url);
  if (oga) return `oga/${oga[1]}`;
  throw new Error(`no raw name rule for ${url}`);
}

/** Parse the manifest tables into sources (FFSL rows expand the `FFSL` prefix). */
export function parseManifest(text = readFileSync(MANIFEST_PATH, 'utf8')): Source[] {
  const prefix = /`FFSL = (https:[^`]+)`/.exec(text)?.[1];
  if (!prefix) throw new Error('manifest: FFSL prefix missing');
  const out: Source[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || line.startsWith('|---')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const sound = cells[1] ?? '';
    const cell = cells.find((c) => c.includes('https://') || c.startsWith('`FFSL`'));
    if (!cell) continue;
    let url: string;
    const ff = /^`FFSL` \+ `([^`]+)`/.exec(cell);
    if (ff) url = prefix + ff[1];
    else url = /(https:\/\/\S+)/.exec(cell)![1]!;
    out.push({ sound, url, file: rawName(url) });
  }
  return out;
}

export const SOURCE_FILES = (): Set<string> => new Set(parseManifest().map((s) => s.file));
