'use client';

import { useEffect, useRef, useState } from 'react';
import { buildExport, exportFilename, parseGraphExport } from '@/lib/portable';
import { mergeByLWW } from '@/lib/sync';
import { useGraph } from '@/lib/useGraph';
import { getSyncKey, setSyncKey } from '@/lib/useSync';

export default function SettingsPage() {
  const { nodes, loading, replaceAll } = useGraph();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const [key, setKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);

  useEffect(() => {
    getSyncKey().then((k) => setKey(k ?? ''));
  }, []);

  function download() {
    const blob = new Blob([JSON.stringify(buildExport(nodes), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename();
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file: File) {
    setMessage('');
    setError('');
    const result = parseGraphExport(await file.text());
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Same last-write-wins rule sync uses: importing a backup must not roll
    // back concepts you have reviewed more recently than the file.
    const { merged, conflicts } = mergeByLWW(nodes, result.nodes);
    await replaceAll(merged);
    setMessage(
      `Imported ${result.nodes.length} concepts — ${merged.length} in the graph now` +
        (conflicts.length ? `, ${conflicts.length} resolved to the newer review` : '') +
        (result.skipped ? `. Skipped ${result.skipped} malformed entries.` : '.'),
    );
  }

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-xl font-medium">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Your graph lives in this browser&apos;s storage. Clearing site data deletes it, so keep a
          backup.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Backup</h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={download}
            disabled={loading || nodes.length === 0}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
          >
            Export {nodes.length} concepts
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-foreground"
          >
            Import a backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFile(file);
              e.target.value = '';
            }}
          />
        </div>
        <p className="text-xs text-muted">
          Importing merges rather than replaces — a concept you reviewed more recently than the
          backup keeps its schedule.
        </p>
        {message && <p className="text-sm text-accent">{message}</p>}
        {error && <p className="text-sm text-warn">import failed: {error}</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Sync passphrase</h2>
        <p className="text-sm text-muted">
          Must match <code className="font-mono text-xs">SYNC_SECRET</code> on the server. It is
          stored only in this browser and never sent anywhere except the sync endpoint. With no
          secret configured server-side, sync stays off.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="password"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setKeySaved(false);
            }}
            placeholder="passphrase"
            className="w-64 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={async () => {
              await setSyncKey(key);
              setKeySaved(true);
            }}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-foreground"
          >
            Save
          </button>
          {keySaved && <span className="text-sm text-accent">saved</span>}
        </div>
      </section>
    </div>
  );
}
