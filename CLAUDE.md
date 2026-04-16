# Claude Instructions

Agent Memory Devtools is a local-first, debuggable, correctable memory system for AI coding agents.

## Product Guardrails

- Keep SQLite as the source of truth.
- Keep deterministic local heuristics and replay traces visible.
- Do not claim hosted sync, auth, teams, enterprise policy management, or remote vector databases are implemented.
- Keep rule and conflict UI limits explicit:
  - rules are created through feedback and exposed through API/CLI
  - the UI does not have a full rule-management screen
  - the UI can dismiss visible conflicts, while API/CLI expose richer conflict actions

## Current Integration Path

This repo ships a real Claude Code project hook path in `.claude/settings.json`.

Automatic capture can happen after:

- durable `UserPromptSubmit` prompts
- `PostToolUse` edit/write activity
- `TaskCompleted`
- `Stop`
- `SessionEnd` flushes for pending changed files

The hook helper is `.claude/hooks/agent-memory-hook.mjs`.

## Manual Commands

Use these when you need an explicit checkpoint or want to inspect behavior:

```bash
npm run cli -- hooks status
npm run cli -- capture changes --tool claude-code --summary "what changed and what remains"
npm run cli -- capture session --summary "durable checkpoint summary" --tool claude-code
npm run cli -- replay <trace-id>
```

## Read Before Editing Docs

- `docs/automatic-memory.md`
- `docs/claude-code-integration.md`
- `README.md`

## Validation

```bash
npm run build
npm test
npm run lint
```
