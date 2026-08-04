// Offline sync conflict resolution (danger zone 5). Pure.
//
// Reviewing on a phone offline while a desktop session is running produces two
// divergent FSRS states for the same concept. Resolution is last-write-wins on
// the review timestamp — not on sync arrival order, which would let a stale
// device that reconnects late overwrite newer work.
import type { GraphNode } from './types.ts';

/**
 * When this concept was last genuinely touched by a learner. Review time beats
 * card metadata beats creation, so an untouched concept never outranks a
 * reviewed one.
 */
export function lastTouched(node: GraphNode): number {
  const lastReview = node.history.at(-1)?.at ?? 0;
  const lastCard = node.card.last_review ? Date.parse(node.card.last_review) : 0;
  return Math.max(lastReview, Number.isNaN(lastCard) ? 0 : lastCard, node.createdAt ?? 0);
}

/**
 * Deterministic winner for one concept present on both sides. Ties fall to the
 * side with more reviews, then to `local`, so the same two inputs always
 * resolve the same way regardless of which device ran the merge.
 */
export function pickWinner(local: GraphNode, remote: GraphNode): GraphNode {
  const l = lastTouched(local);
  const r = lastTouched(remote);
  if (l !== r) return l > r ? local : remote;
  if (local.history.length !== remote.history.length) {
    return local.history.length > remote.history.length ? local : remote;
  }
  return local;
}

export interface MergeResult {
  merged: GraphNode[];
  /** Ids where both sides had the concept and their timestamps disagreed. */
  conflicts: string[];
}

/** Last-write-wins merge of two whole graphs. */
export function mergeByLWW(local: GraphNode[], remote: GraphNode[]): MergeResult {
  const byId = new Map(local.map((n) => [n.id, n]));
  const conflicts: string[] = [];

  for (const incoming of remote) {
    const mine = byId.get(incoming.id);
    if (!mine) {
      byId.set(incoming.id, incoming);
      continue;
    }
    if (lastTouched(mine) !== lastTouched(incoming)) conflicts.push(incoming.id);
    byId.set(incoming.id, pickWinner(mine, incoming));
  }

  return { merged: [...byId.values()], conflicts };
}

/** Everything changed since the last successful sync. */
export function changedSince(nodes: GraphNode[], since: number): GraphNode[] {
  return nodes.filter((n) => lastTouched(n) > since);
}
