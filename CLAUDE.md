# Claude Instructions

## Project Identity

Agent Memory Devtools is a local-first, debuggable, correctable memory system for AI coding agents. The product is not just retrieval; it is the full memory lifecycle: ingest, explain, replay, correct, suggest, score confidence, and detect conflicts.

## Current Feature Map

- Core memory: SQLite store, sessions, steps, memories, facts, events, embeddings, traces, decisions, mutations, feedback, rules, missing suggestions, usage, and conflicts.
- Ingestion: raw transcripts and JSON steps, normalization, chunking, classification, importance/confidence scoring, rules, dedupe, ignored decisions, merge decisions, replay traces.
- Retrieval: local keyword plus deterministic semantic ranking, recency, importance, pinned, and same-session signals with score explanations.
- Memory Fix Mode: feedback records, apply feedback, feedback-derived rules, remember ignored decisions, archive unwanted memories, adjust importance, change kind, repair wrong merges, merge duplicates.
- Missing Memory Analysis: session scanning, evidence-backed suggestions, accept/dismiss workflow.
- Confidence and conflicts: confidence reports, recompute flow, usage reinforcement, conservative preference-conflict detection, resolution APIs.
- UI: Dashboard, Memory Explorer, Session Explorer, Replay Viewer, Settings.
- CLI/API: local routes and commands for the same workflows, with CLI fallback to local core operations where implemented.

## Guardrails

- Do not invent implemented features. Hosted sync, auth, teams, enterprise policy management, remote vector database dependencies, and advanced embedding integrations are out of scope today.
- Keep terminology consistent: memory, feedback, rules, suggestions, confidence, conflicts, replay traces, Memory Fix Mode.
- Treat rules carefully: they are implemented in core/API/CLI and can be created by UI feedback actions, but there is no full UI rule-management page yet.
- Treat conflict resolution carefully: UI supports detection and dismissal; API/CLI support additional resolution actions.
- Prefer concise, developer-friendly docs over academic framing or generic AI claims.

## Working Notes

Read code before changing docs or instructions. The most important implementation files are:

- `packages/memory-core/src/service.ts`
- `packages/memory-core/src/ingestion.ts`
- `packages/memory-core/src/retrieval.ts`
- `packages/memory-core/src/missing-analysis.ts`
- `packages/memory-core/src/confidence.ts`
- `packages/memory-core/src/conflicts.ts`
- `apps/api/src/app.ts`
- `packages/cli/src/index.ts`
- `apps/web/src/App.tsx`

Validate behavior with `npm run build`, `npm test`, and `npm run lint` when code changes. For documentation-only changes, at least scan headings and command examples for consistency.
