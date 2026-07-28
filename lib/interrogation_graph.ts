// Interrogation AI state graph (CLAUDE.md §3). Pure: stage transitions, mode
// selection, prompt construction, and the leak guard. No IO, so the whole
// Socratic control flow is unit-testable.
import type { GraphNode } from './types.ts';

export enum SocraticMode {
  Classical = 'CLASSICAL_SOCRATIC', // Trigger: false assumption / missed edge case
  Elaborative = 'ELABORATIVE_INTERROGATION', // Trigger: correct answer given
  GuidedDiscovery = 'GUIDED_DISCOVERY', // Trigger: user is stuck / blanking
}

/** The rigid pipeline every concept is driven through. */
export enum SocraticStage {
  Clarification = 'CLARIFICATION',
  AssumptionTest = 'ASSUMPTION_TEST',
  Causal = 'CAUSAL',
  EdgeCase = 'EDGE_CASE',
  Complete = 'COMPLETE',
}

export const STAGE_ORDER: SocraticStage[] = [
  SocraticStage.Clarification,
  SocraticStage.AssumptionTest,
  SocraticStage.Causal,
  SocraticStage.EdgeCase,
  SocraticStage.Complete,
];

export interface Evaluation {
  isCorrect: boolean;
  isStuck: boolean;
  hasFalseAssumption: boolean;
  missedEdgeCase: boolean;
  /** What the learner did not account for — fuel for the next question. */
  gap: string;
  /** 0..1 how much of the concept the explanation actually covered. */
  coverage: number;
}

export interface TutorState {
  stage: SocraticStage;
  /** Consecutive non-advancing turns at the current stage. */
  strikes: number;
  hintsUsed: number;
  turns: number;
  startedAt: number;
}

export interface AgentResponse {
  mode: SocraticMode;
  stage: SocraticStage;
  question: string;
  evaluation: Evaluation;
  state: TutorState;
}

export function initialState(now = Date.now()): TutorState {
  return {
    stage: SocraticStage.Clarification,
    strikes: 0,
    hintsUsed: 0,
    turns: 0,
    startedAt: now,
  };
}

/**
 * Mode selection, in the spec's priority order: dismantle a false belief first,
 * rescue a stuck learner second, deepen a correct answer third.
 */
export function selectMode(evaluation: Evaluation): SocraticMode {
  if (evaluation.hasFalseAssumption || evaluation.missedEdgeCase) return SocraticMode.Classical;
  if (evaluation.isStuck) return SocraticMode.GuidedDiscovery;
  if (evaluation.isCorrect) return SocraticMode.Elaborative;
  // Partially right and not stuck: keep clarifying rather than validating.
  return SocraticMode.Classical;
}

/** Advance only on a correct answer. Three strikes forces the stage forward. */
export function advance(state: TutorState, evaluation: Evaluation): TutorState {
  const next = { ...state, turns: state.turns + 1 };
  if (evaluation.isStuck) next.hintsUsed += 1;

  if (evaluation.isCorrect) {
    const i = STAGE_ORDER.indexOf(state.stage);
    next.stage = STAGE_ORDER[Math.min(i + 1, STAGE_ORDER.length - 1)];
    next.strikes = 0;
    return next;
  }

  next.strikes = state.strikes + 1;
  if (next.strikes >= 3) {
    // ponytail: hard cap instead of adaptive remediation. Prevents an endless
    // loop on one stage; swap in remediation if users report it moves on early.
    const i = STAGE_ORDER.indexOf(state.stage);
    next.stage = STAGE_ORDER[Math.min(i + 1, STAGE_ORDER.length - 1)];
    next.strikes = 0;
  }
  return next;
}

export function isComplete(state: TutorState): boolean {
  return state.stage === SocraticStage.Complete;
}

const STAGE_GOAL: Record<SocraticStage, string> = {
  [SocraticStage.Clarification]:
    'Make them state what the concept actually is, in their own words, without borrowed jargon. Ask them to define any term they used but did not explain.',
  [SocraticStage.AssumptionTest]:
    'Surface an assumption their explanation depends on and make them defend it. Do not accept it because it is conventional.',
  [SocraticStage.Causal]:
    'Force the causal "why". Not what happens — why it must happen, and what mechanism produces it.',
  [SocraticStage.EdgeCase]:
    'Push them to the boundary: a case where the concept breaks down, stops applying, or gives a surprising result.',
  [SocraticStage.Complete]:
    'They have been through the full pipeline. Close out in one sentence naming the single weakest part of their understanding.',
};

