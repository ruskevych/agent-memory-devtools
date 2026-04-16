import { ReplayTrace, RetrievalResult, SearchRequest, SearchResponse } from "@agent-memory/shared";
import { createEmbedding, EmbeddingProvider, HashEmbeddingProvider } from "./embedding.js";
import { MemoryStore } from "./store.js";
import { clamp01, cosine, createId, nowIso, tokenize } from "./util.js";

export class RetrievalEngine {
  constructor(
    private readonly store: MemoryStore,
    private readonly embeddingProvider: EmbeddingProvider = new HashEmbeddingProvider()
  ) {}

  search(request: SearchRequest): SearchResponse {
    const timestamp = nowIso();
    const queryTokens = tokenize(request.query);
    const queryVector = this.embeddingProvider.embed(request.query);
    const candidates = this.store.listMemories({
      kind: request.kind,
      sourceType: request.sourceType,
      sessionId: request.sessionId,
      includeArchived: request.includeArchived,
      includeMerged: false,
      limit: 5000
    });

    const filtered = request.tags?.length
      ? candidates.filter((memory) => request.tags?.every((tag) => memory.tags.includes(tag)))
      : candidates;

    const results: RetrievalResult[] = filtered
      .map((memory) => {
        const memoryTokens = tokenize(`${memory.content} ${memory.summary} ${memory.tags.join(" ")}`);
        const matchedTerms = queryTokens.filter((token) => memoryTokens.includes(token));
        const keywordScore = queryTokens.length === 0 ? 0 : matchedTerms.length / queryTokens.length;
        const embedding = this.store.getEmbedding(memory.id) ?? createEmbedding(memory.id, memory.content, this.embeddingProvider);
        if (!this.store.getEmbedding(memory.id)) this.store.upsertEmbedding(embedding);
        const semanticScore = cosine(queryVector, embedding.vector);
        const ageDays = Math.max(0, (Date.now() - Date.parse(memory.timestamp)) / 86_400_000);
        const recencyScore = clamp01(1 / (1 + ageDays / 30));
        const pinnedBoost = memory.pinned ? 0.16 : 0;
        const importanceBoost = memory.importance * 0.2;
        const sourceBoost = request.sessionId && memory.relatedSessionId === request.sessionId ? 0.12 : 0;
        const score = clamp01(
          keywordScore * 0.42 +
            semanticScore * 0.24 +
            recencyScore * 0.12 +
            memory.importance * 0.18 +
            pinnedBoost +
            sourceBoost
        );
        const strongest = [
          keywordScore > 0 ? "keyword match" : undefined,
          semanticScore > 0.62 ? "semantic similarity" : undefined,
          memory.pinned ? "pinned memory" : undefined,
          memory.importance > 0.7 ? "high importance" : undefined,
          sourceBoost > 0 ? "same session" : undefined
        ].filter(Boolean);

        return {
          memory,
          score,
          explanation: {
            keywordScore,
            semanticScore,
            recencyScore,
            pinnedBoost,
            importanceBoost,
            sourceBoost,
            matchedTerms,
            reason: strongest.length ? `Selected for ${strongest.join(", ")}.` : "Selected as the best available local match.",
            components: {
              keyword: keywordScore * 0.42,
              semantic: semanticScore * 0.24,
              recency: recencyScore * 0.12,
              importance: memory.importance * 0.18,
              pinned: pinnedBoost,
              source: sourceBoost
            }
          }
        };
      })
      .filter((result) => result.score > 0.08 || result.explanation.keywordScore > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, request.limit);

    const trace: ReplayTrace = {
      id: createId("trace"),
      type: "retrieval",
      title: `Search: ${request.query}`,
      createdAt: timestamp,
      input: {
        query: request.query,
        limit: request.limit,
        kind: request.kind ?? null,
        tags: request.tags ?? [],
        sourceType: request.sourceType ?? null,
        sessionId: request.sessionId ?? null
      },
      stages: [
        {
          name: "candidate-filtering",
          summary: `Loaded ${candidates.length} active memories and filtered to ${filtered.length} candidates.`,
          metadata: { candidates: candidates.length, filtered: filtered.length }
        },
        {
          name: "ranking",
          summary: `Ranked ${results.length} memories using keyword, local semantic, recency, pinned, importance, and session boosts.`,
          items: results.map((result) => ({
            memoryId: result.memory.id,
            score: result.score,
            reason: result.explanation.reason,
            matchedTerms: result.explanation.matchedTerms,
            components: result.explanation.components
          }))
        }
      ],
      decisions: [],
      results,
      metadata: { resultCount: results.length }
    };
    this.store.addTrace(trace);
    for (const [index, result] of results.entries()) {
      this.store.addUsage({
        id: createId("use"),
        memoryId: result.memory.id,
        traceId: trace.id,
        query: request.query,
        rank: index + 1,
        score: result.score,
        event: "returned",
        timestamp,
        metadata: { explanation: result.explanation.reason }
      });
    }

    return { query: request.query, results, trace };
  }
}
