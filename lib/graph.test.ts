import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionDensity, edgesOf, linkOrphans, mergeNodes, neighbors, newNode, orphans } from './graph.ts';
import type { GraphNode } from './types.ts';

function n(title: string, summary = '', deps: string[] = []): GraphNode {
  const node = newNode({ title, summary, sourceText: summary });
  node.id = title;
  node.dependencies = deps;
  return node;
}

test('edges drop dangling and duplicate links', () => {
  const nodes = [n('a', '', ['b', 'ghost', 'a']), n('b', '', ['a'])];
  assert.equal(edgesOf(nodes).length, 1);
});

test('density counts each undirected edge for both endpoints', () => {
  const nodes = [n('a', '', ['b']), n('b'), n('c')];
  assert.equal(connectionDensity(nodes), 2 / 3);
  assert.equal(connectionDensity([n('solo')]), 0);
});

test('orphans are the nodes nothing touches', () => {
  const nodes = [n('a', '', ['b']), n('b'), n('c')];
  assert.deepEqual(orphans(nodes).map((x) => x.id), ['c']);
});

test('linkOrphans attaches strays to the most word-similar node (danger zone 3)', () => {
  const nodes = [
    n('a', 'gradient descent optimizer steps downhill', ['b']),
    n('b', 'loss surface geometry'),
    n('c', 'momentum accelerates gradient descent optimizer'),
  ];
  const linked = linkOrphans(nodes);
  assert.equal(orphans(linked).length, 0);
  assert.deepEqual(linked.find((x) => x.id === 'c')!.dependencies, ['a']);
  assert.ok(connectionDensity(linked) > connectionDensity(nodes));
});

test('neighbors are bidirectional', () => {
  const nodes = [n('a', '', ['b']), n('b'), n('c')];
  assert.deepEqual(neighbors(nodes, 'b').map((x) => x.id), ['a']);
});

test('mergeNodes replaces by id and keeps the rest', () => {
  const merged = mergeNodes([n('a', 'old'), n('b')], [n('a', 'new')]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((x) => x.id === 'a')!.summary, 'new');
});

test('newNode starts with an unscheduled empty card', () => {
  const node = newNode({ title: 't', summary: 's', sourceText: 's' });
  assert.equal(node.card.reps, 0);
  assert.equal(node.card.state, 0);
  assert.ok(!Number.isNaN(Date.parse(node.card.due)));
});
