'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useSync } from '@/lib/useSync';

/** Registers the service worker and shows connection / sync state. */
export default function SyncBar() {
  const { state, online, pending, lastSyncedAt, sync } = useSync();

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* offline support is optional; the app works without it */
      });
    }
  }, []);

  // A rejected key is the one state the learner can actually fix, so it links
  // to where they fix it instead of offering a retry that will fail again.
  if (state === 'unauthorized') {
    return (
      <Link href="/settings" className="font-mono text-[11px] text-warn">
        sync key rejected — fix
      </Link>
    );
  }

  const label = !online
    ? `offline${pending > 0 ? ` · ${pending} queued` : ''}`
    : state === 'syncing'
      ? 'syncing…'
      : state === 'disabled'
        ? 'sync off'
        : state === 'error'
          ? 'sync failed'
          : pending > 0
            ? `${pending} unsynced`
            : lastSyncedAt
              ? 'synced'
              : 'not synced yet';

  const tone =
    !online || state === 'error' ? 'text-warn' : pending > 0 ? 'text-foreground' : 'text-muted';

  return (
    <button
      onClick={sync}
      disabled={!online || state === 'syncing' || state === 'disabled'}
      title={
        state === 'disabled'
          ? 'SYNC_SECRET is not set on the server'
          : lastSyncedAt
            ? `last synced ${new Date(lastSyncedAt).toLocaleString()}`
            : 'never synced'
      }
      className={`font-mono text-[11px] ${tone} disabled:cursor-default`}
    >
      {!online && '⚠ '}
      {label}
    </button>
  );
}
