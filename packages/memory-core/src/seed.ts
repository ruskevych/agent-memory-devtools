import { IngestRequest } from "@agent-memory/shared";
import { MemoryService } from "./service.js";

export const demoSessions: IngestRequest[] = [
  {
    source: { type: "sample", agent: "codex", label: "repo-preferences.md" },
    session: {
      title: "Repository preference handoff",
      agent: "codex",
      tags: ["demo", "preferences"]
    },
    rawContent: `user: In this repo, prefer TypeScript everywhere and use Zod schemas at API boundaries.

assistant: Noted. I also found that package scripts should stay npm-workspace friendly and validation rules should live at API boundaries.

user: Always keep memory decisions explainable in the UI; avoid opaque vector database behavior.`
  },
  {
    source: { type: "sample", agent: "claude", label: "unresolved-task.json" },
    session: {
      title: "Unresolved dashboard task",
      agent: "claude",
      tags: ["demo", "task"]
    },
    steps: [
      {
        role: "user",
        content: "We implemented the memory explorer, but the dashboard still needs duplicate merge stats and recent retrieval activity."
      },
      {
        role: "assistant",
        content: "Open task: follow up by wiring /stats into the dashboard and showing merged duplicate counts."
      }
    ]
  },
  {
    source: { type: "sample", agent: "codex", label: "codebase-facts.txt" },
    session: {
      title: "Codebase facts",
      agent: "codex",
      tags: ["demo", "codebase"]
    },
    rawContent: `assistant: The API lives in apps/api and uses Fastify. The CLI package should call the API when it is available and fall back to local memory-core operations.

assistant: packages/memory-core owns ingestion, dedupe, ranking, and replay traces.

assistant: Codebase validation rules use shared Zod schemas from packages/shared and Fastify routes validate incoming API payloads.

assistant: apps/web is a React and Vite TypeScript UI for inspecting memories, sessions, and traces.`
  },
  {
    source: { type: "sample", agent: "codex", label: "duplicate-noise.txt" },
    session: {
      title: "Duplicate preference noise",
      agent: "codex",
      tags: ["demo", "dedupe"]
    },
    rawContent: `user: Prefer TypeScript everywhere and validate API input with Zod schemas.

assistant: The repo preference is to use TypeScript everywhere and Zod validation at API boundaries.

user: Always keep memory decisions explainable in the UI; avoid opaque vector database behavior.`
  }
];

export function seedDemoData(service: MemoryService): ReturnType<MemoryService["ingest"]>[] {
  return demoSessions.map((session) => service.ingest(session));
}
