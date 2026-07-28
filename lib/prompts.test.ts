import assert from 'node:assert/strict';
import test from 'node:test';
import { newNode } from './graph.ts';
import {
  blankDiagram,
  generateReviewPrompt,
  lastPromptType,
  promptWeights,
  PromptType,
  selectPromptType,
} from './prompts.ts';
import type { GraphNode, TopologyType } from './types.ts';

function concept(over: Partial<GraphNode> = {}): GraphNode {
  return {
    ...newNode({ title: 'Raft', summary: 'A leader replicates a log.', sourceText: 'src' }),
    visualSchema: 'graph TD\n  c["Raft"] --- n0["Consensus"]',
    ...over,
  };
}

function reviewed(promptType: PromptType, over: Partial<GraphNode> = {}): GraphNode {
  const n = concept(over);
  n.history = [{ at: 1, rating: 3, timeTakenMs: 1000, hintsUsed: 0, promptType, intervalDays: 1 }];
  return n;
}

test('weights follow the cognitive router, not the concept', () => {
  const dualCoded = promptWeights(concept({ topology: 'SYSTEMS' as TopologyType }));
  const theoretical = promptWeights(concept({ topology: 'THEORETICAL' as TopologyType }));
  const algorithmic = promptWeights(concept({ topology: 'ALGORITHMIC' as TopologyType }));

  assert.ok(dualCoded[PromptType.Structural] > dualCoded[PromptType.Causal], 'systems favour dual coding');
  assert.ok(theoretical[PromptType.Causal] > theoretical[PromptType.Structural], 'theory favours elaboration');
  assert.ok(
    algorithmic[PromptType.CounterExample] > algorithmic[PromptType.Structural],
    'algorithmic favours interleaving/edge cases',
  );
});

test('a concept with no diagram is never probed structurally', () => {
  const w = promptWeights(concept({ visualSchema: '', topology: 'SYSTEMS' as TopologyType }));
  assert.equal(w[PromptType.Structural], 0);
  // Even with a roll that would otherwise land on structural.
  for (const r of [0, 0.01, 0.5, 0.99]) {
    assert.notEqual(
      selectPromptType(concept({ visualSchema: '', topology: 'SYSTEMS' as TopologyType }), () => r),
      PromptType.Structural,
    );
  }
});

test('the previous prompt type is never repeated', () => {
  for (const type of Object.values(PromptType)) {
    const node = reviewed(type);
    for (const r of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
      assert.notEqual(selectPromptType(node, () => r), type, `repeated ${type} at roll ${r}`);
    }
  }
});

test('lastPromptType ignores unrecognised history entries', () => {
  assert.equal(lastPromptType(concept()), null);
  assert.equal(lastPromptType(reviewed('NONSENSE' as PromptType)), null);
  assert.equal(lastPromptType(reviewed(PromptType.Causal)), PromptType.Causal);
});

test('selection still returns something when only one type is possible', () => {
  const node = reviewed(PromptType.BlankPage, { visualSchema: '' });
  assert.ok(Object.values(PromptType).includes(selectPromptType(node, () => 0.5)));
});

test('every roll in range yields a weighted type', () => {
  const node = concept({ topology: 'THEORETICAL' as TopologyType });
  const seen = new Set<PromptType>();
  for (let i = 0; i < 100; i++) seen.add(selectPromptType(node, () => i / 100));
  assert.ok(seen.size > 1, 'generator must vary the prompt, not settle on one');
});

test('blankDiagram removes the concept label but keeps the structure', () => {
  const blanked = blankDiagram(concept());
  assert.ok(!blanked.includes('"Raft"'));
  assert.ok(blanked.includes('"?"'));
  assert.ok(blanked.includes('"Consensus"'));
  assert.equal(blankDiagram(concept({ visualSchema: '' })), '');
});

test('blankDiagram survives a title with regex metacharacters', () => {
  const node = concept({ title: 'O(n log n)', visualSchema: 'graph TD\n  c["O(n log n)"] --- n0["Sorting"]' });
  const blanked = blankDiagram(node);
  assert.ok(blanked.includes('"?"'));
  assert.ok(blanked.includes('"Sorting"'));
});

test('generated prompts are open-ended and never multiple choice (danger zone 1)', () => {
  const all = [concept(), concept({ title: 'Consensus' })];
  all[0].dependencies = [all[1].id];
  for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
    const s = generateReviewPrompt(all[0], all, () => r, 1000);
    assert.equal(s.nodeId, all[0].id);
    assert.equal(s.startedAt, 1000);
    assert.ok(s.instruction.length > 20);
    assert.ok(s.hint.length > 0, 'every prompt needs a hint so hint use is measurable friction');
    assert.ok(!/\ba\)|\bb\)|choose one|which of the following/i.test(s.instruction));
  }
});

test('structural prompts carry a blanked scaffold, others do not', () => {
  const node = concept({ topology: 'SYSTEMS' as TopologyType });
  const structural = generateReviewPrompt(node, [node], () => 0, 0);
  if (structural.type === PromptType.Structural) {
    assert.ok(structural.scaffold?.includes('"?"'));
  }
  const blank = generateReviewPrompt(concept({ visualSchema: '' }), [], () => 0.99, 0);
  assert.equal(blank.scaffold, undefined);
});
