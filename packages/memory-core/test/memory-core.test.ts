import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryService, SqliteMemoryStore } from "../src/index.js";

let service: MemoryService | undefined;

function makeService(): MemoryService {
  const dir = mkdtempSync(join(tmpdir(), "agent-memory-test-"));
  service = new MemoryService(new SqliteMemoryStore(join(dir, "memory.sqlite")));
  return service;
}

afterEach(() => {
  service?.close();
  service = undefined;
});

describe("ingestion", () => {
  it("stores durable preferences and ignores short noise", () => {
    const local = makeService();
    const result = local.ingest({
      rawContent: `user: Prefer TypeScript everywhere and validate API input with Zod.

assistant: ok`,
      source: { type: "sample", agent: "codex" }
    });

    expect(result.stored.some((memory) => memory.kind === "preference")).toBe(true);
    expect(result.trace.stages.map((stage) => stage.name)).toContain("classification");
    expect(local.listMemories()).toHaveLength(1);
  });

  it("merges near-duplicate memories into a canonical memory", () => {
    const local = makeService();
    local.ingest({
      rawContent: "user: Always keep retrieval decisions explainable in the UI and avoid opaque vector database behavior.",
      source: { type: "sample", agent: "codex" }
    });
    const duplicate = local.ingest({
      rawContent: "user: Always keep retrieval decisions explainable in the UI; avoid opaque vector DB behavior.",
      source: { type: "sample", agent: "codex" }
    });

    expect(duplicate.merged).toHaveLength(1);
    expect(local.stats().mergedMemories).toBe(1);
    expect(local.listMemories({ includeArchived: true, includeMerged: true })).toHaveLength(2);
  });
});

describe("noise filtering", () => {
  it("rejects user-prompt that is a conversational question", () => {
    const local = makeService();
    const result = local.captureAutomation({
      source: { type: "hook", agent: "claude-code" },
      events: [
        {
          type: "user-prompt",
          tool: "claude-code",
          trigger: "hook",
          content: "can you calculate fibonacci numbers? this is very important part of the project"
        }
      ]
    });
    expect(result.ignoredEventIds).toHaveLength(1);
    expect(result.acceptedEventIds).toHaveLength(0);
  });

  it("rejects npm output pasted as a user prompt", () => {
    const local = makeService();
    const result = local.captureAutomation({
      source: { type: "hook", agent: "claude-code" },
      events: [
        {
          type: "user-prompt",
          tool: "claude-code",
          trigger: "hook",
          content:
            "npm run dev:api\n\nadded 74 packages, and audited 288 packages in 531ms\n\n52 packages are looking for funding\n  run `npm fund` for details\n\nfound 0 vulnerabilities"
        }
      ]
    });
    expect(result.ignoredEventIds).toHaveLength(1);
  });

  it("rejects an agent-summary that has no completion verb and is short", () => {
    const local = makeService();
    const result = local.captureAutomation({
      source: { type: "hook", agent: "claude-code" },
      events: [
        {
          type: "agent-summary",
          tool: "claude-code",
          trigger: "hook",
          content: "Port 4317 is already in use. Let me find what is occupying it."
        }
      ]
    });
    expect(result.ignoredEventIds).toHaveLength(1);
  });

  it("accepts an agent-summary that contains a completion verb", () => {
    const local = makeService();
    const result = local.captureAutomation({
      source: { type: "hook", agent: "claude-code" },
      events: [
        {
          type: "agent-summary",
          tool: "claude-code",
          trigger: "hook",
          content:
            "Fixed the port conflict by terminating the stale process (PID 43487). Updated the dev:api startup to verify the port is free before binding."
        }
      ]
    });
    expect(result.acceptedEventIds).toHaveLength(1);
  });

  it("does not split a short two-sentence response into individual chunks", () => {
    const local = makeService();
    const result = local.ingest({
      rawContent: "assistant: Port 4317 is already in use. Let me find what is occupying it.",
      source: { type: "sample", agent: "claude-code" }
    });
    const chunking = result.trace.stages.find((stage) => stage.name === "chunking");
    expect(chunking?.items).toHaveLength(1);
  });

  it("rejects a standalone question ingested directly", () => {
    const local = makeService();
    const result = local.ingest({
      rawContent:
        "user: Were you checking that the UserPromptSubmit hook fires and records this conversation?",
      source: { type: "sample", agent: "claude-code" }
    });
    expect(result.stored).toHaveLength(0);
  });

  it("rejects npm noise lines ingested directly", () => {
    const local = makeService();
    const result = local.ingest({
      rawContent: "user: 52 packages are looking for funding run npm fund for details",
      source: { type: "sample", agent: "claude-code" }
    });
    expect(result.stored).toHaveLength(0);
  });
});

