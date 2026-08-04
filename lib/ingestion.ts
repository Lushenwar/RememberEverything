// Ingestion & auto-classification (CLAUDE.md §1). Server-side: one LLM pass
// extracts concepts + topology; without a key the heuristic chunker runs
// instead, so the app is fully usable offline.
import { chunkText, conceptsToNodes, type Concept } from './chunker.ts';
import { ask, llmAvailable } from './llm.ts';
import { classifyTopology } from './moe_router.ts';
import type { GraphNode, SubjectTopology, TopologyType } from './types.ts';

const TOPOLOGY_TYPES: TopologyType[] = [
  'ALGORITHMIC',
  'MATH',
  'THEORETICAL',
  'SYSTEMS',
  'HISTORY',
  'LANGUAGE',
];

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['topology', 'concepts'],
  properties: {
    topology: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'label', 'confidence'],
      properties: {
        type: { type: 'string', enum: TOPOLOGY_TYPES },
        label: { type: 'string' },
        confidence: { type: 'number' },
      },
    },
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'simpleDefinition', 'sourceExcerpt', 'relatedTitles'],
        properties: {
          title: { type: 'string' },
          simpleDefinition: { type: 'string' },
          sourceExcerpt: { type: 'string' },
          relatedTitles: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const SYSTEM = `You convert raw study material into a connected knowledge graph.

Rules:
- Chunk into whole, teachable concepts — not sentence fragments and not the entire document. Aim for one concept per idea a learner could be asked to explain from memory.
- Prefer fewer, denser concepts over many tiny ones. Fragmenting the material into disconnected trivia destroys its usefulness.
- Every concept MUST list at least one relatedTitle from the same batch (exact title match) unless the batch has only one concept. Relationships are what make this a graph rather than a pile of flashcards.
- simpleDefinition is the Feynman-style plain-language explanation, no jargon that is not defined in the source.
- sourceExcerpt is copied VERBATIM from the input. Never paraphrase it, never invent it — it is the ground truth the tutor will check the learner's answers against.
- Classify the whole document into exactly one topology type.`;

interface LlmConcept {
  title: string;
  simpleDefinition: string;
  sourceExcerpt: string;
  relatedTitles: string[];
}

export async function processRawContent(
  rawText: string,
  category = 'general',
): Promise<{ nodes: GraphNode[]; topology: SubjectTopology; usedLlm: boolean }> {
  const text = rawText.trim();
  if (!text) return { nodes: [], topology: classifyTopology(''), usedLlm: false };

  if (llmAvailable()) {
    const result = await ask<{
      topology: SubjectTopology;
      concepts: LlmConcept[];
    }>({
      system: SYSTEM,
      prompt: `Material to ingest:\n\n${text}`,
      schema: EXTRACTION_SCHEMA,
    });

    if (result && result.concepts.length > 0) {
      const concepts: Concept[] = result.concepts.map((c) => ({
        title: c.title,
        summary: c.simpleDefinition,
        // Guard against a paraphrased "excerpt": grounding only works if the
        // text really is in the source (danger zone 2).
        sourceText: text.includes(c.sourceExcerpt.trim()) ? c.sourceExcerpt.trim() : text,
        relatedTitles: c.relatedTitles,
      }));
      return {
        nodes: conceptsToNodes(concepts, result.topology.type, category),
        topology: result.topology,
        usedLlm: true,
      };
    }
  }

  const topology = classifyTopology(text);
  return {
    nodes: conceptsToNodes(chunkText(text), topology.type, category),
    topology,
    usedLlm: false,
  };
}
