// MoE cognitive router — maps subject topology to the cognitive experts that
// evidence says work best for that shape of material (CLAUDE.md §2).
import { CognitiveExpert, type SubjectTopology, type TopologyType } from './types.ts';

export function routeSessionStrategy(topology: SubjectTopology): CognitiveExpert[] {
  switch (topology.type) {
    case 'ALGORITHMIC':
    case 'MATH':
      return [CognitiveExpert.Interleaving, CognitiveExpert.ActiveRecall];
    case 'THEORETICAL':
      return [CognitiveExpert.ElaborativeEncoding, CognitiveExpert.DualCoding];
    case 'SYSTEMS':
    case 'HISTORY':
      return [CognitiveExpert.DualCoding, CognitiveExpert.SpacedRepetition];
    default:
      return [CognitiveExpert.SpacedRepetition, CognitiveExpert.ActiveRecall];
  }
}

/** Keyword classifier — the fallback when no LLM key is configured. */
const SIGNALS: Record<TopologyType, string[]> = {
  ALGORITHMIC: ['algorithm', 'complexity', 'recursion', 'runtime', 'sort', 'graph', 'pointer', 'loop', 'stack', 'queue', 'compiler', 'code'],
  MATH: ['theorem', 'proof', 'lemma', 'integral', 'derivative', 'matrix', 'probability', 'equation', 'vector', 'converges'],
  THEORETICAL: ['theory', 'concept', 'principle', 'framework', 'hypothesis', 'philosophy', 'argues', 'interpretation', 'model'],
  SYSTEMS: ['system', 'protocol', 'architecture', 'component', 'pipeline', 'network', 'layer', 'server', 'kernel', 'process'],
  HISTORY: ['century', 'war', 'empire', 'revolution', 'treaty', 'dynasty', 'reign', 'movement', 'era'],
  LANGUAGE: ['verb', 'noun', 'conjugation', 'grammar', 'vocabulary', 'tense', 'pronunciation', 'syntax'],
};

export function classifyTopology(rawText: string): SubjectTopology {
  const words = rawText.toLowerCase().split(/[^a-z]+/);
  const counts = new Map<TopologyType, number>();
  for (const w of words) {
    for (const [type, signals] of Object.entries(SIGNALS) as [TopologyType, string[]][]) {
      if (signals.some((s) => w === s || w.startsWith(s))) {
        counts.set(type, (counts.get(type) ?? 0) + 1);
      }
    }
  }
  let best: TopologyType = 'THEORETICAL';
  let bestCount = 0;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = type;
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return {
    type: best,
    confidence: total === 0 ? 0.2 : bestCount / total,
    label: best.charAt(0) + best.slice(1).toLowerCase(),
  };
}
