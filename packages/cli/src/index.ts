#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Command } from "commander";
import { IngestRequest, SearchRequest } from "@agent-memory/shared";
import { defaultDbPath, MemoryService, seedDemoData, SqliteMemoryStore } from "@agent-memory/memory-core";

const defaultApiUrl = process.env.AGENT_MEMORY_API_URL ?? "http://127.0.0.1:4317";

const program = new Command()
  .name("agent-memory")
  .description("Local inspectable memory for coding agents")
  .version("0.1.0")
  .option("--api <url>", "Local API URL", defaultApiUrl)
  .option("--db <path>", "SQLite database path", defaultDbPath());

program
  .command("init")
  .description("Create the local memory database")
  .action(async () => {
    const dbPath = program.opts<{ db: string }>().db;
    await mkdir(dirname(dbPath), { recursive: true });
    const service = localService(dbPath);
    service.close();
    console.log(`Initialized agent-memory store at ${dbPath}`);
  });

program
  .command("ingest")
  .argument("<file>", "Transcript text or JSON ingest file")
  .description("Ingest a session transcript or JSON event file")
  .action(async (file: string) => {
    const body = parseIngestFile(file);
    const result = await withApiFallback("POST", "/ingest", body, () => localService().ingest(body));
    console.log(`Ingested session: ${result.session.title}`);
    console.log(`Stored ${result.stored.length}, merged ${result.merged.length}, ignored ${result.ignored.length}`);
    console.log(`Trace: ${result.trace.id}`);
  });

program
  .command("search")
  .argument("<query>", "Search query")
  .option("-l, --limit <number>", "Result limit", "10")
  .description("Search local memories with explanations")
  .action(async (query: string, options: { limit: string }) => {
    const request: SearchRequest = { query, limit: Number(options.limit), includeArchived: false };
    const result = await withApiFallback("POST", "/search", request, () => localService().search(request));
    for (const [index, item] of result.results.entries()) {
      console.log(`${index + 1}. ${item.memory.summary} (${item.memory.kind}, score ${item.score.toFixed(3)})`);
      console.log(`   why: ${item.explanation.reason}`);
      if (item.explanation.matchedTerms.length) {
        console.log(`   matched: ${item.explanation.matchedTerms.join(", ")}`);
      }
    }
    console.log(`Trace: ${result.trace.id}`);
  });

program
  .command("list")
  .option("--archived", "Include archived memories")
  .option("--kind <kind>", "Filter by memory kind")
  .description("List stored memories")
  .action(async (options: { archived?: boolean; kind?: string }) => {
    const query = new URLSearchParams();
    if (options.archived) query.set("includeArchived", "true");
    if (options.kind) query.set("kind", options.kind);
    const memories = await withApiFallback("GET", `/memories?${query.toString()}`, undefined, () =>
      localService().listMemories({ includeArchived: options.archived, kind: options.kind })
    );
    for (const memory of memories) {
      const flags = [memory.pinned ? "pinned" : "", memory.archived ? "archived" : "", memory.mergedInto ? `merged:${memory.mergedInto}` : ""]
        .filter(Boolean)
        .join(", ");
      console.log(`${memory.id}  ${memory.kind}  ${memory.summary}${flags ? ` [${flags}]` : ""}`);
    }
  });

const session = program.command("session").description("Session commands");
session
  .command("list")
  .description("List ingested sessions")
  .action(async () => {
    const sessions = await withApiFallback("GET", "/sessions", undefined, () => localService().listSessions());
    for (const item of sessions) {
      console.log(`${item.id}  ${item.startedAt.slice(0, 10)}  ${item.agent}  ${item.title}`);
    }
  });

const feedback = program.command("feedback").description("Memory feedback commands");
feedback
  .command("add")
  .argument("<target-id>", "Target memory, decision, session step, or retrieval result id")
  .requiredOption("--target <type>", "Target type: memory, decision, session-step, retrieval-result")
  .requiredOption("--type <type>", "Feedback type")
  .option("--reason <text>", "Human-readable reason")
  .option("--memory <id>", "Related memory id")
  .option("--session <id>", "Related session id")
  .option("--trace <id>", "Related replay trace id")
  .option("--apply", "Apply feedback immediately")
  .option("--rule", "Create a future behavior rule while applying")
  .description("Create a structured feedback record")
  .action(async (targetId: string, options: Record<string, string | boolean | undefined>) => {
    const body = {
      targetId,
      targetType: options.target,
      type: options.type,
      reason: options.reason,
      memoryId: options.memory,
      sessionId: options.session,
      traceId: options.trace,
      apply: Boolean(options.apply),
      createRule: Boolean(options.rule)
    };
    const result = await withApiFallback("POST", "/feedback", body, () => localService().addFeedback(body as never, { apply: body.apply, createRule: body.createRule }));
    console.log(`${result.feedback.id}  ${result.feedback.status}  ${result.feedback.type}`);
    if (result.memory) console.log(`Memory: ${result.memory.id}  ${result.memory.summary}`);
    if (result.rule) console.log(`Rule: ${result.rule.id}  ${result.rule.scope}`);
  });

