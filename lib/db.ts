// IndexedDB persistence. Two stores: `nodes` (the graph) and `kv` (everything else).
// ponytail: whole graph is read into memory on load. Fine to ~10k concepts;
// add an index + cursor queries if a user ever passes that.
import type { GraphNode } from './types.ts';

const DB_NAME = 'remember-everything';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable (server or private mode)'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('nodes')) db.createObjectStore('nodes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export async function allNodes(): Promise<GraphNode[]> {
  try {
    return await tx<GraphNode[]>('nodes', 'readonly', (s) => s.getAll());
  } catch {
    return [];
  }
}

export async function putNodes(nodes: GraphNode[]): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('nodes', 'readwrite');
    const s = t.objectStore('nodes');
    for (const n of nodes) s.put(n);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function deleteNode(id: string): Promise<void> {
  return tx<undefined>('nodes', 'readwrite', (s) => s.delete(id)).then(() => undefined);
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    return await tx<T>('kv', 'readonly', (s) => s.get(key));
  } catch {
    return undefined;
  }
}

export function kvSet<T>(key: string, value: T): Promise<void> {
  return tx<IDBValidKey>('kv', 'readwrite', (s) => s.put(value, key)).then(() => undefined);
}
