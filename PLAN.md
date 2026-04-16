# Agent Memory Product Evolution Plan

Goal: evolve Agent Memory Devtools from "a memory storage tool" into "a debuggable, correctable, self-improving memory system for AI agents" while keeping the current local-first MVP architecture intact.

This plan is intentionally additive. It extends the existing ingestion, retrieval, replay, API, UI, CLI, and SQLite layers without replacing the core architecture or introducing external services.

## Current Architecture Summary

### Active Package Boundaries

- `packages/shared/src/index.ts`
  - Owns Zod schemas and shared TypeScript types.
  - Current durable model includes `Memory`, `MemoryFact`, `MemoryEvent`, `Session`, `SessionStep`, `ReplayTrace`, `MemoryDecision`, `MemoryMutation`, `SearchRequest`, and dashboard stats.
  - `Memory` already has `confidence`, `importance`, `pinned`, `archived`, `duplicateOf`, `mergedInto`, `relatedSessionId`, and flexible `metadata`.

- `packages/memory-core/src/store.ts`
  - Owns SQLite persistence through a generic JSON table pattern.
  - Tables are all shaped as `id`, optional `memory_id`, `created_at`, `updated_at`, and `data`.
  - Current tables: `memories`, `facts`, `events`, `embeddings`, `sessions`, `session_steps`, `traces`, `decisions`, and `mutations`.
  - This makes adding new typed tables low-friction, but there is no robust versioned migration system beyond `CREATE TABLE IF NOT EXISTS`.

- `packages/memory-core/src/ingestion.ts`
  - Normalizes ingest input into sessions and steps.
  - Chunks transcript content.
  - Classifies candidate memory kind, importance, confidence, tags, and reason using deterministic heuristics.
  - Ignores low-importance candidates.
  - Dedupes with token Jaccard overlap against existing active memories.
  - Stores memories, facts, events, decisions, and ingestion replay traces.

- `packages/memory-core/src/retrieval.ts`
  - Searches active, non-merged memories.
  - Ranks with keyword match, deterministic hash embedding similarity, recency, pinned boost, importance, and same-session source boost.
  - Writes retrieval replay traces with score components.
  - Does not currently persist usage events for returned or selected memories.

- `packages/memory-core/src/service.ts`
  - Facade used by API and CLI fallback.
  - Owns `ingest`, `search`, memory CRUD, merge, sessions, traces, stats, and mutations.
  - Existing user actions already write `MemoryMutation` records.

- `apps/api/src/app.ts`
  - Fastify API exposes health, stats, memory CRUD, merge, sessions, ingest, search, replay, and seed endpoints.
  - API contracts are simple and should remain backward-compatible.

- `apps/web/src/App.tsx`
  - Single-file React app with Dashboard, Memory Explorer, Session Explorer, Replay Viewer, and Settings.
  - Memory Explorer already supports search, filters, detail panel, pin, archive, delete, merge, score breakdown, and source/dedupe details.
  - Session Explorer shows timeline and related memories.
  - Replay Viewer shows ingestion/retrieval stages, decisions, ranked results, and score components.

- `packages/cli/src/index.ts`
  - Commander CLI exposes `init`, `ingest`, `search`, `list`, `session list`, `replay`, and `dev:seed`.
  - Commands prefer the API and fall back to local core for core operations.

### What Is Reusable

- `MemoryMutation` is reusable for user-visible fixes such as edits, pin/archive, restore, merge, and delete.
- `ReplayTrace` and `MemoryDecision` are reusable for explaining why a memory was created, ignored, merged, or retrieved.
- Existing `confidence` and `importance` fields give the confidence system a place to write final scores without changing core memory shape.
- `metadata` can carry compatibility-safe details during the first implementation, but important new records should become first-class shared schemas.
- `SessionStep` and `MemoryDecision` give Missing Memory Analysis enough raw material to analyze what was ignored or never extracted.
- `listMemories`, `listSessions`, `getSession`, `listTraces`, `listDecisions`, and `listMutations` are strong extension points for new analysis endpoints.
- The UI already has the right product surfaces: Memory Explorer for correction, Session Explorer for missed memories, Replay Viewer for auditability.

### What Needs Extension

- First-class feedback records, not only generic memory mutations.
- Durable user rules or adjustments that influence future ingestion, dedupe, and ranking.
- A way to expose candidate-like missed-memory suggestions after ingestion without storing them as accepted memories.
- Usage tracking for retrieval results and opened/accepted memories.
- Conflict detection records or reports.
- Confidence breakdowns that explain the numeric `Memory.confidence` value.
- Store methods and API endpoints for feedback, analysis, usage, conflicts, and confidence reports.
- Tests for correction effects, missing-memory heuristics, usage tracking, and confidence/conflict behavior.

### Risks To Existing Behavior

