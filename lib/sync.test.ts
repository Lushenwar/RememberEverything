import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReview } from './fsrs.ts';
import { emptyCard, newNode } from './graph.ts';
import { changedSince, lastTouched, mergeByLWW, pickWinner } from './sync.ts';
import type { GraphNode } from './types.ts';

const T0 = new Date('2026-07-28T09:00:00.000Z');
const DESKTOP = new Date('2026-07-28T10:00:00.000Z');
const MOBILE = new Date('2026-07-28T11:00:00.000Z');

function concept(id: string, createdAt = T0.getTime()): GraphNode {
  const n = newNode({ title: id, summary: 's', sourceText: 'src', category: 'ds' });
  n.id = id;
  n.createdAt = createdAt;
  n.card = emptyCard(T0);
  return n;
}

const review = (n: GraphNode, at: Date, isCorrect = true) =>
  applyReview(n, { timeTakenMs: 5_000, hintsUsed: 0, promptType: 'CAUSAL', isCorrect }, at);

test('lastTouched prefers review time over creation time', () => {
  const fresh = concept('a');
  assert.equal(lastTouched(fresh), T0.getTime());
  assert.equal(lastTouched(review(fresh, MOBILE)), MOBILE.getTime());
});

test('a reviewed copy always beats an untouched one', () => {
  const untouched = concept('a');
  const reviewed = review(untouched, DESKTOP);
  assert.equal(pickWinner(untouched, reviewed).history.length, 1);
  assert.equal(pickWinner(reviewed, untouched).history.length, 1);
});

test('offline mobile review beats an earlier desktop review (danger zone 5)', () => {
  const base = concept('raft');
  const desktop = review(base, DESKTOP);
  const mobileOffline = review(base, MOBILE);

  // Mobile reconnects last, but the rule is review time, not arrival order.
  const { merged, conflicts } = mergeByLWW([desktop], [mobileOffline]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].card.last_review, MOBILE.toISOString());
  assert.deepEqual(conflicts, ['raft']);
});

test('a stale device reconnecting late cannot overwrite newer work', () => {
  const base = concept('raft');
  const newer = review(base, MOBILE);
  const stale = review(base, DESKTOP);

  // Same pair, opposite push order — must resolve identically.
  const a = mergeByLWW([newer], [stale]).merged[0];
  const b = mergeByLWW([stale], [newer]).merged[0];
  assert.equal(a.card.last_review, MOBILE.toISOString());
  assert.equal(b.card.last_review, MOBILE.toISOString());
});

test('divergent FSRS state resolves to one card, not a blend', () => {
  const base = concept('raft');
  const failedOnDesktop = review(base, DESKTOP, false);
  const passedOnMobile = review(base, MOBILE, true);
  const winner = mergeByLWW([failedOnDesktop], [passedOnMobile]).merged[0];

  assert.equal(winner.history.length, 1, 'histories must not be concatenated');
  assert.equal(winner.card.due, passedOnMobile.card.due);
  assert.equal(winner.card.lapses, passedOnMobile.card.lapses);
});

test('merge unions both sides and only flags real conflicts', () => {
  const shared = concept('shared');
  const local = [review(shared, DESKTOP), concept('local-only')];
  const remote = [review(shared, MOBILE), concept('remote-only')];

  const { merged, conflicts } = mergeByLWW(local, remote);
  assert.deepEqual(merged.map((n) => n.id).sort(), ['local-only', 'remote-only', 'shared']);
  assert.deepEqual(conflicts, ['shared'], 'concepts present on one side only are not conflicts');
});

test('identical timestamps resolve deterministically rather than flapping', () => {
  const base = concept('raft');
  const a = review(base, DESKTOP);
  const b = review(a, DESKTOP); // same instant, one more review
  assert.equal(pickWinner(a, b).history.length, 2, 'tie breaks toward more reviews');
  assert.equal(pickWinner(b, a).history.length, 2);
});

test('merging with an empty side is a no-op in both directions', () => {
  const local = [concept('a'), concept('b')];
  assert.equal(mergeByLWW(local, []).merged.length, 2);
  assert.equal(mergeByLWW([], local).merged.length, 2);
  assert.deepEqual(mergeByLWW(local, []).conflicts, []);
});

test('changedSince selects only what a device still owes the server', () => {
  const untouched = concept('a');
  const reviewed = review(concept('b'), MOBILE);
  const since = DESKTOP.getTime();
  assert.deepEqual(changedSince([untouched, reviewed], since).map((n) => n.id), ['b']);
  assert.equal(changedSince([untouched, reviewed], MOBILE.getTime()).length, 0);
});

test('merge survives the JSON round trip a real sync performs', () => {
  const base = concept('raft');
  const local = review(base, DESKTOP);
  const remote: GraphNode[] = JSON.parse(JSON.stringify([review(base, MOBILE)]));
  const { merged } = mergeByLWW([local], remote);
  assert.equal(merged[0].card.last_review, MOBILE.toISOString());
  assert.equal(typeof merged[0].card.due, 'string');
});
