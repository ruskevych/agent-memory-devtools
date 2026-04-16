---
name: build-memory-engine
description: Use when changing packages/memory-core or shared schemas for Agent Memory Devtools, including ingestion, retrieval, feedback, rules, missing-memory analysis, confidence, conflicts, replay traces, SQLite storage, or tests.
---

# Build Memory Engine

## Goal

Keep the core memory system debuggable, correctable, and local-first. The engine should explain why memories are stored, ignored, merged, retrieved, corrected, suggested, trusted, or flagged as conflicted.

## Current Capabilities

- Ingest raw transcripts or structured JSON steps into sessions and timeline steps.
- Classify candidates into `fact`, `preference`, `event`, `task-context`, `codebase-context`, and `summary`.
- Apply ingestion and dedupe rules from feedback-derived or manually created rules.
- Store, ignore, or merge candidate memories with replayable decisions.
- Search memories with keyword, deterministic local semantic, recency, pinned, importance, and same-session signals.
- Store structured feedback and apply Memory Fix Mode corrections.
- Analyze sessions for missing-memory suggestions and accept or dismiss them.
- Compute confidence reports from base confidence, source reliability, usage, recency, feedback, and conflicts.
- Detect conservative preference conflicts and support resolution actions.

## Working Rules

- Keep SQLite and shared Zod schemas as the contract boundary.
- Add or update tests in `packages/memory-core/test` for behavioral changes.
- Preserve replay trace readability whenever changing ingestion, retrieval, feedback, missing analysis, confidence, or conflicts.
- Do not add remote services or hosted dependencies to the core path.
- When adding a feature, expose whether it is core-only, API-visible, CLI-visible, or UI-visible.

## Useful Files

- `packages/memory-core/src/service.ts`
- `packages/memory-core/src/ingestion.ts`
- `packages/memory-core/src/retrieval.ts`
- `packages/memory-core/src/missing-analysis.ts`
- `packages/memory-core/src/confidence.ts`
- `packages/memory-core/src/conflicts.ts`
- `packages/memory-core/src/store.ts`
- `packages/shared/src/index.ts`