- Ingestion regressions if feedback rules are applied directly inside the current private `classifyCandidate` and `findDuplicate` logic without clear boundaries.
- Retrieval ranking regressions if confidence and usage are added as large score factors too early.
- API compatibility risk if `MemorySchema` is made stricter or existing endpoint response shapes are changed.
- Store migration risk because the current schema is generic but table creation is manually listed in `tableNames`.
- UI state risk because `App.tsx` is already large; adding feature panels without careful component extraction could make behavior hard to maintain.
- Test fragility around ranking weights if confidence and usage alter existing expected result order.
- Product confusion if "fix", "archive", "delete", "feedback", and "rule" are not clearly separated.

### Missing Data Structures

Add these as shared schemas in `packages/shared/src/index.ts` and store them in new JSON tables in `packages/memory-core/src/store.ts`.

- `MemoryFeedback`
  - Captures user corrections against a memory, decision, session step, or retrieval result.
  - Suggested fields: `id`, `targetType`, `targetId`, `memoryId`, `sessionId`, `traceId`, `type`, `actor`, `reason`, `patch`, `createdAt`, `appliedAt`, `status`, `metadata`.

- `MemoryRule`
  - Durable deterministic adjustment derived from user feedback.
  - Suggested fields: `id`, `scope`, `condition`, `effect`, `enabled`, `createdFromFeedbackId`, `createdAt`, `updatedAt`, `metadata`.

- `MissingMemorySuggestion`
  - A reviewable candidate for something that likely should have been remembered.
  - Suggested fields: `id`, `sessionId`, `stepIds`, `content`, `summary`, `kind`, `tags`, `reason`, `evidence`, `score`, `matchedMemoryIds`, `status`, `createdAt`, `resolvedAt`, `metadata`.

- `MemoryUsage`
  - A retrieval/use event for a memory.
  - Suggested fields: `id`, `memoryId`, `traceId`, `query`, `rank`, `score`, `event`, `timestamp`, `metadata`.

- `MemoryConflict`
  - A deterministic conflict report between two or more memories or facts.
  - Suggested fields: `id`, `memoryIds`, `kind`, `subject`, `summary`, `severity`, `status`, `detectedAt`, `resolvedAt`, `metadata`.

- `MemoryConfidenceReport`
  - Computed or cached explanation for confidence.
  - Suggested fields: `memoryId`, `confidence`, `components`, `reasons`, `updatedAt`, `metadata`.

## Design Principles

- Keep the core deterministic and explainable.
- Prefer small local heuristics over model calls or external dependencies.
- Preserve existing endpoint contracts; add endpoints instead of changing current responses.
- Store correction and analysis records separately from `Memory` so raw memory history remains auditable.
- Let Phase 1 create correction signals that Phase 2 and Phase 3 can use.
- Make every phase independently testable through core unit tests, API endpoints, CLI commands, and at least one UI path.

## Phase 1: Memory Fix Mode

### Product Outcome

Users can correct memory behavior, not just edit stored text. A user should be able to say:

- This should have been remembered.
- This should not be remembered.
- This memory is the wrong kind.
- This is a duplicate of that memory.
- This memory should be more or less important.
- Future ingestion should follow this correction.

### Integration Points

- `Memory Explorer`
  - Primary place for fixing an existing memory.
  - Add a "Fix" section in the detail panel with structured actions.

- `Replay Viewer`
  - Add correction actions beside ingestion decisions, especially ignored candidates and merge decisions.
  - This is where users can fix "you ignored the wrong thing".

- `Session Explorer`
  - Later in Phase 1, allow creating a memory from a selected session step.
  - This becomes a bridge to Missing Memory Analysis in Phase 2.

- `MemoryService`
  - Add methods such as `addFeedback`, `applyFeedback`, `listFeedback`, `createRuleFromFeedback`, and `listRules`.

- `IngestionPipeline`
  - Apply enabled `MemoryRule` records during candidate classification, ignore thresholding, and dedupe.

- `RetrievalEngine`
  - Do not change retrieval scoring heavily in Phase 1.
  - Optionally apply simple feedback-derived boosts only when a rule explicitly targets ranking.

### Data Model

Add `MemoryFeedbackSchema`:

- `targetType`: `"memory" | "decision" | "session-step" | "retrieval-result"`
- `type`: `"should-remember" | "should-not-remember" | "wrong-kind" | "wrong-tags" | "wrong-summary" | "wrong-content" | "wrong-merge" | "duplicate" | "boost-importance" | "lower-importance"`
- `status`: `"pending" | "applied" | "dismissed"`
- `patch`: flexible but typed as metadata for MVP compatibility.

Add `MemoryRuleSchema`:

