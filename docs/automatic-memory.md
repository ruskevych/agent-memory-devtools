# Automatic Memory

A deterministic local automation pipeline captures, filters, classifies, and stores durable memory from real coding sessions.

## Event Sources

The automation pipeline accepts these event types:

- `user-prompt`
- `agent-summary`
- `file-change`
- `task-complete`
- `session-checkpoint`

Each event records:

- tool: `codex`, `claude-code`, or `generic`
- trigger: `hook`, `watch`, `cli`, or `manual`
- source metadata
- optional changed-file evidence

## What The Pipeline Does

1. normalizes incoming automation events
2. filters low-signal, noisy, or secret-like content
3. dedupes repeated automatic captures
4. turns accepted events into normal session steps
5. runs the existing ingestion pipeline (chunking, classification, rules, dedupe)
6. patches replay traces with automation stages

The result is normal memory with full feedback, rules, confidence, conflicts, and replay traces. Automatic capture is not a separate hidden store.

## Signal Detection

Signal detection uses generic wordlists in `packages/memory-core/src/signals.ts`. These lists are not specific to any project, tool, or framework — they describe universal developer intent.

**Durable instruction signals** — explicit preference verbs (`prefer`, `always`, `never`, `avoid`, `ensure`, `enforce`), approach nouns (`workflow`, `convention`, `style`, `pattern`, `guideline`, `rule`, `principle`, `standard`), and multi-word phrases (`we always use`, `use X instead`, `when writing`, `from now on`).

**Completion signals** — 60+ past-tense verbs that indicate completed work: create (`built`, `implemented`, `scaffolded`), modify (`refactored`, `improved`, `standardized`), fix (`debugged`, `resolved`, `squashed`), remove (`deprecated`, `pruned`), ship (`deployed`, `released`, `merged`), configure (`integrated`, `wired`, `registered`), and more.

**Continuation signals** — 28 terms for unresolved or ongoing work: `todo`, `blocked`, `wip`, `backlog`, `deferred`, `outstanding`, `next steps`, and more.

**Codebase context signals** — path prefixes (`src/`, `packages/`), languages, frameworks, databases, architecture terms, and file extensions.

To tune what gets captured, edit the wordlists in `signals.ts` — changes propagate to both the automation and ingestion pipelines automatically.

## Replay Visibility

Automatic traces add two stages ahead of normal ingestion:

- `automation-events`
- `automation-filtering`

These stages show what arrived, what was accepted, what was ignored, and why.

## Chunking

The ingestion pipeline splits content at paragraph boundaries (`\n\n`) first. Sentence-level splitting only applies to paragraphs longer than 500 characters. This prevents a two-sentence conversational reply from becoming two separate memory candidates.

## Noise Suppression

The pipeline rejects content at two layers — automation filtering and ingestion classification.

**Rejected at automation (event level):**
- conversational acknowledgements — 33 exact-match phrases (`ok`, `done`, `sure`, `sounds good`, `my bad`, etc.)
- questions — any event content ending with `?`
- system output — npm fund notices, vulnerability counts, audited package lines, build completion lines, stack trace lines, test runner summaries
- secret-like content — tokens, passwords, private keys

**Rejected at ingestion (chunk level):**
- any chunk matching the above patterns
- `fact`-kind chunks scoring below importance 0.40 (raised from 0.28) — plain conversational sentences default to 0.32 and are now below the bar
- chunks where the assistant stop-event message was pre-filtered by the hook before it reached the API

**Hook pre-filtering (Claude Code stop events):**
Before the `Stop` hook submits a `last_assistant_message` as an `agent-summary`, it scans the message sentence-by-sentence and only forwards sentences that contain a completion verb. Conversational responses that describe intent but contain no completed work are dropped at the hook.

## Code-Change Capture

Changed files are summarized with deterministic heuristics. The pipeline uses `CODEBASE_CONTEXT_RE` from `signals.ts` to identify meaningful changes — frameworks, languages, database terms, architecture terms, file extensions, and path prefixes. Evidence file paths are stored on resulting memories.

## What Is Automatic

- Claude Code hooks submit events without manual CLI commands
- Codex watch mode submits file-change events automatically

## What Is Explicit

- transcript imports
- manual checkpoints
- Codex prompt and summary capture
- correction through feedback and rules

## Verification

```bash
npm run dev:api
npm run cli -- capture changes --tool codex --summary "Added automation capture routes and UI visibility."
npm run cli -- replay <trace-id>
```

In Memory Explorer, confirm:

- automatic badge
- source type and trigger
- origin event type
- evidence file paths when present
