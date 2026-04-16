# Roadmap

Agent Memory Devtools should stay small, local, debuggable, and correctable. The roadmap favors trust and developer control over platform sprawl.

## Completed

- Local SQLite memory store with sessions, steps, memories, events, feedback, rules, suggestions, usage, conflicts, and replay traces
- Deterministic ingestion, dedupe, explainable retrieval, confidence, and conflict detection
- Memory Fix Mode across API, CLI, and UI
- Missing-memory suggestions with accept and dismiss flows
- React UI with Dashboard, Memory Explorer, Session Explorer, Replay Viewer, and Settings
- Automatic event capture pipeline for prompt, summary, checkpoint, task-complete, and file-change events
- Code-change-aware memory capture heuristics for local workflows
- Claude Code project hooks through committed `.claude/settings.json`
- Codex-compatible watch and checkpoint capture workflow without claiming unsupported native hooks
- CLI commands for integration setup, hook status, session capture, change capture, and watch mode
- Docs for Codex, Claude Code, and automatic memory behavior

## In Progress

- Tightening demo data and screenshots so automatic capture is obvious on the first run
- Expanding test coverage around CLI flows and integration edge cases

## Next

- Add richer API route tests for automation capture
- Show more automation-specific summaries on the dashboard
- Improve changed-file heuristics for more ecosystems beyond the current code-first defaults
- Add export/import helpers for the local SQLite store

## Future Ideas

- Optional deeper git-diff analysis while keeping deterministic local behavior
- Optional pluggable embedding providers without changing the default local-first path
- Retrieval evaluation fixtures for regression testing ranking changes over time

## Out Of Scope

- Hosted sync
- Authentication and teams
- Enterprise policy management
- Remote vector database dependency
- Hidden background daemons
- Pretending Codex has a native repo hook lifecycle when it does not
