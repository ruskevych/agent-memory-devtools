---
name: ship-readme
description: Use when updating README.md, FEATURES.md, DEMO.md, ROADMAP.md, AGENTS.md, CLAUDE.md, or other public docs for Agent Memory Devtools.
---

# Ship README

Before editing docs, inspect the implementation in:

- `packages/memory-core/src`
- `apps/api/src/app.ts`
- `packages/cli/src/index.ts`
- `apps/web/src/App.tsx`

Document implemented behavior only. The current product includes Memory Fix Mode, feedback, feedback-derived rules, Missing Memory Analysis, explainable retrieval and replay, confidence reports, conservative conflicts, local SQLite storage, API, CLI, and React UI.

Keep README concise and structured around problem, solution, key features, quickstart, CLI, API, architecture, differences, roadmap, and contributing.

Call out partial surfaces accurately: rules are mostly API/CLI plus feedback-created UI behavior; UI conflict resolution is currently dismissal-focused.
