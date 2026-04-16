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

The supported Codex path is: what is this? TODO: clear 

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

Build and start the API (required for hooks):

```bash
npm run build
npm run dev:api
```

In a new terminal, verify hooks:

```bash
npm run cli:prod -- integrate claude
npm run cli:prod -- hooks status
```

Open the repo in Claude Code, use `/hooks` to confirm the project hooks are active, then make a meaningful edit.

The hooks will automatically capture durable prompts, file changes, and task summaries.

## Verification

Search memory:

```bash
npm run cli:prod -- search "automation capture memory"
```

Inspect the latest replay trace:

```bash
npm run cli:prod -- replay <trace-id>
```

List memories:

```bash
npm run cli:prod -- list
```

In the web UI, Memory Explorer now shows whether a memory came from automatic capture and whether the origin was a user prompt, agent summary, or file change.

Start the web UI:

```bash
npm run dev:web
```

Then visit `http://localhost:5173`

## CLI Surface

**Development mode** (rebuilds dependencies automatically):
```bash
npm run cli -- <command>
```

**Production mode** (faster, requires `npm run build` first):
```bash
npm run cli:prod -- <command>
```

### Core Memory

```bash
npm run cli:prod -- init
npm run cli:prod -- ingest examples/sample-session.txt
npm run cli:prod -- search "typescript zod api"
npm run cli:prod -- session list
npm run cli:prod -- replay <trace-id>
npm run cli:prod -- list
```

### Automation and Integrations

```bash
npm run cli:prod -- integrate codex
npm run cli:prod -- integrate claude
npm run cli:prod -- hooks install
npm run cli:prod -- hooks status
npm run cli:prod -- capture session --summary "durable checkpoint summary" --tool codex
npm run cli:prod -- capture changes --tool codex --summary "what changed and what remains"
npm run cli:prod -- watch --tool codex
```

### Correction Loop

```bash
npm run cli:prod -- fix remember <decision-or-step-id> --target decision --rule
npm run cli:prod -- fix forget <memory-id> --rule
npm run cli:prod -- analyze-missing <session-id> --refresh
npm run cli:prod -- confidence show <memory-id>
npm run cli:prod -- conflicts detect
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

## TypeScript Best Practices

This project uses TypeScript for type safety across the CLI, API, and UI. Follow these practices:

### Zod Schema-First Types

Define schemas in `packages/shared` and infer TypeScript types from them:

```typescript
// Good - single source of truth
const MemorySchema = z.object({
  id: z.string(),
  content: z.string(),
  metadata: z.record(z.unknown())
})
type Memory = z.infer<typeof MemorySchema>

// Avoid - duplicating structure
interface Memory {
  id: string
  content: string
  metadata: Record<string, unknown>
}
```

### Strict Null Checks

Always handle null and undefined explicitly:

```typescript
// Good
function getMemory(id: string): Memory | null {
  const result = db.query(id)
  return result ?? null
}

const memory = getMemory(id)
if (memory) {
  console.log(memory.content) // Safe
}

// Avoid - assuming non-null
function getMemory(id: string): Memory {
  return db.query(id)! // Dangerous assertion
}
```

### Type Assertions

Avoid `as` assertions unless absolutely necessary. Prefer type guards:

```typescript
// Good - type guard
function isMemory(obj: unknown): obj is Memory {
  return MemorySchema.safeParse(obj).success
}

if (isMemory(data)) {
  console.log(data.content) // TypeScript knows it's Memory
}

// Avoid - blind assertion
const memory = data as Memory // No runtime validation
```

### Generic Constraints

Use generic constraints for reusable functions:

```typescript
// Good
function findById<T extends { id: string }>(items: T[], id: string): T | null {
  return items.find(item => item.id === id) ?? null
}

// Avoid - overly permissive
function findById(items: any[], id: string): any {
  return items.find(item => item.id === id)
}
```

### Return Type Annotations

Always annotate public function return types:

```typescript
// Good - explicit contract
export function searchMemories(query: string): Memory[] {
  return db.search(query)
}

// Avoid - implicit return type
export function searchMemories(query: string) {
  return db.search(query)
}
```

### Discriminated Unions

Use discriminated unions for variant data:

```typescript
// Good
type CaptureEvent =
  | { type: 'user-prompt'; content: string }
  | { type: 'file-change'; path: string; diff: string }
  | { type: 'task-complete'; summary: string }

function handleEvent(event: CaptureEvent) {
  switch (event.type) {
    case 'user-prompt':
      return processPrompt(event.content)
    case 'file-change':
      return processDiff(event.path, event.diff)
    case 'task-complete':
      return processSummary(event.summary)
  }
}
```

### Avoid `any`

Use `unknown` for truly unknown types, then validate:

```typescript
// Good
function processData(data: unknown): Memory {
  const parsed = MemorySchema.parse(data) // Runtime check
  return parsed
}

// Avoid
function processData(data: any): Memory {
  return data // No safety
}
```

### Type Imports

Use type-only imports when importing only types:

```typescript
// Good
import type { Memory, ReplayTrace } from '@agent-memory/shared'
import { MemorySchema } from '@agent-memory/shared'

// Avoid - can cause circular dependencies
import { Memory, MemorySchema } from '@agent-memory/shared'
```

## Tailwind Best Practices

The UI (`apps/web`) uses Tailwind CSS. Follow these practices for consistency and maintainability:

### Utility-First Approach

Prefer Tailwind utilities over custom CSS:

```tsx
// Good
<div className="flex items-center gap-4 px-6 py-3">

// Avoid
<div className="custom-container" style={{ display: 'flex' }}>
```

### Component Extraction

Extract repeated patterns into React components, not `@apply` directives:

```tsx
// Good
function Card({ children }) {
  return <div className="rounded-lg border bg-white p-6 shadow-sm">{children}</div>
}

// Avoid creating @apply classes in CSS files
```

### Theme Configuration

Use theme values from `tailwind.config.js` instead of arbitrary values:

```tsx
// Good - uses theme spacing
<div className="p-4 gap-2">

// Avoid - arbitrary values should be rare
<div className="p-[17px] gap-[9px]">
```

### Responsive Design

Mobile-first responsive utilities:

```tsx
<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
```

### Conditional Classes

Use `clsx` or `cn` helper for conditional classes:

```tsx
import { cn } from '@/lib/utils'

<button className={cn(
  "px-4 py-2 rounded",
  isActive && "bg-blue-500 text-white",
  !isActive && "bg-gray-100 text-gray-700"
)}>
```

### Color Consistency

Use semantic color names from the theme:

```tsx
// Good
className="text-gray-700 bg-blue-50 border-gray-200"

// Avoid mixing color systems
className="text-slate-700 bg-blue-50 border-zinc-200"
```

### Performance

- Group related utilities logically (layout → spacing → colors → typography)
- Avoid duplicating the same utility combinations across many files
- Use PurgeCSS-safe dynamic class construction
