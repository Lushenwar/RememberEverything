// Pure chunking + node assembly. Shared by the LLM and heuristic ingestion
// paths, and unit-testable without a network or a browser.
import { linkOrphans, newNode, significantWords } from './graph.ts';
import type { GraphNode, TopologyType } from './types.ts';

export interface Concept {
  title: string;
  /** Plain-language definition — the thing the learner has to be able to say. */
  summary: string;
  /** Verbatim excerpt this concept came from. Grounds the Socratic agent. */
  sourceText: string;
  /** Titles of sibling concepts this one depends on or relates to. */
  relatedTitles: string[];
}

/**
 * Trust boundary: without a cap, one paste of a whole textbook becomes a hung
 * request and a large token bill. Roughly a long chapter.
 */
export const MAX_INGEST_CHARS = 60_000;

/** Chunks that fall under this many words get folded into the previous one. */
const MIN_WORDS = 12;

/**
 * Split prose into concept-sized chunks. Prefers markdown headings, then blank
 * lines, then sentence groups — whichever the source actually provides.
 */
export function chunkText(raw: string): Concept[] {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  let blocks = splitOnHeadings(text);
  if (blocks.length < 2) blocks = text.split(/\n\s*\n/);
  if (blocks.length < 2) blocks = groupSentences(text);

  const chunks: { title: string; body: string }[] = [];
  for (const block of blocks) {
    const body = block.trim();
    if (!body) continue;
    // ponytail: fold runts into the previous chunk instead of a smarter
    // segmenter. Directly counters over-chunking (danger zone 3).
    if (wordCount(body) < MIN_WORDS && chunks.length > 0) {
      chunks[chunks.length - 1].body += `\n${body}`;
      continue;
    }
    chunks.push({ title: '', body });
  }

  return chunks.map((c) => {
    const title = deriveTitle(c.body);
    return { title, summary: firstSentences(c.body, 2), sourceText: c.body, relatedTitles: [] };
  });
}

function splitOnHeadings(text: string): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^\s{0,3}#{1,6}\s+\S/.test(line) && current.length > 0) {
      out.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) out.push(current.join('\n'));
  return out;
}

function groupSentences(text: string, per = 3): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += per) {
    out.push(sentences.slice(i, i + per).join('').trim());
  }
  return out;
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function deriveTitle(body: string): string {
  const heading = body.match(/^\s{0,3}#{1,6}\s+(.+)$/m);
  if (heading) return heading[1].trim().slice(0, 80);
  const first = firstSentences(body, 1);
  const words = first.split(/\s+/).filter(Boolean);
  return (words.length > 9 ? `${words.slice(0, 9).join(' ')}…` : first).slice(0, 80) || 'Untitled';
}

function firstSentences(body: string, n: number): string {
  // Drop heading lines whole — the heading already became the title, and
  // leaving it here makes every summary start by repeating the title.
  const stripped = body.replace(/^\s{0,3}#{1,6}\s+.*$/gm, '').trim();
  const sentences = stripped.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!sentences) return stripped.split('\n')[0].trim();
  return sentences.slice(0, n).join('').trim();
}

/**
 * Turn concepts into graph nodes: resolve title references into ids, then
 * repair any concept that ended up disconnected (danger zone 3).
 */
export function conceptsToNodes(
  concepts: Concept[],
  topology: TopologyType,
  category: string,
): GraphNode[] {
  const nodes = concepts.map((c) =>
    newNode({
      title: c.title,
      summary: c.summary,
      sourceText: c.sourceText,
      topology,
      category,
    }),
  );

  const byTitle = new Map(nodes.map((n, i) => [normalize(concepts[i].title), n.id]));
  concepts.forEach((c, i) => {
    nodes[i].dependencies = [
      ...new Set(
        c.relatedTitles
          .map((t) => byTitle.get(normalize(t)))
          .filter((id): id is string => Boolean(id) && id !== nodes[i].id),
      ),
    ];
  });

  // The heuristic path produces no explicit relations at all, so seed edges
  // from lexical overlap before repairing whatever is still orphaned.
  if (nodes.every((n) => n.dependencies.length === 0)) seedLexicalEdges(nodes);
  return linkOrphans(nodes);
}

function seedLexicalEdges(nodes: GraphNode[]): void {
  const words = nodes.map((n) => significantWords(`${n.title} ${n.summary} ${n.sourceText}`));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      let shared = 0;
      for (const w of words[i]) if (words[j].has(w)) shared++;
      if (shared >= 3) nodes[i].dependencies.push(nodes[j].id);
    }
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
