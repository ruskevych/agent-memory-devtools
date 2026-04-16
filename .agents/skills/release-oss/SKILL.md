---
name: release-oss
description: Use when preparing Agent Memory Devtools for open-source release quality, including docs, screenshots, examples, issue templates, contribution flow, and consistency checks.
---

# Release OSS

## Release Bar

The repo should feel like a polished open-source devtool for local AI-agent memory. Keep docs accurate, demos runnable, and claims grounded in implemented behavior.

## Checklist

- README explains the problem, solution, quickstart, CLI, API, architecture, differences, roadmap, and contributing.
- FEATURES groups implemented capabilities by core memory, debugging/replay, Memory Fix Mode, Missing Memory Analysis, confidence/conflicts, and developer experience.
- DEMO can be followed in 2-3 minutes using seeded data.
- ROADMAP separates completed, in progress, next, future ideas, and out-of-scope work.
- Instruction files use the same terminology as README.
- Screenshots live under `docs/screenshots` or are clearly listed as placeholders.
- Commands match `package.json` scripts.

## Guardrails

- Do not describe planned features as implemented.
- Do not hide partial UI surfaces; call them out in roadmap or agent instructions.
- Keep language developer-friendly and specific. Avoid generic AI buzzwords.
