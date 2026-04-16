import {
  IngestRequest,
  IngestResponse,
  Memory,
  MemoryDecision,
  MemoryEvent,
  MemoryFact,
  MemoryKind,
  MemoryRule,
  MemorySource,
  Metadata,
  ReplayStage,
  ReplayTrace,
  Session,
  SessionStep
} from "@agent-memory/shared";
import { createEmbedding, EmbeddingProvider, HashEmbeddingProvider } from "./embedding.js";
import {
  CODEBASE_CONTEXT_RE,
  COMPLETION_VERB_RE,
  CONVERSATIONAL_ACK_RE,
  DURABLE_INSTRUCTION_PHRASES,
  DURABLE_INSTRUCTION_VERB_RE,
  SYSTEM_NOISE_PATTERNS,
  TASK_CONTINUATION_RE,
} from "./signals.js";
import { MemoryStore } from "./store.js";
import { clamp01, createId, jaccard, normalizeText, nowIso, summarize, tokenize, unique } from "./util.js";

interface Candidate {
  id: string;
  content: string;
  kind: MemoryKind;
  confidence: number;
  importance: number;
  tags: string[];
  sourceStepId?: string;
  reason: string;
  ruleIds?: string[];
  forceStore?: boolean;
  forceIgnore?: boolean;
}

export class IngestionPipeline {
  constructor(
    private readonly store: MemoryStore,
    private readonly embeddingProvider: EmbeddingProvider = new HashEmbeddingProvider()
  ) {}

