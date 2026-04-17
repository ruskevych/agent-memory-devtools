---
name: memory-capture
description: Use when a Codex task changes durable repo behavior, introduces important codebase context, or reaches a meaningful checkpoint that should become memory.
---

# Memory-Capture Skill – Agent Memory Devtools

You are using **Agent Memory Devtools** — a local SQLite memory layer that is the single source of truth for durable project knowledge.

**Goal:** Make every new request start with perfect context and end with perfect memory updates.

## 1. Memory Using (New Request Workflow – ALWAYS do this first)

At the very beginning of every new user request or task:

1. Run a targeted memory search:
   ```bash
   npm run cli:prod -- search "<2-4 most important keywords from the request>" --limit 8
   ```
   Example: `npm run cli:prod -- search "automation capture CLI hooks" --limit 8`

2. If the search returns anything relevant, also check the latest replay trace:
   ```bash
   npm run cli:prod -- replay <trace-id-from-search>
   ```

3. Read the returned memories before you think or plan. Explicitly reference them in your reasoning (e.g. "From memory ID 42 we already decided X…").

4. If the search shows missing context you know should exist, immediately run:
   ```bash
   npm run cli:prod -- analyze-missing <session-id-if-known> --refresh
   ```

Never rely on your own internal knowledge alone when a memory exists.

## 2. Memory Saving (Capture Workflow – you must be explicit)

Codex has no automatic hooks. After file changes or architecture decisions:

```bash
npm run cli:prod -- capture changes --tool codex --summary "Concise one-line description of what changed and why it matters"
```

At the end of a task or session:

```bash
npm run cli:prod -- capture session --tool codex --summary "Durable checkpoint: key decisions, preferences, and remaining work"
```

Best-practice capture rules:
- Use the memory kinds the system expects: `fact`, `preference`, `codebase-context`, `task-context`.
- Write actionable, future-proof summaries — someone reading this in 3 months should understand it instantly.
- Attach evidence: changed files, routes, schemas, CLI commands.

If you spot a bad capture or something that should have been stored, fix it immediately:

```bash
npm run cli:prod -- fix remember <memory-or-decision-id> --rule
npm run cli:prod -- fix forget <memory-id> --rule
```

## 3. Golden Rules

- **Search first, act second.** Never plan without checking memory.
- **Capture last.** Never end a turn without a capture if you touched code, made a decision, or changed workflow.
- **Be explicit.** Watch mode is conservative — it only stores strong signals. When something is truly important, capture it manually with a clear summary.
- **Use replay traces** whenever you want to understand why something was or wasn't stored.
- **Prefer memory over repetition.** If the answer is already in memory, say "Per existing memory ID X: …" instead of re-explaining.
