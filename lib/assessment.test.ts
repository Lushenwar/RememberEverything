import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAssessorPrompt,
  detectJargon,
  EVALUATION_SCHEMA,
  heuristicEvaluate,
  normalizeEvaluation,
} from './assessment.ts';
import { newNode } from './graph.ts';
import { selectMode, SocraticMode, SocraticStage, type Evaluation } from './interrogation_graph.ts';

const CONCEPT = newNode({
  title: 'Backpropagation',
  summary: 'Gradients of the loss are propagated backwards through the network to update weights.',
  sourceText:
    'Backpropagation computes the gradient of the loss with respect to each weight by applying the chain rule backwards through the network. Optimisation then steps the weights against that gradient.',
});

const BASE: Evaluation = {
  isCorrect: false,
  isStuck: false,
  hasFalseAssumption: false,
  missedEdgeCase: false,
  gap: 'heuristic gap',
  coverage: 0.4,
};

test('assessor prompt grounds grading in the source and forbids plausibility (danger zone 2)', () => {
  const p = buildAssessorPrompt(CONCEPT, SocraticStage.Causal);
  assert.ok(p.includes(CONCEPT.sourceText));
  assert.ok(p.includes('SOURCE OF TRUTH'));
  assert.ok(p.includes('ONLY thing you may treat as fact'));
  assert.ok(/analogy/i.test(p));
  assert.ok(p.includes('CAUSAL'));
});

test('evaluation schema is a valid structured-outputs object', () => {
  assert.equal(EVALUATION_SCHEMA.additionalProperties, false);
  const props = Object.keys(EVALUATION_SCHEMA.properties);
  assert.deepEqual([...EVALUATION_SCHEMA.required].sort(), props.sort());
});

test('normalizeEvaluation clamps coverage and coerces types', () => {
  const e = normalizeEvaluation(
    { isCorrect: 1, isStuck: 0, coverage: 5, gap: '  real gap  ', jargon: ['chain rule', '', 7] },
    BASE,
  );
  assert.equal(e.isCorrect, true);
  assert.equal(e.isStuck, false);
  assert.equal(e.coverage, 1);
  assert.equal(e.gap, 'real gap');
  assert.deepEqual(e.jargon, ['chain rule']);
  assert.equal(e.source, 'llm');
});

test('normalizeEvaluation refuses an unevidenced false-assumption claim', () => {
  const e = normalizeEvaluation(
    { isCorrect: true, hasFalseAssumption: true, unverifiedClaims: [], coverage: 0.9 },
    BASE,
  );
  assert.equal(e.hasFalseAssumption, false);
  assert.equal(e.isCorrect, true);
});

test('an evidenced false assumption overrides isCorrect and routes to classical', () => {
  const e = normalizeEvaluation(
    {
      isCorrect: true,
      hasFalseAssumption: true,
      unverifiedClaims: ['it works because the brain does the same thing'],
      coverage: 0.8,
      gap: 'the analogy is not in the source',
    },
    BASE,
  );
  assert.equal(e.hasFalseAssumption, true);
  assert.equal(e.isCorrect, false, 'a false belief cannot also be a correct answer');
  assert.equal(selectMode(e), SocraticMode.Classical);
});

test('normalizeEvaluation falls back for junk input', () => {
  assert.deepEqual(normalizeEvaluation(null, BASE), BASE);
  assert.deepEqual(normalizeEvaluation('nope', BASE), BASE);
  assert.equal(normalizeEvaluation({ coverage: NaN, gap: '   ' }, BASE).coverage, BASE.coverage);
  assert.equal(normalizeEvaluation({ gap: '   ' }, BASE).gap, BASE.gap);
});

test('normalizeEvaluation caps list fields so one bad response cannot flood the prompt', () => {
  const e = normalizeEvaluation(
    { unverifiedClaims: Array.from({ length: 40 }, (_, i) => `claim ${i}`), coverage: 0.5 },
    BASE,
  );
  assert.equal(e.unverifiedClaims!.length, 5);
});

test('detectJargon flags borrowed terms and clears explained ones', () => {
  assert.ok(
    detectJargon('You just do backpropagation and the optimisation handles it.', CONCEPT).includes(
      'optimisation',
    ),
  );
  assert.deepEqual(
    detectJargon(
      'Optimisation, which means nudging each weight a little in the direction that lowers the error, does the rest.',
      CONCEPT,
    ),
    [],
  );
});

test('detectJargon ignores words that are not in the source vocabulary', () => {
  assert.deepEqual(detectJargon('I think it does something with numbers and stuff.', CONCEPT), []);
});

test('the heuristic evaluator tags its own output as heuristic', () => {
  const e = heuristicEvaluate('It propagates gradients backwards.', CONCEPT, SocraticStage.Clarification);
  assert.equal(e.source, 'heuristic');
  assert.ok(Array.isArray(e.jargon));
});