  ingest(input: IngestRequest): IngestResponse {
    const timestamp = nowIso();
    const traceId = createId("trace");
    const source = normalizeSource(input.source, timestamp);
    const steps = normalizeSteps(input, timestamp);
    const session: Session = {
      id: input.session?.id ?? createId("ses"),
      title: input.session?.title ?? inferSessionTitle(steps),
      agent: input.session?.agent ?? source.agent ?? "unknown",
      startedAt: steps[0]?.timestamp ?? timestamp,
      endedAt: steps.at(-1)?.timestamp,
      tags: input.session?.tags ?? unique(["ingested", source.agent, ...(input.session?.tags ?? [])].filter(Boolean) as string[]),
      summary: summarize(steps.map((step) => step.content).join(" "), 180),
      metadata: input.session?.metadata ?? {}
    };
    const sessionSteps: SessionStep[] = steps.map((step, index) => ({
      id: createId("step"),
      sessionId: session.id,
      index,
      role: step.role ?? "event",
      content: step.content,
      timestamp: step.timestamp ?? timestamp,
      metadata: step.metadata ?? {}
    }));
    const stepById = new Map(sessionSteps.map((step) => [step.id, step]));

    const chunks = chunkSteps(sessionSteps);
    const ingestionRules = this.store.listRules({ scope: "ingestion", enabled: true });
    const dedupeRules = this.store.listRules({ scope: "dedupe", enabled: true });
    const candidates = chunks
      .map((chunk) => applyIngestionRules(classifyCandidate(chunk.content, chunk.stepId), ingestionRules));
    const decisions: MemoryDecision[] = [];
    const stored: Memory[] = [];
    const ignored: MemoryDecision[] = [];
    const merged: MemoryDecision[] = [];
    const facts: MemoryFact[] = [];
    const events: MemoryEvent[] = [];
    const stages: ReplayStage[] = [
      {
        name: "input-normalization",
        summary: `Created session ${session.title} with ${sessionSteps.length} timeline steps.`,
        metadata: { sessionId: session.id, rawLength: input.rawContent?.length ?? 0 }
      },
      {
        name: "chunking",
        summary: `Split transcript into ${chunks.length} candidate chunks.`,
        items: chunks.map((chunk) => ({ id: chunk.id, content: summarize(chunk.content), stepId: chunk.stepId }))
      },
      {
        name: "classification",
        summary: `Classified ${candidates.length} memory-worthy candidates.`,
        items: candidates.map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          importance: candidate.importance,
          confidence: candidate.confidence,
          tags: candidate.tags,
          reason: candidate.reason,
          ruleIds: candidate.ruleIds ?? []
        }))
      }
    ];
    if (ingestionRules.length || dedupeRules.length) {
      stages.push({
        name: "rules",
        summary: `Loaded ${ingestionRules.length} ingestion rules and ${dedupeRules.length} dedupe rules.`,
        items: candidates
          .filter((candidate) => candidate.ruleIds?.length)
          .map((candidate) => ({
            id: candidate.id,
            action: candidate.forceIgnore ? "force-ignore" : candidate.forceStore ? "force-store" : "adjust",
            ruleIds: candidate.ruleIds ?? [],
            reason: candidate.reason
          }))
      });
    }

    this.store.upsertSession(session);
    for (const step of sessionSteps) {
      this.store.upsertSessionStep(step);
      const event: MemoryEvent = {
        id: createId("evt"),
        sessionId: session.id,
        kind: `session-${step.role}`,
        title: summarize(step.content, 80),
        content: step.content,
        timestamp: step.timestamp,
        metadata: { stepId: step.id, index: step.index }
      };
      this.store.addEvent(event);
      events.push(event);
    }

    const existing = this.store.listMemories({ includeArchived: true, includeMerged: true, limit: 2000 });
    for (const candidate of candidates) {
      if (candidate.forceIgnore) {
        const decision = createDecision(traceId, candidate, "ignore", candidate.reason);
        this.store.addDecision(decision);
        decisions.push(decision);
        ignored.push(decision);
        continue;
      }
      const importanceFloor = candidate.kind === "fact" ? 0.40 : 0.28;
      if (
        !candidate.forceStore &&
        (candidate.importance < 0.12 || (candidate.importance < importanceFloor && !["preference", "task-context", "codebase-context"].includes(candidate.kind)))
      ) {
        const decision = createDecision(traceId, candidate, "ignore", "Low importance and no durable developer-memory signal.");
        this.store.addDecision(decision);
        decisions.push(decision);
        ignored.push(decision);
        continue;
      }

      const duplicateMatch = findDuplicate(candidate, existing, dedupeRules);
      const duplicate = duplicateMatch?.memory;
      const sourceStep = candidate.sourceStepId ? stepById.get(candidate.sourceStepId) : undefined;
      const memory: Memory = {
        id: createId("mem"),
        content: candidate.content,
        summary: summarize(candidate.content),
        kind: candidate.kind,
        source: { ...source, stepId: candidate.sourceStepId },
        tags: unique([candidate.kind, ...candidate.tags]).sort(),
        timestamp,
        confidence: candidate.confidence,
        importance: candidate.importance,
        pinned: candidate.kind === "preference" && candidate.importance > 0.72,
        archived: Boolean(duplicate),
        duplicateOf: duplicate?.id,
        mergedInto: duplicate?.id,
        relatedSessionId: session.id,
        metadata: {
          candidateId: candidate.id,
          ingestionTraceId: traceId,
          decisionReason: candidate.reason,
          sourceRole: sourceStep?.role ?? null,
          sourceStepId: sourceStep?.id ?? null,
          sourceEventType: asString(sourceStep?.metadata?.automationEventType) ?? null,
          automationTool: asString(sourceStep?.metadata?.automationTool) ?? null,
          automationTrigger: asString(sourceStep?.metadata?.automationTrigger) ?? null,
          captureFingerprint: asString(sourceStep?.metadata?.captureFingerprint) ?? null,
          filePaths: asStringArray(sourceStep?.metadata?.filePaths) ?? [],
          ...(duplicateMatch ? { dedupeScore: duplicateMatch.score } : {})
        }
      };

      if (duplicate) {
        const canonical: Memory = {
          ...duplicate,
          tags: unique([...duplicate.tags, ...memory.tags]).sort(),
          confidence: Math.max(duplicate.confidence, memory.confidence),
          importance: Math.max(duplicate.importance, memory.importance),
          metadata: {
            ...duplicate.metadata,
            mergedDuplicateIds: unique([...(asStringArray(duplicate.metadata?.mergedDuplicateIds) ?? []), memory.id])
          }
        };
        this.store.upsertMemory(canonical);
        this.store.upsertMemory(memory);
        this.store.upsertEmbedding(createEmbedding(memory.id, memory.content, this.embeddingProvider));
        const decision = createDecision(
          traceId,
          candidate,
          "merge",
          `Merged into canonical memory ${duplicate.id} because content overlap ${duplicateMatch.score.toFixed(2)} crossed the dedupe threshold.`,
          memory.id,
          duplicate.id
        );
        this.store.addDecision(decision);
        decisions.push(decision);
        merged.push(decision);
        stored.push(memory);
        existing.push(memory);
      } else {
        this.store.upsertMemory(memory);
        this.store.upsertEmbedding(createEmbedding(memory.id, memory.content, this.embeddingProvider));
        const decision = createDecision(traceId, candidate, "store", candidate.reason, memory.id);
        this.store.addDecision(decision);
        decisions.push(decision);
        stored.push(memory);
        existing.push(memory);
      }

      const latestMemory = stored.at(-1);
      if (latestMemory) {
        const fact = maybeCreateFact(latestMemory);
        if (fact) {
          this.store.addFact(fact);
          facts.push(fact);
        }
        if (latestMemory.kind === "event" || latestMemory.kind === "task-context") {
          const event: MemoryEvent = {
            id: createId("evt"),
            sessionId: session.id,
            memoryId: latestMemory.id,
            kind: latestMemory.kind,
            title: latestMemory.summary,
            content: latestMemory.content,
            timestamp,
            metadata: { memoryId: latestMemory.id }
          };
          this.store.addEvent(event);
          events.push(event);
        }
      }
    }

    stages.push({
      name: "dedupe-and-storage",
      summary: `Stored ${stored.filter((memory) => !memory.mergedInto).length}, merged ${merged.length}, ignored ${ignored.length}.`,
      items: decisions.map((decision) => ({
        action: decision.action,
        memoryId: decision.memoryId ?? null,
        duplicateOf: decision.duplicateOf ?? null,
        reason: decision.reason
      }))
    });

    const trace: ReplayTrace = {
      id: traceId,
      type: "ingestion",
      title: `Ingested ${session.title}`,
      createdAt: timestamp,
      input: {
        sessionId: session.id,
        source,
        stepCount: sessionSteps.length,
        rawContent: input.rawContent ? summarize(input.rawContent, 300) : null
      },
      stages,
      decisions,
      results: [],
      metadata: { stored: stored.length, ignored: ignored.length, merged: merged.length }
    };
    this.store.addTrace(trace);

    return { session, steps: sessionSteps, stored, ignored, merged, facts, events, trace };
  }
}

