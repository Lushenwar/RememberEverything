// FSRS spaced repetition engine (CLAUDE.md §5). Pure — the scheduler is the
// one part of this app that must be reproducible, so it takes `now` explicitly
// and never reads the clock itself.
import { fsrs, Rating, State, type Card, type Grade, type RecordLogItem } from 'ts-fsrs';
import type { GraphNode, ReviewLog, StoredCard } from './types.ts';

const scheduler = fsrs();

export function toCard(stored: StoredCard): Card {
  return {
    ...stored,
    due: new Date(stored.due),
    last_review: stored.last_review ? new Date(stored.last_review) : undefined,
  } as Card;
}

export function toStored(card: Card): StoredCard {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.toISOString() : undefined,
  };
}

/**
 * Friction → rating, exactly as specified. Slow or heavily hinted recall is a
 * failure even when the answer eventually arrives; instant recall is easy.
 */
export function frictionRating(timeTakenMs: number, hintsUsed: number): Grade {
  if (hintsUsed > 2 || timeTakenMs > 60000) return Rating.Again;
  if (hintsUsed > 0) return Rating.Hard;
  if (timeTakenMs < 10000) return Rating.Easy;
  return Rating.Good;
}

export function calculateNextReview(
  currentCardState: Card,
  timeTakenMs: number,
  hintsUsed: number,
  now = new Date(),
  /**
   * Not in the spec's signature, but a wrong answer produced in four seconds
   * would otherwise be scheduled as Easy. Correctness dominates friction.
   */
  isCorrect = true,
): RecordLogItem {
  const rating = isCorrect ? frictionRating(timeTakenMs, hintsUsed) : Rating.Again;
  return scheduler.repeat(currentCardState, now)[rating];
}

export interface Attempt {
  timeTakenMs: number;
  hintsUsed: number;
  promptType: string;
  isCorrect: boolean;
}

/** Reschedule a concept from one review attempt and append it to its history. */
export function applyReview(node: GraphNode, attempt: Attempt, now = new Date()): GraphNode {
  const item = calculateNextReview(
    toCard(node.card),
    attempt.timeTakenMs,
    attempt.hintsUsed,
    now,
    attempt.isCorrect,
  );

  const log: ReviewLog = {
    at: now.getTime(),
    rating: item.log.rating,
    timeTakenMs: attempt.timeTakenMs,
    hintsUsed: attempt.hintsUsed,
    promptType: attempt.promptType,
    intervalDays: daysBetween(now, item.card.due),
  };

  return { ...node, card: toStored(item.card), history: [...node.history, log] };
}

export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / 86_400_000);
}

export function isDue(node: GraphNode, now = new Date()): boolean {
  return new Date(node.card.due).getTime() <= now.getTime();
}

/** Due concepts, most overdue first. Phase 7 interleaves this ordering. */
export function dueQueue(nodes: GraphNode[], now = new Date()): GraphNode[] {
  return nodes
    .filter((n) => isDue(n, now))
    .sort((a, b) => new Date(a.card.due).getTime() - new Date(b.card.due).getTime());
}

export interface DueCounts {
  due: number;
  fresh: number;
  learning: number;
  review: number;
  total: number;
}

export function dueCounts(nodes: GraphNode[], now = new Date()): DueCounts {
  const due = dueQueue(nodes, now);
  return {
    due: due.length,
    fresh: nodes.filter((n) => n.card.state === State.New).length,
    learning: nodes.filter(
      (n) => n.card.state === State.Learning || n.card.state === State.Relearning,
    ).length,
    review: nodes.filter((n) => n.card.state === State.Review).length,
    total: nodes.length,
  };
}

/** "in 3 days" / "today" — for the concept and dashboard views. */
export function formatDue(node: GraphNode, now = new Date()): string {
  const days = daysBetween(now, new Date(node.card.due));
  if (days === 0) return 'due now';
  if (days < 1) return `due in ${Math.round(days * 24)}h`;
  if (days < 2) return 'due tomorrow';
  if (days < 30) return `due in ${Math.round(days)} days`;
  return `due in ${Math.round(days / 30)} months`;
}

export { Rating, State };
