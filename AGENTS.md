# Agent Instructions

## Product Direction

Agent Memory Devtools is a debuggable, correctable memory system for AI coding agents. It should help developers answer what an agent remembered, why it remembered it, why it retrieved it, and how to fix memory behavior when it is wrong.

Use the same terminology across code, docs, issues, and demos:

- memory
- feedback
- rules
- missing-memory suggestions
- confidence
- conflicts
- replay traces
- Memory Fix Mode

## Current Implemented Surface

- `packages/memory-core` owns ingestion, retrieval, SQLite storage, feedback application, rules, missing-memory analysis, confidence reports, conflict detection, usage tracking, replay traces, and demo seed data.
- `apps/api` exposes local Fastify routes for memory CRUD, ingest, search, feedback, rules, sessions, missing analysis, confidence, conflicts, usage, replay, stats, and demo seed.
- `packages/cli` exposes init, ingest, search, list, session list, replay, seed, feedback, rules, fix shortcuts, missing analysis, confidence, and conflicts.
- `apps/web` exposes Dashboard, Memory Explorer, Session Explorer, Replay Viewer, and Settings.

## Boundaries

- Do not describe hosted sync, teams, auth, remote vector databases, or production policy management as implemented.
- Do not imply that the UI has full rule editing. Rules are exposed through API and CLI; the UI creates rules through feedback actions but does not yet provide a rule-management screen.
- Do not imply that conflict resolution in the UI supports every API action. The UI currently supports detecting conflicts and dismissing visible conflicts; API/CLI support richer resolution actions.
- Keep local-first behavior explicit: SQLite is the source of truth, and deterministic hash embeddings are the default.

## Development Workflow

Use existing package boundaries and shared Zod schemas. Keep changes scoped and add tests when behavior changes in `packages/memory-core`, API contracts, or cross-surface workflows.

Useful commands:

```bash
npm run build
npm test
npm run lint
npm run cli -- dev:seed
npm run cli -- search "typescript zod api"
```

## Documentation Workflow

Before updating docs, inspect the implementation. README, FEATURES, DEMO, ROADMAP, AGENTS, and CLAUDE instructions must use the same feature names and avoid future-tense promises unless they are listed in ROADMAP.

When documenting new behavior, include:

- what the feature does
- what problem it solves
- where it is exposed: core, API, CLI, UI, or tests
- any partial implementation limits
