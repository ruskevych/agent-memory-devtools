# Codex + Claude Integration Plan

Goal: make Agent Memory Devtools usable as a real local memory layer for Codex and Claude Code with automatic memory updates, clear setup docs, visible replay traces, and honest product boundaries.

Status legend:

- `[done]` completed
- `[in-progress]` actively being implemented
- `[next]` queued next
- `[later]` dependent follow-up

## Current Repo State

- `[done]` Inspected `AGENTS.md`, `CLAUDE.md`, `.agents/skills`, `.claude/skills`, and `.claude/agents`.
- `[done]` Confirmed there is no existing `.claude/settings.json` or project hook configuration yet.
- `[done]` Confirmed current product already includes ingestion, retrieval, feedback, rules, missing-memory suggestions, confidence, conflicts, replay traces, API routes, CLI commands, and UI inspection surfaces.
- `[done]` Confirmed there are no Codex-specific or Claude-specific integration docs yet.
- `[done]` Confirmed current CLI/API ingest flows are manual and transcript-oriented, not workflow-event oriented.

## Implementation Plan

### 1. Shared Automation Contract

- `[done]` Added shared schemas for automated workflow events and capture decisions.
- `[done]` Extended source metadata so memories can say whether they came from Codex, Claude Code, hooks, watch mode, or manual capture.
- `[done]` Defined deterministic capture inputs for:
  - user prompt / instruction events
  - agent summary events
  - file change events
  - task completion events
  - session checkpoint events

### 2. Memory-Core Automation Pipeline

- `[done]` Added a core automation capture pipeline that filters noisy events, derives memory-worthy inputs, and reuses existing ingestion.
- `[done]` Patched replay traces so automatic capture stages are visible:
  - incoming events
  - filtering and ignore reasons
  - code-change-derived summaries
  - downstream ingestion decisions
- `[done]` Added dedupe safeguards for repeated automatic captures.
- `[done]` Kept all automation local-first and deterministic.

### 3. Code-Change-Aware Capture

- `[done]` Added deterministic changed-file heuristics for codebase-context memories.
- `[done]` Detect meaningful signals such as:
  - dependency additions/removals
  - schema or route changes
  - CLI command additions
  - UI surface changes
  - repeated architecture/path changes
- `[done]` Attached evidence files and change summaries to stored memories and replay traces.

### 4. Claude Code Integration

- `[done]` Added committed project hook config in `.claude/settings.json`.
- `[done]` Added hook helpers under `.claude/hooks/` for:
  - `UserPromptSubmit`
  - `PostToolUse` for edit/write tools
  - `Stop`
  - `TaskCompleted`
- `[done]` Kept hooks deterministic, local, and debounced so they do not spam memory.
- `[done]` Updated `CLAUDE.md` and `.claude/skills` with the real memory-aware workflow.

### 5. Codex Integration

- `[done]` Kept `AGENTS.md` short and made the supported Codex path explicit.
- `[done]` Added a Codex memory-capture skill under `.agents/skills/`.
- `[done]` Implemented the best practical Codex-native workflow without pretending there are native hooks:
  - repo instructions
  - capture helpers
  - watch mode for automatic file-change capture
  - explicit checkpoint/end-of-task capture commands
- `[done]` Documented what is automatic versus semi-automatic for Codex.

### 6. CLI and API Surface

- `[done]` Added CLI commands for:
  - `integrate codex`
  - `integrate claude`
  - `capture session`
  - `capture changes`
  - `watch`
  - `hooks install`
  - `hooks status`
- `[done]` Added API support for automation capture so hooks and helpers can submit event batches cleanly.
- `[done]` Added CLI-focused tests for install/status/capture helpers where practical.

### 7. UI Visibility

- `[done]` Surfaced automatic capture origin in Memory Explorer.
- `[done]` Surfaced automation filtering stages in Replay Viewer.
- `[done]` Showed whether memories came from prompt, summary, file change, or task completion.
- `[done]` Kept feedback/rule influence visible on automatically captured memories.

### 8. Documentation Refresh

- `[done]` Updated:
  - `README.md`
  - `FEATURES.md`
  - `DEMO.md`
  - `ROADMAP.md`
  - `AGENTS.md`
  - `CLAUDE.md`
- `[done]` Added:
  - `docs/codex-integration.md`
  - `docs/claude-code-integration.md`
  - `docs/automatic-memory.md`
- `[done]` Included exact setup commands, verification steps, limitations, and troubleshooting.

### 9. Validation

- `[done]` Added tests for automated event ingestion, code-change heuristics, dedupe/noise suppression, and hook/helper behavior.
- `[done]` Ran:
  - `npm run build`
  - `npm test`
  - `npm run lint`

## Execution Notes

- Codex does not get a fake native hook story. The shipped path should be instructions plus local automation helpers, with watch mode providing the strongest automatic file-change path.
- Claude Code should use real project hooks because the tool supports them.
- SQLite remains the source of truth.
- Deterministic local heuristics stay on the critical path; no hosted sync, auth, or remote dependencies.
