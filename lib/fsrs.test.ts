import assert from 'node:assert/strict';
import test from 'node:test';
import { Rating, State } from 'ts-fsrs';
import {
  applyReview,
  calculateNextReview,
  daysBetween,
  dueCounts,
  dueQueue,
  formatDue,
  frictionRating,
  isDue,
  toCard,
  toStored,
} from './fsrs.ts';
import { emptyCard, newNode } from './graph.ts';
import type { GraphNode } from './types.ts';

const NOW = new Date('2026-07-28T12:00:00.000Z');

function concept(title = 'Raft'): GraphNode {
  const n = newNode({ title, summary: 's', sourceText: 'src' });
  n.card = emptyCard(NOW);
  return n;
}

test('friction maps to ratings exactly as specified', () => {
  assert.equal(frictionRating(5_000, 0), Rating.Easy);
  assert.equal(frictionRating(30_000, 0), Rating.Good);
  assert.equal(frictionRating(30_000, 1), Rating.Hard);
  assert.equal(frictionRating(5_000, 1), Rating.Hard, 'hints outrank a fast answer');
  assert.equal(frictionRating(30_000, 3), Rating.Again);
  assert.equal(frictionRating(61_000, 0), Rating.Again);
  assert.equal(frictionRating(5_000, 3), Rating.Again, 'hints outrank speed at the top too');
});

test('a wrong answer is Again no matter how fast it arrived', () => {
  const card = toCard(concept().card);
  const fast = calculateNextReview(card, 2_000, 0, NOW, false);
  assert.equal(fast.log.rating, Rating.Again);
  const honest = calculateNextReview(card, 2_000, 0, NOW, true);
  assert.equal(honest.log.rating, Rating.Easy);
  assert.ok(honest.card.due.getTime() > fast.card.due.getTime());
});

test('better recall buys a longer interval', () => {
  const card = toCard(concept().card);
  const again = calculateNextReview(card, 90_000, 0, NOW).card.due.getTime();
  const hard = calculateNextReview(card, 30_000, 1, NOW).card.due.getTime();
  const good = calculateNextReview(card, 30_000, 0, NOW).card.due.getTime();
  const easy = calculateNextReview(card, 3_000, 0, NOW).card.due.getTime();
  assert.ok(again <= hard && hard <= good && good < easy, `${again} ${hard} ${good} ${easy}`);
});

test('card serialisation round-trips through IndexedDB-safe JSON', () => {
  const stored = concept().card;
  const round = toStored(toCard(stored));
  assert.deepEqual(round, stored);
  // Survives an actual JSON hop, which is what IndexedDB and sync do.
  const viaJson = toStored(toCard(JSON.parse(JSON.stringify(stored))));
  assert.deepEqual(viaJson, stored);
  assert.equal(typeof round.due, 'string');
});

test('last_review survives the round trip once a card has been reviewed', () => {
  const reviewed = applyReview(concept(), { timeTakenMs: 5_000, hintsUsed: 0, promptType: 'CAUSAL', isCorrect: true }, NOW);
  assert.equal(reviewed.card.last_review, NOW.toISOString());
  assert.deepEqual(toStored(toCard(reviewed.card)), reviewed.card);
});

test('applyReview advances the card and appends one history entry', () => {
  const before = concept();
  const after = applyReview(
    before,
    { timeTakenMs: 4_000, hintsUsed: 0, promptType: 'BLANK_PAGE', isCorrect: true },
    NOW,
  );
  assert.equal(after.history.length, 1);
  assert.equal(before.history.length, 0, 'must not mutate the input node');
  assert.equal(after.card.reps, 1);
  assert.notEqual(after.card.state, State.New);

  const log = after.history[0];
  assert.equal(log.rating, Rating.Easy);
  assert.equal(log.promptType, 'BLANK_PAGE');
  assert.equal(log.at, NOW.getTime());
  assert.ok(log.intervalDays > 0);
  assert.equal(log.intervalDays, daysBetween(NOW, new Date(after.card.due)));
});

test('a lapse increments lapses and pulls the card back in', () => {
  let n = concept();
  for (let i = 0; i < 3; i++) {
    n = applyReview(n, { timeTakenMs: 3_000, hintsUsed: 0, promptType: 'CAUSAL', isCorrect: true }, NOW);
  }
  const graduated = new Date(n.card.due);
  const lapsed = applyReview(
    n,
    { timeTakenMs: 3_000, hintsUsed: 0, promptType: 'CAUSAL', isCorrect: false },
    graduated,
  );
  assert.equal(lapsed.card.lapses, n.card.lapses + 1);
  assert.ok(daysBetween(graduated, new Date(lapsed.card.due)) < daysBetween(NOW, graduated));
});

test('new cards are due immediately; scheduled ones are not', () => {
  const fresh = concept();
  assert.ok(isDue(fresh, NOW));
  const scheduled = applyReview(fresh, { timeTakenMs: 3_000, hintsUsed: 0, promptType: 'CAUSAL', isCorrect: true }, NOW);
  assert.equal(isDue(scheduled, NOW), false);
  assert.ok(isDue(scheduled, new Date(scheduled.card.due)), 'due exactly at the due instant');
});

test('dueQueue returns only due cards, most overdue first', () => {
  const a = concept('a');
  const b = concept('b');
  const c = concept('c');
  a.card = { ...a.card, due: new Date('2026-07-20T00:00:00Z').toISOString() };
  b.card = { ...b.card, due: new Date('2026-07-25T00:00:00Z').toISOString() };
  c.card = { ...c.card, due: new Date('2026-08-30T00:00:00Z').toISOString() };

  assert.deepEqual(dueQueue([b, c, a], NOW).map((n) => n.title), ['a', 'b']);
  assert.deepEqual(dueQueue([], NOW), []);
});

test('dueCounts breaks the graph down by scheduling state', () => {
  const fresh = concept('fresh');
  const learning = applyReview(concept('learning'), { timeTakenMs: 3_000, hintsUsed: 0, promptType: 'CAUSAL', isCorrect: true }, NOW);
  const counts = dueCounts([fresh, learning], NOW);
  assert.equal(counts.total, 2);
  assert.equal(counts.fresh, 1);
  assert.equal(counts.due, 1);
  assert.equal(counts.fresh + counts.learning + counts.review, counts.total);
});

test('formatDue reads naturally across the scale', () => {
  const n = concept();
  const at = (iso: string) => formatDue({ ...n, card: { ...n.card, due: iso } }, NOW);
  assert.equal(at('2026-07-28T11:00:00Z'), 'due now');
  assert.equal(at('2026-07-28T18:00:00Z'), 'due in 6h');
  assert.equal(at('2026-07-29T12:00:00Z'), 'due tomorrow');
  assert.equal(at('2026-08-07T12:00:00Z'), 'due in 10 days');
  assert.equal(at('2026-10-28T12:00:00Z'), 'due in 3 months');
});

test('daysBetween never goes negative', () => {
  assert.equal(daysBetween(NOW, new Date('2026-07-01T00:00:00Z')), 0);
  assert.equal(daysBetween(NOW, new Date('2026-07-29T12:00:00Z')), 1);
});
