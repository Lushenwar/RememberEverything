'use client';

import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import {
  initialState,
  isComplete,
  SocraticMode,
  SocraticStage,
  STAGE_ORDER,
  type AgentResponse,
  type TutorState,
} from '@/lib/interrogation_graph';
import { useGraph } from '@/lib/useGraph';
import { useSpeech } from '@/lib/useSpeech';

interface Turn {
  role: 'tutor' | 'learner';
  text: string;
  mode?: SocraticMode;
  stage?: SocraticStage;
}

const MODE_LABEL: Record<SocraticMode, string> = {
  [SocraticMode.Classical]: 'classical',
  [SocraticMode.Elaborative]: 'elaborative',
  [SocraticMode.GuidedDiscovery]: 'guided discovery',
};

export default function TutorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { nodes, loading } = useGraph();
  const node = nodes.find((n) => n.id === id);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [state, setState] = useState<TutorState>(() => initialState());
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const speech = useSpeech((text) => setInput((prev) => (prev ? `${prev} ${text}` : text)));
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  async function send() {
    if (!node || !input.trim() || busy) return;
    const explanation = input.trim();
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: 'learner', text: explanation }]);
    setInput('');
    setBusy(true);
    setError('');
    if (speech.listening) speech.stop();

    try {
      const res = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task: 'socratic', concept: node, input: explanation, state, history }),
      });
      const data: AgentResponse & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'the tutor failed to respond');
      setTurns((t) => [
        ...t,
        { role: 'tutor', text: data.question, mode: data.mode, stage: data.stage },
      ]);
      setState(data.state);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-muted">Loading…</p>;
  if (!node)
    return (
      <p className="text-muted">
        Concept not found. <Link href="/" className="text-accent">Back to the graph</Link>.
      </p>
    );

  const stageIndex = STAGE_ORDER.indexOf(state.stage);
  const done = isComplete(state);

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted">Feynman session</p>
        <h1 className="mt-1 text-xl font-medium">{node.title}</h1>
        <ol className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {STAGE_ORDER.map((s, i) => (
            <li
              key={s}
              className={`rounded-full border px-2 py-1 font-mono uppercase tracking-wider ${
                i < stageIndex
                  ? 'border-accent-dim text-accent'
                  : i === stageIndex
                    ? 'border-accent text-accent'
                    : 'border-border text-muted'
              }`}
            >
              {s.replace(/_/g, ' ').toLowerCase()}
            </li>
          ))}
        </ol>
      </header>

      {turns.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">
          Explain <span className="text-foreground">{node.title}</span> from memory, as if to
          someone who has never heard of it. Don&apos;t look at the source — the point is to find
          out what you cannot yet say.
        </div>
      )}

      <div className="space-y-4">
        {turns.map((t, i) => (
          <div
            key={i}
            className={t.role === 'tutor' ? 'rounded-lg border border-border bg-surface p-4' : 'pl-4'}
          >
            {t.role === 'tutor' && t.mode && (
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted">
                {MODE_LABEL[t.mode]} · {t.stage?.replace(/_/g, ' ').toLowerCase()}
              </p>
            )}
            <p className={t.role === 'tutor' ? '' : 'text-muted'}>{t.text}</p>
          </div>
        ))}
        {busy && <p className="pl-4 text-sm text-muted">Interrogating…</p>}
        <div ref={endRef} />
      </div>

      {done ? (
        <div className="rounded-lg border border-accent-dim bg-surface p-5">
          <p className="text-sm">
            Pipeline complete — {state.turns} turns, {state.hintsUsed} hints.
          </p>
          <Link href={`/concept/${node.id}`} className="mt-3 inline-block text-sm text-accent">
            Back to the concept →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
            }}
            rows={5}
            placeholder="Explain it in your own words…"
            className="w-full resize-y rounded-md border border-border bg-surface p-3 text-sm outline-none focus:border-accent"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
            >
              Answer
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
            <span className="text-xs text-muted">⌘/Ctrl + Enter to send</span>
            {error && <span className="text-sm text-warn">{error}</span>}
            {speech.error && <span className="text-sm text-warn">{speech.error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
