'use client';

import Link from 'next/link';
import { useState } from 'react';
import { graphToMermaid } from '@/lib/diagram';
import { dueCounts, formatDue, isDue } from '@/lib/fsrs';
import { connectionDensity, edgesOf, orphans } from '@/lib/graph';
import { useGraph } from '@/lib/useGraph';
import Diagram from './Diagram';

export default function GraphPage() {
  const { nodes, loading } = useGraph();
  const [showMap, setShowMap] = useState(true);
  const density = connectionDensity(nodes);
  const stray = orphans(nodes).length;
  const counts = dueCounts(nodes);

  if (loading) return <p className="text-muted">Loading graph…</p>;

  if (nodes.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-10 text-center">
        <h1 className="text-xl font-medium">Nothing encoded yet</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Paste lecture notes, an article, or a textbook section. The engine chunks it into
          connected concepts, draws each one, then interrogates you on it.
        </p>
        <Link
          href="/ingest"
          className="mt-6 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-background"
        >
          Ingest material
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium">Knowledge graph</h1>
          <p className="mt-1 text-sm text-muted">
            {nodes.length} concepts · {edgesOf(nodes).length} edges · density{' '}
            <span className={density < 1 ? 'text-warn' : 'text-accent'}>{density.toFixed(2)}</span>
            {stray > 0 && <span className="text-warn"> · {stray} orphaned</span>}
          </p>
        </div>
        <Link
          href="/review"
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            counts.due > 0
              ? 'bg-accent text-background'
              : 'border border-border text-muted'
          }`}
        >
          {counts.due > 0 ? `Review ${counts.due} due` : 'Nothing due'}
        </Link>
      </header>

      <p className="font-mono text-[11px] text-muted">
        {counts.fresh} new · {counts.learning} learning · {counts.review} in review
      </p>

      <section>
        <button
          onClick={() => setShowMap((v) => !v)}
          className="text-sm text-muted transition-colors hover:text-foreground"
        >
          {showMap ? '− hide' : '+ show'} concept map
        </button>
        {showMap && <Diagram className="mt-3" source={graphToMermaid(nodes)} />}
      </section>

      <ul className="grid gap-3 sm:grid-cols-2">
        {nodes.map((n) => (
          <li key={n.id}>
            <Link
              href={`/concept/${n.id}`}
              className="block h-full rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-medium">{n.title}</h2>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                  {n.topology}
                </span>
              </div>
              <p className="mt-2 line-clamp-3 text-sm text-muted">{n.summary}</p>
              <p className="mt-3 font-mono text-[11px] text-muted">
                {n.dependencies.length} links · {n.history.length} reviews ·{' '}
                <span className={isDue(n) ? 'text-accent' : ''}>{formatDue(n)}</span>
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
