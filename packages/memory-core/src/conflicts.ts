import { Memory, MemoryConflict } from "@agent-memory/shared";
import { MemoryStore } from "./store.js";
import { createId, jaccard, normalizeText, nowIso, summarize, tokenize, unique } from "./util.js";

type Polarity = "positive" | "negative" | "instead";

export function detectMemoryConflicts(store: MemoryStore): MemoryConflict[] {
  const active = store.listMemories({ includeArchived: false, includeMerged: false, limit: 5000 }).filter((memory) => memory.kind === "preference");
  const existing = store.listConflicts("open");
  const created: MemoryConflict[] = [];
  for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < active.length; rightIndex += 1) {
      const left = active[leftIndex];
      const right = active[rightIndex];
      if (existing.some((conflict) => sameMemorySet(conflict.memoryIds, [left.id, right.id]))) continue;
      const conflict = conflictFor(left, right);
      if (!conflict) continue;
      store.upsertConflict(conflict);
      created.push(conflict);
    }
  }
  return created;
}

function conflictFor(left: Memory, right: Memory): MemoryConflict | undefined {
  const leftPolarity = polarity(left.content);
  const rightPolarity = polarity(right.content);
  if (!leftPolarity || !rightPolarity || leftPolarity === rightPolarity) return undefined;
  const subjectScore = subjectOverlap(left, right);
  const tagOverlap = jaccard(left.tags, right.tags);
  if (subjectScore < 0.26 && tagOverlap < 0.25) return undefined;
  return {
    id: createId("conf"),
    memoryIds: [left.id, right.id],
    kind: "preference-contradiction",
    subject: summarize(commonSubject(left, right), 100),
    summary: `Potential preference conflict between "${left.summary}" and "${right.summary}".`,
    severity: Math.min(1, 0.55 + Math.max(subjectScore, tagOverlap) * 0.35),
    status: "open",
    detectedAt: nowIso(),
    metadata: {
      leftPolarity,
      rightPolarity,
      subjectScore,
      tagOverlap
    }
  };
}

function polarity(content: string): Polarity | undefined {
  if (/\b(never|avoid|do not|don't|no longer)\b/i.test(content)) return "negative";
  if (/\b(use .+ instead|prefer .+ over)\b/i.test(content)) return "instead";
  if (/\b(always|prefer|use|we use|should)\b/i.test(content)) return "positive";
  return undefined;
}

function subjectOverlap(left: Memory, right: Memory): number {
  return jaccard(subjectTokens(left.content), subjectTokens(right.content));
}

function subjectTokens(content: string): string[] {
  return tokenize(
    normalizeText(content).replace(/\b(always|never|avoid|prefer|preference|use|uses|instead|should|do|not|dont|we|over)\b/g, " ")
  );
}

function commonSubject(left: Memory, right: Memory): string {
  const tokens = unique(subjectTokens(left.content).filter((token) => subjectTokens(right.content).includes(token)));
  return tokens.length ? tokens.join(" ") : `${left.kind} preference`;
}

function sameMemorySet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}
