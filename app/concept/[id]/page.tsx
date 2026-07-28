'use client';

import Link from 'next/link';
import { use } from 'react';
import { neighbors } from '@/lib/graph';
import { useGraph } from '@/lib/useGraph';

export default function ConceptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { nodes, loading } = useGraph();
  const node = nodes.find((n) => n.id === id);

  if (loading) return <p className="text-muted">Loading…</p>;
  if (!node)
    return (
      <p className="text-muted">
        Concept not found. <Link href="/" className="text-accent">Back to the graph</Link>.
      </p>
    );

  return (
    <article className="space-y-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted">
          {node.topology} · {node.category}
        </p>
        <h1 className="mt-1 text-2xl font-medium">{node.title}</h1>
        <p className="mt-3 max-w-2xl text-muted">{node.summary}</p>
      </header>

      <section>
        <h2 className="text-sm font-medium">Source</h2>
        <p className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-surface p-4 text-sm text-muted">
          {node.sourceText}
        </p>
      </section>

      <section>
        <h2 className="text-sm font-medium">Connected concepts</h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {neighbors(nodes, node.id).map((nb) => (
            <li key={nb.id}>
              <Link
                href={`/concept/${nb.id}`}
                className="rounded-full border border-border px-3 py-1 text-sm text-muted hover:border-accent hover:text-foreground"
              >
                {nb.title}
              </Link>
            </li>
          ))}
          {neighbors(nodes, node.id).length === 0 && (
            <li className="text-sm text-warn">Orphaned — no links to the rest of the graph.</li>
          )}
        </ul>
      </section>
    </article>
  );
}
