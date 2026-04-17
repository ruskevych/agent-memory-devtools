#!/usr/bin/env node
import { watch as fsWatch, readFileSync, writeFileSync, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { AutomationCaptureRequest, AutomationEventInput, AutomationEventType, IngestRequest, SearchRequest } from "@agent-memory/shared";
import { defaultDbPath, MemoryService, seedDemoData, SqliteMemoryStore } from "@agent-memory/memory-core";
import { buildFileChangeEvent } from "./change-capture.js";
import { detectIntegrationStatus, installClaudeHooks } from "./integration.js";
import { onboard } from "./onboard.js";

function findWorkspaceRoot(startDir: string): string {
  let current = startDir;
  while (current !== dirname(current)) {
    if (existsSync(join(current, "package.json"))) {
      try {
        const pkg = JSON.parse(readFileSync(join(current, "package.json"), "utf8"));
        if (pkg.workspaces) {
          return current;
        }
      } catch {}
    }
    current = dirname(current);
  }
  return startDir; // fallback
}

const defaultApiUrl = process.env.AGENT_MEMORY_API_URL ?? "http://127.0.0.1:4317";
const workspaceRoot = findWorkspaceRoot(process.cwd());

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
    const result = await withApiFallback("POST", "/ingest", body, () => localCapture((service) => service.ingest(body)));
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
    const result = await withApiFallback("POST", "/search", request, () => localCapture((service) => service.search(request)));
    for (const [index, item] of result.results.entries()) {
      console.log(`${index + 1}. ${item.memory.summary} (${item.memory.kind}, score ${item.score.toFixed(3)})`);
      console.log(`   why: ${item.explanation.reason}`);
      if (item.explanation.matchedTerms.length) console.log(`   matched: ${item.explanation.matchedTerms.join(", ")}`);
    }
    console.log(`Trace: ${result.trace.id}`);
  });

program
  .command("context")
  .argument("[query]", "Optional query; defaults to a general project context digest")
  .option("-l, --limit <number>", "Number of memories to surface", "6")
  .description("Retrieve and print relevant memory context — run this at the start of any session")
  .action(async (query: string | undefined, options: { limit: string }) => {
    const q = query?.trim() || "project preferences workflow decisions architecture";
    const request: SearchRequest = { query: q, limit: Number(options.limit), includeArchived: false };
    const result = await withApiFallback("POST", "/search", request, () => localCapture((service) => service.search(request)));
    if (!result.results.length) {
      console.log("No relevant memories found.");
      return;
    }
    console.log("=== Relevant project memory ===");
    for (const item of result.results) {
      const score = item.score.toFixed(2);
      console.log(`[${item.memory.kind}] ${item.memory.summary} (${score})`);
      if (item.explanation.matchedTerms.length) console.log(`  matched: ${item.explanation.matchedTerms.join(", ")}`);
    }
    console.log(`Trace: ${result.trace.id}`);
  });

program
  .command("list")
  .option("--archived", "Include archived memories")
  .option("--kind <kind>", "Filter by memory kind")
  .option("--scope <scope>", "Filter by scope: project or global")
  .description("List stored memories")
  .action(async (options: { archived?: boolean; kind?: string; scope?: string }) => {
    const query = new URLSearchParams();
    if (options.archived) query.set("includeArchived", "true");
    if (options.kind) query.set("kind", options.kind);
    if (options.scope) query.set("scope", options.scope);
    const memories = await withApiFallback("GET", `/memories?${query.toString()}`, undefined, () =>
      localCapture((service) => service.listMemories({ includeArchived: options.archived, kind: options.kind, scope: options.scope }))
    );
    for (const memory of memories) {
      const scopeTag = (memory.scope ?? "project") === "global" ? "global" : "";
      const flags = [memory.pinned ? "pinned" : "", memory.archived ? "archived" : "", memory.mergedInto ? `merged:${memory.mergedInto}` : "", scopeTag]
        .filter(Boolean)
        .join(", ");
      console.log(`${memory.id}  ${memory.kind}  ${memory.summary}${flags ? ` [${flags}]` : ""}`);
    }
  });