- `scope`: `"ingestion" | "dedupe" | "retrieval"`
- `condition`: deterministic JSON condition such as text contains tokens, source type, memory kind, tag, or target id.
- `effect`: deterministic JSON effect such as force kind, add tags, boost importance, lower importance, force store, force ignore, never merge pair, merge target.
- `enabled`: boolean.

Store tables:

- `feedback`
- `rules`

### How Feedback Affects Importance Scoring

Minimal deterministic approach:

- `boost-importance`
  - Immediately patch selected memory `importance = min(1, importance + 0.15)`.
  - Create an ingestion rule if the user opts into future behavior, for example matching the memory's kind and strongest tags.

- `lower-importance`
  - Immediately patch selected memory `importance = max(0, importance - 0.15)`.
  - If importance falls below a low threshold and memory is not pinned, suggest archive rather than auto-delete.

- `should-remember`
  - If target is an ignored decision or session step, create a manual memory with source type `manual`, related session id, and metadata linking feedback id.
  - Add a rule with effect `forceStore` or `importanceBoost`.

- `should-not-remember`
  - Archive the memory by default, preserving history.
  - Add a rule with effect `forceIgnore` for closely matching future candidates.

### How Feedback Affects Deduplication

Minimal deterministic approach:

- `duplicate`
  - Use existing `mergeMemory(sourceId, targetId)` for immediate behavior.
  - Create a rule effect `preferCanonicalMemoryId` for future candidates similar to the source/target content.

- `wrong-merge`
  - Restore the source memory by clearing `archived`, `duplicateOf`, and `mergedInto`.
  - Remove the source id from target `metadata.mergedDuplicateIds`.
  - Create a rule effect `neverMergePair` for that pair and optionally matching summaries.

- Adjust `findDuplicate` through a small `DedupePolicy` helper rather than embedding rule logic in the existing loop.

### How Feedback Affects Ingestion Decisions

Minimal deterministic approach:

- Extract existing classification and dedupe helpers into policy-friendly helpers:
  - `classifyCandidate`
  - `applyIngestionRules`
  - `findDuplicate`
  - `applyDedupeRules`
- Rules run after base classification and before ignore thresholding.
- Rule effects should be included in replay stages so users can see why behavior changed.
- Feedback-applied decisions should create `MemoryDecision` entries with action `update` or metadata `ruleIds`.

### API Design

Add endpoints without changing existing ones:

- `GET /feedback?memoryId=&sessionId=&status=`
- `POST /feedback`
  - Payload: `{ targetType, targetId, type, reason?, patch?, apply?: boolean, createRule?: boolean }`
  - Response: `{ feedback, memory?, rule?, mutation? }`

- `POST /feedback/:id/apply`
  - Payload: `{ createRule?: boolean }`
  - Response: `{ feedback, memory?, rule?, mutation? }`

- `GET /rules?scope=&enabled=`
- `POST /rules`
- `PATCH /rules/:id`

Nice-to-have but not required in MVP:

- `POST /memories/:id/fix`
  - Thin convenience wrapper around `POST /feedback`.

### UI Changes

- Memory Explorer detail panel:
  - Add "Fix memory" section.
  - Actions: mark correct/incorrect, change kind, adjust importance, create duplicate merge, archive as "should not remember".
  - Show recent feedback records for the selected memory.
  - Show active rules that affect the memory when available.

- Memory table:
  - Add a small feedback indicator when feedback exists.
  - Keep quick actions unchanged for compatibility.

- Replay Viewer:
  - For ignored ingestion decisions, add "Remember this" action.
  - For merge decisions, add "Wrong merge" action.
  - Show rule-applied metadata in stage items.

- Session Explorer:
  - Add a selected-step action: "Create memory from step".
  - Keep this simple in Phase 1; Phase 2 will add suggestions.

### CLI Support

Add commands:

- `agent-memory feedback add <target-id> --target memory|decision|session-step --type <type> --reason <text> --apply --rule`
- `agent-memory feedback list --memory <id> --status pending|applied`
- `agent-memory rule list`
- `agent-memory rule enable <id>`
- `agent-memory rule disable <id>`
- Convenience:
  - `agent-memory fix remember <decision-or-step-id>`
  - `agent-memory fix forget <memory-id>`
  - `agent-memory fix duplicate <source-id> <target-id>`

### Tests

- Feedback records can be created and listed.
- Applying `should-not-remember` archives memory and writes a mutation.
- Applying `should-remember` to an ignored decision creates a memory linked to the original trace.
- Duplicate feedback reuses existing merge behavior.
- A `forceIgnore` or `importanceBoost` rule changes a later ingestion decision and appears in the replay trace.

### Minimal Powerful Version

Implement only:

- Feedback table and schema.
- Rule table and schema.
- `should-remember`, `should-not-remember`, `boost-importance`, `lower-importance`, and `duplicate`.
- Memory Explorer detail fixes.
- Replay ignored-decision "Remember this".
- CLI feedback list/add and three fix shortcuts.

