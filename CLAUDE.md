# CLAUDE.md — Memory Engine Orchestrator

## WORKFLOW: BRANCH + PR ONLY

No direct commits to `main`. Every change goes: `git checkout -b <branch>` → commit → `gh pr create`. A pre-commit hook (`.git/hooks/pre-commit`) enforces this locally by rejecting commits made while on `main`.

## CURRENT STATUS

```text
╔══════════════════════════════════════════════════════════╗
║  BUILD PROGRESS                             10/10 DONE   ║
║  ██████████████████████████████  ALL PHASES COMPLETE     ║
║  Phase 0: Base App & Graph Setup                [DONE]   ║
║  Phase 1: Concept Chunking & Ingestion          [DONE]   ║
║  Phase 2: Dual Coding Auto-Generation           [DONE]   ║
║  Phase 3: Socratic Feynman Tutor Core           [DONE]   ║
║  Phase 4: Elaborative Assessment Engine         [DONE]   ║
║  Phase 5: Multi-Modal Prompt Generator          [DONE]   ║
║  ── hardening ──────────────────────────────────────     ║
║  Phase 6: FSRS Spaced Repetition Engine         [DONE]   ║
║  Phase 7: Context-Switched Interleaving         [DONE]   ║
║  Phase 8: Offline PWA & Sync Capabilities       [DONE]   ║
║  Phase 9: Analytics & Memory Decay Modeler      [DONE]   ║
╚══════════════════════════════════════════════════════════╝
```

Phase: Complete
Status: All ten phases implemented and verified. 103 tests green via `npm test`,
production build clean.

No test is skipped or dormant. The engine modules are pure and take `now`,
`rng`, and both sides of a merge as arguments, so every check — scheduling,
interleaving, decay, sync conflict resolution — runs offline with no network,
no browser, and no API key.

Every LLM-backed path has a deterministic fallback, so the whole app is
functional without ANTHROPIC_API_KEY; set it to enable grounded extraction,
diagram generation, and the elaborative assessor.

Update this as you finish each step.

## WHAT THIS FILE IS

This document is the authoritative technical specification for building the Remember Everything memory engine. Every architectural decision, cognitive science translation, prompt strategy, and state machine transition defined here is binding. Do not deviate without explicit user approval.

---

## PRODUCT DEFINITION

The Remember Everything Memory Engine is a cross-platform (Web-first PWA) application designed to optimize long-term memory encoding and retrieval using evidence-based cognitive science principles. It ingests raw material, transforms it into dual-coded visual structures, enforces the Feynman technique via a Socratic AI agent, and schedules reviews using a dynamic FSRS-based spaced repetition algorithm.

### What the Orchestrator IS:

* A cognitive translation engine that applies Active Recall, Spaced Repetition, Elaborative Encoding, Interleaving, and Dual Coding/Chunking.
* A multi-modal practice platform featuring visual node graphs, Socratic text/voice dialogue, and varied prompt generation.
* An autonomous multi-agent pipeline routing cognitive strategies based on subject topology.

### What the Orchestrator IS NOT:

* Not a passive flashcard app (e.g., Anki clone). It does not rely on simple text-to-text memorization.
* Not a general-purpose note-taking tool (e.g., Notion).
* Not a simple LLM wrapper. The LLM is orchestrating specific, constrained cognitive tasks (routing, jargon detection, Socratic questioning, diagram generation).

---

## SYSTEM ARCHITECTURE & DATA FLOW

```text
                           ┌────────────────────────────────┐
                           │      Raw Content Input         │
                           │   (Text, Links, Lecture Notes) │
                           └──────────────┬─────────────────┘
                                          │ (Auto-Classification & Extraction)
┌─────────────────────────────────────────▼────────────────────────────────────────┐
│                   MoE Cognitive Router (Subject Classifier)                      │
│ Determines optimal cognitive strategy weighting based on subject topology:       │
│ - STEM/Math -> High Interleaving & Active Recall                                 │
│ - Theory/Concepts -> High Elaborative Encoding (Feynman)                         │
│ - Systems/History -> High Dual Coding & Chunking                                 │
└─────────────────────────────────────────┬────────────────────────────────────────┘
                                          │
                                          ▼
┌───────────────────────────┐      ┌───────────────────────────────┐
│ Dual Coding Generator     ├─────►│  Knowledge Graph (IndexedDB)  │
│ (Visuals via LLM)         │      │  (Nodes, Edges, Primitives)   │
└───────────────────────────┘      └──────────────┬────────────────┘
                                                  │
                                                  ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                   Interrogation AI Pipeline (State Graph)                      │
│                                                                                │
│  [ Clarification ] ──> [ Assumption Test ] ──> [ Causal ] ──> [ Edge Case ]    │
│                                                                                │
│  Dynamically selects Socratic mode based on user response accuracy.            │
└──────────────┬─────────────────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      FSRS Scheduling Queue                       │
│             (Dynamic Intervals based on friction/confidence)     │
└──────────────────────────────────────────────────────────────────┘
```

