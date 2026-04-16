import {
  DashboardStats,
  FeedbackTargetType,
  FeedbackType,
  IngestRequest,
  IngestRequestSchema,
  IngestResponse,
  Memory,
  MemoryConfidenceReport,
  MemoryConflict,
  MemoryFeedback,
  MemoryMutation,
  MemoryRule,
  Metadata,
  MissingMemorySuggestion,
  ReplayTrace,
  SearchRequest,
  SearchRequestSchema,
  SearchResponse,
  Session,
  SessionStep
} from "@agent-memory/shared";
import { HashEmbeddingProvider } from "./embedding.js";
import { computeConfidenceReport } from "./confidence.js";
import { detectMemoryConflicts } from "./conflicts.js";
import { IngestionPipeline } from "./ingestion.js";
import { analyzeMissingMemories } from "./missing-analysis.js";
import { RetrievalEngine } from "./retrieval.js";
import { MemoryFilters, MemoryStore, SqliteMemoryStore } from "./store.js";
import { clamp01, createId, nowIso, summarize, tokenize, unique } from "./util.js";

export interface FeedbackInput {
  targetType: FeedbackTargetType;
  targetId: string;
  type: FeedbackType;
  reason?: string;
  patch?: Metadata;
  actor?: string;
  memoryId?: string;
  sessionId?: string;
  traceId?: string;
}

export interface FeedbackApplyOptions {
  apply?: boolean;
  createRule?: boolean;
}

export interface FeedbackResult {
  feedback: MemoryFeedback;
  memory?: Memory;
  rule?: MemoryRule;
}

export class MemoryService {
  private readonly ingestion: IngestionPipeline;
  private readonly retrieval: RetrievalEngine;

  constructor(public readonly store: MemoryStore = new SqliteMemoryStore()) {
    const embeddings = new HashEmbeddingProvider();
    this.ingestion = new IngestionPipeline(store, embeddings);
    this.retrieval = new RetrievalEngine(store, embeddings);
  }

  close(): void {
    this.store.close();
  }

  ingest(input: IngestRequest): IngestResponse {
    return this.ingestion.ingest(IngestRequestSchema.parse(input));
  }

  search(input: SearchRequest): SearchResponse {
    return this.retrieval.search(SearchRequestSchema.parse(input));
  }

  listMemories(filters?: MemoryFilters): Memory[] {
    return this.store.listMemories(filters);
  }

  getMemory(id: string): Memory | undefined {
    return this.store.getMemory(id);
  }

  createMemory(input: Omit<Memory, "id" | "timestamp"> & { id?: string; timestamp?: string }): Memory {
    const memory: Memory = {
      ...input,
      id: input.id ?? createId("mem"),
      timestamp: input.timestamp ?? nowIso()
    };
    this.store.upsertMemory(memory);
    this.store.addMutation({
      id: createId("mut"),
      memoryId: memory.id,
      type: "create",
      actor: "api",
      timestamp: nowIso(),
      after: memory as never
    });
    this.recordUsage(memory.id, "applied", { action: "create" });
    return memory;
  }

  updateMemory(id: string, patch: Partial<Memory>, actor = "api"): Memory | undefined {
    const existing = this.store.getMemory(id);
    if (!existing) return undefined;
    const next = { ...existing, ...patch, id };
    this.store.upsertMemory(next);
    const mutationType =
      "pinned" in patch ? "pin" : "archived" in patch ? (patch.archived ? "archive" : "restore") : "update";
    this.store.addMutation({
      id: createId("mut"),
      memoryId: id,
      type: mutationType,
      actor,
      timestamp: nowIso(),
      before: existing as never,
      after: next as never
    });
    this.recordUsage(id, "applied", { action: mutationType });
    return next;
  }

  deleteMemory(id: string, actor = "api"): boolean {
    const existing = this.store.getMemory(id);
    if (!existing) return false;
    this.store.deleteMemory(id);
    this.store.addMutation({
      id: createId("mut"),
      memoryId: id,
      type: "delete",
      actor,
      timestamp: nowIso(),
      before: existing as never,
      reason: "Deleted by user"
    });
    return true;
  }

