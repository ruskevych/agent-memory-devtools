# Contributing

Thanks for helping make Agent Memory Devtools a sharper open-source project.

## Project Principles

- Keep the core idea clear: inspectable, explainable local memory for coding agents.
- Prefer polish, clarity, tests, and docs over broad new scope.
- Do not add auth, hosted sync, enterprise policy layers, or mandatory remote services.
- Keep changes small enough to review.

## Good First Contribution Areas

- UI empty states and readability
- demo seed data
- retrieval explanation wording
- replay trace rendering
- README and screenshot updates
- eval fixtures and focused tests

## Local Workflow

```bash
npm install
npm run build
npm test
npm run lint
```

For the live demo:

```bash
npm run dev:api
npm run dev:web
```

## Pull Request Checklist

- [ ] The change supports inspectable local memory.
- [ ] The UI or CLI behavior is demoable when relevant.
- [ ] Tests were added or updated for behavior changes.
- [ ] README/docs were updated for user-facing changes.
- [ ] No generic placeholder copy remains.
- [ ] No auth, cloud sync, or enterprise scope was introduced.

## Larger Changes

Open an issue first for changes that alter memory semantics, ranking behavior, storage shape, or public API contracts.