program
  .command("export")
  .option("--format <format>", "Output format: json or markdown", "json")
  .option("--output <file>", "Write to file instead of stdout")
  .option("--scope <scope>", "Export only project or global memories")
  .option("--kind <kind>", "Export only memories of this kind")
  .description("Export memories to JSON or Markdown")
  .action(async (options: { format: string; output?: string; scope?: string; kind?: string }) => {
    const format = options.format === "markdown" ? "markdown" : "json";
    const query = new URLSearchParams({ format });
    if (options.scope) query.set("scope", options.scope);
    if (options.kind) query.set("kind", options.kind);
    const apiUrl = program.opts<{ api: string }>().api;
    let data: string;
    try {
      const response = await fetch(`${apiUrl}/memories/export?${query.toString()}`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`${response.status}`);
      data = await response.text();
    } catch {
      data = localCapture((service) => service.exportMemories({ scope: options.scope, kind: options.kind }, format));
    }
    if (options.output) {
      writeFileSync(options.output, data, "utf8");
      console.log(`Exported to ${options.output}`);
    } else {
      process.stdout.write(data);
    }
  });

program
  .command("import")
  .argument("<file>", "JSON export file to import")
  .option("--overwrite", "Overwrite memories with matching ids")
  .description("Import memories from a JSON export file")
  .action(async (file: string, options: { overwrite?: boolean }) => {
    const data = readFileSync(file, "utf8");
    const body = { data, overwrite: Boolean(options.overwrite) };
    const result = await withApiFallback("POST", "/memories/import", body, () =>
      localCapture((service) => service.importMemories(data, { overwrite: options.overwrite }))
    );
    console.log(`Imported ${result.imported}, skipped ${result.skipped}${result.errors.length ? `, errors: ${result.errors.join("; ")}` : ""}`);
  });

const session = program.command("session").description("Session commands");
session
  .command("list")
  .description("List ingested sessions")
  .action(async () => {
    const sessions = await withApiFallback("GET", "/sessions", undefined, () => localCapture((service) => service.listSessions()));
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
    const result = await withApiFallback("POST", "/feedback", body, () =>
      localCapture((service) => service.addFeedback(body as never, { apply: body.apply, createRule: body.createRule }))
    );
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
      localCapture((service) => service.listFeedback({ memoryId: options.memory, sessionId: options.session, status: options.status }))
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
      localCapture((service) => service.listRules({ scope: options.scope, enabled: options.enabled === undefined ? undefined : options.enabled === "true" }))
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
    const result = await withApiFallback("PATCH", `/rules/${id}`, { enabled: true }, () =>
      localCapture((service) => {
        const local = service.updateRule(id, { enabled: true });
        if (!local) throw new Error(`Rule ${id} not found`);
        return local;
      })
    );
    console.log(`Enabled ${result.id}`);
  });

rule
  .command("disable")
  .argument("<id>", "Rule id")
  .description("Disable a rule")
  .action(async (id: string) => {
    const result = await withApiFallback("PATCH", `/rules/${id}`, { enabled: false }, () =>
      localCapture((service) => {
        const local = service.updateRule(id, { enabled: false });
        if (!local) throw new Error(`Rule ${id} not found`);
        return local;
      })
    );
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
    const result = await withApiFallback("POST", "/feedback", body, () =>
      localCapture((service) => service.addFeedback(body as never, { apply: true, createRule: Boolean(options.rule) }))
    );
    console.log(`Remembered via feedback ${result.feedback.id}${result.memory ? ` as ${result.memory.id}` : ""}`);
  });

fix
  .command("forget")
  .argument("<memory-id>", "Memory id")
  .option("--rule", "Create a future force-ignore rule")
  .description("Archive a memory as something that should not be remembered")
  .action(async (memoryId: string, options: { rule?: boolean }) => {
    const body = { targetId: memoryId, targetType: "memory", type: "should-not-remember", apply: true, createRule: Boolean(options.rule) };
    const result = await withApiFallback("POST", "/feedback", body, () =>
      localCapture((service) => service.addFeedback(body as never, { apply: true, createRule: Boolean(options.rule) }))
    );
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
    const result = await withApiFallback("POST", "/feedback", body, () =>
      localCapture((service) => service.addFeedback(body as never, { apply: true, createRule: Boolean(options.rule) }))
    );
    console.log(`Merged via feedback ${result.feedback.id}${result.memory ? ` into ${targetId}` : ""}`);
  });