feedback
  .command("list")
  .option("--memory <id>", "Filter by memory id")
  .option("--session <id>", "Filter by session id")
  .option("--status <status>", "Filter by status")
  .description("List feedback records")
  .action(async (options: { memory?: string; session?: string; status?: string }) => {
    const query = new URLSearchParams();
    if (options.memory) query.set("memoryId", options.memory);
    if (options.session) query.set("sessionId", options.session);
    if (options.status) query.set("status", options.status);
    const rows = await withApiFallback("GET", `/feedback?${query.toString()}`, undefined, () =>
      localService().listFeedback({ memoryId: options.memory, sessionId: options.session, status: options.status })
    );
    for (const item of rows) {
      console.log(`${item.id}  ${item.status}  ${item.type}  target=${item.targetType}:${item.targetId}${item.reason ? `  ${item.reason}` : ""}`);
    }
  });

const rule = program.command("rule").description("Memory rule commands");
rule
  .command("list")
  .option("--scope <scope>", "Filter by scope")
  .option("--enabled <value>", "Filter by enabled true/false")
  .description("List deterministic memory rules")
  .action(async (options: { scope?: string; enabled?: string }) => {
    const query = new URLSearchParams();
    if (options.scope) query.set("scope", options.scope);
    if (options.enabled) query.set("enabled", options.enabled);
    const rows = await withApiFallback("GET", `/rules?${query.toString()}`, undefined, () =>
      localService().listRules({ scope: options.scope, enabled: options.enabled === undefined ? undefined : options.enabled === "true" })
    );
    for (const item of rows) {
      console.log(`${item.id}  ${item.enabled ? "enabled" : "disabled"}  ${item.scope}  from=${item.createdFromFeedbackId ?? "manual"}`);
    }
  });

rule
  .command("enable")
  .argument("<id>", "Rule id")
  .description("Enable a rule")
  .action(async (id: string) => {
    const result = await withApiFallback("PATCH", `/rules/${id}`, { enabled: true }, () => {
      const local = localService().updateRule(id, { enabled: true });
      if (!local) throw new Error(`Rule ${id} not found`);
      return local;
    });
    console.log(`Enabled ${result.id}`);
  });

rule
  .command("disable")
  .argument("<id>", "Rule id")
  .description("Disable a rule")
  .action(async (id: string) => {
    const result = await withApiFallback("PATCH", `/rules/${id}`, { enabled: false }, () => {
      const local = localService().updateRule(id, { enabled: false });
      if (!local) throw new Error(`Rule ${id} not found`);
      return local;
    });
    console.log(`Disabled ${result.id}`);
  });

const fix = program.command("fix").description("Memory Fix Mode shortcuts");
fix
  .command("remember")
  .argument("<decision-or-step-id>", "Ignored decision id or session step id")
  .option("--target <type>", "Target type", "decision")
  .option("--rule", "Create a future force-store rule")
  .description("Turn an ignored decision or session step into a memory")
  .action(async (targetId: string, options: { target: string; rule?: boolean }) => {
    const body = { targetId, targetType: options.target, type: "should-remember", apply: true, createRule: Boolean(options.rule) };
    const result = await withApiFallback("POST", "/feedback", body, () => localService().addFeedback(body as never, { apply: true, createRule: Boolean(options.rule) }));
    console.log(`Remembered via feedback ${result.feedback.id}${result.memory ? ` as ${result.memory.id}` : ""}`);
  });

fix
  .command("forget")
  .argument("<memory-id>", "Memory id")
  .option("--rule", "Create a future force-ignore rule")
  .description("Archive a memory as something that should not be remembered")
  .action(async (memoryId: string, options: { rule?: boolean }) => {
    const body = { targetId: memoryId, targetType: "memory", type: "should-not-remember", apply: true, createRule: Boolean(options.rule) };
    const result = await withApiFallback("POST", "/feedback", body, () => localService().addFeedback(body as never, { apply: true, createRule: Boolean(options.rule) }));
    console.log(`Archived via feedback ${result.feedback.id}${result.rule ? ` and rule ${result.rule.id}` : ""}`);
  });

