'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { decayCurve, retrievability, type DecayPoint } from '@/lib/analytics';
import { fallbackDiagram } from '@/lib/diagram';
import { formatDue } from '@/lib/fsrs';
import { neighbors } from '@/lib/graph';
import type { GraphNode } from '@/lib/types';
import { useGraph } from '@/lib/useGraph';
import Diagram from '../../Diagram';

/**
 * Editing preserves the card and history — a typo in a title should not cost
 * the learner their scheduling, which deleting and re-ingesting would.
 */
function ConceptEditor({
  node,
  onSave,
  onCancel,
}: {
  node: GraphNode;
  onSave: (updated: GraphNode) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(node.title);
  const [summary, setSummary] = useState(node.summary);
  const [category, setCategory] = useState(node.category);
  const [sourceText, setSourceText] = useState(node.sourceText);

  const field = 'mt-1 w-full rounded-md border border-border bg-surface p-3 text-sm outline-none focus:border-accent';

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-medium">Edit concept</h1>

      <label className="block">
        <span className="text-sm text-muted">Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
      </label>

      <label className="block">
        <span className="text-sm text-muted">Plain-language definition</span>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          className={`${field} resize-y`}
        />
      </label>

      <label className="block">
        <span className="text-sm text-muted">Topic (used to interleave reviews)</span>
        <input value={category} onChange={(e) => setCategory(e.target.value)} className={field} />
      </label>

      <label className="block">
        <span className="text-sm text-muted">
          Source — the tutor grades your answers against this text, so keep it accurate
        </span>
        <textarea
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          rows={8}
          className={`${field} resize-y font-mono`}
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={() =>
            onSave({
              ...node,
              title: title.trim() || node.title,
              summary: summary.trim(),
              category: category.trim() || 'general',
              sourceText: sourceText.trim(),
            })
          }
          disabled={!title.trim()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          Save
        </button>
        <button onClick={onCancel} className="text-sm text-muted hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The forgetting curve for this concept, next 90 days. */
function DecayChart({ points }: { points: DecayPoint[] }) {
  if (points.length < 2) return null;
  const w = 600;
  const h = 90;
  const maxDay = points.at(-1)!.day || 1;
  const xy = (p: DecayPoint) => [(p.day / maxDay) * w, h - p.retrievability * h] as const;
  const line = points.map((p) => xy(p).join(',')).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;

  return (
    <figure className="mt-3 rounded-lg border border-border bg-surface p-4">
      {/* preserveAspectRatio="none": the curve should fill the width, not be
          letterboxed to the viewBox ratio. */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
        role="img"
        aria-label="Forgetting curve over the next 90 days"
      >
        <line x1="0" y1={h * 0.3} x2={w} y2={h * 0.3} stroke="var(--warn)" strokeDasharray="4 4" strokeWidth="1" opacity="0.4" />
        <polygon points={area} fill="var(--accent-dim)" opacity="0.45" />
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2" />
      </svg>
      <figcaption className="mt-2 flex justify-between font-mono text-[10px] text-muted">
        <span>today</span>
        <span className="text-warn">— 70% recall</span>
        <span>+{maxDay}d</span>
      </figcaption>
    </figure>
  );
}

export default function ConceptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { nodes, loading, save, remove } = useGraph();
  const node = nodes.find((n) => n.id === id);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (loading) return <p className="text-muted">Loading…</p>;
  if (!node)
    return (
      <p className="text-muted">
        Concept not found. <Link href="/" className="text-accent">Back to the graph</Link>.
      </p>
    );

  if (editing) {
    return (
      <ConceptEditor
        node={node}
        onCancel={() => setEditing(false)}
        onSave={async (updated) => {
          await save([updated]);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <article className="space-y-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted">
          {node.topology} · {node.category}
        </p>
        <h1 className="mt-1 text-2xl font-medium">{node.title}</h1>
        <p className="mt-3 max-w-2xl text-muted">{node.summary}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href={`/tutor/${node.id}`}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background"
          >
            Explain it from memory
          </Link>
          <button
            onClick={() => setEditing(true)}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:text-foreground"
          >
            Edit
          </button>
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              className="text-sm text-muted hover:text-warn"
            >
              Delete
            </button>
          ) : (
            <span className="flex items-center gap-2 text-sm">
              <span className="text-warn">
                Delete permanently, losing {node.history.length} review
                {node.history.length === 1 ? '' : 's'}?
              </span>
              <button
                onClick={async () => {
                  await remove(node.id);
                  router.push('/');
                }}
                className="rounded-md bg-warn px-3 py-1 text-sm font-medium text-background"
              >
                Delete
              </button>
              <button onClick={() => setConfirming(false)} className="text-sm text-muted">
                Cancel
              </button>
            </span>
          )}
        </div>
      </header>

      <section>
        <h2 className="text-sm font-medium">Memory</h2>
        <p className="mt-1 font-mono text-[11px] text-muted">
          {node.card.reps === 0
            ? 'never reviewed'
            : `${Math.round(retrievability(node) * 100)}% recall now · ${formatDue(node)} · ${node.history.length} reviews`}
        </p>
        {node.card.reps > 0 && <DecayChart points={decayCurve(node, 90)} />}
      </section>

      <section>
        <h2 className="text-sm font-medium">Visual encoding</h2>
        <Diagram
          className="mt-2"
          source={node.visualSchema || fallbackDiagram(node, nodes)}
        />
      </section>

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