const capture = program.command("capture").description("Automation capture commands");
capture
  .command("session")
  .argument("[file]", "Transcript, JSON batch, or session file")
  .option("--stdin", "Read from stdin instead of a file")
  .option("--summary <text>", "Capture a checkpoint summary as automation")
  .option("--tool <tool>", "codex, claude-code, or generic", "generic")
  .option("--trigger <trigger>", "hook, watch, cli, or manual", "cli")
  .option("--type <type>", "Automation event type", "session-checkpoint")
  .description("Capture a workflow checkpoint or ingest a session file")
  .action(async (file: string | undefined, options: { stdin?: boolean; summary?: string; tool: string; trigger: string; type: AutomationEventType }) => {
    const content = options.stdin ? await readStdin() : file ? readFileSync(file, "utf8") : options.summary ?? "";
    if (!content.trim()) {
      console.log("No capture input provided.");
      return;
    }
    const parsed = parseCaptureContent(content, file, options.tool, options.trigger, options.type);
    if (isIngestPayload(parsed)) {
      const result = await withApiFallback("POST", "/ingest", parsed, () => localCapture((service) => service.ingest(parsed)));
      console.log(`Captured session ${result.session.title}`);
      console.log(`Stored ${result.stored.length}, merged ${result.merged.length}, ignored ${result.ignored.length}`);
      console.log(`Trace: ${result.trace.id}`);
      return;
    }
    const result = await captureAutomation(parsed);
    printAutomationResult(result);
  });

capture
  .command("changes")
  .argument("[files...]", "Changed files to analyze; defaults to git working tree changes")
  .option("--tool <tool>", "codex, claude-code, or generic", "generic")
  .option("--trigger <trigger>", "hook, watch, cli, or manual", "cli")
  .option("--session <id>", "Related session id")
  .option("--summary <text>", "Optional checkpoint summary to capture alongside file changes")
  .description("Capture meaningful code-change memory candidates")
  .action(async (files: string[] | undefined, options: { tool: string; trigger: string; session?: string; summary?: string }) => {
    const events: AutomationEventInput[] = [];
    const changeEvent = buildFileChangeEvent({
      workspaceRoot,
      files,
      tool: options.tool as never,
      trigger: options.trigger as never,
      sessionId: options.session,
      metadata: {}
    });
    if (changeEvent) events.push(changeEvent);
    if (options.summary) {
      events.push({
        type: "session-checkpoint",
        tool: options.tool as never,
        trigger: options.trigger as never,
        automatic: options.trigger !== "manual",
        sessionId: options.session,
        cwd: workspaceRoot,
        content: options.summary,
        metadata: {}
      });
    }
    if (!events.length) {
      console.log("No meaningful code changes detected for capture.");
      return;
    }
    const result = await captureAutomation({
      session: {
        id: options.session,
        agent: options.tool
      },
      source: {
        type: options.trigger === "hook" ? "hook" : "automation",
        agent: options.tool,
        label: `${options.tool} ${options.trigger} capture`,
        path: workspaceRoot
      },
      events
    });
    printAutomationResult(result);
  });

