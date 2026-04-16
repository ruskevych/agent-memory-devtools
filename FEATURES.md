# Features

Agent Memory Devtools is a debuggable, correctable memory system for AI coding agents. The product is built around a simple promise: developers should be able to see what the agent remembered, why it remembered it, why it retrieved it, and how to fix it.

## Core Memory System

| Feature | What it does | Exposed in |
| --- | --- | --- |
| Local SQLite store | Stores memories, sessions, steps, events, feedback, rules, suggestions, usage, conflicts, and replay traces. | core, API, CLI, UI |
| Deterministic ingestion | Classifies durable context into `fact`, `preference`, `event`, `task-context`, `codebase-context`, and `summary`. | core, API, CLI, UI |
| Dedupe and merge tracking | Merges near-duplicate memories while preserving audit history. | core, API, CLI, UI |
| Explainable retrieval | Ranks with keyword, deterministic local semantic, recency, importance, pinned, and same-session signals. | core, API, CLI, UI |

## Automatic Memory Capture

| Feature | What it does | Exposed in |
| --- | --- | --- |
| Automation event schema | Accepts prompt, summary, file-change, task-complete, and session-checkpoint events. | shared, core, API, CLI |
| Automation capture pipeline | Filters noisy events, dedupes repeated captures, and routes accepted events into the existing ingestion path. | core, API, CLI |
| Automatic source metadata | Marks memories as automatic and records the tool, trigger, and origin event type. | core, UI |
| Automation replay stages | Adds `automation-events` and `automation-filtering` stages ahead of normal ingestion stages. | core, UI, CLI |
| Code-change-derived capture | Turns meaningful changed files into codebase-context candidates without external APIs. | CLI, core |

## Codex Compatibility

| Feature | What it does | Exposed in |
| --- | --- | --- |
| Short repo instructions | `AGENTS.md` explains the supported Codex path without claiming fake native hooks. | repo instructions |
| Codex memory skill | `.agents/skills/memory-capture/SKILL.md` tells Codex when and how to update memory. | repo skills |
| Watch mode | `agent-memory watch --tool codex` provides the strongest automatic file-change capture path available for Codex in this repo. | CLI |
| Checkpoint capture | `capture changes` and `capture session` let Codex record durable summaries explicitly at meaningful checkpoints. | CLI |

## Claude Code Compatibility

| Feature | What it does | Exposed in |
| --- | --- | --- |
| Project hook config | `.claude/settings.json` commits the supported hook path for this repo. | repo config |
| Hook helper | `.claude/hooks/agent-memory-hook.mjs` captures durable prompts immediately, tracks changed files, and flushes summaries at stop/task boundaries. | repo hooks |
| Claude memory skill | `.claude/skills/memory-capture/SKILL.md` explains what is automatic and what stays explicit. | repo skills |
| Hook visibility | `hooks status` and `integrate claude` show whether the expected files are present. | CLI |

## Memory Fix Mode

| Feature | What it does | Exposed in |
| --- | --- | --- |
| Structured feedback | Stores corrections for memories, decisions, session steps, and retrieval results. | core, API, CLI, UI |
| Feedback-derived rules | Lets corrections change future ingestion or dedupe behavior. | core, API, CLI, UI-created rules |
| Replay fixes | Replay Viewer can promote ignored decisions into memory and repair wrong merges. | UI |

## Missing Memory Analysis, Confidence, and Conflicts

| Feature | What it does | Exposed in |
| --- | --- | --- |
| Missing-memory suggestions | Scans sessions for durable context that ingestion skipped. | core, API, CLI, UI |
| Confidence reports | Explains trust signals from source reliability, usage, feedback, recency, and conflicts. | core, API, CLI, UI |
| Conservative conflicts | Detects obvious contradictions and preserves them as auditable records. | core, API, CLI, UI dismissal |

## Developer Experience

| Feature | What it does | Exposed in |
| --- | --- | --- |
| Dashboard | Shows health, counts, sessions, traces, and retrieval activity. | UI |
| Memory Explorer | Shows automatic origin, source metadata, explanations, confidence, conflicts, and fix actions. | UI |
| Session Explorer | Shows steps, related memories, and missing-memory suggestions. | UI |
| Replay Viewer | Shows automatic filtering stages plus ingestion and retrieval reasoning. | UI |
| Fastify API | Exposes local CRUD, ingest, automation capture, search, replay, feedback, rules, sessions, missing analysis, confidence, conflicts, and stats. | API |
| CLI | Exposes init, ingest, integrate, capture, hooks, watch, replay, feedback, rules, missing analysis, confidence, and conflicts. | CLI |
