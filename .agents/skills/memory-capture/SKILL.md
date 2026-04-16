---
name: memory-capture
description: Use when a Codex task changes durable repo behavior, introduces important codebase context, or reaches a meaningful checkpoint that should become memory.
---

# Memory Capture Workflow

Use this skill when work in Agent Memory Devtools should update local memory for future Codex sessions.

## Goal

Keep Codex memory capture explicit, local, and auditable.

Codex does not get a fake native hook story in this repo. The supported path is:

- automatic file-change capture through `agent-memory watch`
- explicit checkpoint capture through CLI commands
- replay, feedback, and rules for correction

## When To Capture

Capture after:

- durable user or repo preferences
- meaningful codebase changes
- new commands, routes, schemas, or workflow conventions
- unresolved follow-up work
- task completion summaries that future agent sessions will need

Do not capture:

- trivial chatter
- tiny edits with no durable effect
- repeated status updates with no new project context

## Commands

Start the local API:

```bash
npm run dev:api
```

Strongest automatic path for Codex:

```bash
npm run cli -- watch --tool codex
```

Checkpoint capture after meaningful work:

```bash
npm run cli -- capture changes --tool codex --summary "what changed and what remains"
```

Manual session/checkpoint capture:

```bash
npm run cli -- capture session --summary "durable preference, handoff, or checkpoint summary" --tool codex
```

Inspect what was stored:

```bash
npm run cli -- replay <trace-id>
npm run cli -- search "memory query"
```

## Review Loop

After capture:

1. Inspect the replay trace.
2. Check whether the memory came from prompt, summary, or file change.
3. If capture was wrong, use feedback or missing-memory analysis instead of editing docs to paper over it.
