import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyCard, newNode } from './graph.ts';
import { adjacentRepeats, buildDailyQueue, buildQueueFor, groupByCategory, interleaveCategories } from './queue.ts';
import type { GraphNode } from './types.ts';

const NOW = new Date('2026-07-28T12:00:00.000Z');

function concept(title: string, category: string, dueIso = NOW.toISOString()): GraphNode {
  const n = newNode({ title, summary: 's', sourceText: 'src', category });
  n.card = { ...emptyCard(NOW), due: dueIso };
  return n;
}

/** n items in one category, titled c0, c1, … */
function batch(category: string, count: number): GraphNode[] {
  return Array.from({ length: count }, (_, i) => concept(`${category}${i}`, category));
}

test('groupByCategory buckets by category and defaults empty ones', () => {
  const grouped = groupByCategory([
    concept('a', 'math'),
    concept('b', 'systems'),
    concept('c', 'math'),
    concept('d', ''),
  ]);
  assert.deepEqual([...grouped.keys()].sort(), ['general', 'math', 'systems']);
  assert.equal(grouped.get('math')!.length, 2);
  assert.equal(grouped.get('general')!.length, 1);
});

test('balanced categories interleave with zero repeats', () => {
  const queue = buildDailyQueue([...batch('math', 3), ...batch('systems', 3), ...batch('history', 3)]);
  assert.equal(queue.length, 9);
  assert.equal(adjacentRepeats(queue), 0);
});

test('every concept appears exactly once', () => {
  const input = [...batch('math', 4), ...batch('systems', 2), ...batch('history', 7)];
  const queue = buildDailyQueue(input);
  assert.equal(queue.length, input.length);
  assert.deepEqual(
    queue.map((n) => n.id).sort(),
    input.map((n) => n.id).sort(),
  );
});

test('a dominant category is spread as thinly as arithmetic allows', () => {
  // 6 math + 2 systems: at best math appears in 3 adjacent pairs.
  const queue = buildDailyQueue([...batch('math', 6), ...batch('systems', 2)]);
  assert.equal(adjacentRepeats(queue), 3);
  assert.equal(queue[0].category, 'math', 'the deepest bucket goes first');
});

test('the greedy beats naive round-robin on a skewed queue', () => {
  const input = [...batch('math', 5), ...batch('systems', 1), ...batch('history', 1)];
  const queue = buildDailyQueue(input);
  // Naive cycling (math, systems, history, math, math, math, math) leaves 3
  // repeats; picking the deepest bucket each time leaves 2.
  assert.equal(adjacentRepeats(queue), 2);
});

test('within a topic the most overdue concept still comes first', () => {
  const old = concept('old', 'math', '2026-07-01T00:00:00Z');
  const recent = concept('recent', 'math', '2026-07-27T00:00:00Z');
  const other = concept('other', 'systems', '2026-07-20T00:00:00Z');
  const queue = buildDailyQueue([old, recent, other]);
  const math = queue.filter((n) => n.category === 'math').map((n) => n.title);
  assert.deepEqual(math, ['old', 'recent']);
});

test('a single category degrades to plain order rather than failing', () => {
  const input = batch('math', 4);
  const queue = buildDailyQueue(input);
  assert.deepEqual(queue.map((n) => n.title), input.map((n) => n.title));
  assert.equal(adjacentRepeats(queue), 3);
});

test('empty and single-item queues are handled', () => {
  assert.deepEqual(buildDailyQueue([]), []);
  assert.equal(buildDailyQueue([concept('solo', 'math')]).length, 1);
  assert.equal(adjacentRepeats([]), 0);
  assert.equal(adjacentRepeats([concept('solo', 'math')]), 0);
});

test('interleaveCategories does not mutate the grouping it was given', () => {
  const grouped = groupByCategory([...batch('math', 2), ...batch('systems', 2)]);
  interleaveCategories(grouped);
  assert.equal(grouped.get('math')!.length, 2);
  assert.equal(grouped.get('systems')!.length, 2);
});

test('buildQueueFor drops concepts that are not due yet', () => {
  const due = concept('due', 'math', '2026-07-01T00:00:00Z');
  const later = concept('later', 'systems', '2026-12-01T00:00:00Z');
  const queue = buildQueueFor([due, later], NOW);
  assert.deepEqual(queue.map((n) => n.title), ['due']);
});

test('interleaving holds at scale', () => {
  const queue = buildDailyQueue([
    ...batch('math', 20),
    ...batch('systems', 18),
    ...batch('history', 22),
  ]);
  assert.equal(queue.length, 60);
  assert.equal(adjacentRepeats(queue), 0);
});
