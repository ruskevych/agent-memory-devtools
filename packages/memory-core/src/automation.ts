import {
  AutomationCaptureDecision,
  AutomationCaptureRequest,
  AutomationCaptureRequestSchema,
  AutomationCaptureResponse,
  AutomationEvent,
  AutomationEventInput,
  MemorySource,
  ReplayStage,
  ReplayTrace,
  Session,
  SessionStep
} from "@agent-memory/shared";
import { IngestionPipeline } from "./ingestion.js";
import { MemoryStore } from "./store.js";
import { createId, jaccard, normalizeText, nowIso, summarize, tokenize, unique } from "./util.js";

interface PreparedAutomationEvent {
  event: AutomationEvent;
  decision: AutomationCaptureDecision;
}

interface AcceptedAutomationEvent extends PreparedAutomationEvent {
  decision: AutomationCaptureDecision & {
    action: "accept";
    role: SessionStep["role"];
    content: string;
    fingerprint: string;
  };
}

export class AutomationPipeline {
  constructor(
    private readonly store: MemoryStore,
    private readonly ingestion: IngestionPipeline
  ) {}

  capture(input: AutomationCaptureRequest): AutomationCaptureResponse {
    const parsed = AutomationCaptureRequestSchema.parse(input);
    const timestamp = nowIso();
    const normalizedEvents = parsed.events.map((event) => normalizeAutomationEvent(event, timestamp));
    const prepared = normalizedEvents.map((event) => prepareAutomationEvent(event, this.store));
    const accepted = prepared.filter((item): item is AcceptedAutomationEvent => item.decision.action === "accept");
    const ignored = prepared.filter((item) => item.decision.action === "ignore");
    const baseStages = automationStages(normalizedEvents, prepared);

    if (!accepted.length) {
      const trace: ReplayTrace = {
        id: createId("trace"),
        type: "ingestion",
        title: automaticTraceTitle(normalizedEvents),
        createdAt: timestamp,
        input: {
          automation: {
            acceptedEvents: 0,
            ignoredEvents: ignored.length,
            tools: unique(normalizedEvents.map((event) => event.tool)),
            triggers: unique(normalizedEvents.map((event) => event.trigger)),
            eventTypes: unique(normalizedEvents.map((event) => event.type))
          }
        },
        stages: baseStages,
        decisions: [],
        results: [],
        metadata: {
          automatic: true,
          stored: 0,
          ignored: 0,
          merged: 0,
          acceptedEventIds: [],
          ignoredEventIds: ignored.map((item) => item.event.id)
        }
      };
      this.store.addTrace(trace);
      return {
        session: undefined,
        steps: [],
        stored: [],
        ignored: [],
        merged: [],
        facts: [],
        events: [],
        trace,
        captureDecisions: prepared.map((item) => item.decision),
        acceptedEventIds: [],
        ignoredEventIds: ignored.map((item) => item.event.id)
      };
    }

    const sessionTags = unique([
      "automation",
      ...accepted.map((item) => item.event.tool),
      ...accepted.map((item) => item.event.type),
      ...(parsed.session?.tags ?? [])
    ]);
    const session: AutomationCaptureRequest["session"] = {
      id: parsed.session?.id,
      title: parsed.session?.title ?? inferAutomationSessionTitle(accepted),
      agent: parsed.session?.agent ?? dominantToolLabel(accepted),
      tags: sessionTags,
      metadata: {
        ...(parsed.session?.metadata ?? {}),
        automatic: true,
        acceptedEventCount: accepted.length,
        ignoredEventCount: ignored.length
      }
    };
    const source = automationSource(parsed.source, accepted, timestamp);
    const steps = accepted.map((item, index) => ({
      role: item.decision.role,
      content: item.decision.content,
      timestamp: item.event.timestamp,
      metadata: {
        automatic: true,
        automationEventId: item.event.id,
        automationEventType: item.event.type,
        automationTool: item.event.tool,
        automationTrigger: item.event.trigger,
        captureFingerprint: item.decision.fingerprint,
        taskId: item.event.taskId ?? null,
        filePaths: item.event.files.map((file) => file.path),
        fileSummaries: item.event.files.map((file) => file.summary).filter((value): value is string => Boolean(value)),
        hookEventName: stringMetadata(item.event.metadata, "hookEventName") ?? null
      }
    }));
    const result = this.ingestion.ingest({
      session,
      source,
      steps,
      metadata: {
        ...parsed.metadata,
        automatic: true,
        acceptedEventIds: accepted.map((item) => item.event.id),
        ignoredEventIds: ignored.map((item) => item.event.id)
      }
    });
    const trace = patchTrace(result.trace, normalizedEvents, prepared, source);
    this.store.addTrace(trace);

    return {
      ...result,
      trace,
      captureDecisions: prepared.map((item) => item.decision),
      acceptedEventIds: accepted.map((item) => item.event.id),
      ignoredEventIds: ignored.map((item) => item.event.id)
    };
  }
}