fix
  .command("duplicate")
  .argument("<source-id>", "Duplicate memory id")
  .argument("<target-id>", "Canonical memory id")
  .option("--rule", "Create a future canonical dedupe rule")
  .description("Merge a duplicate memory into its canonical target")
  .action(async (sourceId: string, targetId: string, options: { rule?: boolean }) => {
    const body = {
      targetId: sourceId,
      targetType: "memory",
      type: "duplicate",
      patch: { targetId },
      apply: true,
      createRule: Boolean(options.rule)
    };
    const result = await withApiFallback("POST", "/feedback", body, () => localService().addFeedback(body as never, { apply: true, createRule: Boolean(options.rule) }));
    console.log(`Merged via feedback ${result.feedback.id}${result.memory ? ` into ${targetId}` : ""}`);
  });

program
  .command("analyze-missing")
  .argument("<session-id>", "Session id")
  .option("-l, --limit <number>", "Suggestion limit", "10")
  .option("--refresh", "Regenerate suggestions")
  .description("Analyze a session for likely missed memories")
  .action(async (sessionId: string, options: { limit: string; refresh?: boolean }) => {
    const body = { limit: Number(options.limit), refresh: Boolean(options.refresh) };
    const result = await withApiFallback("POST", `/sessions/${sessionId}/analyze-missing`, body, () =>
      localService().analyzeMissingMemories(sessionId, body)
    );
    console.log(`Analyzed ${result.sessionId}: ${result.suggestions.length} suggestions`);
    for (const item of result.suggestions) {
      console.log(`${item.id}  ${item.kind}  ${item.score.toFixed(2)}  ${item.summary}`);
      console.log(`   why: ${item.reason}`);
      if (item.matchedMemoryIds.length) console.log(`   possibly covered: ${item.matchedMemoryIds.join(", ")}`);
    }
  });

const missing = program.command("missing").description("Missing-memory suggestion commands");
missing
  .command("accept")
  .argument("<suggestion-id>", "Suggestion id")
  .description("Promote a missing-memory suggestion into a memory")
  .action(async (id: string) => {
    const result = await withApiFallback("POST", `/missing/${id}/accept`, {}, () => {
      const local = localService().acceptMissingSuggestion(id);
      if (!local) throw new Error(`Suggestion ${id} not found`);
      return local;
    });
    console.log(`Accepted ${result.suggestion.id} as memory ${result.memory.id}`);
  });

missing
  .command("dismiss")
  .argument("<suggestion-id>", "Suggestion id")
  .option("--reason <text>", "Dismissal reason")
  .description("Dismiss a missing-memory suggestion")
  .action(async (id: string, options: { reason?: string }) => {
    const result = await withApiFallback("POST", `/missing/${id}/dismiss`, { reason: options.reason }, () => {
      const local = localService().dismissMissingSuggestion(id, options.reason);
      if (!local) throw new Error(`Suggestion ${id} not found`);
      return local;
    });
    console.log(`Dismissed ${result.id}`);
  });

const confidence = program.command("confidence").description("Memory confidence commands");
confidence
  .command("show")
  .argument("<memory-id>", "Memory id")
  .description("Show an explainable confidence report")
  .action(async (memoryId: string) => {
    const report = await withApiFallback("GET", `/memories/${memoryId}/confidence`, undefined, () => {
      const local = localService().confidenceReport(memoryId);
      if (!local) throw new Error(`Memory ${memoryId} not found`);
      return local;
    });
    console.log(`${report.memoryId}  ${report.label}  ${report.confidence.toFixed(2)}`);
    for (const [name, component] of Object.entries(report.components)) {
      console.log(`  ${name}: ${component.score.toFixed(2)} x ${component.weight.toFixed(2)} = ${component.contribution.toFixed(2)}`);
    }
    if (report.conflictIds.length) console.log(`  conflicts: ${report.conflictIds.join(", ")}`);
  });

confidence
  .command("recompute")
  .option("--memory <id>", "Recompute one memory")
  .description("Recompute confidence for one memory or all memories")
  .action(async (options: { memory?: string }) => {
    const result = await withApiFallback("POST", "/confidence/recompute", { memoryId: options.memory }, () => ({
      reports: localService().recomputeConfidence(options.memory)
    }));
    console.log(`Recomputed ${result.reports.length} confidence report${result.reports.length === 1 ? "" : "s"}.`);
  });

