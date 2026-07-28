import assert from 'node:assert/strict';
import test from 'node:test';
import {
  atRisk,
  averageRetention,
  byCategory,
  byPromptType,
  currentStreak,
  decayCurve,
  median,
  retrievability,
  reviewHistogram,
  summarize,
} from './analytics.ts';
import { applyReview } from './fsrs.ts';
import { emptyCard, newNode } from './graph.ts';
import type { GraphNode } from './types.ts';

const NOW = new Date('2026-07-28T12:00:00.000Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function concept(title: string, category = 'ds'): GraphNode {
  const n = newNode({ title, summary: 's', sourceText: 'src', category });
  n.card = emptyCard(NOW);
  return n;
}

const pass = (n: GraphNode, at = NOW) =>
  applyReview(n, { timeTakenMs: 5_000, hintsUsed: 0, promptType: 'CAUSAL', isCorrect: true }, at);
const fail = (n: GraphNode, at = NOW) =>
  applyReview(n, { timeTakenMs: 70_000, hintsUsed: 3, promptType: 'BLANK_PAGE', isCorrect: false }, at);

test('an unreviewed concept has no memory to decay', () => {
  assert.equal(retrievability(concept('a'), NOW), 0);
  assert.equal(averageRetention([concept('a')], NOW), 0);
});

test('retrievability decays monotonically after a review', () => {
  const reviewed = pass(concept('a'), day(0));
  const today = retrievability(reviewed, NOW);
  const week = retrievability(reviewed, new Date(NOW.getTime() + 7 * 86_400_000));
  const year = retrievability(reviewed, new Date(NOW.getTime() + 365 * 86_400_000));

  assert.ok(today > 0.9, `just-reviewed should be near-certain, got ${today}`);
  assert.ok(week < today, 'must decay over a week');
  assert.ok(year < week, 'must keep decaying over a year');
  assert.ok(year >= 0);
});

test('decayCurve starts high, ends lower, and stays in range', () => {
  const curve = decayCurve(pass(concept('a')), 60, NOW, 30);
  assert.ok(curve.length > 1);
  assert.equal(curve[0].day, 0);
  assert.ok(curve.at(-1)!.retrievability < curve[0].retrievability);
  for (const p of curve) {
    assert.ok(p.retrievability >= 0 && p.retrievability <= 1, `out of range: ${p.retrievability}`);
  }
});

test('atRisk finds decayed concepts, weakest first, and ignores unstudied ones', () => {
  const fresh = pass(concept('fresh'), NOW);
  const stale = pass(concept('stale'), day(120));
  const never = concept('never');

  const risky = atRisk([fresh, stale, never], 0.7, NOW);
  assert.deepEqual(risky.map((n) => n.title), ['stale']);
  // Raising the threshold can only widen the set; it never picks up `never`.
  assert.ok(atRisk([fresh, stale, never], 0.99, NOW).length >= risky.length);
  assert.equal(atRisk([fresh, stale, never], 0, NOW).length, 0);
  assert.ok(!atRisk([fresh, stale, never], 0.99, NOW).some((n) => n.title === 'never'));
});

test('byPromptType ranks the weakest prompt type first', () => {
  let a = concept('a');
  // Chronological order: FSRS is a stateful timeline, not a bag of events.
  a = applyReview(a, { timeTakenMs: 5_000, hintsUsed: 0, promptType: 'CAUSAL', isCorrect: true }, day(3));
  a = applyReview(a, { timeTakenMs: 5_000, hintsUsed: 0, promptType: 'CAUSAL', isCorrect: true }, day(2));
  a = applyReview(a, { timeTakenMs: 70_000, hintsUsed: 3, promptType: 'BLANK_PAGE', isCorrect: false }, day(1));

  const stats = byPromptType([a]);
  assert.equal(stats[0].promptType, 'BLANK_PAGE', 'worst pass rate comes first');
  assert.equal(stats[0].passRate, 0);
  assert.equal(stats[0].hintRate, 1);
  assert.equal(stats[1].promptType, 'CAUSAL');
  assert.equal(stats[1].passRate, 1);
  assert.equal(stats[1].attempts, 2);
});

test('byCategory surfaces the weakest topic first', () => {
  const strong = pass(concept('strong', 'math'), NOW);
  const weak = pass(concept('weak', 'systems'), day(200));
  const stats = byCategory([strong, weak], NOW);
  assert.equal(stats[0].category, 'systems');
  assert.equal(stats[0].concepts, 1);
  assert.equal(stats[0].reviews, 1);
  assert.ok(stats[0].retention < stats[1].retention);
});

test('byCategory handles a topic with no reviews yet', () => {
  const [stat] = byCategory([concept('untouched', 'new-topic')], NOW);
  assert.equal(stat.reviews, 0);
  assert.equal(stat.passRate, 0);
  assert.equal(stat.retention, 0);
});

test('reviewHistogram buckets by day, oldest first', () => {
  let n = concept('a');
  n = pass(n, day(2));
  n = pass(n, day(0));
  n = pass(n, day(0));

  const hist = reviewHistogram([n], 7, NOW);
  assert.equal(hist.length, 7);
  assert.equal(hist[0].daysAgo, 6, 'oldest bucket first');
  assert.equal(hist.at(-1)!.daysAgo, 0);
  assert.equal(hist.at(-1)!.reviews, 2, 'two reviews today');
  assert.equal(hist.find((b) => b.daysAgo === 2)!.reviews, 1);
  assert.equal(hist.find((b) => b.daysAgo === 1)!.reviews, 0);
});

test('reviewHistogram drops reviews outside the window', () => {
  const old = pass(concept('a'), day(90));
  assert.equal(reviewHistogram([old], 7, NOW).reduce((s, b) => s + b.reviews, 0), 0);
});

test('currentStreak counts consecutive days and survives a gap only at the front', () => {
  let n = concept('a');
  n = pass(n, day(2));
  n = pass(n, day(1));
  n = pass(n, day(0));
  assert.equal(currentStreak([n], NOW), 3);

  // Nothing today yet, but yesterday counted — the streak is still alive.
  let m = concept('b');
  m = pass(m, day(2));
  m = pass(m, day(1));
  assert.equal(currentStreak([m], NOW), 2);

  // A two-day gap breaks it.
  let o = concept('c');
  o = pass(o, day(4));
  o = pass(o, day(3));
  assert.equal(currentStreak([o], NOW), 0);
  assert.equal(currentStreak([concept('d')], NOW), 0);
});

test('summarize reports the whole picture without dividing by zero', () => {
  const empty = summarize([], NOW);
  assert.equal(empty.reviews, 0);
  assert.equal(empty.passRate, 0);
  assert.equal(empty.retention, 0);
  assert.equal(empty.medianMs, 0);
  assert.equal(empty.currentStreak, 0);

  let a = pass(concept('a'), day(1));
  a = fail(a, day(0));
  const s = summarize([a, concept('untouched')], NOW);
  assert.equal(s.concepts, 2);
  assert.equal(s.studied, 1);
  assert.equal(s.reviews, 2);
  assert.equal(s.passRate, 0.5);
  assert.equal(s.hintRate, 0.5);
  assert.equal(s.medianMs, 37_500);
});

test('median handles both parities and empty input', () => {
  assert.equal(median([]), 0);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});
