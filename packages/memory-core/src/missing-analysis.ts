import { Memory, MemoryKind, MissingMemorySuggestion, SessionStep } from "@agent-memory/shared";
import { extractTags } from "./ingestion.js";
import { MemoryStore } from "./store.js";
import { clamp01, createId, jaccard, normalizeText, summarize, tokenize, unique, nowIso } from "./util.js";

export interface MissingAnalysisOptions {
  refresh?: boolean;
  limit?: number;
}

interface SuggestionCandidate {
  content: string;
  stepIds: string[];
  kind: MemoryKind;
  tags: string[];
  reason: string;
  score: number;
  evidence: MissingMemorySuggestion["evidence"];
  matchedMemoryIds: string[];
}

export function analyzeMissingMemories(
  store: MemoryStore,
  sessionId: string,
  options: MissingAnalysisOptions = {}
): { sessionId: string; suggestions: MissingMemorySuggestion[]; analyzedAt: string } {
  const analyzedAt = nowIso();
  const existingOpen = store.listMissingSuggestions({ sessionId, status: "open" });
  if (existingOpen.length && !options.refresh) {
    return { sessionId, suggestions: existingOpen.slice(0, options.limit ?? 10), analyzedAt };
  }

  const steps = store.listSessionSteps(sessionId);
  const memories = store.listMemories({ includeArchived: false, includeMerged: false, limit: 5000 });
  const candidates = [
    ...durablePatternCandidates(steps, memories),
    ...repeatedConceptCandidates(steps, memories),
    ...ignoredDecisionCandidates(store, sessionId, memories)
  ];

  const deduped = dedupeCandidates(candidates)
    .filter((candidate) => candidate.score >= 0.48)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 10)
    .map((candidate) => toSuggestion(sessionId, candidate, analyzedAt));

  for (const suggestion of deduped) {
    store.upsertMissingSuggestion(suggestion);
  }
  return { sessionId, suggestions: deduped, analyzedAt };
}

function durablePatternCandidates(steps: SessionStep[], memories: Memory[]): SuggestionCandidate[] {
  const candidates: SuggestionCandidate[] = [];
  for (const step of steps) {
    const content = step.content.trim();
    if (content.length < 24) continue;
    const kind = classifyDurableKind(content);
    if (!kind) continue;
    const match = coverage(content, memories);
    if (match.covered) continue;
    const tags = unique([kind, ...extractTags(content)]).slice(0, 12);
    const roleBoost = step.role === "user" || step.role === "system" ? 0.12 : 0;
    const score = clamp01(0.5 + roleBoost + Math.min(0.16, tags.length * 0.025) - match.penalty);
    candidates.push({
      content,
      stepIds: [step.id],
      kind,
      tags,
      reason: durableReason(kind),
      score,
      evidence: [{ stepId: step.id, snippet: summarize(content, 160), reason: `${step.role} step contains a durable ${kind} signal.` }],
      matchedMemoryIds: match.matches
    });
  }
  return candidates;
}

function repeatedConceptCandidates(steps: SessionStep[], memories: Memory[]): SuggestionCandidate[] {
  const byConcept = new Map<string, SessionStep[]>();
  for (const step of steps) {
    for (const concept of extractConcepts(step.content)) {
      byConcept.set(concept, [...(byConcept.get(concept) ?? []), step]);
    }
  }
  const candidates: SuggestionCandidate[] = [];
  for (const [concept, matchedSteps] of byConcept) {
    const uniqueSteps = unique(matchedSteps.map((step) => step.id));
    if (uniqueSteps.length < 2) continue;
    const content = `${concept} came up repeatedly in this session: ${matchedSteps
      .slice(0, 3)
      .map((step) => summarize(step.content, 90))
      .join(" ")}`;
    const match = coverage(content, memories);
    if (match.covered) continue;
    candidates.push({
      content,
      stepIds: uniqueSteps,
      kind: "summary",
      tags: unique(["summary", ...extractTags(content)]),
      reason: "Repeated concept appeared across multiple session steps without a strong existing memory.",
      score: clamp01(0.46 + Math.min(0.24, uniqueSteps.length * 0.08) - match.penalty),
      evidence: matchedSteps.slice(0, 3).map((step) => ({
        stepId: step.id,
        snippet: summarize(step.content, 150),
        reason: `Repeated concept: ${concept}`
      })),
      matchedMemoryIds: match.matches
    });
  }
  return candidates;
}

