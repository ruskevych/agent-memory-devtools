# Agent Memory Devtools

> Debug and fix what your AI agent remembers.

[![Local-first](https://img.shields.io/badge/local--first-SQLite-246b5b)](#local-first-design)
[![Node](https://img.shields.io/badge/node-%3E%3D20.11-315f8f)](#60-second-quickstart)
[![License: MIT](https://img.shields.io/badge/license-MIT-a66d05)](LICENSE)

**Your AI agent forgets things. This fixes that.**

Debuggable, correctable, and inspectable memory for Codex, Claude Code, and other AI coding agents.

Agent Memory Devtools gives coding agents a local memory layer that developers can inspect, fix, replay, and trust. It stores memories in SQLite, explains ingestion and retrieval decisions, and turns user corrections into feedback records and deterministic rules.

Think Chrome DevTools, but for AI agent memory.

## What This Looks Like in Practice

You search:

```text
why did the agent use zod here?
```

Instead of guessing, you see:

- which memory was used
- why it was ranked
- when it was created
- what session it came from
- which scoring signals affected retrieval

Then you realize the memory is wrong.

Click **This should not be remembered** or apply the same fix from the CLI.

Run the agent again.

It does not make the same memory mistake.

### The Problem in One Sentence

You run your agent again, and it forgets how your project is structured, what you told it 10 minutes ago, or why it made a decision.

Or worse: it remembers the wrong thing.

Agent Memory Devtools lets you see, fix, and improve what your agent remembers.

## Problem

Agent memory is usually opaque. A coding agent may remember stale preferences, miss important handoff notes, merge the wrong duplicate, or retrieve a memory for reasons nobody can see. Vector search alone does not answer the questions developers actually ask:

- What did the agent remember from the last session?
- Why was this candidate stored, ignored, or merged?
- Why did this memory rank above another result?
- How do I correct a bad memory so it does not happen again?
- Which memories are low-confidence, stale, or contradicted?

## Solution

Agent Memory Devtools treats memory as developer infrastructure, not hidden model state.

It provides a memory engine, Fastify API, CLI, and React inspector for local agent workflows. Every durable memory keeps its source, kind, tags, confidence, importance, state, related session, and decision metadata. Searches return ranked explanations. Ingestion and retrieval create replay traces. Corrections are captured as feedback and can become rules for future ingestion or dedupe behavior.

## Before vs After

### Without Agent Memory Devtools

- Agent forgets important context between runs.
- You do not know why it retrieved a memory.
- Bad memories keep coming back.
- Missed context stays missed.
- Memory behavior is hard to debug.

### With Agent Memory Devtools

- Inspect every stored memory.
- See exactly why a memory was created or retrieved.
- Fix bad memory with direct feedback.
- Detect what should have been remembered.
- Track confidence, usage, and conflicts.

## Who This Is For

- Developers using Codex, Claude Code, or similar coding agents.
- People building agent workflows with persistent project context.
- Maintainers frustrated by flaky or stale agent memory.
- Teams evaluating predictable, inspectable AI systems without hosted memory infrastructure.

## Key Features

### Memory Fix Mode

Fix broken memory behavior directly:

- "This should not be remembered."
- "This was merged incorrectly."
- "This should have been remembered."
- "This memory should matter more."

Corrections are stored as feedback and can become deterministic rules for future sessions.

### Missing Memory Analysis

Find what your agent should have remembered but did not.

Detect:

- missed preferences
- lost task context
- important codebase facts
- repeated concepts across a session

Accept suggestions in the Session Explorer or through the API/CLI.

### Explainable Retrieval and Replay

See exactly why a memory was retrieved:

- keyword match
- local semantic similarity
- recency
- importance
- pinned boost
- same-session boost

Replay traces show the ingestion and retrieval pipeline, including store, ignore, merge, and ranking decisions.

### Confidence and Conflicts

Understand memory quality before trusting it:

- confidence score and label
- usage reinforcement
- stale or low-confidence memory
- feedback impact
- open preference conflicts

### Local-First Design

- SQLite storage
- deterministic local hash embeddings
- no API keys
- no cloud account
- no remote vector database
- no hidden hosted state

See [FEATURES.md](FEATURES.md) for the full capability map.

## How It Works

1. You run your agent.
2. Sessions are ingested into local memory.
3. Durable facts, preferences, tasks, codebase context, and summaries are extracted.
4. You inspect and fix memory in the UI, API, or CLI.
5. Retrieval is explainable and traceable.
6. Corrections improve future ingestion and dedupe behavior through feedback and rules.

## Design Principles

- **Deterministic by default** - local ranking and hash embeddings make behavior reproducible without hidden model calls.
- **Local-first** - SQLite is the source of truth, and no external service is required.
- **Fully inspectable state** - memories, sessions, traces, feedback, rules, suggestions, usage, and conflicts are stored as readable records.
- **Explainable decisions** - ingestion, dedupe, retrieval, confidence, and correction workflows expose their reasons.
- **Correction over magic** - when memory is wrong, developers should be able to fix it and improve future behavior.

## Screenshots

Placeholders are kept so maintainers can drop in current captures before publishing:

- `docs/screenshots/dashboard.png` - health metrics, guided demo, recent sessions, retrieval activity
- `docs/screenshots/memory-explorer.png` - search, memory details, fix controls, confidence, conflicts
- `docs/screenshots/session-explorer.png` - timeline, related memories, missing-memory suggestions
- `docs/screenshots/replay-viewer.png` - ingestion and retrieval decision pipelines

## Try It in 30 Seconds

```bash
npm install
npm run dev:api &
npm run dev:web &
npm run cli -- dev:seed
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) and search:

```text
typescript zod api
```

## 60-Second Quickstart

Install dependencies:

```bash
npm install
```

Run the API:

```bash
npm run dev:api
```

Run the UI in a second terminal:

```bash
npm run dev:web
```

Seed demo data in a third terminal:

```bash
npm run cli -- dev:seed
```

Open the app:

```text
http://127.0.0.1:5173
```

Try the workflow:

1. Open **Dashboard** and confirm demo memories, sessions, traces, and health metrics.
2. Open **Memory Explorer** and search for `typescript zod api`.
3. Select a memory and inspect why it exists, why it was retrieved, confidence, feedback, and conflicts.
4. Open **Replay** and inspect the latest retrieval trace.
5. Open **Session Explorer**, select a session, run **Analyze missing memories**, and accept or dismiss a suggestion.

## CLI Usage

The CLI uses the local API when it is available and falls back to direct `memory-core` operations for supported commands.

```bash
npm run cli -- init
npm run cli -- dev:seed
npm run cli -- ingest examples/sample-session.txt
npm run cli -- ingest examples/sample-session.json
npm run cli -- list
npm run cli -- search "typescript zod api"
npm run cli -- session list
npm run cli -- replay <trace-id>
```

Memory Fix Mode:

```bash
npm run cli -- fix remember <decision-or-step-id> --target decision --rule
npm run cli -- fix forget <memory-id> --rule
npm run cli -- fix duplicate <source-memory-id> <canonical-memory-id> --rule
```

Feedback, missing-memory analysis, confidence, and conflicts:

```bash
npm run cli -- feedback list --status applied
npm run cli -- analyze-missing <session-id> --refresh
npm run cli -- missing accept <suggestion-id>
npm run cli -- confidence show <memory-id>
npm run cli -- confidence recompute
npm run cli -- conflicts detect
npm run cli -- conflicts list
```

## API Examples

Health:

```bash
curl http://127.0.0.1:4317/health
```

Seed demo sessions:

```bash
curl -X POST http://127.0.0.1:4317/dev/seed
```

Search with ranking explanations:

```bash
curl -X POST http://127.0.0.1:4317/search \
  -H "content-type: application/json" \
  -d '{"query":"typescript zod api","limit":5}'
```

Ingest a session:

```bash
curl -X POST http://127.0.0.1:4317/ingest \
  -H "content-type: application/json" \
  -d @examples/sample-session.json
```

Apply feedback and create a rule:

```bash
curl -X POST http://127.0.0.1:4317/feedback \
  -H "content-type: application/json" \
  -d '{"targetType":"memory","targetId":"<memory-id>","memoryId":"<memory-id>","type":"should-not-remember","apply":true,"createRule":true}'
```

Analyze missing memories:

```bash
curl -X POST http://127.0.0.1:4317/sessions/<session-id>/analyze-missing \
  -H "content-type: application/json" \
  -d '{"refresh":true,"limit":8}'
```

Inspect confidence and conflicts:

```bash
curl http://127.0.0.1:4317/memories/<memory-id>/confidence
curl -X POST http://127.0.0.1:4317/conflicts/detect
curl http://127.0.0.1:4317/conflicts
```

Explore replay traces:

```bash
curl http://127.0.0.1:4317/replay
curl http://127.0.0.1:4317/replay/<trace-id>
```

## Architecture

```text
apps/web          React + Vite inspector UI
apps/api          Fastify REST API
packages/cli      agent-memory command line tool
packages/shared   Zod schemas and shared TypeScript types
packages/memory-core
  store.ts        SQLite repository boundary
  ingestion.ts    normalization, chunking, classification, rules, dedupe, traces
  retrieval.ts    local search, ranking, explanations, retrieval traces
  service.ts      feedback, rules, missing analysis, confidence, conflicts
  seed.ts         demo sessions
```

Core flow:

```text
transcript or JSON session
  -> normalize session and steps
  -> chunk candidate memories
  -> apply ingestion and dedupe rules
  -> store, ignore, or merge with a reason
  -> search with explainable local ranking
  -> correct with feedback, suggestions, and rules
  -> replay decisions from API, CLI, or UI
```

## Local-First Design

- Default database: `~/.agent-memory/memory.sqlite`
- Storage: SQLite via `better-sqlite3`
- Embeddings: deterministic local hash embeddings
- API: local Fastify server on `http://127.0.0.1:4317`
- UI: local Vite app on `http://127.0.0.1:5173`

Configuration:

```bash
AGENT_MEMORY_HOME=~/.agent-memory
AGENT_MEMORY_DB=~/.agent-memory/memory.sqlite
AGENT_MEMORY_API_URL=http://127.0.0.1:4317
VITE_AGENT_MEMORY_API_URL=http://127.0.0.1:4317
```

## Why This Is Different

**Vector DBs** store embeddings.

**LangChain memory** usually lives inside your app.

**Simple RAG** answers retrieval questions.

**Agent Memory Devtools** gives you:

- visibility
- control
- correction
- replay
- confidence

It treats memory as a developer-facing system, not hidden infrastructure.

## Development

```bash
npm run build
npm test
npm run lint
```

Core tests live in `packages/memory-core/test` and cover ingestion, dedupe, retrieval explanations, Memory Fix Mode, missing-memory analysis, confidence, and conflicts.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for completed work, current focus, and high-impact next steps.

## Contributing

Contributions are welcome around UI polish, docs, demo fixtures, trace wording, tests, and small integrations that preserve the local-first design. Start with [CONTRIBUTING.md](CONTRIBUTING.md), open an issue for larger changes, and keep PRs scoped to making coding-agent memory more debuggable and correctable.
