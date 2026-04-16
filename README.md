# Agent Memory Devtools

> Your AI agent forgets things. This fixes that.

Works with Codex and Claude Code out of the box.

Agent Memory Devtools gives coding agents a local memory layer you can inspect, replay, and correct. It stores everything in SQLite, keeps retrieval explainable, and records traces for every capture and search decision.

---

## What this looks like in practice

You are mid-session with Codex or Claude Code. The agent makes a retrieval decision you disagree with — or misses something it should have stored. Instead of restarting or hoping it improves, you open the inspector, see exactly why that decision was made, apply feedback, and the agent behaves differently on the next run.

```bash
# See what was captured and why
npm run cli:prod -- list
npm run cli:prod -- replay <trace-id>

# Correct behavior
npm run cli:prod -- fix forget <memory-id> --rule
npm run cli:prod -- fix remember <decision-id> --target decision --rule
```

---

## The problem

Coding agents lose project context across sessions, store things they should ignore, retrieve the wrong memory at the wrong time, and give you no way to understand or fix the behavior. You end up prompting around the problem instead of solving it.

---

## The solution

A local memory pipeline that:

- captures durable signal from real coding sessions (automatically for Claude Code, via watch and checkpoints for Codex)
- classifies, deduplicates, and ranks memories with deterministic local heuristics
- records a replay trace for every capture and retrieval decision
- lets you apply feedback and promote corrections to persistent rules
- surfaces missing-memory suggestions, confidence reports, and conservative conflict detection

---

## Before vs After

| Before | After |
|---|---|
| Agent forgets important project decisions | Durable memories survive across sessions |
| No idea what the agent remembered or why | Replay traces for every decision |
| Cannot correct wrong retrieval behavior | Feedback promotes to rules |
| Black box scoring | Explainable local ranking |
| Vendor lock-in to hosted memory | SQLite, local-first, no auth |

---

## Who this is for

- Developers using Codex or Claude Code who want persistent, correctable agent memory
- Teams who need to inspect and debug what an agent stored and why
- Anyone who has been burned by an agent confidently using the wrong context

---

## Key features

- **Automatic capture** — Claude Code hooks capture prompts, file changes, and task summaries with no manual steps; stop-event summaries are pre-filtered before reaching the API
- **Watch mode + checkpoints** — Codex sessions use file-change watching and explicit checkpoint capture
- **Replay traces** — every ingestion and retrieval decision has a step-by-step trace you can inspect
- **Feedback and rules** — mark a memory to remember or forget; promote corrections to persistent rules
- **Missing memory analysis** — surface what was likely important but not stored
- **Confidence reports** — per-memory confidence scores with contributing factors
- **Conservative conflict detection** — flag contradictory memories without silent overwrites
- **React inspector UI** — browse, filter, and dismiss conflicts visually
- **REST API + CLI** — full programmatic access to every feature

---

## Design principles

- SQLite is the source of truth — no hosted sync, no remote vector database
- Deterministic local heuristics — no LLM calls for retrieval decisions
- Replay traces are always visible — nothing is a black box
- Rules come from feedback — not from a config file you maintain by hand
- Capture is conservative — generic wordlists in `signals.ts` filter questions, conversational acks, system output, and secret-like content at both the automation and ingestion layers

---

## Try it in 30 seconds

```bash
npm install
npm run dev:api &
npm run dev:web &
npm run cli:prod -- list
```

Then open `http://localhost:5173` to explore the inspector UI.

---

## Codex & Claude Code integration

### Claude Code

Claude Code has real project hooks wired in `.claude/settings.json`. Once the API is running, hooks automatically capture:

- durable user prompts (`UserPromptSubmit`)
- file changes after edit/write tools (`PostToolUse`)
- task-complete summaries (`TaskCompleted`)
- end-of-turn assistant summaries (`Stop`)
- session-end flushes for pending changed files (`SessionEnd`)

Every captured event flows through the memory pipeline and shows up with a replay trace, source metadata, and the full feedback and rules workflow.

**Setup:**

```bash
npm run build
npm run dev:api

# In a new terminal
npm run cli:prod -- integrate claude
npm run cli:prod -- hooks status
```

Open the repo in Claude Code and use `/hooks` to confirm project hooks are active. Work normally — capture is automatic.

### Codex

Codex works with this repo through repo instructions, a memory-capture skill, file-change watching, and explicit checkpoint commands.

**Setup:**

```bash
npm run cli:prod -- integrate codex
npm run cli:prod -- watch --tool codex
```

At meaningful checkpoints:

```bash
npm run cli:prod -- capture changes --tool codex --summary "what changed and what remains"
npm run cli:prod -- capture session --summary "durable checkpoint summary" --tool codex
```

**What is automatic vs manual:**

| | Claude Code | Codex |
|---|---|---|
| Prompt capture | Automatic (hook) | Manual checkpoint |
| File-change capture | Automatic (hook) | Automatic (watch) |
| Task summary | Automatic (hook) | Manual checkpoint |
| Replay traces | Yes | Yes |
| Feedback and rules | Yes | Yes |

---

## Full quickstart

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

Then visit `http://localhost:5173`.

---

## Verification

```bash
npm run cli:prod -- search "automation capture memory"
npm run cli:prod -- replay <trace-id>
npm run cli:prod -- list
```

The web UI shows whether a memory came from automatic capture and whether the origin was a user prompt, agent summary, or file change.

---

## CLI reference

**Development mode** (rebuilds dependencies automatically):
```bash
npm run cli -- <command>
```

**Production mode** (faster, requires `npm run build` first):
```bash
npm run cli:prod -- <command>
```

### Core memory

```bash
npm run cli:prod -- init
npm run cli:prod -- ingest examples/sample-session.txt
npm run cli:prod -- search "typescript zod api"
npm run cli:prod -- session list
npm run cli:prod -- replay <trace-id>
npm run cli:prod -- list
```

### Automation and integrations

```bash
npm run cli:prod -- integrate codex
npm run cli:prod -- integrate claude
npm run cli:prod -- hooks install
npm run cli:prod -- hooks status
npm run cli:prod -- capture session --summary "durable checkpoint summary" --tool codex
npm run cli:prod -- capture changes --tool codex --summary "what changed and what remains"
npm run cli:prod -- watch --tool codex
```

### Correction loop

```bash
npm run cli:prod -- fix remember <decision-or-step-id> --target decision --rule
npm run cli:prod -- fix forget <memory-id> --rule
npm run cli:prod -- analyze-missing <session-id> --refresh
npm run cli:prod -- confidence show <memory-id>
npm run cli:prod -- conflicts detect
```

---

## API reference

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

---

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

---

## Limitations

- Codex uses repo instructions plus local helpers rather than native repo hooks
- Claude hook capture requires the local API to be running
- Automation ignores questions, conversational acknowledgements, system output (npm, build lines, stack traces), and stop-event summaries with no completion verbs; edit `signals.ts` to tune the wordlists
- The UI does not have a full rule-management screen — rules are created through feedback and exposed through the API and CLI
- Conflict resolution in the UI is currently dismissal-focused; richer conflict actions are available through the API and CLI

---

## Docs

- [Automatic memory pipeline](docs/automatic-memory.md)
- [Codex integration](docs/codex-integration.md)
- [Claude Code integration](docs/claude-code-integration.md)
- [Features](FEATURES.md)
- [Demo](DEMO.md)
- [Roadmap](ROADMAP.md)

---

## Development

```bash
npm run build
npm test
npm run lint
```