program
  .command("watch")
  .option("--tool <tool>", "codex, claude-code, or generic", "codex")
  .option("--debounce <ms>", "Debounce window in milliseconds", "4000")
  .option("--session <id>", "Related session id")
  .description("Watch the workspace and capture meaningful code changes automatically")
  .action(async (options: { tool: string; debounce: string; session?: string }) => {
    const pending = new Set<string>();
    let timer: NodeJS.Timeout | undefined;
    const debounceMs = Number(options.debounce);
    console.log(`Watching ${workspaceRoot} for meaningful changes as ${options.tool}. Press Ctrl+C to stop.`);

    const watcher = fsWatch(workspaceRoot, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const path = String(filename);
      if (!path || /(^|\/)(node_modules|dist|coverage|\.git)(\/|$)/.test(path)) return;
      if (eventType === "rename" && !path.includes(".")) return;
      pending.add(path);
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const files = [...pending];
        pending.clear();
        const changeEvent = buildFileChangeEvent({
          workspaceRoot,
          files,
          tool: options.tool as never,
          trigger: "watch",
          sessionId: options.session
        });
        if (!changeEvent) return;
        const result = await captureAutomation({
          session: { id: options.session, agent: options.tool },
          source: {
            type: "automation",
            agent: options.tool,
            label: `${options.tool} watch capture`,
            path: workspaceRoot
          },
          events: [changeEvent]
        });
        if (result.acceptedEventIds.length || result.stored.length || result.merged.length) {
          console.log(`[watch] trace=${result.trace.id} accepted=${result.acceptedEventIds.length} stored=${result.stored.length} merged=${result.merged.length}`);
        }
      }, debounceMs);
    });

    process.on("SIGINT", () => {
      watcher.close();
      console.log("\nStopped watch mode.");
      process.exit(0);
    });
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
      localCapture((service) => service.analyzeMissingMemories(sessionId, body))
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
    const result = await withApiFallback("POST", `/missing/${id}/accept`, {}, () =>
      localCapture((service) => {
        const local = service.acceptMissingSuggestion(id);
        if (!local) throw new Error(`Suggestion ${id} not found`);
        return local;
      })
    );
    console.log(`Accepted ${result.suggestion.id} as memory ${result.memory.id}`);
  });

missing
  .command("dismiss")
  .argument("<suggestion-id>", "Suggestion id")
  .option("--reason <text>", "Dismissal reason")
  .description("Dismiss a missing-memory suggestion")
  .action(async (id: string, options: { reason?: string }) => {
    const result = await withApiFallback("POST", `/missing/${id}/dismiss`, { reason: options.reason }, () =>
      localCapture((service) => {
        const local = service.dismissMissingSuggestion(id, options.reason);
        if (!local) throw new Error(`Suggestion ${id} not found`);
        return local;
      })
    );
    console.log(`Dismissed ${result.id}`);
  });

const confidence = program.command("confidence").description("Memory confidence commands");
confidence
  .command("show")
  .argument("<memory-id>", "Memory id")
  .description("Show an explainable confidence report")
  .action(async (memoryId: string) => {
    const report = await withApiFallback("GET", `/memories/${memoryId}/confidence`, undefined, () =>
      localCapture((service) => {
        const local = service.confidenceReport(memoryId);
        if (!local) throw new Error(`Memory ${memoryId} not found`);
        return local;
      })
    );
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
    const result = await withApiFallback("POST", "/confidence/recompute", { memoryId: options.memory }, () =>
      localCapture((service) => ({
        reports: service.recomputeConfidence(options.memory)
      }))
    );
    console.log(`Recomputed ${result.reports.length} confidence report${result.reports.length === 1 ? "" : "s"}.`);
  });