const MODE_INSTRUCTION: Record<SocraticMode, string> = {
  [SocraticMode.Classical]:
    'Dismantle the assumption using a counter-example. Do not give the answer.',
  [SocraticMode.GuidedDiscovery]:
    'Provide a minimal constraint or hint to keep them moving forward.',
  [SocraticMode.Elaborative]:
    "They answered correctly. Now force them to explain the causal 'Why?' behind it.",
};

/**
 * The agent never gets to freelance: it is pinned to the source text and told
 * exactly one move to make.
 */
export function buildAgentPrompt(
  mode: SocraticMode,
  stage: SocraticStage,
  concept: GraphNode,
): string {
  const base = `You are a Socratic tutor running the Feynman technique on ONE concept.

SOURCE OF TRUTH — the learner's original material. Everything you assert or accept must be supported by this text. If their analogy or claim is not supported here, treat it as unverified and challenge it; never validate it as fact.
<source>
${concept.sourceText}
</source>

Concept under examination: ${concept.title}
Reference definition (for your judgement only, never quote it): ${concept.summary}

Current stage: ${stage}
Stage goal: ${STAGE_GOAL[stage]}
Your move this turn: ${MODE_INSTRUCTION[mode]}

Hard rules:
- Ask exactly ONE question. No preamble, no praise, no summary of what they said.
- Never state the answer, the definition, or the mechanism. You interrogate; they explain.
- Never offer multiple-choice options. The answer must be open-ended and produced by them.
- Two sentences maximum.`;

  if (mode !== SocraticMode.GuidedDiscovery) return base;

  // Danger zone 6: the model's instinct when a learner struggles is to rescue
  // them with the answer. This constraint is the whole point of the mode.
  return `${base}

GUIDED DISCOVERY CONSTRAINT (absolute):
- You are FORBIDDEN from writing the concept name "${concept.title}" or naming its core mechanism.
- You may only ask a pointing question that narrows the search space: a smaller case, a constraint to hold fixed, a related thing they already know.
- If the only helpful thing you can think of reveals the mechanism, ask about a simpler adjacent case instead.`;
}

/**
 * Post-generation guard for GuidedDiscovery. Cheap, and it catches the failure
 * mode a system prompt alone does not reliably prevent (danger zone 6).
 */
export function leaksAnswer(question: string, concept: GraphNode): boolean {
  const q = words(question).join(' ');
  const title = words(concept.title).join(' ');
  if (title.length > 3 && q.includes(title)) return true;

  // Any contiguous phrase lifted out of the definition. Stopwords stay in the
  // n-gram so it matches real prose; requiring one long word keeps generic
  // phrasings like "what happens when the" from tripping the guard.
  const def = words(concept.summary);
  for (let i = 0; i + 4 <= def.length; i++) {
    const gram = def.slice(i, i + 4);
    if (!gram.some((w) => w.length > 5)) continue;
    if (q.includes(gram.join(' '))) return true;
  }
  return false;
}

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Last-resort question when generation is unavailable or kept leaking. */
export function fallbackQuestion(mode: SocraticMode, stage: SocraticStage): string {
  if (mode === SocraticMode.GuidedDiscovery) {
    return 'Take the smallest possible example you can imagine — what happens in that case, step by step?';
  }
  switch (stage) {
    case SocraticStage.Clarification:
      return 'Explain that again without using any term you have not already defined. What is it, plainly?';
    case SocraticStage.AssumptionTest:
      return 'What has to be true for your explanation to hold? Why should I believe that part?';
    case SocraticStage.Causal:
      return 'Why does that happen rather than something else? What is the mechanism underneath it?';
    case SocraticStage.EdgeCase:
      return 'Describe a case where this stops working. What breaks first, and why?';
    default:
      return 'Which part of your explanation are you least sure about, and what would settle it?';
  }
}
