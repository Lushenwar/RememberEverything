# Remember Everything

A memory engine that ingests raw material, chunks it into a connected knowledge
graph, draws each concept, interrogates you on it Socratically, and schedules
reviews with FSRS.

It is not a flashcard app. There are no multiple-choice questions and nothing
to flip over — every prompt is open-ended, and answers are graded against the
source you actually ingested.

## Quickstart

```sh
npm install
npm run hooks   # branch + PR enforcement (see below)
npm run dev
```

Open <http://localhost:3000>, paste something into **Ingest**, and review it.

**No API key is required.** Every LLM-backed path has a deterministic fallback,
so ingestion, diagrams, tutoring, scheduling, and analytics all work offline.
Set `ANTHROPIC_API_KEY` to upgrade the three places a model genuinely helps:

| Feature | Without a key | With a key |
| --- | --- | --- |
| Chunking | Heading/paragraph splitter | Concepts extracted with explicit relationships |
| Diagrams | Concept-and-neighbours graph | Structure of the concept itself |
| Grading | Stage-aware heuristics | Grounded assessor: false assumptions, unverified analogies, jargon |

Copy `.env.example` to `.env.local` and fill in what you want.

## Commands

```sh
npm run dev     # dev server
npm test        # 100+ tests, node --test, no framework
npm run build   # production build
npm run lint
npm run hooks   # point git at .githooks (rejects commits on main)
```

## Architecture

Engine modules in `lib/` are pure and take `now`, `rng`, and both sides of a
merge as arguments. That is what makes scheduling, interleaving, decay, and
sync conflict resolution testable with no network, no browser, and no API key.

| Module | Does |
| --- | --- |
| `ingestion.ts` / `chunker.ts` | Raw text → connected, classified concepts |
| `moe_router.ts` | Subject topology → which cognitive strategies to weight |
| `dualcoding.ts` / `diagram.ts` | Mermaid generation, sanitising, fallbacks |
| `interrogation_graph.ts` | Socratic state machine, prompts, answer-leak guard |
| `assessment.ts` | Grading against the source; jargon detection |
| `prompts.ts` | Four recall prompt types, weighted and non-repeating |
| `fsrs.ts` | Friction → rating → next interval |
| `queue.ts` | Interleaves topics so practice is never blocked |
| `sync.ts` | Last-write-wins merge on review time |
| `analytics.ts` | Forgetting curve, decay, per-prompt-type weak spots |

State lives in IndexedDB (`lib/db.ts`). All LLM calls go through
`app/api/llm/route.ts` so the key never reaches the browser.

## Sync

`/api/sync` reads and overwrites the whole graph, so it **fails closed**: with
no `SYNC_SECRET` set on the server, sync is disabled rather than public. Set it,
then enter the same passphrase under **Settings** on each device. The passphrase
is stored in that browser's IndexedDB and is never bundled into the app.

Conflicts resolve last-write-wins on the **review timestamp**, not on arrival
order — a device that was offline for an hour cannot overwrite newer work when
it reconnects.

## Backup

The graph lives in one browser's IndexedDB; clearing site data destroys it.
**Settings → Export** writes a JSON file. Importing merges by the same
last-write-wins rule, so restoring a backup never rolls back concepts you have
reviewed since.

## Workflow

No direct commits to `main`. Branch → commit → PR. `npm run hooks` points git
at `.githooks/`, whose `pre-commit` rejects commits made on `main`.

The full specification is in [CLAUDE.md](./CLAUDE.md).