describe("automatic capture", () => {
  it("captures durable automation events and annotates replay traces", () => {
    const local = makeService();
    const result = local.captureAutomation({
      source: { type: "hook", agent: "claude-code", label: "Claude Code automatic capture" },
      session: { agent: "claude-code" },
      events: [
        {
          type: "user-prompt",
          tool: "claude-code",
          trigger: "hook",
          content: "Prefer capturing durable prompt instructions and codebase changes as local memory in this repo."
        },
        {
          type: "file-change",
          tool: "claude-code",
          trigger: "hook",
          files: [
            {
              path: "apps/api/src/app.ts",
              summary: "Updated Fastify API routes for /automation/capture.",
              metadata: { hash: "hash_api_capture" }
            }
          ]
        }
      ]
    });

    expect(result.acceptedEventIds).toHaveLength(2);
    expect(result.trace.stages[0].name).toBe("automation-events");
    expect(result.trace.stages[1].name).toBe("automation-filtering");
    expect(result.stored.some((memory) => memory.source.type === "hook")).toBe(true);
    expect(result.stored.some((memory) => memory.metadata.sourceEventType === "user-prompt")).toBe(true);
  });

  it("ignores low-signal automation events but still writes an auditable trace", () => {
    const local = makeService();
    const result = local.captureAutomation({
      source: { type: "hook", agent: "claude-code" },
      events: [{ type: "agent-summary", tool: "claude-code", trigger: "hook", content: "done" }]
    });

    expect(result.acceptedEventIds).toHaveLength(0);
    expect(result.ignoredEventIds).toHaveLength(1);
    expect(result.session).toBeUndefined();
    expect(result.trace.stages[1].name).toBe("automation-filtering");
  });

  it("dedupes repeated automation capture fingerprints", () => {
    const local = makeService();
    const first = local.captureAutomation({
      source: { type: "automation", agent: "codex" },
      events: [
        {
          type: "file-change",
          tool: "codex",
          trigger: "watch",
          files: [
            {
              path: "packages/cli/src/index.ts",
              summary: "Updated CLI commands for integrate, capture, and watch.",
              metadata: { hash: "same_hash" }
            }
          ]
        }
      ]
    });
    const second = local.captureAutomation({
      source: { type: "automation", agent: "codex" },
      events: [
        {
          type: "file-change",
          tool: "codex",
          trigger: "watch",
          files: [
            {
              path: "packages/cli/src/index.ts",
              summary: "Updated CLI commands for integrate, capture, and watch.",
              metadata: { hash: "same_hash" }
            }
          ]
        }
      ]
    });

    expect(first.acceptedEventIds).toHaveLength(1);
    expect(second.acceptedEventIds).toHaveLength(0);
    expect(second.captureDecisions[0]?.metadata.deduped).toBe(true);
  });
});

describe("retrieval", () => {
  it("ranks pinned important memories above weaker matches and explains the score", () => {
    const local = makeService();
    local.ingest({
      rawContent: `user: Prefer TypeScript everywhere and use Zod at API boundaries.

assistant: The weather is nice today and this should not be important.`,
      source: { type: "sample", agent: "codex" }
    });

    const response = local.search({ query: "typescript zod api validation", limit: 5, includeArchived: false });

    expect(response.results[0].memory.kind).toBe("preference");
    expect(response.results[0].explanation.reason).toMatch(/keyword|semantic|pinned|importance/i);
    expect(response.trace.type).toBe("retrieval");
    expect(response.trace.results[0].memory.id).toBe(response.results[0].memory.id);
  });
});