function ignoredDecisionCandidates(store: MemoryStore, sessionId: string, memories: Memory[]): SuggestionCandidate[] {
  const traceIds = new Set(store.listTraces("ingestion", 500).filter((trace) => trace.input.sessionId === sessionId).map((trace) => trace.id));
  return store
    .listDecisions()
    .filter((decision) => traceIds.has(decision.traceId) && decision.action === "ignore" && decision.confidence >= 0.45)
    .flatMap((decision) => {
      const content = typeof decision.metadata.content === "string" ? decision.metadata.content : "";
      if (!content) return [];
      const match = coverage(content, memories);
      if (match.covered) return [];
      const kind = typeof decision.metadata.kind === "string" && isMemoryKind(decision.metadata.kind) ? decision.metadata.kind : "summary";
      return [
        {
          content,
          stepIds: typeof decision.metadata.sourceStepId === "string" ? [decision.metadata.sourceStepId] : [],
          kind,
          tags: unique([kind, ...extractTags(content)]),
          reason: "Ignored ingestion decision looked recoverable during missing-memory analysis.",
          score: clamp01(0.5 + decision.confidence * 0.25 + decision.importance * 0.15 - match.penalty),
          evidence: [{ stepId: String(decision.metadata.sourceStepId ?? decision.id), snippet: summarize(content, 160), reason: decision.reason }],
          matchedMemoryIds: match.matches
        }
      ];
    });
}

function coverage(content: string, memories: Memory[]): { covered: boolean; matches: string[]; penalty: number } {
  const scored = memories
    .map((memory) => ({
      id: memory.id,
      score: Math.max(jaccard(tokenize(content), tokenize(memory.content)), jaccard(tokenize(content), tokenize(memory.summary)))
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  return {
    covered: best >= 0.72,
    matches: scored.filter((item) => item.score >= 0.34).slice(0, 3).map((item) => item.id),
    penalty: best >= 0.34 ? 0.12 : 0
  };
}

function dedupeCandidates(candidates: SuggestionCandidate[]): SuggestionCandidate[] {
  const kept: SuggestionCandidate[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (kept.some((item) => jaccard(tokenize(item.content), tokenize(candidate.content)) > 0.64)) continue;
    kept.push(candidate);
  }
  return kept;
}

function toSuggestion(sessionId: string, candidate: SuggestionCandidate, createdAt: string): MissingMemorySuggestion {
  return {
    id: createId("miss"),
    sessionId,
    stepIds: candidate.stepIds,
    content: candidate.content,
    summary: summarize(candidate.content),
    kind: candidate.kind,
    tags: candidate.tags,
    reason: candidate.reason,
    evidence: candidate.evidence,
    score: candidate.score,
    matchedMemoryIds: candidate.matchedMemoryIds,
    status: "open",
    createdAt,
    metadata: {}
  };
}

function classifyDurableKind(content: string): MemoryKind | undefined {
  if (/\b(prefer|always|never|avoid|use .* instead|we use|style)\b/i.test(content)) return "preference";
  if (/\b(todo|follow up|blocked|remaining|still need|not done|open task)\b/i.test(content)) return "task-context";
  if (/\b(apps\/|packages\/|src\/|api|cli|vite|react|fastify|sqlite|schema|database|repo|tests?|build)\b/i.test(content)) return "codebase-context";
  if (/\b[A-Z][A-Za-z0-9_-]+\s+(?:is|uses|lives in|should)\b/.test(content)) return "fact";
  return undefined;
}

function durableReason(kind: MemoryKind): string {
  switch (kind) {
    case "preference":
      return "Detected a durable preference or workflow rule that may have been missed.";
    case "task-context":
      return "Detected unresolved task context that could help future continuation.";
    case "codebase-context":
      return "Detected codebase context with paths, tools, schema, or implementation terms.";
    default:
      return "Detected a durable factual statement that may be useful later.";
  }
}

function extractConcepts(content: string): string[] {
  const normalized = normalizeText(content);
  const concepts = new Set<string>();
  for (const match of content.matchAll(/\b(?:apps|packages|src|docs|tests?)\/[A-Za-z0-9_./-]+/g)) {
    concepts.add(match[0]);
  }
  for (const match of content.matchAll(/\b[A-Z][A-Za-z0-9_-]{3,}\b/g)) {
    concepts.add(match[0].toLowerCase());
  }
  for (const token of tokenize(normalized)) {
    if (/^(react|vite|typescript|fastify|sqlite|zod|memory|retrieval|dedupe|session|schema|api|cli)$/.test(token)) {
      concepts.add(token);
    }
  }
  return [...concepts].slice(0, 8);
}

function isMemoryKind(value: string): value is MemoryKind {
  return ["fact", "preference", "event", "task-context", "codebase-context", "summary"].includes(value);
}