const conflicts = program.command("conflicts").description("Memory conflict commands");
conflicts
  .command("list")
  .option("--status <status>", "Conflict status", "open")
  .description("List memory conflicts")
  .action(async (options: { status: string }) => {
    const rows = await withApiFallback("GET", `/conflicts?status=${encodeURIComponent(options.status)}`, undefined, () =>
      localService().listConflicts(options.status)
    );
    for (const conflict of rows) {
      console.log(`${conflict.id}  ${conflict.status}  severity=${conflict.severity.toFixed(2)}  ${conflict.summary}`);
      console.log(`   memories: ${conflict.memoryIds.join(", ")}`);
    }
  });

conflicts
  .command("detect")
  .description("Detect conservative memory conflicts")
  .action(async () => {
    const result = await withApiFallback("POST", "/conflicts/detect", {}, () => ({ conflicts: localService().detectConflicts() }));
    console.log(`Detected ${result.conflicts.length} new conflict${result.conflicts.length === 1 ? "" : "s"}.`);
  });

conflicts
  .command("resolve")
  .argument("<id>", "Conflict id")
  .requiredOption("--action <action>", "dismiss, mark-resolved, archive-memory, or merge")
  .option("--memory <id>", "Memory id for archive/merge")
  .option("--target <id>", "Target memory id for merge")
  .option("--reason <text>", "Resolution reason")
  .description("Resolve or dismiss a conflict")
  .action(async (id: string, options: { action: "dismiss" | "archive-memory" | "merge" | "mark-resolved"; memory?: string; target?: string; reason?: string }) => {
    const body = { action: options.action, memoryId: options.memory, targetId: options.target, reason: options.reason };
    const result = await withApiFallback("POST", `/conflicts/${id}/resolve`, body, () => {
      const local = localService().resolveConflict(id, body);
      if (!local) throw new Error(`Conflict ${id} not found`);
      return local;
    });
    console.log(`${result.id}  ${result.status}`);
  });

program
  .command("replay")
  .argument("<id>", "Replay trace id")
  .description("Show an ingestion or retrieval trace")
  .action(async (id: string) => {
    const trace = await withApiFallback("GET", `/replay/${id}`, undefined, () => {
      const local = localService().getTrace(id);
      if (!local) throw new Error(`Trace ${id} not found`);
      return local;
    });
    console.log(`${trace.title} (${trace.type})`);
    for (const stage of trace.stages) {
      console.log(`- ${stage.name}: ${stage.summary}`);
    }
    if (trace.results.length) {
      console.log("Results:");
      for (const result of trace.results) {
        console.log(`  ${result.memory.id}: ${result.score.toFixed(3)} - ${result.explanation.reason}`);
      }
    }
  });

program
  .command("dev:seed")
  .description("Seed realistic demo sessions")
  .action(async () => {
    const result = await withApiFallback("POST", "/dev/seed", {}, () => {
      const service = localService();
      const responses = seedDemoData(service);
      return {
        ok: true,
        sessions: responses.map((response) => response.session),
        memories: responses.flatMap((response) => response.stored),
        traces: responses.map((response) => response.trace)
      };
    });
    console.log(`Seeded ${result.sessions.length} sessions and ${result.memories.length} memories.`);
  });

await program.parseAsync(process.argv);

function localService(dbPath = program.opts<{ db: string }>().db): MemoryService {
  return new MemoryService(new SqliteMemoryStore(dbPath));
}

function parseIngestFile(file: string): IngestRequest {
  const content = readFileSync(file, "utf8");
  if (file.endsWith(".json")) {
    const parsed = JSON.parse(content) as IngestRequest | NonNullable<IngestRequest["steps"]>;
    if (Array.isArray(parsed)) return { steps: parsed, source: { type: "import", path: file, label: file } };
    return { ...parsed, source: { type: "import", path: file, label: file, ...parsed.source } };
  }
  return {
    rawContent: content,
    source: { type: "import", path: file, label: file }
  };
}

async function withApiFallback<T>(method: "GET" | "POST" | "PATCH", path: string, body: unknown, fallback: () => T): Promise<T> {
  const apiUrl = program.opts<{ api: string }>().api;
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(900)
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return (await response.json()) as T;
  } catch {
    return fallback();
  }
}