describe("memory fix mode", () => {
  it("creates and lists feedback records", () => {
    const local = makeService();
    const memory = local.createMemory({
      content: "Prefer concise TypeScript services with Zod validation at API boundaries.",
      summary: "Prefer concise TypeScript services with Zod validation.",
      kind: "preference",
      source: { type: "manual" },
      tags: ["preference", "typescript", "zod"],
      confidence: 0.8,
      importance: 0.7,
      pinned: false,
      archived: false,
      metadata: {}
    });

    const result = local.addFeedback({
      targetType: "memory",
      targetId: memory.id,
      memoryId: memory.id,
      type: "boost-importance",
      reason: "This preference matters."
    });

    expect(result.feedback.status).toBe("pending");
    expect(local.listFeedback({ memoryId: memory.id })).toHaveLength(1);
  });

  it("applies should-not-remember by archiving the memory and writing a mutation", () => {
    const local = makeService();
    const memory = local.createMemory({
      content: "The assistant made a transient joke that should not shape future coding work.",
      summary: "Transient joke.",
      kind: "event",
      source: { type: "manual" },
      tags: ["event"],
      confidence: 0.4,
      importance: 0.2,
      pinned: false,
      archived: false,
      metadata: {}
    });

    const result = local.addFeedback(
      { targetType: "memory", targetId: memory.id, memoryId: memory.id, type: "should-not-remember" },
      { apply: true, createRule: true }
    );

    expect(result.feedback.status).toBe("applied");
    expect(result.memory?.archived).toBe(true);
    expect(result.rule?.effect.forceIgnore).toBe(true);
    expect(local.mutations(memory.id).some((mutation) => mutation.type === "archive")).toBe(true);
  });

  it("turns an ignored decision into a manual memory", () => {
    const local = makeService();
    const ingest = local.ingest({
      rawContent: "user: The temporary API key is sk-test-123 and should never become durable memory.",
      source: { type: "sample", agent: "codex" }
    });
    const ignored = ingest.ignored[0];

    const result = local.addFeedback(
      { targetType: "decision", targetId: ignored.id, traceId: ingest.trace.id, type: "should-remember" },
      { apply: true, createRule: true }
    );

    expect(result.memory?.source.type).toBe("manual");
    expect(result.memory?.metadata.correctedFromTargetId).toBe(ignored.id);
    expect(result.rule?.effect.forceStore).toBe(true);
  });

  it("applies duplicate feedback through the existing merge behavior", () => {
    const local = makeService();
    const target = local.createMemory({
      content: "Always keep memory replay traces explainable.",
      summary: "Keep replay traces explainable.",
      kind: "preference",
      source: { type: "manual" },
      tags: ["preference", "memory"],
      confidence: 0.8,
      importance: 0.8,
      pinned: false,
      archived: false,
      metadata: {}
    });
    const source = local.createMemory({
      content: "Always keep replay traces explainable in the memory UI.",
      summary: "Keep replay traces explainable in the UI.",
      kind: "preference",
      source: { type: "manual" },
      tags: ["preference", "ui"],
      confidence: 0.7,
      importance: 0.7,
      pinned: false,
      archived: false,
      metadata: {}
    });

    const result = local.addFeedback(
      { targetType: "memory", targetId: source.id, memoryId: source.id, type: "duplicate", patch: { targetId: target.id } },
      { apply: true, createRule: true }
    );

    expect(result.memory?.mergedInto).toBe(target.id);
    expect(result.rule?.effect.preferCanonicalMemoryId).toBe(target.id);
  });

  it("uses feedback-derived rules during future ingestion and records them in replay", () => {
    const local = makeService();
    const memory = local.createMemory({
      content: "Ignore lunch menu chatter in memory ingestion.",
      summary: "Ignore lunch menu chatter.",
      kind: "preference",
      source: { type: "manual" },
      tags: ["preference", "lunch"],
      confidence: 0.8,
      importance: 0.7,
      pinned: false,
      archived: false,
      metadata: {}
    });
    const fix = local.addFeedback(
      { targetType: "memory", targetId: memory.id, memoryId: memory.id, type: "should-not-remember", patch: { textContains: ["lunch", "menu"] } },
      { apply: true, createRule: true }
    );

    const next = local.ingest({
      rawContent: "user: The lunch menu uses tacos today and this is just transient chatter.",
      source: { type: "sample", agent: "codex" }
    });

    expect(next.ignored).toHaveLength(1);
    expect(next.ignored[0].metadata.ruleIds).toContain(fix.rule?.id);
    expect(next.trace.stages.some((stage) => stage.name === "rules")).toBe(true);
  });
});

