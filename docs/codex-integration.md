# Codex Integration

This repo supports Codex as a real local memory workflow, but it does not pretend Codex has a native project hook lifecycle when it does not.

## Supported Path

Codex in this repo uses:

- `AGENTS.md` for repo instructions
- `.agents/skills/memory-capture/SKILL.md` for the memory-aware workflow
- `agent-memory watch` for automatic file-change capture
- `capture changes` and `capture session` for explicit checkpoints

## Setup

Install dependencies and start the local API:

```bash
npm install
npm run dev:api
```

Verify the repo integration files:

```bash
npm run cli -- integrate codex
```

Start automatic file-change capture:

```bash
npm run cli -- watch --tool codex
```

Optional UI:

```bash
npm run dev:web
```

## Recommended Workflow

### 1. Start Work

- read `AGENTS.md`
- use the memory-capture skill when durable context changes
- start `watch` if you want automatic file-change capture

### 2. During Meaningful Code Changes

`watch` will capture changed files automatically.

If you want an explicit checkpoint immediately:

```bash
npm run cli -- capture changes --tool codex --summary "what changed and what remains"
```

### 3. End Of Task Or Handoff

Capture the durable summary explicitly:

```bash
npm run cli -- capture session --summary "durable handoff summary" --tool codex
```

### 4. Inspect And Correct

```bash
npm run cli -- search "memory query"
npm run cli -- replay <trace-id>
```

If capture was wrong, use feedback, rules, missing-memory suggestions, confidence, or conflicts.

## What Is Automatic

- file-change capture while `watch` is running
- replay trace creation for automatic change capture

## What Is Semi-Automatic

- prompt and summary capture through explicit CLI checkpoints
- transcript imports

## Limitations

- there is no native Codex project hook lifecycle in this repo
- Codex prompt capture is explicit, not hidden
- `watch` is intentionally conservative and may ignore tiny low-value edits

## Verification Checklist

- `npm run cli -- integrate codex` reports the instruction file, memory skill, and doc
- `npm run cli -- watch --tool codex` starts successfully
- a meaningful edit produces a replay trace
- Memory Explorer shows automatic source metadata for the resulting memory

## Troubleshooting

If memory is not updating:

- make sure `npm run dev:api` is running
- make sure `watch` is still running
- force a checkpoint with `capture changes`
- inspect the trace to see whether automation filtered the event out
