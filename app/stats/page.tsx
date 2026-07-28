'use client';

import Link from 'next/link';
import {
  atRisk,
  byCategory,
  byPromptType,
  retrievability,
  reviewHistogram,
  summarize,
} from '@/lib/analytics';
import { formatDue } from '@/lib/fsrs';
import { useGraph } from '@/lib/useGraph';

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function StatsPage() {
  const { nodes, loading } = useGraph();

  if (loading) return <p className="text-muted">Loading…</p>;
  if (nodes.length === 0)
    return (
      <p className="text-muted">
        Nothing to measure yet.{' '}
        <Link href="/ingest" className="text-accent">
          Ingest some material
        </Link>
        .
      </p>
    );

  const s = summarize(nodes);
  const histogram = reviewHistogram(nodes, 30);
  const decayed = atRisk(nodes, 0.7).slice(0, 8);
  const categories = byCategory(nodes);
  const prompts = byPromptType(nodes);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-xl font-medium">Memory model</h1>
        <p className="mt-1 text-sm text-muted">
          Retention is the FSRS forgetting curve evaluated for today — the same model that sets your
          intervals, so what you see here and what you get scheduled cannot disagree.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="retention" value={pct(s.retention)} accent />
        <Stat label="pass rate" value={s.reviews ? pct(s.passRate) : '—'} />
        <Stat label="at risk" value={String(s.atRisk)} warn={s.atRisk > 0} />
        <Stat label="day streak" value={String(s.currentStreak)} />
        <Stat label="concepts" value={`${s.studied}/${s.concepts}`} />
        <Stat label="reviews" value={String(s.reviews)} />
        <Stat label="hint rate" value={s.reviews ? pct(s.hintRate) : '—'} />
        <Stat label="median time" value={s.medianMs ? `${Math.round(s.medianMs / 1000)}s` : '—'} />
      </section>

      <section>
        <h2 className="text-sm font-medium">Reviews, last 30 days</h2>
        <Histogram data={histogram} />
      </section>

      {decayed.length > 0 && (
        <section>
          <h2 className="text-sm font-medium">Decaying fastest</h2>
          <p className="mt-1 text-sm text-muted">
            Recall probability has already dropped below 70%. These are the ones actually slipping.
          </p>
          <ul className="mt-3 space-y-2">
            {decayed.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/concept/${n.id}`}
                  className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 hover:border-accent"
                >
                  <span className="flex-1 truncate text-sm">{n.title}</span>
                  <Bar value={retrievability(n)} />
                  <span className="w-24 shrink-0 text-right font-mono text-[11px] text-muted">
                    {pct(retrievability(n))} · {formatDue(n)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {prompts.length > 0 && (
        <section>
          <h2 className="text-sm font-medium">By prompt type</h2>
          <p className="mt-1 text-sm text-muted">
            Where recall actually fails. A high pass rate on one type only means that type is easy.
          </p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                <th className="pb-2">type</th>
                <th className="pb-2 text-right">attempts</th>
                <th className="pb-2 text-right">pass</th>
                <th className="pb-2 text-right">hints</th>
                <th className="pb-2 text-right">median</th>
              </tr>
            </thead>
            <tbody>
              {prompts.map((p) => (
                <tr key={p.promptType} className="border-b border-border/50">
                  <td className="py-2 font-mono text-xs">{p.promptType.toLowerCase()}</td>
                  <td className="py-2 text-right text-muted">{p.attempts}</td>
                  <td className={`py-2 text-right ${p.passRate < 0.6 ? 'text-warn' : ''}`}>
                    {pct(p.passRate)}
                  </td>
                  <td className="py-2 text-right text-muted">{pct(p.hintRate)}</td>
                  <td className="py-2 text-right text-muted">{Math.round(p.medianMs / 1000)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium">By topic</h2>
        <ul className="mt-3 space-y-2">
          {categories.map((c) => (
            <li key={c.category} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm">{c.category}</span>
              <Bar value={c.retention} />
              <span className="w-40 shrink-0 text-right font-mono text-[11px] text-muted">
                {pct(c.retention)} retention · {c.reviews} reviews
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-2xl ${warn ? 'text-warn' : accent ? 'text-accent' : ''}`}>{value}</p>
    </div>
  );
}

function Bar({ value }: { value: number }) {
  return (
    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-border" aria-hidden>
      <span
        className={`block h-full rounded-full ${value < 0.7 ? 'bg-warn' : 'bg-accent'}`}
        style={{ width: `${Math.max(2, value * 100)}%` }}
      />
    </span>
  );
}

function Histogram({ data }: { data: { daysAgo: number; reviews: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.reviews));
  return (
    <div className="mt-3 flex h-24 items-end gap-1">
      {data.map((d) => (
        <div
          key={d.daysAgo}
          title={`${d.reviews} review${d.reviews === 1 ? '' : 's'} ${
            d.daysAgo === 0 ? 'today' : `${d.daysAgo}d ago`
          }`}
          className="flex-1 rounded-sm bg-accent-dim"
          style={{ height: `${Math.max(4, (d.reviews / max) * 100)}%` }}
        >
          <span className="sr-only">
            {d.reviews} reviews {d.daysAgo} days ago
          </span>
        </div>
      ))}
    </div>
  );
}