describe("missing memory analysis", () => {
  it("finds durable session preferences that are not already covered", () => {
    const local = makeService();
    local.store.upsertSession({
      id: "ses_missing",
      title: "Missing preference session",
      agent: "codex",
      startedAt: new Date().toISOString(),
      tags: [],
      metadata: {}
    });
    local.store.upsertSessionStep({
      id: "step_missing_1",
      sessionId: "ses_missing",
      index: 0,
      role: "user",
      content: "Prefer Vitest for package tests and avoid adding Jest to this repo.",
      timestamp: new Date().toISOString(),
      metadata: {}
    });

    const result = local.analyzeMissingMemories("ses_missing", { refresh: true });

    expect(result.suggestions.some((suggestion) => suggestion.kind === "preference")).toBe(true);
    expect(result.suggestions[0].evidence[0].stepId).toBe("step_missing_1");
  });

  it("suppresses suggestions that are already covered by an active memory", () => {
    const local = makeService();
    local.store.upsertSession({
      id: "ses_covered",
      title: "Covered preference session",
      agent: "codex",
      startedAt: new Date().toISOString(),
      tags: [],
      metadata: {}
    });
    local.store.upsertSessionStep({
      id: "step_covered_1",
      sessionId: "ses_covered",
      index: 0,
      role: "user",
      content: "Prefer Vitest for package tests and avoid adding Jest to this repo.",
      timestamp: new Date().toISOString(),
      metadata: {}
    });
    local.createMemory({
      content: "Prefer Vitest for package tests and avoid adding Jest to this repo.",
      summary: "Prefer Vitest for package tests.",
      kind: "preference",
      source: { type: "manual" },
      tags: ["preference", "vitest"],
      confidence: 0.8,
      importance: 0.8,
      pinned: false,
      archived: false,
      metadata: {}
    });

    const result = local.analyzeMissingMemories("ses_covered", { refresh: true });

    expect(result.suggestions).toHaveLength(0);
  });

  it("accepts a suggestion as a memory and links it to the suggestion", () => {
    const local = makeService();
    local.store.upsertSession({
      id: "ses_accept",
      title: "Accept suggestion session",
      agent: "codex",
      startedAt: new Date().toISOString(),
      tags: [],
      metadata: {}
    });
    local.store.upsertSessionStep({
      id: "step_accept_1",
      sessionId: "ses_accept",
      index: 0,
      role: "user",
      content: "Always keep SQLite migrations backward compatible for local memory stores.",
      timestamp: new Date().toISOString(),
      metadata: {}
    });
    const [suggestion] = local.analyzeMissingMemories("ses_accept", { refresh: true }).suggestions;

    const accepted = local.acceptMissingSuggestion(suggestion.id);

    expect(accepted?.suggestion.status).toBe("accepted");
    expect(accepted?.memory.metadata.suggestionId).toBe(suggestion.id);
  });

  it("dismisses suggestions and hides them from the default open list", () => {
    const local = makeService();
    local.store.upsertSession({
      id: "ses_dismiss",
      title: "Dismiss suggestion session",
      agent: "codex",
      startedAt: new Date().toISOString(),
      tags: [],
      metadata: {}
    });
    local.store.upsertSessionStep({
      id: "step_dismiss_1",
      sessionId: "ses_dismiss",
      index: 0,
      role: "user",
      content: "Always keep replay explanations readable for future debugging.",
      timestamp: new Date().toISOString(),
      metadata: {}
    });
    const [suggestion] = local.analyzeMissingMemories("ses_dismiss", { refresh: true }).suggestions;

    local.dismissMissingSuggestion(suggestion.id, "Not useful");

    expect(local.listMissingSuggestions("ses_dismiss")).toHaveLength(0);
  });
});

