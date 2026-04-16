# Roadmap

Agent Memory Devtools should stay small, local, debuggable, and correctable. The roadmap favors trust and developer control over broad platform scope.

## Completed

- Local SQLite memory store with sessions, steps, memories, facts, events, traces, decisions, mutations, feedback, rules, suggestions, usage, and conflicts.
- Transcript and JSON session ingestion.
- Memory classification for facts, preferences, events, task context, codebase context, and summaries.
- Importance and confidence fields on memories.
- Dedupe and merge tracking for repeated context.
- Explainable local retrieval with keyword, deterministic semantic, recency, pinned, importance, and same-session signals.
- Ingestion and retrieval replay traces.
- React/Vite UI with Dashboard, Memory Explorer, Session Explorer, Replay Viewer, and Settings.
- Memory Fix Mode through UI controls, replay actions, API feedback, and CLI shortcuts.
- Feedback-derived ingestion and dedupe rules.
- Missing Memory Analysis with accept and dismiss workflows.
- Confidence reports and recompute flow.
- Conservative preference-conflict detection and resolution APIs.
- Fastify API routes for memory, ingest, search, feedback, rules, sessions, missing analysis, confidence, conflicts, usage, replay, stats, and demo seed.
- CLI coverage for init, ingest, search, list, sessions, replay, seed, feedback, rules, fix shortcuts, missing analysis, confidence, and conflicts.
- Core tests for ingestion, dedupe, retrieval, Memory Fix Mode, missing analysis, confidence, and conflicts.

## In Progress

- Documentation refresh for the debuggable, correctable product direction.
- Screenshot placeholders for Dashboard, Memory Explorer, Session Explorer, and Replay Viewer.
- UI copy polish for replay stages, correction actions, confidence, and missing-memory suggestions.

## Next

- Add current screenshot assets under `docs/screenshots`.
- Add focused API reference docs for feedback, rules, missing analysis, confidence, and conflicts.
- Improve CLI trace formatting so replay output shows decision items and score components more clearly.
- Add tests for API routes that cover feedback, missing suggestions, confidence recompute, and conflict resolution.
- Add UI affordances for viewing and toggling rules created from feedback.
- Add export/import helpers for backing up and restoring the local SQLite memory store.

## Future Ideas

- Optional pluggable embedding providers while keeping deterministic local embeddings as the default.
- Lightweight retrieval evaluation fixtures for comparing ranking behavior over time.
- Browser screenshot capture workflow for docs and releases.
- SQLite migration helpers as the schema evolves.

## Out of Scope for Now

- Hosted sync
- Authentication and teams
- Enterprise policy management
- Remote vector database dependency
- Framework conversion
- Complex embedding integrations before the local explainability loop is strong
