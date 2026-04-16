# Automatic Memory

This repo now supports a deterministic local automation pipeline for memory capture.

## Event Sources

The automation pipeline accepts these event types:

- `user-prompt`
- `agent-summary`
- `file-change`
- `task-complete`
- `session-checkpoint`

Each event records:

- tool: `codex`, `claude-code`, or `generic`
- trigger: `hook`, `watch`, `cli`, or `manual`
- source metadata
- optional changed-file evidence

## What The Pipeline Does

1. normalizes incoming automation events
2. filters low-signal or secret-like content
3. dedupes repeated automatic captures
4. turns accepted events into normal session steps
5. runs the existing ingestion pipeline
6. patches replay traces with automation stages

The result is still normal memory, feedback, rules, confidence, conflicts, and replay traces. Automatic capture is not a separate hidden store.

## Replay Visibility

Automatic traces add two stages ahead of normal ingestion:

- `automation-events`
- `automation-filtering`

These stages show:

- what arrived
- what was accepted
- what was ignored
- why it was ignored

## Code-Change Capture

Changed files are summarized with deterministic heuristics. The current path looks for:

- shared schema changes
- API route changes
- CLI command changes
- memory-core behavior changes
- web UI surface changes
- instruction and integration doc changes
- dependency changes in `package.json`

The pipeline stores evidence file paths on resulting memories when available.

## Noise Suppression

Automatic capture intentionally ignores:

- short conversational acknowledgements
- repeated duplicate captures
- secret-like content
- tiny edits with no durable coding signal

## What Is Automatic

Automatic in this repo means:

- Claude Code hooks can submit events without manual CLI commands
- Codex watch mode can submit file-change events automatically

## What Is Explicit

You still use explicit commands for:

- transcript imports
- manual checkpoints
- Codex prompt/summary capture
- correction through feedback and rules

## Verification

```bash
npm run dev:api
npm run cli -- capture changes --tool codex --summary "Added automation capture routes and UI visibility."
npm run cli -- replay <trace-id>
```

In Memory Explorer, confirm:

- automatic badge
- source type and trigger
- origin event type
- evidence file paths when present