Defer:

- Complex rule builder UI.
- Bulk feedback.
- Auto-learning rules without user confirmation.
- Deleting memories automatically from negative feedback.

### Complexity

Large. This phase touches shared schemas, store, service, ingestion, API, web UI, CLI, and tests. It is still the right first phase because it creates the feedback substrate for the other two features.

## Phase 2: Missing Memory Analysis

### Product Outcome

Users can inspect a session and see likely memories that were missed, with deterministic reasons and one-click promotion to real memory.

### Integration Points

- `Session Explorer`
  - Primary UI surface.
  - Add an "Analysis" section for the selected session.

- `Replay Viewer`
  - Secondary surface.
  - Link analysis suggestions back to ignored decisions or source steps.

- `MemoryService`
  - Add `analyzeMissingMemories(sessionId)` and suggestion lifecycle methods.

- `IngestionPipeline`
  - Reuse chunking/classification logic where possible, but do not automatically store suggestions.

- `Store`
  - Add `missing_suggestions` table.

### Algorithm Design: No Heavy ML

Use deterministic heuristics over session steps, existing memories, and decisions.

1. Candidate extraction
   - Reuse the current chunking and candidate classification behavior.
   - Add a public/internal analyzer that can classify without storing.
   - Include ignored decisions from the session's ingestion trace when available.

2. Repeated concepts
   - Tokenize session steps.
   - Build normalized noun-ish/keyphrase candidates from:
     - repo paths
     - package/framework names already recognized by `extractTags`
     - preference/task phrases
     - repeated capitalized or code-like terms
   - Count repeated concepts across steps.
   - Boost suggestions when a concept appears in multiple steps or appears in both user and assistant messages.

3. Missed facts
   - Detect durable patterns:
     - preference: `prefer`, `always`, `never`, `avoid`, `use X instead`
     - task context: `todo`, `follow up`, `blocked`, `remaining`, `still need`
     - codebase context: paths, package names, schema/API/database terms
     - facts: `X is`, `X uses`, `X lives in`, `X should`
   - Include candidates just below the ingestion threshold.
   - Include ignored decisions with high confidence but low importance.

4. Compare with existing memory
   - Use token Jaccard and existing deterministic embeddings.
   - If nearest active memory overlap is above dedupe threshold, mark as already covered.
   - If overlap is medium, surface as "possibly covered" with matched memory ids.
   - Only return suggestions that are not already confidently covered.

5. Ranking suggestions
   - Score with:
     - durability signal
     - repeated concept count
     - specificity/tag count
     - not-covered penalty
     - source role boost for user/system instructions
   - Keep threshold conservative to avoid noisy suggestions.

### Data Model

Add `MissingMemorySuggestionSchema`:

- `status`: `"open" | "accepted" | "dismissed"`
- `evidence`: array of short evidence records `{ stepId, snippet, reason }`
- `matchedMemoryIds`: existing memories that partially or fully overlap.
- `score`: deterministic 0 to 1 suggestion strength.

Store table:

- `missing_suggestions`

### API Design

- `POST /sessions/:id/analyze-missing`
  - Payload: `{ refresh?: boolean, limit?: number }`
  - Response: `{ sessionId, suggestions, analyzedAt }`

- `GET /sessions/:id/missing`
  - Returns existing suggestions for the session.

- `POST /missing/:id/accept`
  - Creates a memory from the suggestion using source type `manual`, metadata linking suggestion id, and related session id.
  - Marks suggestion as accepted.

- `POST /missing/:id/dismiss`
  - Marks suggestion as dismissed.

### CLI Command

- `agent-memory analyze-missing <session-id> --limit <number>`
  - Prints ranked suggestions with score, kind, reason, and matched memory ids.

- `agent-memory missing accept <suggestion-id>`
- `agent-memory missing dismiss <suggestion-id>`

### UI Integration

- Session Explorer:
  - Add "Analyze missing memories" action.
  - Show suggestion cards below timeline or in a dedicated right-panel section.
  - Each suggestion shows kind, summary, score, reason, evidence snippets, matched existing memories, and Accept/Dismiss.

- Replay Viewer:
  - If selected trace is an ingestion trace, show a link/action to analyze its session.
  - For ignored decisions, show whether they became missing-memory suggestions.

### Tests

- Analysis finds a repeated preference that ingestion ignored or failed to store.
- Analysis suppresses a suggestion when an existing memory has high overlap.
- Accepting a suggestion creates a memory and records a mutation/feedback link.
- Dismissing a suggestion hides it from default session analysis output.
- CLI command works through API fallback.

### Minimal Powerful Version

Implement only:

