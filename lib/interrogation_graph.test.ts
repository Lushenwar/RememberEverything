import assert from 'node:assert/strict';
import test from 'node:test';
import { heuristicEvaluate } from './assessment.ts';
import { newNode } from './graph.ts';
import {
  advance,
  buildAgentPrompt,
  fallbackQuestion,
  initialState,
  isComplete,
  leaksAnswer,
  selectMode,
  SocraticMode,
  SocraticStage,
  type Evaluation,
} from './interrogation_graph.ts';

const CONCEPT = newNode({
  title: 'Leader election',
  summary: 'A follower promotes itself to candidate and wins with a majority of votes.',
  sourceText:
    'A follower that stops hearing from the leader becomes a candidate and requests votes. The candidate wins with a majority of the cluster.',
});

function evalOf(over: Partial<Evaluation> = {}): Evaluation {
  return {
    isCorrect: false,
    isStuck: false,
    hasFalseAssumption: false,
    missedEdgeCase: false,
    gap: '',
    coverage: 0.5,
    ...over,
  };
}

test('selectMode follows the spec priority order', () => {
  assert.equal(selectMode(evalOf({ hasFalseAssumption: true, isCorrect: true })), SocraticMode.Classical);
  assert.equal(selectMode(evalOf({ missedEdgeCase: true })), SocraticMode.Classical);
  assert.equal(selectMode(evalOf({ isStuck: true, isCorrect: true })), SocraticMode.GuidedDiscovery);
  assert.equal(selectMode(evalOf({ isCorrect: true })), SocraticMode.Elaborative);
  // Partially right: keep pushing rather than validating.
  assert.equal(selectMode(evalOf()), SocraticMode.Classical);
});

test('advance walks the pipeline only on correct answers', () => {
  let s = initialState(0);
  assert.equal(s.stage, SocraticStage.Clarification);
  s = advance(s, evalOf({ isCorrect: true }));
  assert.equal(s.stage, SocraticStage.AssumptionTest);
  s = advance(s, evalOf({ isCorrect: true }));
  assert.equal(s.stage, SocraticStage.Causal);
  s = advance(s, evalOf({ isCorrect: true }));
  assert.equal(s.stage, SocraticStage.EdgeCase);
  s = advance(s, evalOf({ isCorrect: true }));
  assert.ok(isComplete(s));
  // Complete is absorbing.
  assert.equal(advance(s, evalOf({ isCorrect: true })).stage, SocraticStage.Complete);
  assert.equal(s.turns, 4);
});

test('a wrong answer holds the stage until three strikes force it forward', () => {
  let s = initialState(0);
  s = advance(s, evalOf());
  assert.equal(s.stage, SocraticStage.Clarification);
  assert.equal(s.strikes, 1);
  s = advance(s, evalOf());
  s = advance(s, evalOf());
  assert.equal(s.stage, SocraticStage.AssumptionTest);
  assert.equal(s.strikes, 0);
});

test('being stuck counts a hint, which the scheduler later reads as friction', () => {
  const s = advance(advance(initialState(0), evalOf({ isStuck: true })), evalOf({ isStuck: true }));
  assert.equal(s.hintsUsed, 2);
});

test('guided discovery prompt forbids naming the concept (danger zone 6)', () => {
  const p = buildAgentPrompt(SocraticMode.GuidedDiscovery, SocraticStage.Causal, CONCEPT);
  assert.ok(p.includes('FORBIDDEN'));
  assert.ok(p.includes('Leader election'));
  assert.ok(p.includes('pointing question'));
});

test('every prompt pins the agent to the source text (danger zone 2)', () => {
  for (const mode of Object.values(SocraticMode)) {
    const p = buildAgentPrompt(mode, SocraticStage.Clarification, CONCEPT);
    assert.ok(p.includes(CONCEPT.sourceText), `${mode} prompt must embed the source`);
    assert.ok(p.includes('SOURCE OF TRUTH'));
    assert.ok(p.includes('Never offer multiple-choice'), `${mode} must forbid recognition prompts`);
  }
});

test('leaksAnswer catches the concept name and lifted definition phrases', () => {
  assert.ok(leaksAnswer('So how does leader election start?', CONCEPT));
  assert.ok(leaksAnswer('What happens when it wins with a majority of votes?', CONCEPT));
  assert.equal(leaksAnswer('What does a node do when it stops hearing anything?', CONCEPT), false);
});

test('fallback questions never hand over the answer', () => {
  for (const stage of Object.values(SocraticStage)) {
    const q = fallbackQuestion(SocraticMode.Classical, stage);
    assert.ok(q.endsWith('?'), `${stage} fallback must be a question`);
  }
  assert.equal(leaksAnswer(fallbackQuestion(SocraticMode.GuidedDiscovery, SocraticStage.Causal), CONCEPT), false);
});

test('heuristicEvaluate detects blanking', () => {
  for (const input of ["I don't know", 'no idea', 'hmm', 'skip this one please']) {
    assert.ok(heuristicEvaluate(input, CONCEPT, SocraticStage.Clarification).isStuck, input);
  }
});

test('heuristicEvaluate requires a causal claim at the causal stage', () => {
  const described =
    'The follower stops hearing from the leader and then it becomes a candidate and asks the cluster for votes.';
  const explained =
    'The follower becomes a candidate because the leader stopped sending heartbeats, so the cluster must replace it to keep accepting writes.';
  assert.equal(heuristicEvaluate(described, CONCEPT, SocraticStage.Causal).isCorrect, false);
  assert.ok(heuristicEvaluate(explained, CONCEPT, SocraticStage.Causal).isCorrect);
});

test('heuristicEvaluate flags a missed edge case at the edge-case stage', () => {
  const e = heuristicEvaluate(
    'The candidate requests votes from the cluster and the leader replicates its log.',
    CONCEPT,
    SocraticStage.EdgeCase,
  );
  assert.ok(e.missedEdgeCase);
  assert.equal(selectMode(e), SocraticMode.Classical);

  const bounded = heuristicEvaluate(
    'It fails when the cluster splits evenly, because no candidate can reach a majority of votes.',
    CONCEPT,
    SocraticStage.EdgeCase,
  );
  assert.equal(bounded.missedEdgeCase, false);
  assert.ok(bounded.isCorrect);
});

test('heuristicEvaluate never claims a false assumption it cannot detect', () => {
  assert.equal(
    heuristicEvaluate('Leader election is when the cluster picks a leader somehow.', CONCEPT, SocraticStage.Clarification)
      .hasFalseAssumption,
    false,
  );
});