---

## CORE TECHNICAL SPECIFICATION & IMPLEMENTATION PATTERNS

### 1. Ingestion & Auto-Classification Engine (`engine/ingestion.ts`)

Converts raw text into a Structured Knowledge Graph and automatically classifies the subject topology to inform the MoE router.

```typescript
import { ContentParser, GraphNode, SubjectTopology } from '@engine/types';

export async function processRawContent(rawText: string): Promise<{ nodes: GraphNode[], topology: SubjectTopology }> {
  // 1. LLM pass: Auto-classify the domain and extract concepts
  const { topology, concepts } = await analyzeAndExtractWithLLM(rawText);

  // 2. LLM pass: Generate visual representations (Dual Coding)
  const nodes = await Promise.all(concepts.map(async (concept) => {
    const mermaidSyntax = await generateMermaidDiagram(concept);
    return {
      id: generateId(),
      title: concept.title,
      summary: concept.simpleDefinition,
      visualSchema: mermaidSyntax,
      dependencies: concept.relatedConceptIds
    };
  }));

  return { nodes, topology };
}
```

### 2. MoE Cognitive Router (`engine/moe_router.ts`)

Dynamically routes the learning session to the most effective cognitive "expert" based on the auto-classified subject matter.

```typescript
export enum CognitiveExpert {
  ActiveRecall = 'ACTIVE_RECALL',
  SpacedRepetition = 'SPACED_REPETITION',
  ElaborativeEncoding = 'ELABORATIVE_ENCODING',
  Interleaving = 'INTERLEAVING',
  DualCoding = 'DUAL_CODING'
}

export function routeSessionStrategy(topology: SubjectTopology): CognitiveExpert[] {
  // Map specific cognitive strategies to the structure of the data
  if (topology.type === 'ALGORITHMIC' || topology.type === 'MATH') {
    return [CognitiveExpert.Interleaving, CognitiveExpert.ActiveRecall];
  } 
  if (topology.type === 'THEORETICAL') {
    return [CognitiveExpert.ElaborativeEncoding, CognitiveExpert.DualCoding];
  }
  // Default structural fallback
  return [CognitiveExpert.SpacedRepetition, CognitiveExpert.ActiveRecall];
}
```

### 3. Interrogation AI State Graph (`engine/interrogation_graph.ts`)

A directed state machine that orchestrates the Feynman technique. It evaluates user input and transitions through a rigid pipeline: `Clarification ──> Assumption Test ──> Causal "Why?" ──> Edge Case / Counter`.

```typescript
export enum SocraticMode {
  Classical = 'CLASSICAL_SOCRATIC',       // Trigger: False assumption / Missed edge case
  Elaborative = 'ELABORATIVE_INTERROGATION', // Trigger: Correct answer given
  GuidedDiscovery = 'GUIDED_DISCOVERY'       // Trigger: User is stuck / blanking
}

export async function processUserExplanation(userInput: string, concept: GraphNode): Promise<AgentResponse> {
  const evaluation = await evaluateUnderstanding(userInput, concept);
  
  // 1. User makes a false assumption -> Dismantle it
  if (evaluation.hasFalseAssumption || evaluation.missedEdgeCase) {
    return triggerAgent(SocraticMode.Classical, {
      instruction: "Dismantle the assumption using a counter-example. Do not give the answer."
    });
  }
  
  // 2. User gets stuck -> Nudge them
  if (evaluation.isStuck) {
    return triggerAgent(SocraticMode.GuidedDiscovery, {
      instruction: "Provide a minimal constraint or hint to keep them moving forward."
    });
  }

  // 3. User is correct -> Deepen retention
  if (evaluation.isCorrect) {
    return triggerAgent(SocraticMode.Elaborative, {
      instruction: "They answered correctly. Now force them to explain the causal 'Why?' behind it."
    });
  }
}
```

