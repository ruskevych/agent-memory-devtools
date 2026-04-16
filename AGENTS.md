# Agent Instructions

Agent Memory Devtools is a local-first, debuggable, correctable memory layer for AI coding agents.

Use the same product terms everywhere:

- memory
- feedback
- rules
- missing-memory suggestions
- confidence
- conflicts
- replay traces
- Memory Fix Mode

## Working In This Repo

- Keep SQLite as the source of truth and keep deterministic local behavior on the critical path.
- Do not introduce hosted sync, auth, teams, or remote memory dependencies.
- Use existing package boundaries and shared Zod schemas.
- Document implemented behavior only.
- To tune what gets captured or ignored, edit `packages/memory-core/src/signals.ts` — it is the single source for all signal wordlists used by both the automation and ingestion pipelines.

## Codex Workflow In This Repo

Codex does not have a native project hook lifecycle here. Do not pretend it does.

Supported path:

- automatic code-change capture through `npm run cli -- watch --tool codex`
- explicit checkpoint capture through `npm run cli -- capture changes --tool codex --summary "..."`
- replay and correction through the existing UI, CLI, feedback, and rules

Use `.agents/skills/memory-capture/SKILL.md` when work should update memory.

## Claude Code Workflow In This Repo

Claude Code uses committed project hooks from `.claude/settings.json`.

Hooks can capture:

- durable user prompts
- changed files after edit/write tools
- task-complete summaries
- end-of-turn assistant summaries

Use `.claude/skills/memory-capture/SKILL.md` for the repo-specific workflow.

## Read Next

- `docs/automatic-memory.md`
- `docs/codex-integration.md`
- `docs/claude-code-integration.md`

## Validation

```bash
npm run build
npm test
npm run lint
```