- Session-level analysis endpoint.
- Suggestion persistence.
- Repeated concept and missed durable-pattern heuristics.
- Accept/Dismiss actions.
- Session Explorer integration.
- CLI analyze and accept/dismiss commands.

Defer:

- Cross-session missing-memory analysis.
- Sophisticated phrase parsing.
- Background automatic analysis after every ingest.
- Suggestion clustering across sessions.

### Complexity

Medium. Most logic can live in a new analyzer module and reuse existing store/session/memory primitives. The hardest part is extracting classification helpers from ingestion without changing ingestion behavior.

## Phase 3: Memory Confidence System

### Product Outcome

Every memory has an explainable confidence score that improves or declines based on usage, recency, source reliability, conflicts, and user feedback. Users can see which memories are trusted, stale, unused, or contradicted.

### Integration Points

- `RetrievalEngine`
  - Track usage events when memories are returned by search.
  - Optionally add a small confidence component to ranking only after reports are stable.

- `MemoryService`
  - Add confidence report computation and conflict detection methods.

- `Store`
  - Add `usage` and `conflicts` tables.

- `Dashboard`
  - Show memory health metrics: low confidence, stale, conflicted.

- `Memory Explorer`
  - Show confidence label and breakdown in detail panel.

- `Replay Viewer`
  - Include confidence and usage components in retrieval traces once ranking uses them.

### How To Compute Confidence

Keep `Memory.confidence` as the final numeric score for compatibility. Compute it from a deterministic report:

- Base confidence
  - Start from existing ingestion confidence.

- Usage frequency
  - Increase confidence for memories repeatedly returned in top results.
  - Larger boost when user actions indicate usefulness, such as opening detail, pinning, accepting, or manually referencing a result.
  - Cap usage boost so popular stale memories do not dominate forever.

- Recency
  - Newer memories get a small freshness boost.
  - Old memories do not automatically become false; they become "stale" unless reinforced by usage.

- Source reliability
  - Manual/user-corrected memories are strongest.
  - Session/user messages are strong.
  - Assistant-only inferred facts are moderate.
  - Imported/sample/demo data is lower unless pinned or repeatedly used.

- Conflicts
  - Lower confidence when active memories conflict on the same subject.
  - Larger penalty for direct preference conflicts such as "always use X" vs "never use X".

- Feedback
  - Positive feedback increases confidence.
  - Negative feedback decreases confidence and may archive the memory.
  - Accepted missing-memory suggestions start with moderate-high confidence because a user accepted them.

Suggested component weights for the first implementation:

- base: 45 percent
- source reliability: 20 percent
- usage: 15 percent
- recency: 10 percent
- feedback: 10 percent
- conflict penalty: subtract up to 30 percent

Weights should be constants in one module and covered by tests.

### How To Track Usage

Add `MemoryUsageSchema` and table `usage`.

Events:

- `returned`
  - Written by `RetrievalEngine.search` for each returned result, with rank and score.

- `selected`
  - Written by API/UI when a memory detail is opened from a search result.
  - Optional in first pass because UI selection tracking adds API chatter.

- `applied`
  - Written when a memory is pinned, accepted from suggestion, used in a fix, or manually updated.

Minimal first pass:

- Track `returned` events in core retrieval.
- Track `applied` for pin/archive/restore/update/create/merge via existing service methods.
- Add selected tracking later if needed.

### How To Detect Conflicts

Deterministic, conservative heuristics:

- Use `MemoryFact` records and active memories only.
- Normalize subjects from facts and memory summaries.
- Detect opposite predicates or phrases:
  - `always` vs `never`
  - `prefer X` vs `avoid X`
  - `use X` vs `use Y instead`
  - same subject with incompatible objects for preference/codebase-context memories.
- Use tag overlap and subject overlap to reduce false positives.
- Mark conflicts as `open` until resolved by archive, merge, edit, or dismiss.
- Do not auto-resolve by deleting or rewriting memories.

### Data Model Updates

Add:

- `MemoryUsageSchema`
- `MemoryConflictSchema`
- `MemoryConfidenceReportSchema`

Store:

- `usage`
- `conflicts`

Optional compatibility-safe `Memory.metadata` additions:

- `confidenceUpdatedAt`
- `confidenceComponents`
- `confidenceLabel`
- `usageCount`
- `conflictCount`

Avoid requiring these metadata fields in `MemorySchema`.

### API Design

- `GET /memories/:id/confidence`
  - Response: confidence report with components, reasons, usage counts, conflict ids.

- `POST /confidence/recompute`
  - Payload: `{ memoryId?: string }`
  - Recomputes one memory or all active memories.

- `GET /conflicts?status=open`
- `POST /conflicts/detect`
- `POST /conflicts/:id/resolve`
  - Payload: `{ action: "dismiss" | "archive-memory" | "merge" | "mark-resolved", memoryId?, targetId?, reason? }`

