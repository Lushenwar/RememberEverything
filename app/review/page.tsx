'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import Diagram from '../Diagram';
import { applyReview, formatDue } from '@/lib/fsrs';
import { buildQueueFor } from '@/lib/queue';
import { initialState, type Evaluation } from '@/lib/interrogation_graph';
import { generateReviewPrompt, PromptType, type ReviewSession } from '@/lib/prompts';
import type { GraphNode } from '@/lib/types';
import { useGraph } from '@/lib/useGraph';
import { useSpeech } from '@/lib/useSpeech';

const TYPE_LABEL: Record<PromptType, string> = {
  [PromptType.Structural]: 'structural',
  [PromptType.Causal]: 'causal',
  [PromptType.BlankPage]: 'blank page',
  [PromptType.CounterExample]: 'counter-example',
};

export default function ReviewPage() {
  const { nodes, loading, save } = useGraph();
  const [index, setIndex] = useState(0);
  // Frozen at mount: rescheduling a card mid-session must not reshuffle the
  // queue under the learner. Phase 7 interleaves this ordering.
  const [startedAt] = useState(() => new Date());
  const queue = useMemo(
    () => (loading ? [] : buildQueueFor(nodes, startedAt)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, startedAt],
  );
  const node = queue[index];
  const switched = index > 0 && queue[index - 1]?.category !== node?.category;

  if (loading) return <p className="text-muted">Loading…</p>;
  if (queue.length === 0)
    return (
      <div className="rounded-lg border border-border bg-surface p-10 text-center">
        <p className="text-muted">
          {nodes.length === 0 ? 'Nothing to review yet.' : 'Nothing is due. Come back later.'}
        </p>
        <Link
          href={nodes.length === 0 ? '/ingest' : '/'}
          className="mt-4 inline-block text-sm text-accent"
        >
          {nodes.length === 0 ? 'Ingest some material →' : 'Back to the graph →'}
        </Link>
      </div>
    );

  if (!node)
    return (
      <div className="rounded-lg border border-accent-dim bg-surface p-10 text-center">
        <p>Session complete — {queue.length} concepts reviewed.</p>
        <Link href="/" className="mt-4 inline-block text-sm text-accent">
          Back to the graph →
        </Link>
      </div>
    );

  return (
    <Card
      key={node.id}
      node={node}
      all={nodes}
      position={`${index + 1} / ${queue.length}`}
      switched={switched}
      onDone={async (updated) => {
        await save([updated]);
        setIndex((i) => i + 1);
      }}
    />
  );
}

function Card({
  node,
  all,
  position,
  switched,
  onDone,
}: {
  node: GraphNode;
  all: GraphNode[];
  position: string;
  switched: boolean;
  onDone: (updated: GraphNode) => void | Promise<void>;
}) {
  const [session] = useState<ReviewSession>(() => generateReviewPrompt(node, all));
  const [answer, setAnswer] = useState('');
  const [hintShown, setHintShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [error, setError] = useState('');
  const speech = useSpeech((text) => setAnswer((p) => (p ? `${p} ${text}` : text)));

  async function submit() {
    if (!answer.trim() || busy) return;
    setBusy(true);
    setError('');
    if (speech.listening) speech.stop();
    try {
      const res = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          task: 'assess',
          concept: node,
          input: answer,
          state: initialState(session.startedAt),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'assessment failed');
      setEvaluation(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function reschedule(): GraphNode {
    return applyReview(node, {
      timeTakenMs: Date.now() - session.startedAt,
      hintsUsed: hintShown ? 1 : 0,
      promptType: session.type,
      isCorrect: Boolean(evaluation?.isCorrect),
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="font-mono text-[11px] uppercase tracking-wider text-accent">
          {TYPE_LABEL[session.type]} recall
        </span>
        <span className="font-mono text-[11px] text-muted">
          {position} ·{' '}
          <span className={switched ? 'text-warn' : ''}>
            {switched && '↻ '}
            {node.category}
          </span>
        </span>
      </header>

      <p className="text-lg">{session.instruction}</p>

      {session.scaffold && <Diagram source={session.scaffold} />}

      {!evaluation ? (
        <div className="space-y-2">
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
            rows={8}
            placeholder="From memory…"
            className="w-full resize-y rounded-md border border-border bg-surface p-3 text-sm outline-none focus:border-accent"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={submit}
              disabled={busy || !answer.trim()}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
            >
              {busy ? 'Checking…' : 'Submit'}
            </button>
            {speech.supported && (
              <button
                onClick={speech.listening ? speech.stop : speech.start}
                aria-pressed={speech.listening}
                className={`rounded-md border px-3 py-2 text-sm ${
                  speech.listening ? 'border-accent text-accent' : 'border-border text-muted'
                }`}
              >
                {speech.listening ? '● listening — stop' : '🎤 speak instead'}
              </button>
            )}
            {!hintShown ? (
              <button onClick={() => setHintShown(true)} className="text-sm text-muted hover:text-foreground">
                stuck? reveal a hint
              </button>
            ) : (
              <span className="text-sm text-muted">hint: {session.hint}</span>
            )}
            {error && <span className="text-sm text-warn">{error}</span>}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-muted">
              {evaluation.isCorrect ? 'met the bar' : 'not yet'} · coverage{' '}
              {Math.round(evaluation.coverage * 100)}%
              {evaluation.source === 'heuristic' && ' · heuristic'} ·{' '}
              <span className="text-accent">{formatDue(reschedule())}</span>
            </p>
            {evaluation.gap && <p className="mt-2 text-sm text-muted">gap: {evaluation.gap}</p>}
            {evaluation.unverifiedClaims && evaluation.unverifiedClaims.length > 0 && (
              <p className="mt-2 text-sm text-warn">
                not supported by your source: {evaluation.unverifiedClaims.join('; ')}
              </p>
            )}
            {evaluation.jargon && evaluation.jargon.length > 0 && (
              <p className="mt-2 text-sm text-muted">
                used without explaining: {evaluation.jargon.join(', ')}
              </p>
            )}
          </div>

          <details className="rounded-lg border border-border bg-surface p-4">
            <summary className="cursor-pointer text-sm font-medium">Compare with the source</summary>
            <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{node.sourceText}</p>
            {node.visualSchema && <Diagram className="mt-3" source={node.visualSchema} />}
          </details>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => onDone(reschedule())}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background"
            >
              Next concept
            </button>
            <Link href={`/tutor/${node.id}`} className="text-sm text-muted hover:text-foreground">
              interrogate this one instead →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
