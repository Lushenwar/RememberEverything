// Multi-modal active recall generator (CLAUDE.md §4). Pure.
//
// The point is variety: if a concept is always probed the same way, the learner
// memorises the question instead of the material. Prompt type is weighted by
// the cognitive experts the MoE router picked, and never repeats the type used
// on the previous review of that concept.
import { neighbors } from './graph.ts';
import { routeSessionStrategy } from './moe_router.ts';
import { CognitiveExpert, type GraphNode } from './types.ts';

export enum PromptType {
  Structural = 'STRUCTURAL', // Draw/complete diagram
  Causal = 'CAUSAL', // Why does X happen?
  BlankPage = 'BLANK_PAGE', // Recall principles without context
  CounterExample = 'COUNTER', // What if edge case occurs?
}

export interface ReviewSession {
  nodeId: string;
  type: PromptType;
  /** What the learner is asked to produce. Always open-ended (danger zone 1). */
  instruction: string;
  /** Shown only if they ask — each reveal is counted as friction by FSRS. */
  hint: string;
  /** Structural prompts show the diagram with the concept's own label removed. */
  scaffold?: string;
  startedAt: number;
}

/** How much each expert wants each prompt type. */
const EXPERT_WEIGHTS: Record<CognitiveExpert, Record<PromptType, number>> = {
  [CognitiveExpert.ActiveRecall]: {
    [PromptType.BlankPage]: 3,
    [PromptType.Causal]: 2,
    [PromptType.CounterExample]: 1,
    [PromptType.Structural]: 1,
  },
  [CognitiveExpert.Interleaving]: {
    [PromptType.CounterExample]: 3,
    [PromptType.Causal]: 2,
    [PromptType.BlankPage]: 1,
    [PromptType.Structural]: 1,
  },
  [CognitiveExpert.ElaborativeEncoding]: {
    [PromptType.Causal]: 3,
    [PromptType.CounterExample]: 2,
    [PromptType.BlankPage]: 1,
    [PromptType.Structural]: 1,
  },
  [CognitiveExpert.DualCoding]: {
    [PromptType.Structural]: 3,
    [PromptType.BlankPage]: 2,
    [PromptType.Causal]: 1,
    [PromptType.CounterExample]: 1,
  },
  [CognitiveExpert.SpacedRepetition]: {
    [PromptType.BlankPage]: 2,
    [PromptType.Causal]: 1,
    [PromptType.Structural]: 1,
    [PromptType.CounterExample]: 1,
  },
};

export function promptWeights(node: GraphNode): Record<PromptType, number> {
  const experts = routeSessionStrategy({ type: node.topology, confidence: 1, label: node.topology });
  const weights: Record<PromptType, number> = {
    [PromptType.Structural]: 0,
    [PromptType.Causal]: 0,
    [PromptType.BlankPage]: 0,
    [PromptType.CounterExample]: 0,
  };
  // routeSessionStrategy returns experts in priority order, so the primary one
  // gets double say — otherwise two experts pulling opposite ways cancel out.
  experts.forEach((expert, i) => {
    const influence = i === 0 ? 2 : 1;
    for (const [type, w] of Object.entries(EXPERT_WEIGHTS[expert]) as [PromptType, number][]) {
      weights[type] += w * influence;
    }
  });
  // A concept with no visual cannot be probed structurally.
  if (!node.visualSchema.trim()) weights[PromptType.Structural] = 0;
  return weights;
}

/** The type used last time, so the generator can avoid repeating it. */
export function lastPromptType(node: GraphNode): PromptType | null {
  const last = node.history.at(-1)?.promptType;
  return last && Object.values(PromptType).includes(last as PromptType)
    ? (last as PromptType)
    : null;
}

export function selectPromptType(node: GraphNode, rng: () => number = Math.random): PromptType {
  const weights = { ...promptWeights(node) };
  const avoid = lastPromptType(node);
  if (avoid && Object.values(weights).filter((w) => w > 0).length > 1) weights[avoid] = 0;

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (total === 0) return PromptType.BlankPage; // always available

  let roll = rng() * total;
  for (const [type, w] of Object.entries(weights) as [PromptType, number][]) {
    roll -= w;
    if (roll < 0) return type;
  }
  return PromptType.BlankPage;
}

/** Blank the concept's own label out of its diagram so the shape remains. */
export function blankDiagram(node: GraphNode): string {
  if (!node.visualSchema.trim()) return '';
  const escaped = node.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return node.visualSchema.replace(new RegExp(`"${escaped}"`, 'gi'), '"?"');
}

export function generateReviewPrompt(
  node: GraphNode,
  all: GraphNode[] = [],
  rng: () => number = Math.random,
  now = Date.now(),
): ReviewSession {
  const type = selectPromptType(node, rng);
  const related = neighbors(all, node.id)
    .slice(0, 3)
    .map((n) => n.title);
  const base = { nodeId: node.id, type, startedAt: now };

  switch (type) {
    case PromptType.Structural:
      return {
        ...base,
        instruction: `The structure below is missing its centre. Name what belongs there and describe how the parts connect — in full sentences, not labels.`,
        scaffold: blankDiagram(node),
        hint: related.length ? `It sits next to: ${related.join(', ')}.` : node.summary.slice(0, 60),
      };

    case PromptType.Causal:
      return {
        ...base,
        instruction: `Why does ${node.title} work the way it does? Give the mechanism, not the sequence of events — what makes it necessary rather than merely what happens.`,
        hint: 'Start from what would go wrong if it did not work this way.',
      };

    case PromptType.CounterExample:
      return {
        ...base,
        instruction: `Describe a case where ${node.title} breaks down, stops applying, or produces a surprising result. What fails first, and why?`,
        hint: 'Push one of its assumptions to an extreme — nothing, everything, or exactly the boundary.',
      };

    default:
      return {
        ...base,
        instruction: `Blank page: write down everything you know about ${node.title} without looking. Definitions, mechanism, where it applies, where it does not.`,
        hint: related.length
          ? `Three things it connects to: ${related.join(', ')}.`
          : 'Begin with what problem it exists to solve.',
      };
  }
}