  mergeMemory(sourceId: string, targetId: string, actor = "api"): Memory | undefined {
    const source = this.store.getMemory(sourceId);
    const target = this.store.getMemory(targetId);
    if (!source || !target || sourceId === targetId) return undefined;
    const mergedTarget: Memory = {
      ...target,
      tags: Array.from(new Set([...target.tags, ...source.tags])).sort(),
      confidence: Math.max(target.confidence, source.confidence),
      importance: Math.max(target.importance, source.importance),
      metadata: {
        ...target.metadata,
        mergedDuplicateIds: Array.from(
          new Set([...(Array.isArray(target.metadata?.mergedDuplicateIds) ? target.metadata.mergedDuplicateIds : []), source.id])
        )
      }
    };
    const mergedSource: Memory = {
      ...source,
      archived: true,
      duplicateOf: target.id,
      mergedInto: target.id
    };
    this.store.upsertMemory(mergedTarget);
    this.store.upsertMemory(mergedSource);
    this.store.addMutation({
      id: createId("mut"),
      memoryId: sourceId,
      type: "merge",
      actor,
      timestamp: nowIso(),
      before: source as never,
      after: mergedSource as never,
      reason: `Merged into ${targetId}`
    });
    this.recordUsage(sourceId, "applied", { action: "merge", targetId });
    this.recordUsage(targetId, "applied", { action: "merge-target", sourceId });
    return mergedSource;
  }

  addFeedback(input: FeedbackInput, options: FeedbackApplyOptions = {}): FeedbackResult {
    const timestamp = nowIso();
    const feedback: MemoryFeedback = {
      id: createId("fb"),
      targetType: input.targetType,
      targetId: input.targetId,
      memoryId: input.memoryId ?? (input.targetType === "memory" ? input.targetId : undefined),
      sessionId: input.sessionId,
      traceId: input.traceId,
      type: input.type,
      actor: input.actor ?? "user",
      reason: input.reason,
      patch: input.patch ?? {},
      createdAt: timestamp,
      status: "pending",
      metadata: {}
    };
    this.store.upsertFeedback(feedback);
    return options.apply ? this.applyFeedback(feedback.id, options) ?? { feedback } : { feedback };
  }

  applyFeedback(id: string, options: FeedbackApplyOptions = {}): FeedbackResult | undefined {
    const feedback = this.store.getFeedback(id);
    if (!feedback) return undefined;
    let memory: Memory | undefined;

    if (feedback.type === "should-remember") {
      memory = this.applyShouldRemember(feedback);
    } else if (feedback.type === "should-not-remember") {
      const target = this.feedbackMemory(feedback);
      memory = target ? this.updateMemory(target.id, { archived: true }, feedback.actor) : undefined;
    } else if (feedback.type === "boost-importance") {
      const target = this.feedbackMemory(feedback);
      memory = target ? this.updateMemory(target.id, { importance: clamp01(target.importance + 0.15) }, feedback.actor) : undefined;
    } else if (feedback.type === "lower-importance") {
      const target = this.feedbackMemory(feedback);
      memory = target ? this.updateMemory(target.id, { importance: clamp01(target.importance - 0.15) }, feedback.actor) : undefined;
    } else if (feedback.type === "duplicate") {
      const targetId = stringPatch(feedback.patch, "targetId") ?? stringPatch(feedback.patch, "canonicalMemoryId");
      memory = targetId ? this.mergeMemory(feedback.targetId, targetId, feedback.actor) : undefined;
    } else if (feedback.type === "wrong-kind" || feedback.type === "wrong-summary" || feedback.type === "wrong-content" || feedback.type === "wrong-tags") {
      const target = this.feedbackMemory(feedback);
      if (target) memory = this.updateMemory(target.id, patchFromFeedback(feedback), feedback.actor);
    } else if (feedback.type === "wrong-merge") {
      memory = this.applyWrongMerge(feedback);
    }

    const applied: MemoryFeedback = {
      ...feedback,
      memoryId: feedback.memoryId ?? memory?.id,
      status: "applied",
      appliedAt: nowIso()
    };
    this.store.upsertFeedback(applied);
    const rule = options.createRule ? this.createRuleFromFeedback(applied, memory) : undefined;
    return { feedback: applied, memory, rule };
  }

  listFeedback(filters: { memoryId?: string; sessionId?: string; status?: string } = {}): MemoryFeedback[] {
    return this.store.listFeedback(filters);
  }

