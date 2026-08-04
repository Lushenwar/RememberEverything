// Interleaved queue manager (CLAUDE.md §6). Pure.
//
// Blocked practice (all of topic A, then all of topic B) feels fluent and
// produces worse retention than interleaving. This scheduler deliberately
// forces a context switch between consecutive reviews.
import { dueQueue } from './fsrs.ts';
import type { GraphNode } from './types.ts';

export function groupByCategory(nodes: GraphNode[]): Map<string, GraphNode[]> {
  const grouped = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const key = n.category || 'general';
    const bucket = grouped.get(key);
    if (bucket) bucket.push(n);
    else grouped.set(key, [n]);
  }
  return grouped;
}

/**
 * Round-robin by remaining depth: always take from the largest bucket that
 * isn't the one we just used. This is the standard rearrangement greedy, and
 * it produces the minimum possible number of same-category adjacencies — zero
 * unless one category holds more than half the queue.
 */
export function interleaveCategories(grouped: Map<string, GraphNode[]>): GraphNode[] {
  const buckets = [...grouped.entries()].map(([category, items]) => ({
    category,
    items: [...items],
  }));

  const out: GraphNode[] = [];
  let previous: string | null = null;

  while (true) {
    const candidates = buckets.filter((b) => b.items.length > 0);
    if (candidates.length === 0) break;

    const eligible = candidates.filter((b) => b.category !== previous);
    // Only fall back to repeating a category when it is the only one left.
    const pool = eligible.length > 0 ? eligible : candidates;
    const pick = pool.reduce((best, b) => (b.items.length > best.items.length ? b : best));

    out.push(pick.items.shift()!);
    previous = pick.category;
  }

  return out;
}

/**
 * The day's review order: due concepts, most overdue first within a topic,
 * interleaved across topics.
 */
export function buildDailyQueue(dueCards: GraphNode[]): GraphNode[] {
  return interleaveCategories(groupByCategory(dueCards));
}

export function buildQueueFor(nodes: GraphNode[], now = new Date()): GraphNode[] {
  return buildDailyQueue(dueQueue(nodes, now));
}

/** How many consecutive pairs share a category — 0 is a perfectly interleaved queue. */
export function adjacentRepeats(queue: GraphNode[]): number {
  let n = 0;
  for (let i = 1; i < queue.length; i++) {
    if (queue[i].category === queue[i - 1].category) n++;
  }
  return n;
}
