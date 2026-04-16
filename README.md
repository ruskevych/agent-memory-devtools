# Agent Memory Devtools

> Debuggable, correctable memory system for AI coding agents.

Agent Memory Devtools gives Codex and Claude Code a local memory layer that developers can inspect, replay, and fix. It stores memory in SQLite, keeps retrieval explainable, records replay traces for ingestion and search, and now supports automatic workflow capture for real coding-agent sessions.

## What Problem This Solves

Coding agents lose useful project context, remember the wrong thing, or make retrieval decisions you cannot inspect. When that happens, developers need answers:

- what did the agent remember?
- why was it stored?
- why was it retrieved?
- what should have been ignored?
- how do I correct future behavior?

## What This Repo Now Supports

### Claude Code

Claude Code has a real project hook path in this repo.

Automatic capture can happen for:

- durable user prompts
- changed files after edit/write tools
- task-complete summaries
- end-of-turn assistant summaries

Those events flow through the normal memory pipeline and show up with replay traces, source metadata, and the usual feedback/rules workflow.

### Codex

Codex does not have a native project hook lifecycle here, so this repo does not fake one.

The supported Codex path is:

- automatic code-change capture through `agent-memory watch`
- explicit checkpoint capture through `capture changes` or `capture session`
- repo instructions plus a memory-capture skill so the workflow is obvious inside the repo

That makes Codex useful out of the box without inventing unsupported tool behavior.

## What Is Automatic vs Semi-Automatic

Automatic:

- Claude Code hook capture for prompt, file-change, stop, and task-complete events
- Codex file-change capture when `watch` is running
- replay traces for automatic capture decisions

Semi-automatic:

- Codex checkpoint summaries through CLI commands
- manual transcript or JSON imports
- correction with feedback, rules, missing-memory suggestions, confidence, and conflicts

## 60-Second Quickstart

Install dependencies:

```bash
npm install
```

Start the local memory API:

```bash
npm run dev:api
```

Optional UI:

```bash
npm run dev:web
```

### Codex Setup

```bash
npm run cli -- integrate codex
npm run cli -- watch --tool codex
```

At meaningful checkpoints:

```bash
npm run cli -- capture changes --tool codex --summary "what changed and what remains"
```

### Claude Code Setup

```bash
npm run cli -- integrate claude
npm run cli -- hooks status
```

Open the repo in Claude Code, use `/hooks` to confirm the project hooks are active, then make a meaningful edit.

## Verification

Search memory:

```bash
npm run cli -- search "automation capture memory"
```

Inspect the latest replay trace:

```bash
npm run cli -- replay <trace-id>
```

List memories:

```bash
npm run cli -- list
```

In the web UI, Memory Explorer now shows whether a memory came from automatic capture and whether the origin was a user prompt, agent summary, or file change.

## CLI Surface

Core memory:

```bash
npm run cli -- init
npm run cli -- ingest examples/sample-session.txt
npm run cli -- search "typescript zod api"
npm run cli -- session list
npm run cli -- replay <trace-id>
```

Automation and integrations:

```bash
npm run cli -- integrate codex
npm run cli -- integrate claude
npm run cli -- hooks install
npm run cli -- hooks status
npm run cli -- capture session --summary "durable checkpoint summary" --tool codex
npm run cli -- capture changes --tool codex --summary "what changed and what remains"
npm run cli -- watch --tool codex
```

Correction loop:

```bash
npm run cli -- fix remember <decision-or-step-id> --target decision --rule
npm run cli -- fix forget <memory-id> --rule
npm run cli -- analyze-missing <session-id> --refresh
npm run cli -- confidence show <memory-id>
npm run cli -- conflicts detect
```

## API Surface

Health:

```bash
curl http://127.0.0.1:4317/health
```

Automatic capture:

```bash
curl -X POST http://127.0.0.1:4317/automation/capture \
  -H "content-type: application/json" \
  -d '{
    "source": { "type": "hook", "agent": "claude-code", "label": "Claude Code automatic capture" },
    "events": [
      {
        "type": "user-prompt",
        "tool": "claude-code",
        "trigger": "hook",
        "content": "Prefer durable coding workflow notes to become local memory."
      }
    ]
  }'
```

Replay:

```bash
curl http://127.0.0.1:4317/replay
```

## Architecture

```text
apps/web          React + Vite inspector UI
apps/api          Fastify API
packages/cli      agent-memory CLI and integration helpers
packages/shared   Zod schemas and shared types
packages/memory-core
  automation.ts   automatic event capture pipeline
  ingestion.ts    normalization, classification, rules, dedupe, replay traces
  retrieval.ts    explainable local ranking and retrieval traces
  service.ts      feedback, rules, missing analysis, confidence, conflicts, automation capture
  store.ts        SQLite store
```

## Local-First Design

- SQLite is the source of truth
- deterministic local embeddings are the default
- no hosted sync
- no auth
- no remote vector database dependency

## Limitations

- Codex uses repo instructions plus local helpers, not native repo hooks
- Claude hook capture requires the local API to be running
- automation intentionally ignores low-signal chatter and secret-like content
- the UI still does not have a full rule-management screen
- conflict resolution in the UI is still dismissal-focused

## Docs

- [Automatic memory pipeline](docs/automatic-memory.md)
- [Codex integration](docs/codex-integration.md)
- [Claude Code integration](docs/claude-code-integration.md)
- [Features](FEATURES.md)
- [Demo](DEMO.md)
- [Roadmap](ROADMAP.md)

## Development

```bash
npm run build
npm test
npm run lint
```
