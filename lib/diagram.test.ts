import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackDiagram, graphToMermaid, mermaidLabel, sanitizeMermaid } from './diagram.ts';
import { newNode } from './graph.ts';
import type { GraphNode } from './types.ts';

function n(title: string, deps: string[] = []): GraphNode {
  const node = newNode({ title, summary: `${title} summary`, sourceText: 'src' });
  node.id = title;
  node.dependencies = deps;
  return node;
}

test('sanitizeMermaid accepts a valid diagram and unwraps code fences', () => {
  assert.equal(sanitizeMermaid('graph TD\n  a --> b'), 'graph TD\n  a --> b');
  assert.equal(sanitizeMermaid('```mermaid\ngraph LR\n  a --> b\n```'), 'graph LR\n  a --> b');
  assert.ok(sanitizeMermaid('flowchart TD\n  a --> b'));
  assert.ok(sanitizeMermaid('stateDiagram-v2\n  [*] --> Idle'));
});

test('sanitizeMermaid rejects prose, empty bodies, and oversized input', () => {
  assert.equal(sanitizeMermaid('Here is a diagram of the concept:'), null);
  assert.equal(sanitizeMermaid('graph TD'), null); // header with no body
  assert.equal(sanitizeMermaid(''), null);
  assert.equal(sanitizeMermaid(null), null);
  assert.equal(sanitizeMermaid(`graph TD\n${'  a --> b\n'.repeat(1000)}`), null);
});

test('sanitizeMermaid rejects injected script content', () => {
  assert.equal(sanitizeMermaid('graph TD\n  a["<script>alert(1)</script>"] --> b'), null);
  assert.equal(sanitizeMermaid('graph TD\n  click a "javascript:alert(1)"'), null);
});

test('mermaidLabel quotes and escapes parser-breaking characters', () => {
  assert.equal(mermaidLabel('Raft consensus'), '"Raft consensus"');
  assert.equal(mermaidLabel('the "leader" <node>'), '"the #quot;leader#quot; node"');
  assert.equal(mermaidLabel('   '), '"concept"');
  assert.ok(mermaidLabel('x'.repeat(100)).length <= 44);
});

test('fallbackDiagram centres the concept on its neighbours', () => {
  const nodes = [n('Raft', ['Consensus']), n('Consensus'), n('Elections', ['Raft'])];
  const src = fallbackDiagram(nodes[0], nodes);
  assert.ok(src.startsWith('graph TD'));
  assert.ok(src.includes('"Consensus"'));
  assert.ok(src.includes('"Elections"'));
  assert.ok(sanitizeMermaid(src), 'fallback must survive its own sanitiser');
});

test('fallbackDiagram still produces a diagram for a lone concept', () => {
  const solo = n('Alone');
  const src = fallbackDiagram(solo, [solo]);
  assert.ok(sanitizeMermaid(src));
  assert.ok(src.includes('"Alone summary"'));
});

test('graphToMermaid draws each undirected edge once', () => {
  const nodes = [n('a', ['b']), n('b', ['a']), n('c')];
  const src = graphToMermaid(nodes);
  assert.equal(src.split('\n').filter((l) => l.includes('---')).length, 1);
  assert.equal(src.split('\n').filter((l) => /^\s+n\d+\[/.test(l)).length, 3);
  assert.ok(sanitizeMermaid(src));
});

test('graphToMermaid caps the node count', () => {
  const many = Array.from({ length: 80 }, (_, i) => n(`c${i}`));
  assert.equal(graphToMermaid(many).split('\n').filter((l) => /^\s+n\d+\[/.test(l)).length, 60);
});
