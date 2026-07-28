// Understanding assessment — heuristic half. Pure and testable; it is both the
// no-API-key path and the fallback when the LLM assessor is unavailable.
import { significantWords } from './graph.ts';
import { SocraticStage, type Evaluation } from './interrogation_graph.ts';
import type { GraphNode } from './types.ts';

const BLANKING = [
  "i don't know",
  'i dont know',
  'no idea',
  'not sure',
  'no clue',
  'i forget',
  'i forgot',
  'blanking',
  'skip',
  'pass',
  'help',
  'hint',
];

/** Words that signal the learner actually reached for a boundary condition. */
const LIMIT_WORDS = [
  'unless',
  'except',
  'fails',
  'fail',
  'breaks',
  'break',
  'limit',
  'edge',
  'cannot',
  "can't",
  'only if',
  'assumes',
  'assumption',
  'unbounded',
  'infinite',
  'zero',
  'empty',
  'negative',
];

/** Words that signal a causal claim rather than a description. */
const CAUSAL_WORDS = ['because', 'since', 'therefore', 'causes', 'so that', 'due to', 'leads to', 'results in'];

export function heuristicEvaluate(
  userInput: string,
  concept: GraphNode,
  stage: SocraticStage,
): Evaluation {
  const input = userInput.trim();
  const lower = input.toLowerCase();
  const wordCount = input.split(/\s+/).filter(Boolean).length;

  const isStuck = wordCount < 8 || BLANKING.some((p) => lower.includes(p));

  // ponytail: strip a trailing "s" instead of a real stemmer — enough to stop
  // "leaders"/"leader" scoring as a miss. Swap in a stemmer if it misjudges.
  const stem = (s: Set<string>) => new Set([...s].map((w) => w.replace(/s$/, '')));
  const target = stem(significantWords(`${concept.title} ${concept.summary} ${concept.sourceText}`));
  const said = stem(significantWords(input));
  let hits = 0;
  for (const w of said) if (target.has(w)) hits++;
  const coverage = target.size === 0 ? 0 : Math.min(1, hits / Math.min(target.size, 12));

  // Stage-specific evidence: each stage asks for a different kind of statement,
  // so "correct" means different things as the pipeline advances.
  const hasCausal = CAUSAL_WORDS.some((w) => lower.includes(w));
  const hasLimit = LIMIT_WORDS.some((w) => lower.includes(w));

  let isCorrect = false;
  let missedEdgeCase = false;
  let gap = '';

  if (!isStuck) {
    switch (stage) {
      case SocraticStage.Clarification:
        isCorrect = coverage >= 0.3 && wordCount >= 15;
        if (!isCorrect) gap = 'the explanation is too thin to tell whether they understand it';
        break;
      case SocraticStage.AssumptionTest:
        isCorrect = coverage >= 0.3 && (hasLimit || hasCausal);
        if (!isCorrect) gap = 'no assumption was named or defended';
        break;
      case SocraticStage.Causal:
        isCorrect = hasCausal && coverage >= 0.25;
        if (!isCorrect) gap = 'described what happens without saying why it must';
        break;
      case SocraticStage.EdgeCase:
        isCorrect = hasLimit && coverage >= 0.2;
        missedEdgeCase = !hasLimit;
        if (!isCorrect) gap = 'no boundary or failure case was identified';
        break;
      default:
        isCorrect = true;
    }
  } else {
    gap = 'blanked or answered too briefly to assess';
  }

  return {
    isCorrect,
    isStuck,
    // The heuristic cannot tell a false belief from an unfamiliar phrasing —
    // only the grounded LLM assessor claims that. Never guess it here.
    hasFalseAssumption: false,
    missedEdgeCase,
    gap,
    coverage,
  };
}
