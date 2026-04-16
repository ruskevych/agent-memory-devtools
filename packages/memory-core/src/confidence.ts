import { Memory, MemoryConfidenceReport } from "@agent-memory/shared";
import { clamp01, nowIso } from "./util.js";
import type { MemoryStore as CoreMemoryStore } from "./store.js";

const weights = {
  base: 0.45,
  sourceReliability: 0.2,
  usage: 0.15,
  recency: 0.1,
  feedback: 0.1
} as const;

export function computeConfidenceReport(store: CoreMemoryStore, memory: Memory): MemoryConfidenceReport {
  const usage = store.listUsage(memory.id);
  const feedback = store.listFeedback({ memoryId: memory.id });
  const conflicts = store.listConflicts("open").filter((conflict) => conflict.memoryIds.includes(memory.id));
  const ageDays = Math.max(0, (Date.now() - Date.parse(memory.timestamp)) / 86_400_000);
  const baseScore = typeof memory.metadata.originalConfidence === "number" ? memory.metadata.originalConfidence : memory.confidence;
  const sourceScore = sourceReliability(memory);
  const usageScore = clamp01(usage.filter((item) => item.event === "returned").length / 8 + usage.filter((item) => item.event === "applied").length * 0.16);
  const recencyScore = clamp01(1 / (1 + ageDays / 120));
  const feedbackScore = feedbackScoreFor(memory, feedback);
  const conflictPenalty = clamp01(conflicts.reduce((sum, conflict) => sum + conflict.severity, 0) * 0.3);
  const components = {
    base: component(baseScore, weights.base),
    sourceReliability: component(sourceScore, weights.sourceReliability),
    usage: component(usageScore, weights.usage),
    recency: component(recencyScore, weights.recency),
    feedback: component(feedbackScore, weights.feedback)
  };
  const confidence = clamp01(Object.values(components).reduce((sum, item) => sum + item.contribution, 0) - conflictPenalty);
  const lastUsedAt = usage[0]?.timestamp;
  const label = conflicts.length ? "conflicted" : confidence < 0.45 ? "low" : ageDays > 120 && usage.length === 0 ? "stale" : confidence >= 0.72 ? "high" : "medium";
  const reasons = [
    `Base confidence contributes ${components.base.contribution.toFixed(2)}.`,
    `Source reliability is ${sourceScore.toFixed(2)} for ${memory.source.type} memories.`,
    usage.length ? `${usage.length} usage events reinforce this memory.` : "No usage reinforcement recorded yet.",
    conflicts.length ? `${conflicts.length} open conflict${conflicts.length === 1 ? "" : "s"} reduce confidence.` : "No open conflicts detected."
  ];

  return {
    memoryId: memory.id,
    confidence,
    label,
    components,
    reasons,
    usageCount: usage.length,
    lastUsedAt,
    conflictIds: conflicts.map((conflict) => conflict.id),
    updatedAt: nowIso(),
    metadata: { conflictPenalty }
  };
}

function component(score: number, weight: number): { score: number; weight: number; contribution: number } {
  return { score: clamp01(score), weight, contribution: clamp01(score) * weight };
}

function sourceReliability(memory: Memory): number {
  if (memory.source.type === "manual") return 0.92;
  if (memory.metadata.feedbackId || memory.metadata.suggestionId) return 0.9;
  if (memory.source.type === "session") return 0.78;
  if (memory.source.type === "cli" || memory.source.type === "api") return 0.72;
  if (memory.source.type === "sample") return 0.52;
  return 0.62;
}

function feedbackScoreFor(memory: Memory, feedback: ReturnType<CoreMemoryStore["listFeedback"]>): number {
  const applied = feedback.filter((item) => item.status === "applied");
  const positive = applied.filter((item) => ["should-remember", "boost-importance", "duplicate"].includes(item.type)).length;
  const negative = applied.filter((item) => ["should-not-remember", "lower-importance", "wrong-content", "wrong-summary"].includes(item.type)).length;
  return clamp01(0.5 + positive * 0.18 - negative * 0.22 + (memory.pinned ? 0.1 : 0));
}