- `POST /usage`
  - Optional endpoint for UI-selected events.

### UI Representation

- Memory Explorer table:
  - Add confidence badge: `high`, `medium`, `low`, `conflicted`, or `stale`.
  - Keep numeric confidence available in detail panel.

- Memory detail:
  - Add "Confidence" card with component bars.
  - Show usage count, last returned, source reliability, recency, feedback, conflict penalty.
  - Show open conflict links with resolve actions.

- Dashboard:
  - Add health metrics: low confidence, stale, open conflicts, recently reinforced.

- Replay Viewer:
  - Retrieval trace ranking stage should include confidence component only if ranking uses confidence.
  - Before that, show confidence as context, not as a score factor.

### Tests

- Retrieval writes usage events for returned memories.
- Confidence report increases with usage and positive feedback.
- Confidence report decreases with open conflicts and negative feedback.
- Conflict detector finds obvious "always/prefer" versus "never/avoid" contradiction.
- Recompute updates `Memory.confidence` without changing unrelated fields.
- Existing ranking test remains stable until confidence is explicitly introduced into ranking.

### Minimal Powerful Version

Implement only:

- Usage table with retrieval returned events.
- Confidence report computation.
- Manual recompute endpoint and service method.
- Conservative conflict detection.
- Memory Explorer confidence card.
- Dashboard health counts.
- CLI confidence/conflicts commands.

Defer:

- Large ranking changes.
- UI selected-event tracking.
- Cross-agent source reliability profiles.
- Auto-resolving conflicts.
- Any ML-based contradiction detection.

### Complexity

Medium to large. Usage tracking is small. Confidence reporting is medium. Conflict detection can become complex, so the first version must stay conservative and explain false negatives as a tradeoff.

## Ordered Implementation Plan

### Phase 1 Tasks: Memory Fix Mode

1. Shared schemas and types
   - Files: `packages/shared/src/index.ts`
   - Add `MemoryFeedbackSchema`, `MemoryRuleSchema`, request/response schemas.
   - Complexity: medium.

2. Store extensions
   - Files: `packages/memory-core/src/store.ts`
   - Add `feedback` and `rules` tables to `tableNames`.
   - Add CRUD/list methods.
   - Complexity: small.

3. Service feedback workflow
   - Files: `packages/memory-core/src/service.ts`
   - Add feedback creation/listing/applying.
   - Reuse `updateMemory`, `createMemory`, and `mergeMemory`.
   - Complexity: medium.

4. Ingestion rule application
   - Files: `packages/memory-core/src/ingestion.ts`, possible new `packages/memory-core/src/rules.ts`
   - Extract policy helpers carefully.
   - Apply simple force-store, force-ignore, importance boost/lower, force-kind, add-tags rules.
   - Add rule ids to replay stage metadata.
   - Complexity: large.

5. API endpoints
   - Files: `apps/api/src/app.ts`
   - Add feedback and rules routes.
   - Complexity: small.

6. CLI commands
   - Files: `packages/cli/src/index.ts`
   - Add feedback/rule/fix commands with API fallback.
   - Complexity: medium.

7. UI Memory Explorer fixes
   - Files: `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/web/src/styles.css`
   - Add fix panel and feedback list.
   - Complexity: medium.

8. UI Replay fixes
   - Files: `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/web/src/styles.css`
   - Add "Remember this" for ignored decisions and "Wrong merge" for merge decisions.
   - Complexity: medium.

9. Tests
   - Files: `packages/memory-core/test/memory-core.test.ts`, possibly new test file.
   - Add feedback and rule behavior tests.
   - Complexity: medium.

Phase 1 is independently testable when:

- A user can correct an ignored decision into a memory.
- A user can mark a memory as not worth remembering and see it archived.
- A user can merge duplicates through feedback.
- A future ingest reflects at least one enabled rule and the replay trace explains it.

### Phase 2 Tasks: Missing Memory Analysis

1. Shared schemas and types
   - Files: `packages/shared/src/index.ts`
   - Add `MissingMemorySuggestionSchema` and analysis request/response schemas.
   - Complexity: medium.

2. Analyzer module
   - Files: new `packages/memory-core/src/missing-analysis.ts`, updates to `ingestion.ts` if helpers are exported internally.
   - Implement deterministic session analysis.
   - Complexity: medium.

3. Store extensions
   - Files: `packages/memory-core/src/store.ts`
   - Add `missing_suggestions` table and methods.
   - Complexity: small.

4. Service lifecycle
   - Files: `packages/memory-core/src/service.ts`
   - Add analyze/list/accept/dismiss methods.
   - Accept creates memory and mutation.
   - Complexity: medium.

5. API endpoints
   - Files: `apps/api/src/app.ts`
   - Add session analysis and missing suggestion actions.
   - Complexity: small.