function normalizeAutomationEvent(event: AutomationEventInput, timestamp: string): AutomationEvent {
  return {
    ...event,
    id: event.id ?? createId("auto"),
    tool: event.tool ?? "generic",
    trigger: event.trigger ?? "cli",
    automatic: event.automatic ?? true,
    timestamp: event.timestamp ?? timestamp,
    files: (event.files ?? []).map((file) => ({
      path: file.path,
      changeType: file.changeType ?? "modified",
      summary: file.summary,
      addedLines: file.addedLines ?? 0,
      deletedLines: file.deletedLines ?? 0,
      symbols: file.symbols ?? [],
      libraries: file.libraries ?? [],
      metadata: file.metadata ?? {}
    })),
    metadata: event.metadata ?? {}
  };
}

function prepareAutomationEvent(event: AutomationEvent, store: MemoryStore): PreparedAutomationEvent {
  const prepared = candidateForEvent(event);
  if (!prepared) {
    return {
      event,
      decision: {
        id: createId("acd"),
        eventId: event.id,
        type: event.type,
        action: "ignore",
        reason: "No durable instruction, summary, or meaningful code-change signal was detected.",
        metadata: { automatic: true }
      }
    };
  }

  if (isSecretLike(prepared.content)) {
    return {
      event,
      decision: {
        id: createId("acd"),
        eventId: event.id,
        type: event.type,
        action: "ignore",
        reason: "Secret-like content is ignored by automatic capture.",
        content: summarize(prepared.content, 160),
        metadata: { automatic: true }
      }
    };
  }

  if (isLowSignal(prepared.content)) {
    return {
      event,
      decision: {
        id: createId("acd"),
        eventId: event.id,
        type: event.type,
        action: "ignore",
        reason: "The event looked conversational or too small to become durable memory.",
        content: summarize(prepared.content, 160),
        metadata: { automatic: true }
      }
    };
  }

  const fingerprint = automationFingerprint(event, prepared.content);
  if (isDuplicateAutomaticCapture(fingerprint, prepared.content, store)) {
    return {
      event,
      decision: {
        id: createId("acd"),
        eventId: event.id,
        type: event.type,
        action: "ignore",
        reason: "A recent automatic memory already captured the same durable signal.",
        content: summarize(prepared.content, 160),
        fingerprint,
        metadata: { automatic: true, deduped: true }
      }
    };
  }

  return {
    event,
    decision: {
      id: createId("acd"),
      eventId: event.id,
      type: event.type,
      action: "accept",
      reason: prepared.reason,
      role: prepared.role,
      content: prepared.content,
      fingerprint,
      metadata: {
        automatic: true,
        fileCount: event.files.length
      }
    }
  };
}

function candidateForEvent(
  event: AutomationEvent
): { role: SessionStep["role"]; content: string; reason: string } | undefined {
  const directContent = event.content?.trim();
  const eventSummary = event.summary?.trim();

  if (event.type === "user-prompt") {
    if (!directContent || !looksDurableInstruction(directContent)) return undefined;
    return {
      role: "user",
      content: directContent,
      reason: "Accepted a durable user instruction from automated prompt capture."
    };
  }

  if (event.type === "agent-summary") {
    const content = directContent ?? eventSummary;
    if (!content || !looksMeaningfulSummary(content)) return undefined;
    return {
      role: "assistant",
      content,
      reason: "Accepted an agent summary because it described meaningful completed work or durable context."
    };
  }

  if (event.type === "task-complete") {
    const content = directContent ?? eventSummary ?? taskCompletionNarrative(event);
    if (!content || !looksMeaningfulSummary(content)) return undefined;
    return {
      role: "assistant",
      content,
      reason: "Accepted a task-completion summary for future handoff or continuation context."
    };
  }

  if (event.type === "session-checkpoint") {
    const content = directContent ?? eventSummary;
    if (!content || !looksMeaningfulSummary(content)) return undefined;
    return {
      role: "event",
      content,
      reason: "Accepted a session checkpoint because it contained durable coding context."
    };
  }

  const fileNarrative = directContent ?? codeChangeNarrative(event);
  if (!fileNarrative || !looksMeaningfulCodeChange(fileNarrative, event.files.map((file) => file.path))) return undefined;
  return {
    role: "event",
    content: fileNarrative,
    reason: "Accepted a meaningful code-change summary from an automatic workflow."
  };
}

