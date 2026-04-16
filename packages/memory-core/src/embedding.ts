import { MemoryEmbedding } from "@agent-memory/shared";
import { createId, hashNumber, nowIso, tokenize } from "./util.js";

export interface EmbeddingProvider {
  provider: string;
  model: string;
  embed(text: string): number[];
}

export class HashEmbeddingProvider implements EmbeddingProvider {
  provider = "local-hash";
  model = "hash-bow-32";

  embed(text: string): number[] {
    const vector = new Array(32).fill(0);
    for (const token of tokenize(text)) {
      const bucket = Math.floor(hashNumber(token) * vector.length) % vector.length;
      vector[bucket] += 1;
    }
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
  }
}

export function createEmbedding(memoryId: string, content: string, provider: EmbeddingProvider): MemoryEmbedding {
  return {
    id: createId("emb"),
    memoryId,
    provider: provider.provider,
    model: provider.model,
    vector: provider.embed(content),
    updatedAt: nowIso()
  };
}