6. CLI commands
   - Files: `packages/cli/src/index.ts`
   - Add analyze-missing, missing accept, missing dismiss.
   - Complexity: medium.

7. Session Explorer UI
   - Files: `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/web/src/styles.css`
   - Add analysis button and suggestion cards.
   - Complexity: medium.

8. Tests
   - Files: `packages/memory-core/test/memory-core.test.ts`, possible new test file.
   - Add repeated concept, existing-memory suppression, accept/dismiss tests.
   - Complexity: medium.

Phase 2 is independently testable when:

- A session can produce open missing-memory suggestions.
- Existing memories suppress redundant suggestions.
- Accepting a suggestion creates a memory.
- Dismissing a suggestion removes it from the default review view.

### Phase 3 Tasks: Memory Confidence System

1. Shared schemas and types
   - Files: `packages/shared/src/index.ts`
   - Add `MemoryUsageSchema`, `MemoryConflictSchema`, `MemoryConfidenceReportSchema`.
   - Complexity: medium.

2. Store extensions
   - Files: `packages/memory-core/src/store.ts`
   - Add `usage` and `conflicts` tables and methods.
   - Complexity: small.

3. Usage tracking
   - Files: `packages/memory-core/src/retrieval.ts`, `packages/memory-core/src/service.ts`
   - Write returned usage events during search.
   - Write applied usage events for create/update/pin/archive/restore/merge.
   - Complexity: medium.

4. Confidence computation
   - Files: new `packages/memory-core/src/confidence.ts`, updates to `service.ts`
   - Compute reports from base confidence, usage, recency, source reliability, feedback, and conflicts.
   - Update `Memory.confidence` on recompute.
   - Complexity: medium.

5. Conflict detection
   - Files: new `packages/memory-core/src/conflicts.ts`, updates to `service.ts`
   - Implement conservative contradiction heuristics.
   - Complexity: medium.

6. API endpoints
   - Files: `apps/api/src/app.ts`
   - Add confidence, recompute, conflicts, and optional usage routes.
   - Complexity: small.

7. CLI commands
   - Files: `packages/cli/src/index.ts`
   - Add confidence show/recompute and conflicts list/detect/resolve.
   - Complexity: medium.

8. UI confidence surfaces
   - Files: `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/web/src/styles.css`
   - Add confidence badge, detail breakdown, dashboard health counts, conflict panel.
   - Complexity: medium.

9. Tests
   - Files: `packages/memory-core/test/memory-core.test.ts`, possible new test file.
   - Add usage, confidence, conflict, recompute tests.
   - Complexity: medium.

Phase 3 is independently testable when:

- Searches create usage records.
- Confidence reports explain their component scores.
- Obvious conflicts are detected and visible.
- Existing search behavior remains stable unless confidence is explicitly enabled as a ranking factor.

## API Changes Summary

Additive endpoints:

- `GET /feedback`
- `POST /feedback`
- `POST /feedback/:id/apply`
- `GET /rules`
- `POST /rules`
- `PATCH /rules/:id`
- `POST /sessions/:id/analyze-missing`
- `GET /sessions/:id/missing`
- `POST /missing/:id/accept`
- `POST /missing/:id/dismiss`
- `GET /memories/:id/confidence`
- `POST /confidence/recompute`
- `GET /conflicts`
- `POST /conflicts/detect`
- `POST /conflicts/:id/resolve`
- Optional later: `POST /usage`

Avoid changing:

- `GET /memories`
- `POST /memories`
- `PATCH /memories/:id`
- `POST /search`
- `GET /sessions/:id`
- `GET /replay/:id`

## UI Changes Summary

- Dashboard
  - Add memory health metrics in Phase 3.

- Memory Explorer
  - Phase 1: Fix Mode actions and feedback history.
  - Phase 3: confidence badge and confidence breakdown.

- Session Explorer
  - Phase 1: create memory from step.
  - Phase 2: missing memory analysis suggestions with accept/dismiss.

- Replay Viewer
  - Phase 1: fix ignored/merged decisions.
  - Phase 2: link ignored decisions to missing suggestions.
  - Phase 3: show confidence context in ranked results.

- Settings
  - Optional rule management can live here later, but do not start with a full rule builder.

## Migration Steps

The current SQLite storage pattern makes migration simple:

1. Add new table names to `tableNames` in `store.ts`.
2. Let existing `migrate()` create them with the same JSON shape.
3. Add `user_version` updates only if a later change needs data backfill.
4. Keep existing `Memory` records valid by making new fields optional or separate.
5. For confidence recompute, update existing memory `confidence` values only after tests confirm stable reports.

## Quick Wins

