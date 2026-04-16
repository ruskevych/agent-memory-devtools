import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, "")
    .replace(/[^a-z0-9_./:@#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(input: string): string[] {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "when",
    "then",
    "than",
    "are",
    "was",
    "were",
    "you",
    "your",
    "our",
    "have",
    "has",
    "had",
    "will",
    "can",
    "not",
    "but",
    "all",
    "any",
    "use",
    "used"
  ]);
  return normalizeText(input)
    .split(" ")
    .filter((token) => token.length > 1 && !stop.has(token));
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function summarize(content: string, maxLength = 140): string {
  const clean = content.replace(/\s+/g, " ").trim();
  const firstSentence = clean.match(/^(.{20,}?[.!?])\s/)?.[1] ?? clean;
  return firstSentence.length > maxLength ? `${firstSentence.slice(0, maxLength - 1).trim()}...` : firstSentence;
}

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const left = new Set(a);
  const right = new Set(b);
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    aMag += a[index] * a[index];
    bMag += b[index] * b[index];
  }
  if (aMag === 0 || bMag === 0) return 0;
  return (dot / (Math.sqrt(aMag) * Math.sqrt(bMag)) + 1) / 2;
}

export function hashNumber(input: string): number {
  const hash = createHash("sha256").update(input).digest();
  return hash.readUInt32BE(0) / 0xffffffff;
}

export function defaultDataDir(): string {
  return process.env.AGENT_MEMORY_HOME ?? join(homedir(), ".agent-memory");
}

export function defaultDbPath(): string {
  return process.env.AGENT_MEMORY_DB ?? join(defaultDataDir(), "memory.sqlite");
}