  createRule(input: Omit<MemoryRule, "id" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: string; updatedAt?: string }): MemoryRule {
    const timestamp = nowIso();
    const rule: MemoryRule = {
      ...input,
      id: input.id ?? createId("rule"),
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp
    };
    this.store.upsertRule(rule);
    return rule;
  }

  updateRule(id: string, patch: Partial<MemoryRule>): MemoryRule | undefined {
    const existing = this.store.getRule(id);
    if (!existing) return undefined;
    const next = { ...existing, ...patch, id, updatedAt: nowIso() };
    this.store.upsertRule(next);
    return next;
  }

  listRules(filters: { scope?: string; enabled?: boolean } = {}): MemoryRule[] {
    return this.store.listRules(filters);
  }

  analyzeMissingMemories(sessionId: string, options: { refresh?: boolean; limit?: number } = {}): {
    sessionId: string;
    suggestions: MissingMemorySuggestion[];
    analyzedAt: string;
  } {
    return analyzeMissingMemories(this.store, sessionId, options);
  }

  listMissingSuggestions(sessionId: string, status = "open"): MissingMemorySuggestion[] {
    return this.store.listMissingSuggestions({ sessionId, status });
  }

  acceptMissingSuggestion(id: string, actor = "api"): { suggestion: MissingMemorySuggestion; memory: Memory } | undefined {
    const suggestion = this.store.getMissingSuggestion(id);
    if (!suggestion) return undefined;
    const memory = this.createMemory({
      content: suggestion.content,
      summary: suggestion.summary,
      kind: suggestion.kind,
      source: {
        type: "manual",
        agent: actor,
        label: "accepted missing-memory suggestion",
        stepId: suggestion.stepIds[0],
        metadata: { suggestionId: suggestion.id }
      },
      tags: suggestion.tags,
      confidence: 0.74,
      importance: Math.max(0.55, suggestion.score),
      pinned: suggestion.kind === "preference" && suggestion.score > 0.66,
      archived: false,
      relatedSessionId: suggestion.sessionId,
      metadata: {
        suggestionId: suggestion.id,
        acceptedMissingMemory: true,
        evidence: suggestion.evidence as never,
        decisionReason: `Accepted missing-memory suggestion: ${suggestion.reason}`
      }
    });
    const resolved: MissingMemorySuggestion = { ...suggestion, status: "accepted", resolvedAt: nowIso(), metadata: { ...suggestion.metadata, memoryId: memory.id } };
    this.store.upsertMissingSuggestion(resolved);
    return { suggestion: resolved, memory };
  }

  dismissMissingSuggestion(id: string, reason?: string): MissingMemorySuggestion | undefined {
    const suggestion = this.store.getMissingSuggestion(id);
    if (!suggestion) return undefined;
    const dismissed: MissingMemorySuggestion = {
      ...suggestion,
      status: "dismissed",
      resolvedAt: nowIso(),
      metadata: { ...suggestion.metadata, dismissReason: reason ?? null }
    };
    this.store.upsertMissingSuggestion(dismissed);
    return dismissed;
  }

  confidenceReport(memoryId: string): MemoryConfidenceReport | undefined {
    const memory = this.store.getMemory(memoryId);
    return memory ? computeConfidenceReport(this.store, memory) : undefined;
  }

  recomputeConfidence(memoryId?: string): MemoryConfidenceReport[] {
    const memories = memoryId
      ? [this.store.getMemory(memoryId)].filter((memory): memory is Memory => Boolean(memory))
      : this.store.listMemories({ includeArchived: true, includeMerged: true, limit: 5000 });
    return memories.map((memory) => {
      const report = computeConfidenceReport(this.store, memory);
      this.store.upsertMemory({
        ...memory,
        confidence: report.confidence,
        metadata: {
          ...memory.metadata,
          originalConfidence: typeof memory.metadata.originalConfidence === "number" ? memory.metadata.originalConfidence : memory.confidence,
          confidenceUpdatedAt: report.updatedAt,
          confidenceComponents: report.components as never,
          confidenceLabel: report.label,
          usageCount: report.usageCount,
          conflictCount: report.conflictIds.length
        }
      });
      return report;
    });
  }

  detectConflicts(): MemoryConflict[] {
    return detectMemoryConflicts(this.store);
  }

  listConflicts(status = "open"): MemoryConflict[] {
    return this.store.listConflicts(status);
  }

  resolveConflict(
    id: string,
    input: { action: "dismiss" | "archive-memory" | "merge" | "mark-resolved"; memoryId?: string; targetId?: string; reason?: string }
  ): MemoryConflict | undefined {
    const conflict = this.store.getConflict(id);
    if (!conflict) return undefined;
    if (input.action === "archive-memory" && input.memoryId) {
      this.updateMemory(input.memoryId, { archived: true }, "conflict-resolution");
    }
    if (input.action === "merge" && input.memoryId && input.targetId) {
      this.mergeMemory(input.memoryId, input.targetId, "conflict-resolution");
    }
    const next: MemoryConflict = {
      ...conflict,
      status: input.action === "dismiss" ? "dismissed" : "resolved",
      resolvedAt: nowIso(),
      metadata: { ...conflict.metadata, resolutionAction: input.action, resolutionReason: input.reason ?? null }
    };
    this.store.upsertConflict(next);
    return next;
  }

  listSessions(limit?: number): Session[] {
    return this.store.listSessions(limit);
  }

  getSession(id: string): (Session & { steps: SessionStep[]; memories: Memory[] }) | undefined {
    const session = this.store.getSession(id);
    if (!session) return undefined;
    return {
      ...session,
      steps: this.store.listSessionSteps(id),
      memories: this.store.listMemories({ sessionId: id, includeArchived: true, includeMerged: true })
    };
  }

  listTraces(type?: "ingestion" | "retrieval", limit?: number): ReplayTrace[] {
    return this.store.listTraces(type, limit);
  }

  getTrace(id: string): ReplayTrace | undefined {
    return this.store.getTrace(id);
  }

  stats(): DashboardStats {
    return this.store.stats();
  }

  mutations(memoryId?: string): MemoryMutation[] {
    return this.store.listMutations(memoryId);
  }

  addUsage(input: Omit<Parameters<MemoryStore["addUsage"]>[0], "id" | "timestamp"> & { id?: string; timestamp?: string }): void {
    this.store.addUsage({
      ...input,
      id: input.id ?? createId("use"),
      timestamp: input.timestamp ?? nowIso()
    });
  }

  private applyShouldRemember(feedback: MemoryFeedback): Memory | undefined {
    const content =
      stringPatch(feedback.patch, "content") ??
      this.decisionContent(feedback.targetId) ??
      (feedback.targetType === "session-step" ? this.store.getSessionStep(feedback.targetId)?.content : undefined);
    if (!content) return undefined;
    const stepId =
      stringPatch(feedback.patch, "stepId") ??
      (feedback.targetType === "session-step" ? feedback.targetId : undefined) ??
      this.decisionStepId(feedback.targetId);
    const step = stepId ? this.store.getSessionStep(stepId) : undefined;
    const kind = memoryKindFromValue(stringPatch(feedback.patch, "kind") ?? this.decisionKind(feedback.targetId)) ?? "summary";
    const tags = unique([kind, ...stringArrayPatch(feedback.patch, "tags")]);
    return this.createMemory({
      content,
      summary: stringPatch(feedback.patch, "summary") ?? summarize(content),
      kind,
      source: {
        type: "manual",
        agent: feedback.actor,
        label: "feedback correction",
        stepId,
        metadata: { feedbackId: feedback.id, targetType: feedback.targetType, targetId: feedback.targetId }
      },
      tags,
      confidence: 0.78,
      importance: 0.72,
      pinned: kind === "preference",
      archived: false,
      relatedSessionId: feedback.sessionId ?? step?.sessionId,
      metadata: {
        feedbackId: feedback.id,
        correctedFromTargetType: feedback.targetType,
        correctedFromTargetId: feedback.targetId,
        traceId: feedback.traceId ?? null,
        decisionReason: feedback.reason ?? "Created manually from Memory Fix Mode feedback."
      }
    });
  }

  private applyWrongMerge(feedback: MemoryFeedback): Memory | undefined {
    const source = this.feedbackMemory(feedback);
    if (!source) return undefined;
    const targetId = source.mergedInto ?? source.duplicateOf ?? stringPatch(feedback.patch, "targetId");
    const target = targetId ? this.store.getMemory(targetId) : undefined;
    if (target) {
      this.store.upsertMemory({
        ...target,
        metadata: {
          ...target.metadata,
          mergedDuplicateIds: (Array.isArray(target.metadata?.mergedDuplicateIds) ? target.metadata.mergedDuplicateIds : []).filter(
            (item) => item !== source.id
          ) as never
        }
      });
    }
    return this.updateMemory(source.id, { archived: false, duplicateOf: undefined, mergedInto: undefined }, feedback.actor);
  }

  private createRuleFromFeedback(feedback: MemoryFeedback, memory?: Memory): MemoryRule {
    const basisContent = memory?.content ?? this.decisionContent(feedback.targetId) ?? stringPatch(feedback.patch, "content") ?? feedback.reason ?? "";
    const terms = unique([...stringArrayPatch(feedback.patch, "textContains"), ...tokenize(basisContent).slice(0, 4)]).slice(0, 6);
    const targetId = stringPatch(feedback.patch, "targetId") ?? stringPatch(feedback.patch, "canonicalMemoryId");
    const rule = this.createRule({
      scope: feedback.type === "duplicate" || feedback.type === "wrong-merge" ? "dedupe" : "ingestion",
      enabled: true,
      condition: {
        ...(terms.length ? { textContainsAny: terms } : {}),
        ...(memory?.kind && !["should-not-remember", "should-remember"].includes(feedback.type) ? { kind: memory.kind } : {})
      },
      effect: ruleEffect(feedback, memory, targetId),
      createdFromFeedbackId: feedback.id,
      metadata: {
        feedbackType: feedback.type,
        targetType: feedback.targetType,
        targetId: feedback.targetId,
        memoryId: memory?.id ?? feedback.memoryId ?? null
      }
    });
    return rule;
  }

  private feedbackMemory(feedback: MemoryFeedback): Memory | undefined {
    return this.store.getMemory(feedback.memoryId ?? feedback.targetId);
  }

  private decisionContent(decisionId: string): string | undefined {
    const decision = this.store.listDecisions().find((item) => item.id === decisionId);
    const content = decision?.metadata?.content;
    return typeof content === "string" ? content : undefined;
  }

  private decisionStepId(decisionId: string): string | undefined {
    const decision = this.store.listDecisions().find((item) => item.id === decisionId);
    const stepId = decision?.metadata?.sourceStepId;
    return typeof stepId === "string" ? stepId : undefined;
  }

  private decisionKind(decisionId: string): string | undefined {
    const decision = this.store.listDecisions().find((item) => item.id === decisionId);
    const kind = decision?.metadata?.kind;
    return typeof kind === "string" ? kind : undefined;
  }

  private recordUsage(memoryId: string, event: "selected" | "applied", metadata: Metadata = {}): void {
    this.addUsage({ memoryId, event, metadata });
  }
}

