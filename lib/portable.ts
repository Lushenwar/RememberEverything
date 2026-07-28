// Export / import. The graph otherwise lives only in one browser's IndexedDB,
// where clearing site data destroys it — so this is the backup, not a feature.
//
// Import is a trust boundary: the file comes off the user's disk and could be
// anything. Every node is validated field by field, and bad ones are skipped
// rather than allowed to poison the graph.
import { emptyCard } from './graph.ts';
import type { GraphNode, ReviewLog, StoredCard, TopologyType } from './types.ts';

export const EXPORT_FORMAT = 'remember-everything';
export const EXPORT_VERSION = 1;

export interface GraphExport {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  nodes: GraphNode[];
}

export function buildExport(nodes: GraphNode[], now = new Date()): GraphExport {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    nodes,
  };
}

export function exportFilename(now = new Date()): string {
  return `remember-everything-${now.toISOString().slice(0, 10)}.json`;
}

export type ImportResult =
  | { ok: true; nodes: GraphNode[]; skipped: number }
  | { ok: false; error: string };

const TOPOLOGIES: TopologyType[] = [
  'ALGORITHMIC',
  'MATH',
  'THEORETICAL',
  'SYSTEMS',
  'HISTORY',
  'LANGUAGE',
];

export function parseGraphExport(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }

  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not a graph export' };
  const file = raw as Record<string, unknown>;
  if (file.format !== EXPORT_FORMAT) {
    return { ok: false, error: 'not a Remember Everything export' };
  }
  if (typeof file.version !== 'number' || file.version > EXPORT_VERSION) {
    return { ok: false, error: `export version ${String(file.version)} is newer than this app` };
  }
  if (!Array.isArray(file.nodes)) return { ok: false, error: 'export contains no nodes' };

  const nodes: GraphNode[] = [];
  let skipped = 0;
  for (const candidate of file.nodes) {
    const node = coerceNode(candidate);
    if (node) nodes.push(node);
    else skipped += 1;
  }

  if (nodes.length === 0) {
    return { ok: false, error: skipped > 0 ? 'every concept in the file was malformed' : 'export contains no nodes' };
  }
  return { ok: true, nodes, skipped };
}

/** Accept a node only if the fields the engine depends on are actually usable. */
function coerceNode(candidate: unknown): GraphNode | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const n = candidate as Record<string, unknown>;

  const id = str(n.id);
  const title = str(n.title);
  if (!id || !title) return null;

  return {
    id,
    title,
    summary: str(n.summary) ?? '',
    sourceText: str(n.sourceText) ?? '',
    visualSchema: str(n.visualSchema) ?? '',
    dependencies: Array.isArray(n.dependencies)
      ? n.dependencies.filter((d): d is string => typeof d === 'string' && d !== id)
      : [],
    category: str(n.category) ?? 'general',
    topology: TOPOLOGIES.includes(n.topology as TopologyType)
      ? (n.topology as TopologyType)
      : 'THEORETICAL',
    createdAt: num(n.createdAt) ?? Date.now(),
    card: coerceCard(n.card),
    history: Array.isArray(n.history)
      ? n.history.map(coerceLog).filter((l): l is ReviewLog => l !== null)
      : [],
  };
}

/**
 * A malformed card would break the scheduler on the next review, so anything
 * unusable resets to a new card. The concept survives; only its schedule is lost.
 */
function coerceCard(candidate: unknown): StoredCard {
  const fresh = emptyCard();
  if (!candidate || typeof candidate !== 'object') return fresh;
  const c = candidate as Record<string, unknown>;

  const due = str(c.due);
  if (!due || Number.isNaN(Date.parse(due))) return fresh;

  const lastReview = str(c.last_review);
  return {
    due,
    stability: num(c.stability) ?? fresh.stability,
    difficulty: num(c.difficulty) ?? fresh.difficulty,
    elapsed_days: num(c.elapsed_days) ?? 0,
    scheduled_days: num(c.scheduled_days) ?? 0,
    learning_steps: num(c.learning_steps) ?? 0,
    reps: num(c.reps) ?? 0,
    lapses: num(c.lapses) ?? 0,
    state: num(c.state) ?? 0,
    last_review: lastReview && !Number.isNaN(Date.parse(lastReview)) ? lastReview : undefined,
  };
}

function coerceLog(candidate: unknown): ReviewLog | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const l = candidate as Record<string, unknown>;
  const at = num(l.at);
  if (at === null) return null;
  return {
    at,
    rating: num(l.rating) ?? 0,
    timeTakenMs: num(l.timeTakenMs) ?? 0,
    hintsUsed: num(l.hintsUsed) ?? 0,
    promptType: str(l.promptType) ?? 'UNKNOWN',
    intervalDays: num(l.intervalDays) ?? 0,
  };
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
