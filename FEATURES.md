# Features

Agent Memory Devtools is a debuggable, correctable memory system for AI coding agents. It is built around one practical promise: developers should be able to see, fix, replay, and trust what an agent remembers.

## What Makes This Different

This is not just memory storage.

It is:

- a debugger for agent memory
- a correction loop for broken memory behavior
- a way to make agents more predictable over time
- a local devtool for inspecting the state agents usually hide

## Core Memory System

| Feature | What it does | Problem it solves |
| --- | --- | --- |
| Local SQLite store | Stores memories, sessions, steps, events, facts, embeddings, traces, feedback, rules, suggestions, usage, and conflicts in SQLite. | Keeps agent memory inspectable and portable without a hosted service. |
| Session ingestion | Accepts raw transcripts or structured JSON steps, normalizes them into sessions and timeline steps, and records source metadata. | Turns agent runs into durable context with traceable provenance. |
| Memory classification | Classifies candidates as `fact`, `preference`, `event`, `task-context`, `codebase-context`, or `summary`. | Gives developers useful categories for filtering, review, and retrieval. |
| Importance and confidence scoring | Assigns initial importance and confidence during ingestion. | Separates durable project context from low-value session noise. |
| Dedupe and merge tracking | Detects near-duplicate memories, archives merged duplicates, and records canonical relationships. | Reduces repeated preferences and noisy handoff notes without deleting history. |
| Mutations | Records create, update, pin, archive, restore, delete, and merge operations. | Makes memory edits auditable. |

## Debugging and Replay

| Feature | What it does | Problem it solves |
| --- | --- | --- |
| Ingestion traces | Show normalization, chunking, classification, rule application, dedupe, storage, ignored candidates, and merge outcomes. | Explains why a memory was stored, ignored, or merged. |
| Retrieval traces | Show candidate filtering, ranking stages, matched terms, score components, and ordered results. | Explains why a memory appeared for a query. |
| Replay Viewer | Displays ingestion and retrieval traces in the web UI with pipeline stages and decision cards. | Makes memory behavior easy to debug and demo. |
| CLI replay | Prints trace stages and ranked results with `npm run cli -- replay <trace-id>` or the installed `agent-memory` binary. | Gives terminal users a fast way to inspect memory decisions. |

## Memory Fix Mode

| Feature | What it does | Problem it solves |
| --- | --- | --- |
| Structured feedback | Stores feedback for memories, decisions, session steps, and retrieval results. | Captures corrections as first-class data instead of one-off edits. |
| Apply feedback | Applies `should-remember`, `should-not-remember`, duplicate, wrong-kind, wrong-content, wrong-summary, wrong-tags, wrong-merge, and importance corrections. | Lets developers repair bad memory behavior directly. |
| Feedback-derived rules | Optionally creates ingestion or dedupe rules from applied feedback. | Prevents repeated mistakes in future ingestions. |
| UI fix controls | Memory Explorer can boost/lower importance, archive unwanted memories, change kind, merge duplicates, recompute confidence, detect conflicts, and dismiss conflicts. | Puts common correction actions next to the memory being inspected. |
| Replay fixes | Replay Viewer can turn ignored decisions into memories and repair wrong merge decisions. | Makes trace debugging actionable. |
| CLI fix shortcuts | `fix remember`, `fix forget`, and `fix duplicate` apply common corrections from the terminal. | Supports correction workflows without opening the UI. |

## Missing Memory Analysis

| Feature | What it does | Problem it solves |
| --- | --- | --- |
| Session analysis | Scans a session for durable preferences, unresolved tasks, codebase context, factual statements, repeated concepts, and recoverable ignored decisions. | Finds useful context that ingestion may have missed. |
| Evidence-backed suggestions | Each suggestion includes content, summary, kind, tags, score, reason, evidence snippets, and possible existing coverage. | Helps developers decide whether the suggestion is worth accepting. |
| Accept suggestions | Promotes a suggestion into a memory linked back to the session and suggestion. | Turns missed context into durable memory. |
| Dismiss suggestions | Marks suggestions as dismissed and hides them from the default open list. | Keeps review queues clean. |

## Confidence and Conflict System

| Feature | What it does | Problem it solves |
| --- | --- | --- |
| Confidence reports | Explains confidence from base score, source reliability, usage, recency, feedback, and conflict penalties. | Shows why a memory is high, medium, low, stale, or conflicted. |
| Usage tracking | Records returned, selected, and applied usage events. Retrieval automatically records returned memories. | Reinforces memories that are actually used. |
| Confidence recompute | Recomputes one memory or all memories and stores confidence metadata. | Keeps health indicators current after feedback, usage, or conflict changes. |
| Conservative conflict detection | Detects obvious contradictory preferences and stores open conflicts. | Flags memories that should not both be trusted. |
| Conflict resolution | Dismisses, marks resolved, archives a memory, or merges through API/CLI; the UI currently supports dismissal. | Gives developers a path to resolve contradiction warnings. |

## Developer Experience

| Feature | What it does | Problem it solves |
| --- | --- | --- |
| Dashboard | Shows memory health, counts by kind, low confidence, open conflicts, recent reinforcement, sessions, traces, duplicate stats, and retrieval activity. | Gives a quick operational view of local memory. |
| Memory Explorer | Searches and filters memories, shows retrieval explanations, source metadata, confidence, feedback history, conflicts, state, and dedupe relationships. | Central workspace for inspecting and correcting memory. |
| Session Explorer | Lists sessions, shows transcript timelines, related memories, missing-memory analysis, and create-memory actions. | Connects memories back to the agent run that produced them. |
| Replay Viewer | Shows trace pipelines and correction actions for ignored or wrongly merged decisions. | Turns hidden memory behavior into a readable debugger. |
| Settings | Configures the local API URL and exposes local runtime details. | Makes local setup explicit. |
| Fastify API | Exposes memory CRUD, ingest, search, feedback, rules, sessions, missing analysis, confidence, conflicts, usage, replay, stats, and demo seed routes. | Provides integration points for agents and local tools. |
| CLI | Supports init, ingest, search, list, session list, replay, seed, feedback, rules, fix shortcuts, missing analysis, confidence, and conflicts. | Keeps the full workflow scriptable. |
| Shared schemas | Uses Zod schemas and shared TypeScript types across packages. | Keeps API, CLI, UI, and core contracts consistent. |
