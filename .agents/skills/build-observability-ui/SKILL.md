---
name: build-observability-ui
description: Use when changing the React UI for Agent Memory Devtools, especially Dashboard, Memory Explorer, Session Explorer, Replay Viewer, Settings, Memory Fix Mode controls, missing-memory suggestions, confidence, or conflicts.
---

# Build Observability UI

## Goal

Make agent memory inspectable and correctable from the first screen. The UI should help developers understand memory health, trace decisions, and act on bad or missing memories.

## Current Screens

- Dashboard: health metrics, counts by kind, recent sessions, traces, duplicate/merge health, retrieval activity, demo actions.
- Memory Explorer: search, filters, result explanations, memory detail, source, tags, state, feedback history, confidence, conflicts, fix controls, merge controls.
- Session Explorer: session list, transcript timeline, related memories, missing-memory analysis, accept/dismiss suggestions, create memory from a step.
- Replay Viewer: ingestion and retrieval traces, pipeline stages, store/ignore/merge decisions, ranked results, remember ignored decisions, wrong-merge repair.
- Settings: local API URL, local runtime details, demo seed action.

## Working Rules

- Do not introduce UI claims for unsupported behavior. There is no full rule-management screen yet.
- Keep local-first language visible: SQLite storage, deterministic local ranking, replayable decisions.
- Put correction actions close to the memory, session step, or trace decision they affect.
- Preserve score components and reasons when changing retrieval or confidence displays.
- Keep empty states actionable: seed data, run search, select a session, or open a trace.

## Useful Files

- `apps/web/src/App.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/styles.css`
- `packages/shared/src/index.ts`