const conflicts = program.command("conflicts").description("Memory conflict commands");
conflicts
  .command("list")
  .option("--status <status>", "Conflict status", "open")
  .description("List memory conflicts")
  .action(async (options: { status: string }) => {
    const rows = await withApiFallback("GET", `/conflicts?status=${encodeURIComponent(options.status)}`, undefined, () =>
      localCapture((service) => service.listConflicts(options.status))
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
    const result = await withApiFallback("POST", "/conflicts/detect", {}, () =>
      localCapture((service) => ({ conflicts: service.detectConflicts() }))
    );
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
    const result = await withApiFallback("POST", `/conflicts/${id}/resolve`, body, () =>
      localCapture((service) => {
        const local = service.resolveConflict(id, body);
        if (!local) throw new Error(`Conflict ${id} not found`);
        return local;
      })
    );
    console.log(`${result.id}  ${result.status}`);
  });

program
  .command("onboard")
  .option("--dir <path>", "Target project directory", process.cwd())
  .option("--force", "Overwrite existing files")
  .description("Set up a new project with Claude Code hooks, hook script, and adaptive memory-capture skills")
  .action((options: { dir: string; force?: boolean }) => {
    const result = onboard(options.dir, Boolean(options.force));
    if (result.created.length) {
      console.log("Files created:");
      for (const rel of result.created) console.log(`  • ${rel}`);
    }
    if (result.skipped.length) {
      console.log("Files skipped (already exist — use --force to overwrite):");
      for (const rel of result.skipped) console.log(`  • ${rel}`);
    }
    if (!result.created.length) {
      console.log("Nothing to do — all files already exist. Run with --force to overwrite.");
      return;
    }
    console.log(`
Open this project in Claude Code or Codex and send this prompt:

  sync memory skill with this project

The AI will read your codebase and make memory capture project-specific.
Memory hooks are active from the first prompt once the API is running.`);
  });

const integrate = program.command("integrate").description("Project integration helpers");
integrate
  .command("codex")
  .description("Show and verify the supported Codex integration path for this repo")
  .action(async () => {
    const status = detectIntegrationStatus(workspaceRoot);
    await mkdir(dirname(program.opts<{ db: string }>().db), { recursive: true });
    console.log(`Codex instructions: ${status.codex.agentsInstructions ? "present" : "missing"}`);
    console.log(`Codex memory skill: ${status.codex.memorySkill ? "present" : "missing"}`);
    console.log(`Codex integration doc: ${status.codex.integrationDoc ? "present" : "missing"}`);
    console.log("");
    console.log("Recommended Codex workflow:");
    console.log("  1. npm run dev:api");
    console.log("  2. npm run cli -- watch --tool codex");
    console.log('  3. At meaningful checkpoints: npm run cli -- capture changes --tool codex --summary "<what changed and what remains>"');
    console.log("  4. Inspect traces with npm run cli -- replay <trace-id> or the web UI.");
  });

integrate
  .command("claude")
  .description("Install or verify Claude Code project hooks for automatic capture")
  .action(async () => {
    const result = installClaudeHooks(workspaceRoot);
    const status = detectIntegrationStatus(workspaceRoot);
    console.log(`${result.changed ? "Updated" : "Verified"} ${result.path}`);
    console.log(`Claude hook script: ${status.claude.hookScript ? "present" : "missing"}`);
    console.log(`Claude memory skill: ${status.claude.memorySkill ? "present" : "missing"}`);
    console.log(`Claude integration doc: ${status.claude.integrationDoc ? "present" : "missing"}`);
    console.log("");
    console.log("Verification:");
    console.log("  1. Start the API with npm run dev:api");
    console.log("  2. Open this repo in Claude Code");
    console.log("  3. Use /hooks to confirm the project hooks are active");
    console.log("  4. Make a meaningful edit and inspect the resulting replay trace");
  });

const hooks = program.command("hooks").description("Hook installation and status commands");
hooks
  .command("install")
  .description("Install the committed Claude Code project hooks into .claude/settings.json")
  .action(() => {
    const result = installClaudeHooks(workspaceRoot);
    console.log(`${result.changed ? "Installed" : "Already current"} hook config at ${result.path}`);
  });

hooks
  .command("status")
  .description("Show Codex and Claude integration status for this workspace")
  .action(() => {
    const status = detectIntegrationStatus(workspaceRoot);
    console.log(`Workspace: ${status.workspaceRoot}`);
    console.log(`Codex: AGENTS=${flag(status.codex.agentsInstructions)} skill=${flag(status.codex.memorySkill)} doc=${flag(status.codex.integrationDoc)}`);
    console.log(
      `Claude: CLAUDE.md=${flag(status.claude.claudeInstructions)} skill=${flag(status.claude.memorySkill)} settings=${flag(status.claude.settings)} hook=${flag(
        status.claude.hookScript
      )} doc=${flag(status.claude.integrationDoc)}`
    );
    console.log("Automation paths:");
    console.log("  Codex: watch mode for automatic code changes, checkpoint capture for prompts/summaries.");
    console.log("  Claude Code: project hooks for prompt, edit, stop, and task-complete capture.");
  });

program
  .command("replay")
  .argument("<id>", "Replay trace id")
  .description("Show an ingestion or retrieval trace")
  .action(async (id: string) => {
    const trace = await withApiFallback("GET", `/replay/${id}`, undefined, () =>
      localCapture((service) => {
        const local = service.getTrace(id);
        if (!local) throw new Error(`Trace ${id} not found`);
        return local;
      })
    );
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
    const result = await withApiFallback("POST", "/dev/seed", {}, () =>
      localCapture((service) => {
        const responses = seedDemoData(service);
        return {
          ok: true,
          sessions: responses.map((response) => response.session),
          memories: responses.flatMap((response) => response.stored),
          traces: responses.map((response) => response.trace)
        };
      })
    );
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

function parseCaptureContent(
  content: string,
  file: string | undefined,
  tool: string,
  trigger: string,
  type: AutomationEventType
): IngestRequest | AutomationCaptureRequest {
  const trimmed = content.trim();
  if (file?.endsWith(".json")) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown> | Array<Record<string, unknown>>;
    if (Array.isArray(parsed)) {
      const first = parsed[0] ?? {};
      if ("role" in first) return { steps: parsed as IngestRequest["steps"], source: { type: "import", path: file, label: file } };
      return {
        source: { type: "import", agent: tool, path: file, label: file },
        events: parsed as never
      };
    }
    if ("steps" in parsed || "rawContent" in parsed) {
      return { ...(parsed as IngestRequest), source: { type: "import", path: file, label: file, ...(parsed.source as object) } };
    }
    if ("events" in parsed) {
      return parsed as unknown as AutomationCaptureRequest;
    }
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if ("steps" in parsed || "rawContent" in parsed) return parsed as unknown as IngestRequest;
    if ("events" in parsed) return parsed as unknown as AutomationCaptureRequest;
  } catch {
      return {
        session: {
          agent: tool,
          title: file ? `Checkpoint from ${file}` : "Session checkpoint"
      },
      source: {
        type: trigger === "hook" ? "hook" : "automation",
        agent: tool,
        label: file ? file : `${tool} checkpoint capture`,
        path: file
      },
      events: [
        {
          type,
          tool: tool as never,
          trigger: trigger as never,
          automatic: trigger !== "manual",
          cwd: workspaceRoot,
          content: trimmed,
          metadata: {}
        }
      ]
    };
  }

  return {
    source: {
      type: trigger === "hook" ? "hook" : "automation",
      agent: tool,
      label: file ? file : `${tool} checkpoint capture`,
      path: file
    },
    events: [
      {
        type,
        tool: tool as never,
        trigger: trigger as never,
        automatic: trigger !== "manual",
        cwd: workspaceRoot,
        content: trimmed,
        metadata: {}
      }
    ]
  };
}

async function captureAutomation(body: AutomationCaptureRequest) {
  return withApiFallback("POST", "/automation/capture", body, () => localCapture((service) => service.captureAutomation(body)));
}

function printAutomationResult(result: Awaited<ReturnType<typeof captureAutomation>>): void {
  const sessionText = result.session ? `session=${result.session.title}` : "session=none";
  console.log(`Captured automation events: ${sessionText}`);
  console.log(`Accepted ${result.acceptedEventIds.length}, ignored ${result.ignoredEventIds.length}, stored ${result.stored.length}, merged ${result.merged.length}`);
  console.log(`Trace: ${result.trace.id}`);
}

function localCapture<T>(fn: (service: MemoryService) => T): T {
  const service = localService();
  try {
    return fn(service);
  } finally {
    service.close();
  }
}

function isIngestPayload(value: IngestRequest | AutomationCaptureRequest): value is IngestRequest {
  return "steps" in value || "rawContent" in value;
}

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) chunks.push(String(chunk));
  return chunks.join("");
}

function flag(value: boolean): string {
  return value ? "yes" : "no";
}

async function withApiFallback<T>(method: "GET" | "POST" | "PATCH", path: string, body: unknown, fallback: () => T): Promise<T> {
  const apiUrl = program.opts<{ api: string }>().api;
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(1200)
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return (await response.json()) as T;
  } catch {
    return fallback();
  }
}
