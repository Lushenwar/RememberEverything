'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MAX_INGEST_CHARS } from '@/lib/chunker';
import { connectionDensity } from '@/lib/graph';
import type { GraphNode, SubjectTopology } from '@/lib/types';
import { useGraph } from '@/lib/useGraph';
import Diagram from '../Diagram';

export default function IngestPage() {
  const router = useRouter();
  const { save } = useGraph();
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    nodes: GraphNode[];
    topology: SubjectTopology;
    usedLlm: boolean;
  } | null>(null);

  async function ingest() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task: 'ingest', text, category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'ingestion failed');
      if (data.nodes.length === 0) throw new Error('no concepts found in that material');
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    if (!result) return;
    await save(result.nodes);
    router.push('/');
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-medium">Ingest material</h1>
        <p className="mt-1 text-sm text-muted">
          Lecture notes, an article, a textbook section. It gets chunked into connected concepts and
          classified so the right cognitive strategy is used for review.
        </p>
      </header>

      <label className="block">
        <span className="text-sm text-muted">Topic label (used to interleave reviews)</span>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. distributed-systems"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="block">
        <span className="flex items-baseline justify-between text-sm text-muted">
          <span>Raw material</span>
          {text.length > MAX_INGEST_CHARS * 0.8 && (
            <span className={text.length > MAX_INGEST_CHARS ? 'text-warn' : ''}>
              {text.length.toLocaleString()} / {MAX_INGEST_CHARS.toLocaleString()} characters
            </span>
          )}
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          placeholder="Paste here…"
          className="mt-1 w-full resize-y rounded-md border border-border bg-surface p-3 font-mono text-sm outline-none focus:border-accent"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={ingest}
          disabled={busy || !text.trim() || text.length > MAX_INGEST_CHARS}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          {busy ? 'Extracting…' : 'Extract concepts'}
        </button>
        {error && <span className="text-sm text-warn">{error}</span>}
      </div>

      {result && (
        <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-medium">
              {result.nodes.length} concepts ·{' '}
              <span className="font-mono text-xs uppercase tracking-wider text-muted">
                {result.topology.type}
              </span>
            </h2>
            <span className="font-mono text-[11px] text-muted">
              density {connectionDensity(result.nodes).toFixed(2)} ·{' '}
              {result.usedLlm ? 'llm extraction' : 'heuristic extraction (no API key)'}
            </span>
          </div>

          <ul className="space-y-3">
            {result.nodes.map((n) => (
              <li key={n.id} className="border-l-2 border-border pl-3">
                <p className="text-sm font-medium">{n.title}</p>
                <p className="mt-1 text-sm text-muted">{n.summary}</p>
                {n.visualSchema && <Diagram className="mt-2" source={n.visualSchema} />}
              </li>
            ))}
          </ul>

          <button
            onClick={keep}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background"
          >
            Add to graph
          </button>
        </section>
      )}
    </div>
  );
}