function automationStages(events: AutomationEvent[], prepared: PreparedAutomationEvent[]): ReplayStage[] {
  return [
    {
      name: "automation-events",
      summary: `Received ${events.length} automation event${events.length === 1 ? "" : "s"} from ${unique(events.map((event) => event.tool)).join(", ")}.`,
      items: events.map((event) => ({
        id: event.id,
        type: event.type,
        tool: event.tool,
        trigger: event.trigger,
        automatic: event.automatic,
        summary: event.summary ?? summarize(event.content ?? event.files.map((file) => file.summary ?? file.path).join("; "), 180),
        fileCount: event.files.length,
        hookEventName: stringMetadata(event.metadata, "hookEventName") ?? null
      }))
    },
    {
      name: "automation-filtering",
      summary: `Accepted ${prepared.filter((item) => item.decision.action === "accept").length} and ignored ${
        prepared.filter((item) => item.decision.action === "ignore").length
      } automation event${prepared.length === 1 ? "" : "s"}.`,
      items: prepared.map((item) => ({
        id: item.decision.id,
        eventId: item.event.id,
        type: item.event.type,
        action: item.decision.action,
        reason: item.decision.reason,
        content: item.decision.content ?? null,
        fingerprint: item.decision.fingerprint ?? null
      }))
    }
  ];
}

function patchTrace(
  trace: ReplayTrace,
  events: AutomationEvent[],
  prepared: PreparedAutomationEvent[],
  source: MemorySource
): ReplayTrace {
  const stages = [...automationStages(events, prepared), ...trace.stages];
  return {
    ...trace,
    title: automaticTraceTitle(events),
    input: {
      ...trace.input,
      automation: {
        sourceType: source.type,
        label: source.label ?? null,
        tool: unique(events.map((event) => event.tool)),
        trigger: unique(events.map((event) => event.trigger)),
        eventTypes: unique(events.map((event) => event.type)),
        acceptedEventIds: prepared.filter((item) => item.decision.action === "accept").map((item) => item.event.id),
        ignoredEventIds: prepared.filter((item) => item.decision.action === "ignore").map((item) => item.event.id)
      }
    },
    stages,
    metadata: {
      ...trace.metadata,
      automatic: true,
      acceptedEventIds: prepared.filter((item) => item.decision.action === "accept").map((item) => item.event.id),
      ignoredEventIds: prepared.filter((item) => item.decision.action === "ignore").map((item) => item.event.id)
    }
  };
}

function automationSource(
  input: AutomationCaptureRequest["source"],
  accepted: AcceptedAutomationEvent[],
  timestamp: string
): MemorySource {
  const tool = dominantToolLabel(accepted);
  const trigger = unique(accepted.map((item) => item.event.trigger)).join(", ");
  return {
    type: input?.type ?? inferredSourceType(accepted),
    agent: input?.agent ?? tool,
    label: input?.label ?? `${tool} automatic capture`,
    path: input?.path ?? accepted[0]?.event.cwd,
    runId: input?.runId,
    timestamp: input?.timestamp ?? timestamp,
    metadata: {
      ...(input?.metadata ?? {}),
      automatic: true,
      tool,
      trigger,
      eventTypes: unique(accepted.map((item) => item.event.type)),
      fileCount: accepted.reduce((total, item) => total + item.event.files.length, 0),
      hookEventNames: unique(
        accepted
          .map((item) => stringMetadata(item.event.metadata, "hookEventName"))
          .filter((value): value is string => Boolean(value))
      )
    }
  };
}

function automaticTraceTitle(events: AutomationEvent[]): string {
  const tool = unique(events.map((event) => event.tool)).join(", ");
  return `Automatic capture from ${tool}`;
}

function inferAutomationSessionTitle(events: AcceptedAutomationEvent[]): string {
  const first = events[0];
  if (!first) return "Automatic memory capture";
  if (first.event.type === "file-change") {
    const topPaths = first.event.files.map((file) => file.path).slice(0, 2).join(", ");
    return summarize(`Automatic code-change capture for ${topPaths || "workspace changes"}`, 80);
  }
  return summarize(first.decision.content, 80);
}

function dominantToolLabel(events: AcceptedAutomationEvent[]): string {
  return events[0]?.event.tool ?? "generic";
}

function inferredSourceType(events: AcceptedAutomationEvent[]): MemorySource["type"] {
  return events.some((item) => item.event.trigger === "hook") ? "hook" : "automation";
}

function taskCompletionNarrative(event: AutomationEvent): string | undefined {
  const subject = stringMetadata(event.metadata, "taskSubject");
  const description = stringMetadata(event.metadata, "taskDescription");
  if (!subject && !description) return undefined;
  return summarize([subject, description].filter(Boolean).join(". "), 220);
}

