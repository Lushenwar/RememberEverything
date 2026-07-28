'use client';
// Client sync driver. Everything the learner does lands in IndexedDB first and
// syncs opportunistically, so going offline mid-session loses nothing.
import { useCallback, useEffect, useState } from 'react';
import { allNodes, kvGet, kvSet, putNodes } from './db.ts';
import { changedSince, mergeByLWW } from './sync.ts';
import type { GraphNode } from './types.ts';

const LAST_SYNC = 'lastSyncedAt';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

export function useSync(onMerged?: (nodes: GraphNode[]) => void) {
  const [state, setState] = useState<SyncState>('idle');
  const [online, setOnline] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<number>(0);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const countPending = useCallback(async () => {
    const since = (await kvGet<number>(LAST_SYNC)) ?? 0;
    setLastSyncedAt(since);
    setPending(changedSince(await allNodes(), since).length);
  }, []);

  useEffect(() => {
    countPending();
  }, [countPending]);

  const sync = useCallback(async () => {
    if (!navigator.onLine) {
      setState('offline');
      return;
    }
    setState('syncing');
    try {
      const since = (await kvGet<number>(LAST_SYNC)) ?? 0;
      const local = await allNodes();
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodes: changedSince(local, since) }),
      });
      if (!res.ok) throw new Error(`sync failed: ${res.status}`);
      const data: { nodes: GraphNode[]; syncedAt: number } = await res.json();

      // Merge locally too: the server saw only our changed subset, so its copy
      // of an untouched concept must not clobber ours.
      const { merged } = mergeByLWW(local, data.nodes);
      await putNodes(merged);
      await kvSet(LAST_SYNC, data.syncedAt);
      setLastSyncedAt(data.syncedAt);
      setPending(0);
      setState('idle');
      onMerged?.(merged);
    } catch {
      setState('error');
    }
  }, [onMerged]);

  // Drain whatever queued up while the device was offline.
  useEffect(() => {
    if (online && pending > 0 && state !== 'syncing') sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  return { state, online, pending, lastSyncedAt, sync, refresh: countPending };
}
