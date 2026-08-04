// Server-side Socratic turn: evaluate the explanation, pick a mode, generate
// exactly one question, and refuse to ship one that gives the game away.
import { heuristicEvaluate } from './assessment.ts';
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

export async function processUserExplanation(
  userInput: string,
  concept: GraphNode,
  state: TutorState,
  history: { role: 'tutor' | 'learner'; text: string }[] = [],
): Promise<AgentResponse> {
  const evaluation = heuristicEvaluate(userInput, concept, state.stage);
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
      prompt: `${transcript ? `Conversation so far:\n${transcript}\n\n` : ''}Learner's latest explanation:\n${userInput}\n\nWhat they have not accounted for: ${evaluation.gap || 'nothing obvious'}\n\nAsk your one question.`,
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
