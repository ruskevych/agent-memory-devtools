# Demo Script

Use this 2-3 minute walkthrough to show Agent Memory Devtools as a real local memory layer for Codex and Claude Code.

## Setup

Terminal 1:

```bash
npm install
npm run dev:api
```

Terminal 2:

```bash
npm run dev:web
```

Optional demo seed:

```bash
npm run cli -- dev:seed
```

Open `http://127.0.0.1:5173`.

## Demo Path

### 1. Show The Product Surface

Start on the Dashboard and explain:

- memories are local SQLite records
- replay traces are first-class
- correction happens through feedback and rules
- automatic capture is visible, not hidden

### 2. Show A Codex-Compatible Flow

In a terminal:

```bash
npm run cli -- integrate codex
npm run cli -- capture changes --tool codex --summary "Added automation capture routes and CLI integration commands."
```

Then show:

- the returned trace id
- the Replay Viewer stages
- the stored memory source showing automatic capture and file-change origin

### 3. Show A Claude-Compatible Flow

In a terminal:

```bash
npm run cli -- integrate claude
npm run cli -- hooks status
```

Explain that the repo ships committed project hooks in `.claude/settings.json`, then point out:

- durable prompts can be captured automatically
- changed files are aggregated during the turn
- stop/task-complete summaries can become memory automatically

### 4. Inspect Memory Explorer

Search for:

```text
automation capture
```

Show:

- memory kind
- automatic badge
- source type and trigger
- origin event type such as `user-prompt` or `file-change`
- evidence file paths when present

### 5. Open Replay Viewer

Select the latest ingestion trace and show the automation-specific stages:

- `automation-events`
- `automation-filtering`
- normal ingestion stages such as classification and dedupe/storage

Point out that ignored automatic events are visible in replay instead of disappearing silently.

### 6. Correct A Bad Capture

From Memory Explorer or the CLI:

```bash
npm run cli -- fix forget <memory-id> --rule
```

Then explain:

- feedback is stored
- future behavior can change through rules
- automatic capture stays auditable and correctable

## Manual Verification Checklist

### Codex

- `npm run cli -- watch --tool codex` starts successfully
- `capture changes` produces a replay trace
- Memory Explorer shows automatic source metadata

### Claude Code

- `/hooks` shows the project hooks
- a meaningful prompt or edit produces an automation trace
- replay shows accepted and ignored automatic events

## Close

This is not just retrieval. It is local agent memory with automatic capture, replay traces, and a correction loop that developers can trust.
