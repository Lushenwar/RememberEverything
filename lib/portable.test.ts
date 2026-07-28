import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReview } from './fsrs.ts';
import { emptyCard, newNode } from './graph.ts';
import { buildExport, exportFilename, parseGraphExport } from './portable.ts';
import { mergeByLWW } from './sync.ts';
import type { GraphNode } from './types.ts';

const NOW = new Date('2026-07-28T12:00:00.000Z');

function concept(title = 'Raft'): GraphNode {
  const n = newNode({ title, summary: 'a summary', sourceText: 'src', category: 'ds' });
  n.card = emptyCard(NOW);
  return n;
}

const roundTrip = (nodes: GraphNode[]) =>
  parseGraphExport(JSON.stringify(buildExport(nodes, NOW)));

test('a real export round-trips without losing scheduling state', () => {
  const reviewed = applyReview(
    concept(),
    { timeTakenMs: 5_000, hintsUsed: 0, promptType: 'CAUSAL', isCorrect: true },
    NOW,
  );
  const result = roundTrip([reviewed, concept('Consensus')]);
  assert.ok(result.ok);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.nodes[0].card, reviewed.card);
  assert.deepEqual(result.nodes[0].history, reviewed.history);
});

test('export is tagged and dated so a stray JSON file cannot be mistaken for one', () => {
  const file = buildExport([concept()], NOW);
  assert.equal(file.format, 'remember-everything');
  assert.equal(file.version, 1);
  assert.equal(file.exportedAt, NOW.toISOString());
  assert.equal(exportFilename(NOW), 'remember-everything-2026-07-28.json');
});

test('files that are not our exports are rejected, not half-imported', () => {
  for (const [input, why] of [
    ['not json at all', 'not valid JSON'],
    ['{"nodes":[]}', 'untagged'],
    ['[]', 'bare array'],
    ['null', 'null'],
    ['{"format":"remember-everything","version":1}', 'no nodes key'],
  ] as const) {
    const r = parseGraphExport(input);
    assert.equal(r.ok, false, `should reject ${why}`);
  }
});

test('an export from a newer version is refused rather than silently downgraded', () => {
  const r = parseGraphExport(JSON.stringify({ ...buildExport([concept()], NOW), version: 99 }));
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /newer than this app/);
});

test('malformed concepts are skipped, good ones still import', () => {
  const file = {
    ...buildExport([concept('Good')], NOW),
    nodes: [concept('Good'), { title: 'no id' }, null, 'a string', { id: 'x' }],
  };
  const r = parseGraphExport(JSON.stringify(file));
  assert.ok(r.ok);
  assert.equal(r.nodes.length, 1);
  assert.equal(r.skipped, 4);
  assert.equal(r.nodes[0].title, 'Good');
});

test('a file where every concept is malformed fails loudly', () => {
  const r = parseGraphExport(
    JSON.stringify({ ...buildExport([], NOW), nodes: [{ nope: true }, null] }),
  );
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /malformed/);
});

test('a corrupt card resets the schedule but keeps the concept', () => {
  const broken = { ...concept(), card: { due: 'not a date', reps: 'seven' } };
  const r = parseGraphExport(JSON.stringify({ ...buildExport([], NOW), nodes: [broken] }));
  assert.ok(r.ok);
  assert.equal(r.nodes[0].title, 'Raft');
  assert.equal(r.nodes[0].card.reps, 0);
  assert.ok(!Number.isNaN(Date.parse(r.nodes[0].card.due)), 'must be schedulable');
});

test('missing optional fields are filled rather than left undefined', () => {
  const sparse = { id: 'abc', title: 'Sparse' };
  const r = parseGraphExport(JSON.stringify({ ...buildExport([], NOW), nodes: [sparse] }));
  assert.ok(r.ok);
  const n = r.nodes[0];
  assert.equal(n.category, 'general');
  assert.equal(n.topology, 'THEORETICAL');
  assert.deepEqual(n.dependencies, []);
  assert.deepEqual(n.history, []);
  assert.equal(typeof n.createdAt, 'number');
});

test('junk inside arrays is filtered, including self-referential edges', () => {
  const messy = {
    ...concept(),
    id: 'self',
    dependencies: ['other', 42, null, 'self'],
    history: [{ at: 1, rating: 3 }, 'nope', { rating: 3 }],
  };
  const r = parseGraphExport(JSON.stringify({ ...buildExport([], NOW), nodes: [messy] }));
  assert.ok(r.ok);
  assert.deepEqual(r.nodes[0].dependencies, ['other']);
  assert.equal(r.nodes[0].history.length, 1, 'entries with no timestamp are unusable');
  assert.equal(r.nodes[0].history[0].promptType, 'UNKNOWN');
});

test('importing a backup cannot roll back newer local reviews', () => {
  const base = concept();
  const backup = applyReview(
    base,
    { timeTakenMs: 5_000, hintsUsed: 0, promptType: 'CAUSAL', isCorrect: true },
    NOW,
  );
  const later = new Date(NOW.getTime() + 3 * 86_400_000);
  const local = applyReview(
    backup,
    { timeTakenMs: 5_000, hintsUsed: 0, promptType: 'CAUSAL', isCorrect: true },
    later,
  );

  const imported = roundTrip([backup]);
  assert.ok(imported.ok);
  const { merged } = mergeByLWW([local], imported.nodes);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].card.last_review, later.toISOString(), 'newer local review must win');
});