function normalizeSource(source: IngestRequest["source"], timestamp: string): MemorySource {
  return {
    type: source?.type ?? "cli",
    agent: source?.agent ?? "unknown",
    label: source?.label ?? "local ingest",
    path: source?.path,
    runId: source?.runId,
    timestamp: source?.timestamp ?? timestamp,
    metadata: source?.metadata ?? {}
  };
}

function normalizeSteps(input: IngestRequest, timestamp: string): Array<{ role: SessionStep["role"]; content: string; timestamp?: string; metadata?: Metadata }> {
  if (input.steps?.length) {
    return input.steps.map((step) => ({
      role: step.role ?? "event",
      content: step.content,
      timestamp: step.timestamp,
      metadata: step.metadata as Metadata | undefined
    }));
  }
  if (!input.rawContent?.trim()) {
    return [{ role: "event", content: "Initialized an empty agent-memory workspace.", timestamp }];
  }
  const lines = input.rawContent
    .split(/\n{2,}|\r?\n(?=(?:user|assistant|system|tool|event)\s*:)/i)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line) => {
    const match = line.match(/^(user|assistant|system|tool|event)\s*:\s*(.+)$/is);
    return {
      role: (match?.[1]?.toLowerCase() as SessionStep["role"]) ?? "event",
      content: (match?.[2] ?? line).trim(),
      timestamp
    };
  });
}

