---
name: ship-readme
description: Use when updating README.md or user-facing docs for Agent Memory Devtools after implementation changes.
---

# Ship README

## Workflow

1. Inspect the implementation before editing docs.
2. Identify implemented, partial, and missing capabilities.
3. Update README first, then FEATURES, DEMO, ROADMAP, and instruction files.
4. Run a consistency pass for feature names, commands, and scope boundaries.

## README Structure

Use this shape unless the repo changes substantially:

- headline: "Debuggable, correctable memory system for AI coding agents"
- problem
- solution
- key features
- screenshots
- 60-second quickstart
- CLI usage
- API examples
- architecture
- local-first design
- why this is different
- development
- roadmap
- contributing

## Accuracy Rules

- Mention Memory Fix Mode, Missing Memory Analysis, explainable retrieval/replay, confidence, conflicts, and local-first design only as implemented.
- Keep rules precise: API/CLI support rule listing and toggling; UI creates rules through feedback actions but does not have a full rule-management screen.
- Keep conflict wording precise: UI can detect and dismiss; API/CLI support more resolution actions.
- Check command examples against `package.json` and `packages/cli/src/index.ts`.
