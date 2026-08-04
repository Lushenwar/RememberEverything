// Dual coding: the pure half. Mermaid sanitising and deterministic diagram
// construction, so a broken or missing LLM response never breaks a render.
import { neighbors } from './graph.ts';
import type { GraphNode } from './types.ts';

const DIAGRAM_HEADERS = [
  'graph',
  'flowchart',
  'mindmap',
  'sequenceDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'classDiagram',
  'erDiagram',
  'journey',
  'timeline',
  'quadrantChart',
];

const MAX_LEN = 4000;

/**
 * Accept an LLM-authored mermaid diagram or reject it. Returns null when the
 * source is unusable — callers fall back to a generated diagram rather than
 * rendering an error to the learner.
 */
export function sanitizeMermaid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let src = raw.trim();

  // Strip a ```mermaid fence if the model wrapped its answer in one.
  const fence = src.match(/^```(?:mermaid)?\s*\n([\s\S]*?)\n?```$/);
  if (fence) src = fence[1].trim();

  if (!src || src.length > MAX_LEN) return null;
  if (/<\s*script|javascript:|<\s*iframe/i.test(src)) return null;

  const firstLine = src.split('\n')[0].trim();
  const header = firstLine.split(/[\s;]/)[0];
  if (!DIAGRAM_HEADERS.includes(header)) return null;
  // A header with no body is not a diagram.
  if (src.split('\n').filter((l) => l.trim()).length < 2) return null;

  return src;
}

/** Mermaid-safe label: quoted, with the characters that break the parser escaped. */
export function mermaidLabel(text: string, max = 42): string {
  const clean = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/"/g, '#quot;')
    .replace(/[<>]/g, '')
    .slice(0, max);
  return `"${clean || 'concept'}"`;
}

function mermaidId(index: number): string {
  return `n${index}`;
}

/**
 * Deterministic fallback: the concept at the centre, its graph neighbours
 * around it. Still a genuine dual-coded structure, just not an LLM's.
 */
export function fallbackDiagram(node: GraphNode, all: GraphNode[] = []): string {
  const near = neighbors(all, node.id).slice(0, 5);
  const lines = ['graph TD', `  c[${mermaidLabel(node.title)}]`];
  if (near.length === 0) {
    lines.push(`  c --> s[${mermaidLabel(node.summary, 60)}]`);
  } else {
    near.forEach((nb, i) => {
      lines.push(`  c --- ${mermaidId(i)}[${mermaidLabel(nb.title)}]`);
    });
  }
  return lines.join('\n');
}

/** The whole knowledge graph as one mermaid diagram. */
export function graphToMermaid(nodes: GraphNode[], limit = 60): string {
  const shown = nodes.slice(0, limit);
  const index = new Map(shown.map((n, i) => [n.id, mermaidId(i)]));
  const lines = ['graph LR'];
  for (const [i, n] of shown.entries()) {
    lines.push(`  ${mermaidId(i)}[${mermaidLabel(n.title)}]`);
  }
  const drawn = new Set<string>();
  for (const n of shown) {
    for (const dep of n.dependencies) {
      const a = index.get(n.id);
      const b = index.get(dep);
      if (!a || !b || a === b) continue;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      lines.push(`  ${a} --- ${b}`);
    }
  }
  return lines.join('\n');
}