function chunkSteps(steps: SessionStep[]): Array<{ id: string; stepId: string; content: string }> {
  const chunks: Array<{ id: string; stepId: string; content: string }> = [];
  for (const step of steps) {
    const paragraphs = step.content
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter((part) => part.length > 20);
    for (const paragraph of paragraphs.length ? paragraphs : [step.content]) {
      if (paragraph.length > 500) {
        const sentences = paragraph
          .split(/(?<=[.!?])\s+(?=[A-Z`])/)
          .map((s) => s.trim())
          .filter((s) => s.length > 20);
        for (const sentence of sentences.length > 1 ? sentences : [paragraph]) {
          chunks.push({ id: createId("cand"), stepId: step.id, content: sentence });
        }
      } else {
        chunks.push({ id: createId("cand"), stepId: step.id, content: paragraph });
      }
    }
  }
  return chunks;
}

function classifyCandidate(content: string, sourceStepId?: string): Candidate {
  const normalized = normalizeText(content);
  const tags = extractTags(content);
  let kind: MemoryKind = "fact";
  let importance = 0.32;
  let confidence = 0.56;
  let reason = "Substantive statement that may help a future coding agent.";

  const isPreference = DURABLE_INSTRUCTION_VERB_RE.test(content) || DURABLE_INSTRUCTION_PHRASES.some((p) => p.test(content));
  if (isPreference) {
    kind = "preference";
    importance += 0.35;
    confidence += 0.22;
    reason = "Detected durable preference or workflow instruction.";
  } else if (TASK_CONTINUATION_RE.test(content)) {
    kind = "task-context";
    importance += 0.3;
    confidence += 0.16;
    reason = "Detected unresolved task or continuation context.";
  } else if (CODEBASE_CONTEXT_RE.test(content)) {
    kind = "codebase-context";
    importance += 0.24;
    confidence += 0.14;
    reason = "Detected codebase or implementation fact.";
  } else if (COMPLETION_VERB_RE.test(content)) {
    kind = "event";
    importance += 0.12;
    reason = "Detected timeline-worthy project event.";
  }

  if (/\b(secret|token|password|api key|private key)\b/i.test(content)) {
    importance = 0.05;
    confidence = 0.2;
    reason = "Potential secret or credential-like content should not be stored by default.";
  }
  if (normalized.length < 24 || CONVERSATIONAL_ACK_RE.test(normalized)) {
    importance = 0.08;
    confidence = 0.25;
    reason = "Too short or conversational to store.";
  } else if (/\?$/.test(content.trim()) || SYSTEM_NOISE_PATTERNS.some((p) => p.test(content))) {
    importance = 0.08;
    confidence = 0.25;
    reason = "Conversational question or system output noise.";
  }

  const specificityBoost = Math.min(0.15, tags.length * 0.025 + Math.max(0, tokenize(content).length - 12) * 0.004);
  return {
    id: createId("cand"),
    content,
    kind,
    confidence: clamp01(confidence),
    importance: clamp01(importance + specificityBoost),
    tags,
    sourceStepId,
    reason
  };
}

export function extractTags(content: string): string[] {
  const tags = new Set<string>();
  for (const match of content.matchAll(/\b(apps|packages|src|docs|tests?)\/[A-Za-z0-9_./-]+/g)) {
    tags.add(match[0].split("/")[0]);
    tags.add(match[0]);
  }
  for (const match of content.matchAll(/\b(react|vite|typescript|fastify|express|sqlite|better-sqlite3|zod|codex|claude|cli|api|memory|retrieval|dedupe|session)\b/gi)) {
    tags.add(match[1].toLowerCase());
  }
  return [...tags].slice(0, 12);
}

function findDuplicate(candidate: Candidate, existing: Memory[], rules: MemoryRule[]): { memory: Memory; score: number } | undefined {
  const preferredCanonicalId = matchingRules(candidate, rules)
    .map((rule) => asString(rule.effect.preferCanonicalMemoryId))
    .find(Boolean);
  if (preferredCanonicalId) {
    const canonical = existing.find((memory) => memory.id === preferredCanonicalId && !memory.mergedInto);
    if (canonical) return { memory: canonical, score: 1 };
  }

  const tokens = tokenize(candidate.content);
  let best: { memory: Memory; score: number } | undefined;
  for (const memory of existing.filter((item) => !item.mergedInto)) {
    if (isNeverMergePair(candidate, memory, rules)) continue;
    const score = Math.max(jaccard(tokens, tokenize(memory.content)), jaccard(tokens, tokenize(memory.summary)));
    if (!best || score > best.score) best = { memory, score };
  }
  return best && best.score >= 0.76 ? best : undefined;
}

function createDecision(
  traceId: string,
  candidate: Candidate,
  action: MemoryDecision["action"],
  reason: string,
  memoryId?: string,
  duplicateOf?: string
): MemoryDecision {
  return {
    id: createId("dec"),
    traceId,
    candidateId: candidate.id,
    memoryId,
    action,
    reason,
    confidence: candidate.confidence,
    importance: candidate.importance,
    duplicateOf,
    timestamp: nowIso(),
    metadata: {
      kind: candidate.kind,
      tags: candidate.tags,
      content: candidate.content,
      sourceStepId: candidate.sourceStepId ?? null,
      ruleIds: candidate.ruleIds ?? []
    }
  };
}

function maybeCreateFact(memory: Memory): MemoryFact | undefined {
  if (!["fact", "preference", "codebase-context", "summary"].includes(memory.kind)) return undefined;
  const [subject, rest] = memory.content.split(/\s+(?:is|are|uses|use|prefers|prefer|should)\s+/i);
  return {
    id: createId("fact"),
    memoryId: memory.id,
    subject: summarize(subject || "workspace", 80),
    predicate: memory.kind === "preference" ? "prefers" : "states",
    object: summarize(rest || memory.content, 180),
    confidence: memory.confidence,
    timestamp: memory.timestamp,
    source: memory.source,
    metadata: { kind: memory.kind }
  };
}

function inferSessionTitle(steps: Array<{ content: string }>): string {
  const first = steps.find((step) => step.content.trim().length > 0)?.content ?? "Untitled memory session";
  return summarize(first, 70);
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function applyIngestionRules(candidate: Candidate, rules: MemoryRule[]): Candidate {
  const applied = matchingRules(candidate, rules);
  if (!applied.length) return candidate;
  let next = { ...candidate, tags: [...candidate.tags], ruleIds: [...(candidate.ruleIds ?? [])] };
  const reasons: string[] = [];
  for (const rule of applied) {
    next.ruleIds = unique([...(next.ruleIds ?? []), rule.id]);
    const effect = rule.effect;
    if (asBoolean(effect.forceStore)) {
      next.forceStore = true;
      next.importance = Math.max(next.importance, 0.5);
      reasons.push("forced store");
    }
    if (asBoolean(effect.forceIgnore)) {
      next.forceIgnore = true;
      next.importance = Math.min(next.importance, 0.05);
      reasons.push("forced ignore");
    }
    const boost = asNumber(effect.importanceBoost);
    if (boost !== undefined) {
      next.importance = clamp01(next.importance + boost);
      reasons.push(`importance +${boost.toFixed(2)}`);
    }
    const lower = asNumber(effect.importanceLower);
    if (lower !== undefined) {
      next.importance = clamp01(next.importance - lower);
      reasons.push(`importance -${lower.toFixed(2)}`);
    }
    const forceKind = asString(effect.forceKind);
    if (forceKind && isMemoryKind(forceKind)) {
      next.kind = forceKind;
      reasons.push(`kind ${forceKind}`);
    }
    const addTags = asStringArray(effect.addTags);
    if (addTags?.length) {
      next.tags = unique([...next.tags, ...addTags]).slice(0, 12);
      reasons.push(`tags ${addTags.join(", ")}`);
    }
  }
  return {
    ...next,
    reason: `${next.reason} Applied rule${applied.length === 1 ? "" : "s"} ${applied.map((rule) => rule.id).join(", ")}${
      reasons.length ? ` (${unique(reasons).join("; ")})` : ""
    }.`
  };
}

function matchingRules(candidate: Candidate, rules: MemoryRule[]): MemoryRule[] {
  return rules.filter((rule) => rule.enabled && matchesCondition(candidate, rule.condition));
}

function matchesCondition(candidate: Candidate, condition: Metadata): boolean {
  const text = normalizeText(candidate.content);
  const contains = asStringArray(condition.textContains);
  if (contains?.length && !contains.every((token) => text.includes(normalizeText(token)))) return false;
  const any = asStringArray(condition.textContainsAny);
  if (any?.length && !any.some((token) => text.includes(normalizeText(token)))) return false;
  const kind = asString(condition.kind);
  if (kind && candidate.kind !== kind) return false;
  const tag = asString(condition.tag);
  if (tag && !candidate.tags.includes(tag)) return false;
  const sourceStepId = asString(condition.sourceStepId);
  if (sourceStepId && candidate.sourceStepId !== sourceStepId) return false;
  const candidateId = asString(condition.candidateId);
  if (candidateId && candidate.id !== candidateId) return false;
  return true;
}

function isNeverMergePair(candidate: Candidate, memory: Memory, rules: MemoryRule[]): boolean {
  return matchingRules(candidate, rules).some((rule) => {
    const ids = asStringArray(rule.effect.neverMergeMemoryIds);
    return Boolean(ids?.includes(memory.id));
  });
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function isMemoryKind(value: string): value is MemoryKind {
  return ["fact", "preference", "event", "task-context", "codebase-context", "summary"].includes(value);
}
