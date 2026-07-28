// Shared domain types for the Remember Everything memory engine.

export type TopologyType =
  | 'ALGORITHMIC'
  | 'MATH'
  | 'THEORETICAL'
  | 'SYSTEMS'
  | 'HISTORY'
  | 'LANGUAGE';

export interface SubjectTopology {
  type: TopologyType;
  /** 0..1 — how sure the classifier is. */
  confidence: number;
  label: string;
}

export enum CognitiveExpert {
  ActiveRecall = 'ACTIVE_RECALL',
  SpacedRepetition = 'SPACED_REPETITION',
  ElaborativeEncoding = 'ELABORATIVE_ENCODING',
  Interleaving = 'INTERLEAVING',
  DualCoding = 'DUAL_CODING',
}

/** FSRS card state, serialisable (ts-fsrs uses Date objects; we store ISO). */
export interface StoredCard {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string;
}

export interface ReviewLog {
  at: number;
  rating: number;
  timeTakenMs: number;
  hintsUsed: number;
  promptType: string;
  /** Interval in days the scheduler handed out after this review. */
  intervalDays: number;
}

export interface GraphNode {
  id: string;
  title: string;
  summary: string;
  /** Mermaid source for the dual-coded visual. */
  visualSchema: string;
  /** Ids of concepts this one depends on / relates to. */
  dependencies: string[];
  /** Interleaving bucket — usually the source document or subtopic. */
  category: string;
  /** Verbatim source excerpt. Grounds the Socratic agent (danger zone 2). */
  sourceText: string;
  topology: TopologyType;
  createdAt: number;
  card: StoredCard;
  history: ReviewLog[];
}

export interface GraphEdge {
  from: string;
  to: string;
}