function codeChangeNarrative(event: AutomationEvent): string | undefined {
  const summaries = unique(event.files.map((file) => file.summary).filter((value): value is string => Boolean(value)));
  if (summaries.length) return summaries.join(" ");

  const interesting = event.files.filter((file) => isInterestingPath(file.path));
  if (!interesting.length) return undefined;

  const paths = interesting.map((file) => file.path).slice(0, 4);
  const areas = unique(interesting.map((file) => pathArea(file.path)).filter((value): value is string => Boolean(value)));
  const libraries = unique(interesting.flatMap((file) => file.libraries)).slice(0, 4);
  const symbols = unique(interesting.flatMap((file) => file.symbols)).slice(0, 4);
  const areaText = areas.length ? `${areas.join(", ")} changed.` : `Changed ${paths.join(", ")}.`;
  const libraryText = libraries.length ? ` Libraries involved: ${libraries.join(", ")}.` : "";
  const symbolText = symbols.length ? ` Symbols touched: ${symbols.join(", ")}.` : "";
  return summarize(`${areaText} Files: ${paths.join(", ")}.${libraryText}${symbolText}`, 240);
}

function looksDurableInstruction(text: string): boolean {
  if (text.length < 40) return false;
  return /\b(prefer|always|never|avoid|use|keep|remember|when working|project|repo|workflow|style|convention|validation|schema|api|cli|route|tests?)\b/i.test(
    text
  );
}

function looksMeaningfulSummary(text: string): boolean {
  if (text.length < 36) return false;
  return /\b(implemented|added|updated|introduced|changed|moved|refactored|fixed|created|removed|hook|integration|memory|schema|route|command|task|remaining|follow up|unresolved|completed)\b/i.test(
    text
  );
}

function looksMeaningfulCodeChange(text: string, filePaths: string[]): boolean {
  if (!filePaths.some((path) => isInterestingPath(path)) && text.length < 50) return false;
  if (/\b(readme|demo|roadmap|feature|docs)\b/i.test(text) && !/\b(ag(e)?nts|claude|hook|workflow|integration|instruction)\b/i.test(text)) {
    return false;
  }
  return /\b(schema|route|command|hook|integration|watch|memory|replay|feedback|rule|confidence|conflict|session|capture|codex|claude|fastify|zod|react|sqlite|api|cli)\b/i.test(
    text
  );
}

function isLowSignal(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized.length < 24 || /^(ok|done|thanks|great|looks good|sounds good)$/.test(normalized);
}

function isSecretLike(text: string): boolean {
  return /\b(secret|token|password|api key|private key|sk-[a-z0-9_-]+)\b/i.test(text);
}

function isInterestingPath(path: string): boolean {
  return !/(^|\/)(dist|node_modules|coverage|\.git|docs\/screenshots)(\/|$)/.test(path) && !/(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(path);
}

function automationFingerprint(event: AutomationEvent, content: string): string {
  const fileSignals = event.files
    .map((file) => `${file.path}:${stringMetadata(file.metadata, "hash") ?? file.summary ?? `${file.addedLines}/${file.deletedLines}`}`)
    .sort()
    .join("|");
  return normalizeText([event.tool, event.trigger, event.type, fileSignals, content].join(" | "));
}

function isDuplicateAutomaticCapture(fingerprint: string, content: string, store: MemoryStore): boolean {
  const contentTokens = tokenize(content);
  const recentMemories = store.listMemories({ includeArchived: true, includeMerged: true, limit: 500 });
  return recentMemories.some((memory) => {
    const storedFingerprint =
      stringMetadata(memory.metadata, "captureFingerprint") ??
      stringMetadata(memory.source.metadata ?? {}, "captureFingerprint");
    if (storedFingerprint && storedFingerprint === fingerprint) return true;
    if (memory.archived || memory.mergedInto) return false;
    if (Math.abs(Date.parse(memory.timestamp) - Date.now()) > 30 * 86_400_000) return false;
    return jaccard(contentTokens, tokenize(memory.content)) >= 0.92;
  });
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

function pathArea(path: string): string | undefined {
  if (/(^|\/)packages\/memory-core\//.test(path)) return "memory-core capture behavior";
  if (/(^|\/)packages\/shared\//.test(path)) return "shared schemas";
  if (/(^|\/)packages\/cli\//.test(path)) return "CLI workflows";
  if (/(^|\/)apps\/api\//.test(path)) return "API routes";
  if (/(^|\/)apps\/web\//.test(path)) return "web UI surfaces";
  if (/(^|\/)\.claude\/settings\.json$/.test(path)) return "Claude Code hooks";
  if (/(^|\/)(AGENTS\.md|CLAUDE\.md)$/.test(path)) return "agent instructions";
  if (/(^|\/)\.(agents|claude)\/skills\//.test(path)) return "agent skills";
  if (/(^|\/)(README|FEATURES|DEMO|ROADMAP)\.md$/.test(path) || /(^|\/)docs\//.test(path)) return "memory workflow docs";
  return undefined;
}
