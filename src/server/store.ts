/**
 * Profile persistence on node:sqlite (built in). One row per profile; list-ish fields are JSON
 * columns. Guests are identified by a random token the client keeps in localStorage; only its
 * SHA-256 is stored. `:memory:` works for tests.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { newProfile, type Profile } from '../shared/profile';

// Loaded through require so bundlers/test runners that don't know the prefix-only builtin cope.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

const JSON_FIELDS = ['unlocks', 'loadouts', 'challengeProgress', 'stats', 'owned', 'ext'] as const;
type JsonField = (typeof JSON_FIELDS)[number];
const COLUMN: Record<JsonField, string> = { unlocks: 'unlocks', loadouts: 'loadouts', challengeProgress: 'challenge_progress', stats: 'stats', owned: 'owned', ext: 'ext' };

interface Row {
  id: string;
  name: string;
  xp: number;
  level: number;
  prestige: number;
  cod_points: number;
  selected_loadout: number;
  unlocks: string;
  loadouts: string;
  challenge_progress: string;
  stats: string;
  owned: string;
  ext: string;
  created_at: number;
  updated_at: number;
}

export class Store {
  private db: DatabaseSyncType;

  constructor(path = 'data/lofi.db') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        token_hash TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        prestige INTEGER NOT NULL DEFAULT 0,
        cod_points INTEGER NOT NULL DEFAULT 0,
        selected_loadout INTEGER NOT NULL DEFAULT 0,
        unlocks TEXT NOT NULL DEFAULT '[]',
        loadouts TEXT NOT NULL DEFAULT '[]',
        challenge_progress TEXT NOT NULL DEFAULT '{}',
        stats TEXT NOT NULL DEFAULT '{}',
        owned TEXT NOT NULL DEFAULT '[]',
        ext TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * Find the profile for a token, or create a guest profile (new token) when the token is missing
   * or unknown. Returns the token the client should keep.
   */
  authenticate(token?: string | null, name?: string | null): { profile: Profile; token: string; created: boolean } {
    if (token && typeof token === 'string' && token.length >= 16 && token.length <= 128) {
      const row = this.db.prepare('SELECT * FROM profiles WHERE token_hash = ?').get(hashToken(token)) as Row | undefined;
      if (row) return { profile: fromRow(row), token, created: false };
    }
    const fresh = randomBytes(24).toString('hex');
    const profile = newProfile(randomUUID(), cleanName(name) ?? `Guest${Math.floor(1000 + Math.random() * 9000)}`);
    this.insert(profile, fresh);
    return { profile, token: fresh, created: true };
  }

  load(id: string): Profile | null {
    const row = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  save(p: Profile): void {
    p.updatedAt = Date.now();
    this.db
      .prepare(
        `UPDATE profiles SET name = ?, xp = ?, level = ?, prestige = ?, cod_points = ?, selected_loadout = ?,
         unlocks = ?, loadouts = ?, challenge_progress = ?, stats = ?, owned = ?, ext = ?, updated_at = ? WHERE id = ?`,
      )
      .run(p.name, p.xp, p.level, p.prestige, p.codPoints, p.selectedLoadout, ...JSON_FIELDS.map((f) => JSON.stringify(p[f])), p.updatedAt, p.id);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }).n;
  }

  close(): void {
    this.db.close();
  }

  private insert(p: Profile, token: string) {
    this.db
      .prepare(
        `INSERT INTO profiles (id, token_hash, name, xp, level, prestige, cod_points, selected_loadout, ${JSON_FIELDS.map((f) => COLUMN[f]).join(', ')}, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.id, hashToken(token), p.name, p.xp, p.level, p.prestige, p.codPoints, p.selectedLoadout, ...JSON_FIELDS.map((f) => JSON.stringify(p[f])), p.createdAt, p.updatedAt);
  }
}

export function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const n = name.replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16);
  return n.length >= 2 ? n : null;
}

function parse<T>(text: string, fallback: T): T {
  try {
    const v = JSON.parse(text) as unknown;
    if (Array.isArray(fallback) ? Array.isArray(v) : v && typeof v === 'object' && !Array.isArray(v)) return v as T;
  } catch {
    /* fall through */
  }
  return fallback;
}

function fromRow(r: Row): Profile {
  const d = newProfile(r.id, r.name, r.created_at);
  return {
    ...d,
    xp: r.xp,
    level: r.level,
    prestige: r.prestige,
    codPoints: r.cod_points,
    selectedLoadout: r.selected_loadout,
    unlocks: parse(r.unlocks, d.unlocks),
    loadouts: (() => {
      const l = parse(r.loadouts, d.loadouts);
      return l.length ? l : d.loadouts;
    })(),
    challengeProgress: parse(r.challenge_progress, d.challengeProgress),
    stats: parse(r.stats, d.stats),
    owned: parse(r.owned, d.owned),
    ext: parse(r.ext, d.ext),
    updatedAt: r.updated_at,
  };
}
