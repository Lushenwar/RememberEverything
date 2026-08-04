// Dual coding generator (CLAUDE.md architecture diagram). Server-side: asks the
// model for a mermaid diagram per concept, falls back to a generated one
// whenever the model is absent or its output does not parse.
import { fallbackDiagram, sanitizeMermaid } from './diagram.ts';
import { ask, llmAvailable } from './llm.ts';
import type { GraphNode } from './types.ts';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['diagrams'],
  properties: {
    diagrams: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'mermaid'],
        properties: {
          title: { type: 'string' },
          mermaid: { type: 'string' },
        },
      },
    },
  },
};

const SYSTEM = `You draw one mermaid diagram per concept so learners encode it visually as well as verbally (dual coding).

Rules:
- Output valid mermaid. Start every diagram with "graph TD", "graph LR", or "flowchart TD".
- Show the concept's STRUCTURE — its parts, its steps, or its causal chain. A single box with the title in it is useless.
- 3 to 7 nodes. Wrap every label in double quotes. Never put quotes, angle brackets, or parentheses inside a label.
- Draw only what the source material supports. Do not invent steps or relationships that are not in the text.
- Return one entry per concept, with the title copied exactly.`;

/**
 * Fill in `visualSchema` for every node. Always resolves — a failed or absent
 * LLM call yields deterministic fallback diagrams instead of empty visuals.
 */
export async function generateDiagrams(nodes: GraphNode[]): Promise<GraphNode[]> {
  if (nodes.length === 0) return nodes;

  const byTitle = new Map<string, string>();
  if (llmAvailable()) {
    const result = await ask<{ diagrams: { title: string; mermaid: string }[] }>({
      system: SYSTEM,
      prompt: nodes
        .map((n) => `## ${n.title}\nDefinition: ${n.summary}\nSource:\n${n.sourceText}`)
        .join('\n\n'),
      schema: SCHEMA,
    }).catch(() => null);

    for (const d of result?.diagrams ?? []) {
      const clean = sanitizeMermaid(d.mermaid);
      if (clean) byTitle.set(norm(d.title), clean);
    }
  }

  return nodes.map((n) => ({
    ...n,
    visualSchema: byTitle.get(norm(n.title)) ?? fallbackDiagram(n, nodes),
  }));
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
