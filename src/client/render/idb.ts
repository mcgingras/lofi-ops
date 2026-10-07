/**
 * Tiny IndexedDB key/value cache for developed textures (PNG blobs) and light bakes
 * (Float32Array buffers). Every call fails soft: no IndexedDB (private mode, old browser) just
 * means no cache.
 */
const DB_NAME = 'lofi-ops-cache';
const STORES = ['textures', 'bakes'] as const;
export type CacheStore = (typeof STORES)[number];

let dbp: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

export async function cacheGet<T>(store: CacheStore, key: string): Promise<T | undefined> {
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function cachePut(store: CacheStore, key: string, value: unknown): Promise<void> {
  const d = await db();
  if (!d) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Drop everything (Settings > clear cache). */
export async function cacheClear(): Promise<void> {
  const d = await db();
  if (!d) return;
  await Promise.all(
    STORES.map(
      (s) =>
        new Promise<void>((resolve) => {
          try {
            const tx = d.transaction(s, 'readwrite');
            tx.objectStore(s).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
          } catch {
            resolve();
          }
        }),
    ),
  );
}
