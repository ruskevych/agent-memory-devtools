# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Agent Memory Devtools is a local-first, debuggable, correctable memory system for AI coding agents.

## Commands

```bash
# Build (order matters — shared and memory-core must build before dependents)
npm run build

# Run all tests
npm test

# Run tests for a single package
npm test -w @agent-memory/memory-core
# Or directly with vitest (from package dir):
cd packages/memory-core && npx vitest run test/ingestion.test.ts

# Type-check without emitting
npm run lint

# Full validation
npm run check

# Dev servers
npm run dev:api     # Fastify API on port 4317
npm run dev:web     # Vite web UI on port 5173

# CLI (dev mode, rebuilds deps first)
npm run cli -- <command>

# CLI (prod mode, uses pre-built dist)
npm run cli:prod -- <command>

# Seed demo data
npm run demo:seed
```

## Architecture

This is an npm workspaces monorepo. Build order is strict: `shared` → `memory-core` → `api`, `cli`, `web`.

### Package map

| Package | Role |
|---|---|
| `packages/shared` | Zod schemas + TypeScript types shared across all packages. Single source of truth for `Memory`, `Session`, `ReplayTrace`, etc. |
| `packages/memory-core` | Core pipeline: ingestion, retrieval, automation, confidence scoring, conflict detection, missing-memory analysis. Also contains `SqliteMemoryStore` (better-sqlite3). |
| `packages/cli` | Commander-based CLI. Talks to the API over HTTP, with a local fallback that instantiates `MemoryService` directly. |
| `packages/storage` | (nascent) Storage adapter layer. |
| `packages/core` | (nascent) Additional core utilities. |
| `packages/evals` | Evaluation harness for pipeline quality. |
| `apps/api` | Fastify REST API wrapping `MemoryService`. Single `createApp()` function in `src/app.ts`. |
| `apps/web` | React 19 + Vite single-page inspector UI. All API calls go through `src/api.ts` (`ApiClient`). No router — page state is a local `useState`. |

### Data flow

1. **Capture** — Claude Code hooks (`/.claude/hooks/agent-memory-hook.mjs`) or CLI commands send events to `POST /automation/capture`.
2. **Ingestion** — `AutomationPipeline` pre-filters events using signal heuristics (`signals.ts`), then passes accepted events to `IngestionPipeline`, which classifies, deduplicates, embeds (deterministic hash embedding), and writes to SQLite via `MemoryStore`.
3. **Retrieval** — `RetrievalEngine` scores candidates by keyword match + cosine similarity (hash embeddings) + recency + pinned/importance boosts. Every decision produces a `ReplayTrace`.
4. **Feedback → Rules** — `MemoryService.applyFeedback()` records `MemoryFeedback` and optionally promotes to `MemoryRule`. Rules are checked during ingestion on the next run.

### Key design constraints

- SQLite is the source of truth. No external vector DB, no hosted sync.
- All ranking is deterministic local heuristics — no LLM calls in the pipeline.
- Every ingestion and retrieval decision records a full `ReplayTrace` for inspection.
- Embeddings use a hash-based provider (`HashEmbeddingProvider`) — approximate but offline.

## Product Guardrails

- Keep SQLite as the source of truth.
- Keep deterministic local heuristics and replay traces visible.
- Do not claim hosted sync, auth, teams, enterprise policy management, or remote vector databases are implemented.
- Keep rule and conflict UI limits explicit:
  - rules are created through feedback and exposed through API/CLI
  - the UI does not have a full rule-management screen
  - the UI can dismiss visible conflicts, while API/CLI expose richer conflict actions

## Claude Code Hooks Integration

This repo ships a real Claude Code project hook path in `.claude/settings.json`.

### Quick Start

1. **Build and start the API** (required for hooks to work):
```bash
npm run build
npm run dev:api
```

2. **Verify hooks are configured**:
```bash
npm run cli:prod -- hooks status
```

3. **Open this repo in Claude Code** and run `/hooks` to confirm project hooks are active.

4. **Work normally** — the hooks automatically capture:
   - Durable `UserPromptSubmit` prompts
   - `PostToolUse` edit/write activity
   - `TaskCompleted` summaries
   - `Stop` event summaries
   - `SessionEnd` flushes for pending changed files

The hook helper is `.claude/hooks/agent-memory-hook.mjs`.

### Verification Commands

```bash
npm run cli:prod -- list
npm run cli:prod -- search "your query"
npm run cli:prod -- replay <trace-id>
```

### Manual Capture Commands

```bash
npm run cli:prod -- capture changes --tool claude-code --summary "what changed and what remains"
npm run cli:prod -- capture session --summary "durable checkpoint summary" --tool claude-code
```

## Read Before Editing Docs

- `docs/automatic-memory.md`
- `docs/claude-code-integration.md`
- `README.md`