### 4. Multi-Modal Active Recall Generator (`engine/prompts.ts`)

Generates diverse prompt types to prevent rote memorization of the question itself.

```typescript
export enum PromptType {
  Structural = 'STRUCTURAL', // Draw/complete diagram
  Causal = 'CAUSAL',         // Why does X happen?
  BlankPage = 'BLANK_PAGE',  // Recall principles without context
  CounterExample = 'COUNTER' // What if edge case occurs?
}

export function generateReviewPrompt(node: GraphNode): ReviewSession {
  const type = selectRandomPromptType();
  switch(type) {
     case PromptType.Structural:
       return buildDiagramPrompt(node);
     // ... other cases based on cognitive routing
  }
}
```

### 5. FSRS Spaced Repetition Engine (`engine/fsrs.ts`)

Calculates the next optimal review date based on user performance friction.

```typescript
import { fsrs, Rating, RecordLogItem } from 'ts-fsrs';

export function calculateNextReview(
    currentCardState: Card, 
    timeTakenMs: number, 
    hintsUsed: number
): RecordLogItem {
    let rating = Rating.Good;
    if (hintsUsed > 2 || timeTakenMs > 60000) rating = Rating.Again;
    else if (hintsUsed > 0) rating = Rating.Hard;
    else if (timeTakenMs < 10000) rating = Rating.Easy;

    const f = fsrs();
    const schedulingCards = f.repeat(currentCardState, new Date());
    
    return schedulingCards[rating];
}
```

### 6. Interleaved Queue Manager (`engine/queue.ts`)

Prevents sequential studying of the same topic.

```typescript
export function buildDailyQueue(dueCards: Card[]): Card[] {
    const grouped = groupByCategory(dueCards);
    return interleaveCategories(grouped); 
}
```

---

## DANGER ZONES — TRAPS TO AVOID

1. **Passive Recognition Trap:** Do not default to multiple-choice questions or simple flashcards. **Fix:** Force open-ended text input or voice transcription for the Feynman Assessor.
2. **LLM Hallucination on Assessment:** The Socratic agent must not accept incorrect analogies as factual. **Fix:** Ground the agent's context window strictly in the original ingested raw content; provide explicit system instructions to verify analogies against the source truth.
3. **Over-Chunking:** Creating hundreds of tiny, disconnected nodes fragments the knowledge graph. **Fix:** Ensure the ingestion engine maps relationships (edges) between chunks, requiring a minimum density of connections.
4. **Mobile UX Friction:** Forcing users to type long Feynman explanations on a mobile keyboard will destroy retention. **Fix:** Integrate Web Speech API for voice-to-text input during the mobile review flow.
5. **Sync Conflicts (Offline PWA):** If a user reviews on mobile offline and studies on desktop simultaneously, FSRS states will clash. **Fix:** Implement a robust Last-Write-Wins (LWW) resolution based on the review timestamp, caching updates in IndexedDB until sync is established.
6. **The Interrogation Collapse:** The LLM will naturally want to validate the user and just give them the right answer when they struggle. **Fix:** The `GuidedDiscovery` mode must have a hard constraint in its system prompt forbidding the output of the target concept name or core mechanism. It is only allowed to ask pointing questions.

---

## IMPLEMENTATION NOTES (build-time decisions)

* **Stack:** Next.js 16 (App Router) + TypeScript + Tailwind 4. Engine modules live in
  `lib/` rather than `engine/` so the `@/` alias and Next's bundler resolve them without
  extra config; filenames match the spec (`lib/ingestion.ts`, `lib/moe_router.ts`, …).
* **Tests:** `node --test` on `lib/**/*.test.ts` using Node's native TypeScript stripping.
  No Jest/Vitest dependency.
* **LLM:** all model calls go through the server route `app/api/llm/route.ts` so
  `ANTHROPIC_API_KEY` never reaches the browser. Every LLM-backed engine function has a
  deterministic heuristic fallback, so the app and its tests are fully functional with no
  key configured.
