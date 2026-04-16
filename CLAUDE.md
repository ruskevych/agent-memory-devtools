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

4. **Work normally** - the hooks will automatically capture:
   - Durable `UserPromptSubmit` prompts
   - `PostToolUse` edit/write activity
   - `TaskCompleted` summaries
   - `Stop` event summaries
   - `SessionEnd` flushes for pending changed files

The hook helper is `.claude/hooks/agent-memory-hook.mjs`.

### Verification Commands

Check what was captured:

```bash
npm run cli:prod -- list
npm run cli:prod -- search "your query"
npm run cli:prod -- replay <trace-id>
```

### Manual Capture Commands

Use these when you need an explicit checkpoint or want to inspect behavior:

```bash
npm run cli:prod -- capture changes --tool claude-code --summary "what changed and what remains"
npm run cli:prod -- capture session --summary "durable checkpoint summary" --tool claude-code
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
