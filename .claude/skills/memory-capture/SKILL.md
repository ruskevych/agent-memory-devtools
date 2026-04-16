---
name: memory-capture
description: Use when Claude Code work should create, verify, or correct local memory capture in Agent Memory Devtools.
---

# Memory Capture Workflow

Claude Code in this repo should use the committed project hooks for automatic capture and the CLI for explicit checkpoints or correction.

## What Is Automatic

Project hooks can automatically capture:

- durable user prompts
- changed files after edit/write tool use
- task-complete summaries
- end-of-turn assistant summaries

These captures stay local and produce replay traces through the normal memory pipeline.

## What Is Still Explicit

Use manual capture when you need to:

- import an older transcript or JSON session
- capture a checkpoint from outside Claude Code
- force a code-change checkpoint immediately
- inspect or repair a capture result

## Commands

Verify hook configuration:

```bash
npm run cli -- hooks status
```

Force a checkpoint capture:

```bash
npm run cli -- capture changes --tool claude-code --summary "what changed and what remains"
```

Manual checkpoint text:

```bash
npm run cli -- capture session --summary "durable checkpoint summary" --tool claude-code
```

Inspect replay:

```bash
npm run cli -- replay <trace-id>
```

## Correction Loop

If the automatic capture was wrong:

1. inspect the replay trace
2. apply feedback or rules
3. re-run capture only when there is genuinely new durable context
