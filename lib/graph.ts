// Pure knowledge-graph operations. No storage, no IO — safe to unit test.
import { createEmptyCard } from 'ts-fsrs';
import type { GraphEdge, GraphNode, StoredCard, TopologyType } from './types.ts';

export function emptyCard(now = new Date()): StoredCard {
  const c = createEmptyCard(now);
  return { ...c, due: c.due.toISOString(), last_review: undefined };
}

export function newNode(
  init: Partial<GraphNode> & Pick<GraphNode, 'title' | 'summary' | 'sourceText'>,
): GraphNode {
  return {
    id: crypto.randomUUID(),
    visualSchema: '',
    dependencies: [],
    category: 'general',
    topology: 'THEORETICAL' as TopologyType,
    createdAt: Date.now(),
    card: emptyCard(),
    history: [],
    ...init,
  };
}

export function edgesOf(nodes: GraphNode[]): GraphEdge[] {
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const n of nodes) {
    for (const to of n.dependencies) {
      if (!ids.has(to) || to === n.id) continue; // drop dangling / self edges
      const key = n.id < to ? `${n.id}|${to}` : `${to}|${n.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: n.id, to });
    }
  }
  return edges;
}

/** Average undirected degree. Danger zone 3: over-chunking shows up as a low number. */
export function connectionDensity(nodes: GraphNode[]): number {
  if (nodes.length < 2) return 0;
  return (edgesOf(nodes).length * 2) / nodes.length;
}

export function orphans(nodes: GraphNode[]): GraphNode[] {
  const touched = new Set<string>();
  for (const e of edgesOf(nodes)) {
    touched.add(e.from);
    touched.add(e.to);
  }
  return nodes.filter((n) => !touched.has(n.id));
}

/**
 * Attach every orphan to its nearest sibling so the graph never fragments into
 * disconnected trivia (danger zone 3). Nearest = most shared significant words.
 */
export function linkOrphans(nodes: GraphNode[]): GraphNode[] {
  const stray = new Set(orphans(nodes).map((n) => n.id));
  if (stray.size === 0 || nodes.length < 2) return nodes;

  const words = new Map(nodes.map((n) => [n.id, significantWords(`${n.title} ${n.summary}`)]));
  return nodes.map((n) => {
    if (!stray.has(n.id)) return n;
    let best: GraphNode | null = null;
    let bestScore = -1;
    for (const other of nodes) {
      if (other.id === n.id) continue;
      const score = overlap(words.get(n.id)!, words.get(other.id)!);
      // Tie-break toward same category, then toward earlier nodes for stability.
      const adjusted = score + (other.category === n.category ? 0.5 : 0);
      if (adjusted > bestScore) {
        bestScore = adjusted;
        best = other;
      }
    }
    return best ? { ...n, dependencies: [...n.dependencies, best.id] } : n;
  });
}

const STOP = new Set(
  'the a an and or of to in is are was were be been it its this that for with as on by from at not but if then than which who whom whose what when where how'.split(
    ' ',
  ),
);

export function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

export function neighbors(nodes: GraphNode[], id: string): GraphNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Set<string>();
  for (const e of edgesOf(nodes)) {
    if (e.from === id) out.add(e.to);
    if (e.to === id) out.add(e.from);
  }
  return [...out].map((i) => byId.get(i)!).filter(Boolean);
}

/** Merge incoming nodes into an existing set, replacing by id. */
export function mergeNodes(existing: GraphNode[], incoming: GraphNode[]): GraphNode[] {
  const byId = new Map(existing.map((n) => [n.id, n]));
  for (const n of incoming) byId.set(n.id, n);
  return [...byId.values()];
}
