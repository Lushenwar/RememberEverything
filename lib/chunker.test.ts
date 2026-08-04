import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkText, conceptsToNodes, type Concept } from './chunker.ts';
import { connectionDensity, edgesOf, orphans } from './graph.ts';
import { classifyTopology, routeSessionStrategy } from './moe_router.ts';
import { CognitiveExpert } from './types.ts';

const NOTES = `# Consensus
Consensus lets a distributed cluster agree on one value even when nodes crash. It is the foundation of replicated state machines.

# Raft
Raft is a consensus algorithm built around a single elected leader. The leader accepts writes from clients and replicates the log to followers.

# Leader election
A follower that hears nothing from the leader becomes a candidate and requests votes. A candidate wins the election with a majority of votes in the cluster.`;

test('chunkText splits on markdown headings', () => {
  const chunks = chunkText(NOTES);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((c) => c.title), ['Consensus', 'Raft', 'Leader election']);
  assert.ok(chunks[1].sourceText.includes('single elected leader'));
});

test('chunkText does not repeat the heading inside the summary', () => {
  const [consensus] = chunkText(NOTES);
  assert.equal(consensus.title, 'Consensus');
  assert.ok(consensus.summary.startsWith('Consensus lets a distributed'), consensus.summary);
  assert.ok(!consensus.summary.startsWith('Consensus Consensus'));
});

test('chunkText falls back to blank lines, then sentence groups', () => {
  assert.equal(chunkText('Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu.\n\nOne two three four five six seven eight nine ten eleven twelve.').length, 2);
  const flowing = chunkText(
    Array.from({ length: 6 }, (_, i) => `Sentence number ${i} carries enough words to survive the runt filter easily.`).join(' '),
  );
  assert.equal(flowing.length, 2); // 6 sentences grouped 3 at a time
});

test('chunkText folds runt chunks into the previous one (danger zone 3)', () => {
  const chunks = chunkText('# Real\nThis paragraph has clearly more than twelve words in it, so it survives.\n\n# Runt\nToo short.');
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].sourceText.includes('Too short.'));
});

test('chunkText returns nothing for empty input', () => {
  assert.deepEqual(chunkText('   \n  '), []);
});

test('conceptsToNodes resolves related titles into edges', () => {
  const concepts: Concept[] = [
    { title: 'Raft', summary: 'a', sourceText: 'a', relatedTitles: ['Leader election', 'Ghost'] },
    { title: 'Leader election', summary: 'b', sourceText: 'b', relatedTitles: ['raft'] },
  ];
  const nodes = conceptsToNodes(concepts, 'SYSTEMS', 'ds');
  assert.equal(edgesOf(nodes).length, 1); // dedup + dangling "Ghost" dropped
  assert.equal(nodes[1].dependencies[0], nodes[0].id); // case-insensitive title match
  assert.equal(nodes[0].category, 'ds');
  assert.equal(nodes[0].topology, 'SYSTEMS');
});

test('heuristic ingestion never leaves an orphaned concept', () => {
  const nodes = conceptsToNodes(chunkText(NOTES), 'SYSTEMS', 'ds');
  assert.equal(nodes.length, 3);
  assert.equal(orphans(nodes).length, 0);
  assert.ok(connectionDensity(nodes) >= 1, `density was ${connectionDensity(nodes)}`);
});

test('classifyTopology picks the dominant signal', () => {
  assert.equal(classifyTopology('The theorem follows from the lemma and the proof of the integral.').type, 'MATH');
  assert.equal(classifyTopology('The protocol layers a kernel process onto the network architecture.').type, 'SYSTEMS');
  assert.equal(classifyTopology('Sorting algorithm runtime complexity with a recursion stack.').type, 'ALGORITHMIC');
});

test('classifyTopology defaults to theoretical with low confidence', () => {
  const t = classifyTopology('birds sing loudly at dawn');
  assert.equal(t.type, 'THEORETICAL');
  assert.ok(t.confidence < 0.5);
});

test('routeSessionStrategy maps topology to cognitive experts', () => {
  const t = (type: string) => ({ type, confidence: 1, label: type }) as never;
  assert.deepEqual(routeSessionStrategy(t('MATH')), [CognitiveExpert.Interleaving, CognitiveExpert.ActiveRecall]);
  assert.deepEqual(routeSessionStrategy(t('THEORETICAL')), [CognitiveExpert.ElaborativeEncoding, CognitiveExpert.DualCoding]);
  assert.deepEqual(routeSessionStrategy(t('HISTORY')), [CognitiveExpert.DualCoding, CognitiveExpert.SpacedRepetition]);
  assert.deepEqual(routeSessionStrategy(t('LANGUAGE')), [CognitiveExpert.SpacedRepetition, CognitiveExpert.ActiveRecall]);
});
