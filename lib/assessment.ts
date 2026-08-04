// Understanding assessment — heuristic half. Pure and testable; it is both the
// no-API-key path and the fallback when the LLM assessor is unavailable.
import { significantWords } from './graph.ts';
import { SocraticStage, type Evaluation } from './interrogation_graph.ts';
import type { GraphNode } from './types.ts';

export const EVALUATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'isCorrect',
    'isStuck',
    'hasFalseAssumption',
    'missedEdgeCase',
    'gap',
    'coverage',
    'unverifiedClaims',
    'jargon',
  ],
  properties: {
    isCorrect: { type: 'boolean' },
    isStuck: { type: 'boolean' },
    hasFalseAssumption: { type: 'boolean' },
    missedEdgeCase: { type: 'boolean' },
    gap: { type: 'string' },
    coverage: { type: 'number' },
    unverifiedClaims: { type: 'array', items: { type: 'string' } },
    jargon: { type: 'array', items: { type: 'string' } },
  },
};

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
    jargon: detectJargon(input, concept),
    source: 'heuristic',
  };
}

/**
 * Terms the learner borrowed from the source without unpacking them. Reciting
 * the textbook's vocabulary is the classic way to sound right while
 * understanding nothing, so it drives the Clarification stage's questions.
 */
export function detectJargon(userInput: string, concept: GraphNode): string[] {
  const source = `${concept.title} ${concept.summary} ${concept.sourceText}`.toLowerCase();
  const technical = new Set(
    [...significantWords(source)].filter((w) => w.length >= 7 || TECHNICAL_SUFFIX.test(w)),
  );

  const lower = userInput.toLowerCase();
  const used = [...significantWords(userInput)].filter((w) => technical.has(w));

  return used.filter((term) => !isExplained(term, lower)).slice(0, 5);
}

const TECHNICAL_SUFFIX = /(tion|sion|ism|ity|ance|ence|ology|graph|meter|itive)$/;

/** Did they unpack the term rather than just drop it in? */
const EXPLAINERS = ['which means', 'that means', 'meaning', 'i.e.', 'in other words', 'that is', 'defined as', 'basically'];

function isExplained(term: string, input: string): boolean {
  const at = input.indexOf(term);
  if (at < 0) return false;
  // Look at the clause the term appears in, plus the one after it.
  const window = input.slice(Math.max(0, at - 60), at + term.length + 120);
  return EXPLAINERS.some((e) => window.includes(e));
}

/** Clamp and sanity-check an LLM assessment before it can steer the session. */
export function normalizeEvaluation(raw: unknown, fallback: Evaluation): Evaluation {
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;

  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 5) : [];

  const unverifiedClaims = strings(r.unverifiedClaims);
  const coverage = typeof r.coverage === 'number' && Number.isFinite(r.coverage)
    ? Math.min(1, Math.max(0, r.coverage))
    : fallback.coverage;

  // An accusation of a false belief has to come with the claim it is about,
  // otherwise the tutor starts dismantling things the learner never said.
  const hasFalseAssumption = Boolean(r.hasFalseAssumption) && unverifiedClaims.length > 0;

  return {
    isCorrect: Boolean(r.isCorrect) && !hasFalseAssumption,
    isStuck: Boolean(r.isStuck),
    hasFalseAssumption,
    missedEdgeCase: Boolean(r.missedEdgeCase),
    gap: typeof r.gap === 'string' && r.gap.trim() ? r.gap.trim() : fallback.gap,
    coverage,
    unverifiedClaims,
    jargon: strings(r.jargon),
    source: 'llm',
  };
}

/**
 * The assessor is not allowed to be generous: it grades against the source
 * text only, and an analogy the source does not support is unverified rather
 * than correct (danger zone 2).
 */
export function buildAssessorPrompt(concept: GraphNode, stage: SocraticStage): string {
  return `You grade one attempt by a learner to explain a concept from memory. You are strict, specific, and grounded.

SOURCE OF TRUTH — the learner's own material. This is the ONLY thing you may treat as fact.
<source>
${concept.sourceText}
</source>

Concept: ${concept.title}
Reference definition: ${concept.summary}
Stage being assessed: ${stage}

Grading rules:
- Judge ONLY against the source. If the learner asserts something the source does not support — including an analogy that "sounds right" — put it in unverifiedClaims. Do not accept it as correct just because it is plausible or because you happen to know it is true.
- isCorrect means they met THIS stage's bar, not that the answer was pleasant: CLARIFICATION needs a jargon-free statement of what it is; ASSUMPTION_TEST needs an assumption named and defended; CAUSAL needs the mechanism, not the sequence of events; EDGE_CASE needs a real boundary where it breaks.
- hasFalseAssumption only when they asserted something the source contradicts, and you must list that assertion in unverifiedClaims.
- isStuck means they blanked, asked for help, or wrote too little to assess — not merely that they were wrong.
- jargon: terms they used without explaining. Reciting the source's vocabulary is not understanding.
- gap: one short phrase naming the single most important thing missing. This becomes the next question.
- coverage: 0 to 1, how much of the concept their explanation actually reached.`;
}
