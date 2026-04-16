---
name: mvp-planner
description: Use when planning implementation slices or prioritizing roadmap work for Agent Memory Devtools as a debuggable, correctable memory system for AI coding agents.
---

# MVP Planner

## Product Thesis

Agent Memory Devtools wins by making coding-agent memory inspectable, replayable, and correctable. Prefer narrow improvements that strengthen trust over broad platform features.

## Plan Against Reality

Current completed capabilities include:

- local SQLite memory store
- ingestion and retrieval replay traces
- Memory Explorer, Session Explorer, Replay Viewer, Dashboard, Settings
- feedback records and applied Memory Fix Mode corrections
- feedback-derived rules
- missing-memory analysis with accept/dismiss
- confidence reports and recompute
- conservative preference-conflict detection
- API and CLI coverage for major workflows

## Prioritization Rules

- Favor work that improves debugging, correction, or confidence.
- Keep local-first behavior intact.
- Prefer API/core tests for behavior changes before UI polish.
- Avoid planning hosted sync, auth, teams, enterprise policy, or remote vector database work as near-term MVP scope.
- Mark partial surfaces clearly, especially rules UI and UI conflict resolution.

## High-Impact Next Areas

- screenshot assets for docs
- API reference docs for correction workflows
- CLI trace formatting
- API route tests for feedback, missing analysis, confidence, and conflicts
- UI rule visibility and toggles
- export/import helpers for local memory backups
