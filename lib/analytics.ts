// Analytics & memory decay modeler. Pure.
//
// Retrievability comes from the same FSRS forgetting curve the scheduler uses,
// so the graph the learner sees and the intervals they get cannot disagree.
import { fsrs, State } from 'ts-fsrs';
import { daysBetween, toCard } from './fsrs.ts';
import type { GraphNode, ReviewLog } from './types.ts';

const scheduler = fsrs();

/**
 * Probability of successful recall right now, 0..1. A card that has never been
 * reviewed has no memory to decay — it reads as 0 rather than 1.
 */
export function retrievability(node: GraphNode, now = new Date()): number {
  if (node.card.state === State.New || node.card.reps === 0) return 0;
  const r = scheduler.get_retrievability(toCard(node.card), now, false);
  return typeof r === 'number' && Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
}

export interface DecayPoint {
  day: number;
  retrievability: number;
}

/** The forgetting curve from today forward — what the learner is losing, and when. */
export function decayCurve(node: GraphNode, days = 60, now = new Date(), steps = 30): DecayPoint[] {
  const points: DecayPoint[] = [];
  const stride = Math.max(1, Math.round(days / steps));
  for (let day = 0; day <= days; day += stride) {
    const at = new Date(now.getTime() + day * 86_400_000);
    points.push({ day, retrievability: retrievability(node, at) });
  }
  return points;
}

/** Concepts whose recall probability has already fallen below the threshold. */
export function atRisk(nodes: GraphNode[], threshold = 0.7, now = new Date()): GraphNode[] {
  return nodes
    .filter((n) => n.card.reps > 0 && retrievability(n, now) < threshold)
    .sort((a, b) => retrievability(a, now) - retrievability(b, now));
}

/** Mean recall probability across everything that has been studied at all. */
export function averageRetention(nodes: GraphNode[], now = new Date()): number {
  const studied = nodes.filter((n) => n.card.reps > 0);
  if (studied.length === 0) return 0;
  return studied.reduce((sum, n) => sum + retrievability(n, now), 0) / studied.length;
}

export interface PromptTypeStat {
  promptType: string;
  attempts: number;
  passRate: number;
  medianMs: number;
  hintRate: number;
}

const PASSING_RATING = 3; // Rating.Good and above

export function allLogs(nodes: GraphNode[]): ReviewLog[] {
  return nodes.flatMap((n) => n.history);
}

/**
 * Which kinds of question the learner actually fails. Recognition-shaped
 * prompts flattering the learner is the whole trap this app exists to avoid,
 * so this is the number worth watching.
 */
export function byPromptType(nodes: GraphNode[]): PromptTypeStat[] {
  const grouped = new Map<string, ReviewLog[]>();
  for (const log of allLogs(nodes)) {
    const bucket = grouped.get(log.promptType);
    if (bucket) bucket.push(log);
    else grouped.set(log.promptType, [log]);
  }

  return [...grouped.entries()]
    .map(([promptType, logs]) => ({
      promptType,
      attempts: logs.length,
      passRate: logs.filter((l) => l.rating >= PASSING_RATING).length / logs.length,
      medianMs: median(logs.map((l) => l.timeTakenMs)),
      hintRate: logs.filter((l) => l.hintsUsed > 0).length / logs.length,
    }))
    .sort((a, b) => a.passRate - b.passRate);
}

export interface CategoryStat {
  category: string;
  concepts: number;
  reviews: number;
  retention: number;
  passRate: number;
}

export function byCategory(nodes: GraphNode[], now = new Date()): CategoryStat[] {
  const grouped = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const key = n.category || 'general';
    const bucket = grouped.get(key);
    if (bucket) bucket.push(n);
    else grouped.set(key, [n]);
  }

  return [...grouped.entries()]
    .map(([category, items]) => {
      const logs = allLogs(items);
      return {
        category,
        concepts: items.length,
        reviews: logs.length,
        retention: averageRetention(items, now),
        passRate: logs.length
          ? logs.filter((l) => l.rating >= PASSING_RATING).length / logs.length
          : 0,
      };
    })
    .sort((a, b) => a.retention - b.retention);
}

export interface DayBucket {
  /** Days before today; 0 is today. */
  daysAgo: number;
  reviews: number;
}

/** Review volume per day, oldest first — the study-consistency signal. */
export function reviewHistogram(nodes: GraphNode[], days = 30, now = new Date()): DayBucket[] {
  const buckets = Array.from({ length: days }, (_, i) => ({ daysAgo: days - 1 - i, reviews: 0 }));
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  for (const log of allLogs(nodes)) {
    const ago = Math.floor(daysBetween(new Date(log.at), endOfToday));
    if (ago >= 0 && ago < days) buckets[days - 1 - ago].reviews += 1;
  }
  return buckets;
}

export interface Summary {
  concepts: number;
  studied: number;
  reviews: number;
  passRate: number;
  hintRate: number;
  retention: number;
  atRisk: number;
  medianMs: number;
  currentStreak: number;
}

export function summarize(nodes: GraphNode[], now = new Date()): Summary {
  const logs = allLogs(nodes);
  return {
    concepts: nodes.length,
    studied: nodes.filter((n) => n.card.reps > 0).length,
    reviews: logs.length,
    passRate: logs.length ? logs.filter((l) => l.rating >= PASSING_RATING).length / logs.length : 0,
    hintRate: logs.length ? logs.filter((l) => l.hintsUsed > 0).length / logs.length : 0,
    retention: averageRetention(nodes, now),
    atRisk: atRisk(nodes, 0.7, now).length,
    medianMs: median(logs.map((l) => l.timeTakenMs)),
    currentStreak: currentStreak(nodes, now),
  };
}

/** Consecutive days ending today (or yesterday) with at least one review. */
export function currentStreak(nodes: GraphNode[], now = new Date()): number {
  const days = new Set(allLogs(nodes).map((l) => dayKey(new Date(l.at))));
  if (days.size === 0) return 0;

  let streak = 0;
  const cursor = new Date(now);
  // A streak survives until today is over, so start from yesterday if nothing
  // has been reviewed yet today.
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