describe("memory confidence system", () => {
  it("tracks returned usage events during retrieval", () => {
    const local = makeService();
    const memory = local.createMemory({
      content: "Prefer TypeScript and Zod for API validation.",
      summary: "Prefer TypeScript and Zod.",
      kind: "preference",
      source: { type: "manual" },
      tags: ["preference", "typescript", "zod"],
      confidence: 0.7,
      importance: 0.8,
      pinned: false,
      archived: false,
      metadata: {}
    });

    local.search({ query: "typescript zod", limit: 3, includeArchived: false });

    const usage = local.store.listUsage(memory.id);
    expect(usage.some((item) => item.event === "returned" && item.query === "typescript zod")).toBe(true);
  });

  it("explains higher confidence from usage and positive feedback", () => {
    const local = makeService();
    const memory = local.createMemory({
      content: "Prefer Fastify routes with Zod validation at API boundaries.",
      summary: "Prefer Fastify with Zod validation.",
      kind: "preference",
      source: { type: "manual" },
      tags: ["preference", "fastify", "zod"],
      confidence: 0.55,
      importance: 0.7,
      pinned: false,
      archived: false,
      metadata: {}
    });
    local.search({ query: "fastify zod", limit: 3, includeArchived: false });
    local.addFeedback({ targetType: "memory", targetId: memory.id, memoryId: memory.id, type: "boost-importance" }, { apply: true });

    const report = local.confidenceReport(memory.id);

    expect(report?.usageCount).toBeGreaterThan(0);
    expect(report?.components.usage.score).toBeGreaterThan(0);
    expect(report?.components.feedback.score).toBeGreaterThan(0.5);
  });

  it("detects obvious preference conflicts and lowers confidence", () => {
    const local = makeService();
    const left = local.createMemory({
      content: "Always use Vitest for package tests.",
      summary: "Always use Vitest for tests.",
      kind: "preference",
      source: { type: "manual" },
      tags: ["preference", "tests"],
      confidence: 0.8,
      importance: 0.8,
      pinned: false,
      archived: false,
      metadata: {}
    });
    local.createMemory({
      content: "Never use Vitest for package tests.",
      summary: "Never use Vitest for tests.",
      kind: "preference",
      source: { type: "manual" },
      tags: ["preference", "tests"],
      confidence: 0.8,
      importance: 0.8,
      pinned: false,
      archived: false,
      metadata: {}
    });

    const conflicts = local.detectConflicts();
    const report = local.confidenceReport(left.id);

    expect(conflicts).toHaveLength(1);
    expect(report?.label).toBe("conflicted");
    expect(report?.conflictIds).toContain(conflicts[0].id);
  });

  it("recompute updates confidence metadata without changing memory content", () => {
    const local = makeService();
    const memory = local.createMemory({
      content: "Prefer local-first deterministic memory ranking.",
      summary: "Prefer local-first deterministic ranking.",
      kind: "preference",
      source: { type: "manual" },
      tags: ["preference", "memory"],
      confidence: 0.62,
      importance: 0.7,
      pinned: false,
      archived: false,
      metadata: { stable: true }
    });

    const [report] = local.recomputeConfidence(memory.id);
    const updated = local.getMemory(memory.id);

    expect(report.memoryId).toBe(memory.id);
    expect(updated?.content).toBe(memory.content);
    expect(updated?.metadata.stable).toBe(true);
    expect(updated?.metadata.confidenceLabel).toBe(report.label);
  });
});