- Add feedback table and API.
- Add "Remember this" action for ignored decisions.
- Add `should-not-remember` as archive plus feedback record.
- Add missing-memory analysis for a single session using current chunk/classify heuristics.
- Track retrieval returned events.
- Show confidence breakdown based on existing confidence, recency, and source before adding conflicts.

## Harder Parts To Simplify

- Rule learning
  - Simplify to explicit user-created rules from feedback. No automatic rule creation without confirmation.

- Deduplication corrections
  - Start with exact memory pair rules, not broad semantic dedupe policies.

- Missing memory extraction
  - Start with session-level suggestions only. Avoid cross-session clustering.

- Conflict detection
  - Start with obvious preference contradictions. Prefer false negatives over noisy false positives.

- Ranking changes
  - Do not make confidence a major ranking input until usage and confidence reports are tested and visible.

- UI expansion
  - Use the existing pages and detail panels. Avoid creating a new top-level page until the workflows prove they need one.

## Execution Strategy

1. Build the correction substrate first.
   - Add schemas, store methods, service methods, and tests for feedback and rules before UI work.

2. Wire one complete Fix Mode path.
   - Implement "Remember this ignored decision" end to end: replay decision, feedback, memory creation, mutation, replay visibility, CLI.

3. Add negative and duplicate fixes.
   - Implement should-not-remember and duplicate/wrong-merge once the positive path is stable.

4. Extract reusable ingestion analysis helpers.
   - Only after Phase 1 tests pass, pull classification/chunking into helpers used by Missing Memory Analysis.

5. Add session-level missing suggestions.
   - Implement analyze, accept, dismiss, UI cards, and CLI.

6. Add usage tracking with no ranking change.
   - Write usage events during retrieval and expose them in reports.

7. Add confidence reports and conflict detection.
   - Compute, display, and test confidence before letting it affect ranking.

8. Revisit ranking last.
   - Add a small confidence component only if reports are understandable and existing tests can be updated intentionally.

## Validation Checklist

Run after each phase:

- `npm run build`
- `npm test`
- `npm run lint`
- API smoke checks for new endpoints.
- CLI smoke checks for new commands.
- Manual UI pass:
  - Memory Explorer selection and fix actions.
  - Session Explorer analysis and suggestion acceptance.
  - Replay Viewer trace readability.
  - Existing seed/search/list flows still work.

## Execution Progress

Started: 2026-04-16

Repository notes:

- `AGENTS.md` was requested but is not present in this checkout.
- No repository-local `SKILL.md` files were found, so project instructions come from this plan and the existing codebase patterns.
- The implementation will keep the current package boundaries and JSON-table SQLite pattern.

Phase status:

- Phase 1 Memory Fix Mode: completed.
  - Added feedback/rule schemas, SQLite tables, service workflows, ingestion rule application, API routes, CLI commands, Memory Explorer fixes, Replay correction actions, Session step create-memory action, and focused core tests.
  - Implementation adjustment: low-importance candidates are now retained as ignored decisions instead of being filtered before decision creation, so Replay Viewer can correct them.
  - Validation: `npm run build`, `npm test`, and `npm run lint` passed after Phase 1.
- Phase 2 Missing Memory Analysis: completed.
  - Added missing suggestion persistence, deterministic session analyzer, service accept/dismiss lifecycle, API routes, CLI commands, Session Explorer analysis UI, and focused core tests.
  - Implementation adjustment: the analyzer is intentionally conservative and session-scoped; it reuses ingestion tag heuristics but keeps candidate extraction separate to avoid ingestion regressions.
  - Validation: `npm run build`, `npm test`, and `npm run lint` passed after Phase 2.
- Phase 3 Memory Confidence System: completed.
  - Added usage/conflict/confidence schemas, usage tracking for retrieval and service-applied actions, confidence reports/recompute, conservative preference conflict detection/resolution, API routes, CLI commands, Dashboard health metrics, Memory Explorer confidence/conflict surfaces, and focused core tests.
  - Implementation adjustment: confidence is visible and persisted back to `Memory.confidence`, but retrieval ranking is intentionally unchanged in this pass per the plan's "defer large ranking changes" guidance.
  - Validation: `npm run build`, `npm test`, and `npm run lint` passed after Phase 3.

Final validation:

- `npm run build` passed.
- `npm test` passed with 16 core tests.
- `npm run lint` passed.
- API smoke passed on port `4327` with `/health`, `/dev/seed`, `/feedback`, `/rules`, `/sessions/:id/analyze-missing`, `/memories/:id/confidence`, `/confidence/recompute`, and `/conflicts/detect`.
- CLI smoke passed against the local API for `list`, `rule list`, `confidence recompute`, `session list`, and `analyze-missing`.
- Note: `npm run dev:api` on the default port could not be used for smoke because port `4317` was already occupied, so the built API server was started on `PORT=4327` with a temporary SQLite database.