function patchFromFeedback(feedback: MemoryFeedback): Partial<Memory> {
  return {
    ...(memoryKindFromValue(stringPatch(feedback.patch, "kind")) ? { kind: memoryKindFromValue(stringPatch(feedback.patch, "kind")) } : {}),
    ...(stringPatch(feedback.patch, "summary") ? { summary: stringPatch(feedback.patch, "summary") } : {}),
    ...(stringPatch(feedback.patch, "content") ? { content: stringPatch(feedback.patch, "content") } : {}),
    ...(Array.isArray(feedback.patch.tags) ? { tags: stringArrayPatch(feedback.patch, "tags") } : {})
  };
}

function ruleEffect(feedback: MemoryFeedback, memory: Memory | undefined, targetId: string | undefined): Metadata {
  switch (feedback.type) {
    case "should-remember":
      return { forceStore: true, importanceBoost: 0.25, addTags: memory?.tags ?? [] };
    case "should-not-remember":
      return { forceIgnore: true };
    case "boost-importance":
      return { importanceBoost: 0.15 };
    case "lower-importance":
      return { importanceLower: 0.15 };
    case "duplicate":
      return { preferCanonicalMemoryId: targetId ?? memory?.mergedInto ?? memory?.duplicateOf ?? null };
    case "wrong-kind":
      return { forceKind: memory?.kind ?? stringPatch(feedback.patch, "kind") ?? null };
    case "wrong-tags":
      return { addTags: memory?.tags ?? stringArrayPatch(feedback.patch, "tags") };
    case "wrong-merge":
      return { neverMergeMemoryIds: [targetId, memory?.id].filter((item): item is string => Boolean(item)) };
    default:
      return {};
  }
}

function stringPatch(patch: Metadata, key: string): string | undefined {
  const value = patch[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayPatch(patch: Metadata, key: string): string[] {
  const value = patch[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function memoryKindFromValue(value: string | undefined): Memory["kind"] | undefined {
  return value && ["fact", "preference", "event", "task-context", "codebase-context", "summary"].includes(value)
    ? (value as Memory["kind"])
    : undefined;
}
