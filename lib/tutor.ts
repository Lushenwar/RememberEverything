// Server-side Socratic turn: evaluate the explanation, pick a mode, generate
// exactly one question, and refuse to ship one that gives the game away.
import {
  buildAssessorPrompt,
  EVALUATION_SCHEMA,
  heuristicEvaluate,
  normalizeEvaluation,
} from './assessment.ts';
import {
  advance,
  buildAgentPrompt,
  fallbackQuestion,
  leaksAnswer,
  selectMode,
  SocraticMode,
  type AgentResponse,
  type TutorState,
} from './interrogation_graph.ts';
import { ask, llmAvailable } from './llm.ts';
import type { GraphNode } from './types.ts';

const QUESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['question'],
  properties: { question: { type: 'string' } },
};

/**
 * Elaborative assessment (CLAUDE.md §3). The LLM grades strictly against the
 * ingested source; the heuristic is both the no-key path and the floor the
 * LLM's answer is normalised against.
 */
export async function evaluateUnderstanding(
  userInput: string,
  concept: GraphNode,
  state: TutorState,
) {
  const heuristic = heuristicEvaluate(userInput, concept, state.stage);
  if (!llmAvailable()) return heuristic;

  const raw = await ask<unknown>({
    system: buildAssessorPrompt(concept, state.stage),
    prompt: `Learner's explanation:\n${userInput}`,
    schema: EVALUATION_SCHEMA,
    maxTokens: 4000,
  }).catch(() => null);

  return raw ? normalizeEvaluation(raw, heuristic) : heuristic;
}

export async function processUserExplanation(
  userInput: string,
  concept: GraphNode,
  state: TutorState,
  history: { role: 'tutor' | 'learner'; text: string }[] = [],
): Promise<AgentResponse> {
  const evaluation = await evaluateUnderstanding(userInput, concept, state);
  const mode = selectMode(evaluation);
  const stage = state.stage;

  let question = '';
  if (llmAvailable()) {
    const transcript = history
      .slice(-6)
      .map((h) => `${h.role === 'tutor' ? 'Tutor' : 'Learner'}: ${h.text}`)
      .join('\n');

    const result = await ask<{ question: string }>({
      system: buildAgentPrompt(mode, stage, concept),
      prompt: [
        transcript ? `Conversation so far:\n${transcript}\n` : '',
        `Learner's latest explanation:\n${userInput}\n`,
        `What they have not accounted for: ${evaluation.gap || 'nothing obvious'}`,
        evaluation.unverifiedClaims?.length
          ? `Claims the source does not support — target one of these:\n${evaluation.unverifiedClaims.map((c) => `- ${c}`).join('\n')}`
          : '',
        evaluation.jargon?.length
          ? `Terms they used without explaining: ${evaluation.jargon.join(', ')}`
          : '',
        '\nAsk your one question.',
      ]
        .filter(Boolean)
        .join('\n'),
      schema: QUESTION_SCHEMA,
      maxTokens: 2000,
    }).catch(() => null);

    const candidate = result?.question?.trim() ?? '';
    // Guided discovery may not name the thing (danger zone 6). If it did, we
    // drop the generation rather than hand the learner the answer.
    if (candidate && !(mode === SocraticMode.GuidedDiscovery && leaksAnswer(candidate, concept))) {
      question = candidate;
    }
  }

  return {
    mode,
    stage,
    question: question || fallbackQuestion(mode, stage),
    evaluation,
    state: advance(state, evaluation),
  };
}
