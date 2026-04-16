import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import {
  DashboardStats,
  Memory,
  MemoryConfidenceReport,
  MemoryConflict,
  MemoryDecision,
  MemoryEmbedding,
  MemoryEvent,
  MemoryFact,
  MemoryFeedback,
  MemoryMutation,
  MemoryRule,
  MemoryUsage,
  MissingMemorySuggestion,
  ReplayTrace,
  Session,
  SessionStep
} from "@agent-memory/shared";
import { defaultDbPath, nowIso } from "./util.js";

type Entity =
  | Memory
  | MemoryFact
  | MemoryEvent
  | MemoryEmbedding
  | Session
  | SessionStep
  | ReplayTrace
  | MemoryDecision
  | MemoryMutation
  | MemoryFeedback
  | MemoryRule
  | MissingMemorySuggestion
  | MemoryUsage
  | MemoryConflict
  | MemoryConfidenceReport;

export interface MemoryFilters {
  query?: string;
  kind?: string;
  tag?: string;
  sourceType?: string;
  includeArchived?: boolean;
  includeMerged?: boolean;
  sessionId?: string;
  limit?: number;
}

export interface MemoryStore {
  close(): void;
  upsertMemory(memory: Memory): void;
  getMemory(id: string): Memory | undefined;
  listMemories(filters?: MemoryFilters): Memory[];
  deleteMemory(id: string): void;
  upsertSession(session: Session): void;
  getSession(id: string): Session | undefined;
  listSessions(limit?: number): Session[];
  upsertSessionStep(step: SessionStep): void;
  getSessionStep(id: string): SessionStep | undefined;
  listSessionSteps(sessionId: string): SessionStep[];
  addFact(fact: MemoryFact): void;
  listFacts(memoryId?: string): MemoryFact[];
  addEvent(event: MemoryEvent): void;
  listEvents(sessionId?: string): MemoryEvent[];
  upsertEmbedding(embedding: MemoryEmbedding): void;
  getEmbedding(memoryId: string): MemoryEmbedding | undefined;
  addTrace(trace: ReplayTrace): void;
  getTrace(id: string): ReplayTrace | undefined;
  listTraces(type?: "ingestion" | "retrieval", limit?: number): ReplayTrace[];
  addDecision(decision: MemoryDecision): void;
  listDecisions(traceId?: string): MemoryDecision[];
  addMutation(mutation: MemoryMutation): void;
  listMutations(memoryId?: string): MemoryMutation[];
  upsertFeedback(feedback: MemoryFeedback): void;
  getFeedback(id: string): MemoryFeedback | undefined;
  listFeedback(filters?: { memoryId?: string; sessionId?: string; status?: string }): MemoryFeedback[];
  upsertRule(rule: MemoryRule): void;
  getRule(id: string): MemoryRule | undefined;
  listRules(filters?: { scope?: string; enabled?: boolean }): MemoryRule[];
  upsertMissingSuggestion(suggestion: MissingMemorySuggestion): void;
  getMissingSuggestion(id: string): MissingMemorySuggestion | undefined;
  listMissingSuggestions(filters?: { sessionId?: string; status?: string }): MissingMemorySuggestion[];
  addUsage(usage: MemoryUsage): void;
  listUsage(memoryId?: string): MemoryUsage[];
  upsertConflict(conflict: MemoryConflict): void;
  getConflict(id: string): MemoryConflict | undefined;
  listConflicts(status?: string): MemoryConflict[];
  stats(): DashboardStats;
}

const tableNames = [
  "memories",
  "facts",
  "events",
  "embeddings",
  "sessions",
  "session_steps",
  "traces",
  "decisions",
  "mutations",
  "feedback",
  "rules",
  "missing_suggestions",
  "usage",
  "conflicts"
] as const;

export class SqliteMemoryStore implements MemoryStore {
  private db: Database.Database;

  constructor(dbPath = defaultDbPath()) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const firstRun = !existsSync(dbPath);
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
    if (firstRun) {
      this.db.pragma("user_version = 1");
    }
  }

  close(): void {
    this.db.close();
  }

  upsertMemory(memory: Memory): void {
    this.upsert("memories", memory.id, memory, memory.timestamp);
  }

  getMemory(id: string): Memory | undefined {
    return this.get<Memory>("memories", id);
  }

  listMemories(filters: MemoryFilters = {}): Memory[] {
    const memories = this.list<Memory>("memories").filter((memory) => {
      if (!filters.includeArchived && memory.archived) return false;
      if (!filters.includeMerged && memory.mergedInto) return false;
      if (filters.kind && memory.kind !== filters.kind) return false;
      if (filters.tag && !memory.tags.includes(filters.tag)) return false;
      if (filters.sourceType && memory.source.type !== filters.sourceType) return false;
      if (filters.sessionId && memory.relatedSessionId !== filters.sessionId) return false;
      if (filters.query) {
        const haystack = `${memory.content} ${memory.summary} ${memory.tags.join(" ")}`.toLowerCase();
        if (!haystack.includes(filters.query.toLowerCase())) return false;
      }
      return true;
    });
    return memories
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.timestamp.localeCompare(a.timestamp))
      .slice(0, filters.limit ?? 500);
  }

  deleteMemory(id: string): void {
    this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  }

  upsertSession(session: Session): void {
    this.upsert("sessions", session.id, session, session.startedAt);
  }

  getSession(id: string): Session | undefined {
    return this.get<Session>("sessions", id);
  }

  listSessions(limit = 100): Session[] {
    return this.list<Session>("sessions")
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  upsertSessionStep(step: SessionStep): void {
    this.upsert("session_steps", step.id, step, step.timestamp);
  }

  getSessionStep(id: string): SessionStep | undefined {
    return this.get<SessionStep>("session_steps", id);
  }

  listSessionSteps(sessionId: string): SessionStep[] {
    return this.list<SessionStep>("session_steps")
      .filter((step) => step.sessionId === sessionId)
      .sort((a, b) => a.index - b.index);
  }

  addFact(fact: MemoryFact): void {
    this.upsert("facts", fact.id, fact, fact.timestamp);
  }

  listFacts(memoryId?: string): MemoryFact[] {
    return this.list<MemoryFact>("facts").filter((fact) => !memoryId || fact.memoryId === memoryId);
  }

  addEvent(event: MemoryEvent): void {
    this.upsert("events", event.id, event, event.timestamp);
  }

  listEvents(sessionId?: string): MemoryEvent[] {
    return this.list<MemoryEvent>("events")
      .filter((event) => !sessionId || event.sessionId === sessionId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  upsertEmbedding(embedding: MemoryEmbedding): void {
    this.upsert("embeddings", embedding.id, embedding, embedding.updatedAt, embedding.memoryId);
  }

  getEmbedding(memoryId: string): MemoryEmbedding | undefined {
    const row = this.db.prepare("SELECT data FROM embeddings WHERE memory_id = ? ORDER BY updated_at DESC LIMIT 1").get(memoryId) as
      | { data: string }
      | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }

  addTrace(trace: ReplayTrace): void {
    this.upsert("traces", trace.id, trace, trace.createdAt);
  }

  getTrace(id: string): ReplayTrace | undefined {
    return this.get<ReplayTrace>("traces", id);
  }

  listTraces(type?: "ingestion" | "retrieval", limit = 100): ReplayTrace[] {
    return this.list<ReplayTrace>("traces")
      .filter((trace) => !type || trace.type === type)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  addDecision(decision: MemoryDecision): void {
    this.upsert("decisions", decision.id, decision, decision.timestamp);
  }

  listDecisions(traceId?: string): MemoryDecision[] {
    return this.list<MemoryDecision>("decisions").filter((decision) => !traceId || decision.traceId === traceId);
  }

  addMutation(mutation: MemoryMutation): void {
    this.upsert("mutations", mutation.id, mutation, mutation.timestamp, mutation.memoryId);
  }

  listMutations(memoryId?: string): MemoryMutation[] {
    return this.list<MemoryMutation>("mutations")
      .filter((mutation) => !memoryId || mutation.memoryId === memoryId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  upsertFeedback(feedback: MemoryFeedback): void {
    this.upsert("feedback", feedback.id, feedback, feedback.createdAt, feedback.memoryId);
  }

  getFeedback(id: string): MemoryFeedback | undefined {
    return this.get<MemoryFeedback>("feedback", id);
  }

  listFeedback(filters: { memoryId?: string; sessionId?: string; status?: string } = {}): MemoryFeedback[] {
    return this.list<MemoryFeedback>("feedback")
      .filter((feedback) => !filters.memoryId || feedback.memoryId === filters.memoryId)
      .filter((feedback) => !filters.sessionId || feedback.sessionId === filters.sessionId)
      .filter((feedback) => !filters.status || feedback.status === filters.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  upsertRule(rule: MemoryRule): void {
    this.upsert("rules", rule.id, rule, rule.createdAt);
  }

  getRule(id: string): MemoryRule | undefined {
    return this.get<MemoryRule>("rules", id);
  }

  listRules(filters: { scope?: string; enabled?: boolean } = {}): MemoryRule[] {
    return this.list<MemoryRule>("rules")
      .filter((rule) => !filters.scope || rule.scope === filters.scope)
      .filter((rule) => filters.enabled === undefined || rule.enabled === filters.enabled)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  upsertMissingSuggestion(suggestion: MissingMemorySuggestion): void {
    this.upsert("missing_suggestions", suggestion.id, suggestion, suggestion.createdAt);
  }

  getMissingSuggestion(id: string): MissingMemorySuggestion | undefined {
    return this.get<MissingMemorySuggestion>("missing_suggestions", id);
  }

  listMissingSuggestions(filters: { sessionId?: string; status?: string } = {}): MissingMemorySuggestion[] {
    return this.list<MissingMemorySuggestion>("missing_suggestions")
      .filter((suggestion) => !filters.sessionId || suggestion.sessionId === filters.sessionId)
      .filter((suggestion) => !filters.status || suggestion.status === filters.status)
      .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
  }

  addUsage(usage: MemoryUsage): void {
    this.upsert("usage", usage.id, usage, usage.timestamp, usage.memoryId);
  }

  listUsage(memoryId?: string): MemoryUsage[] {
    return this.list<MemoryUsage>("usage")
      .filter((usage) => !memoryId || usage.memoryId === memoryId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  upsertConflict(conflict: MemoryConflict): void {
    this.upsert("conflicts", conflict.id, conflict, conflict.detectedAt);
  }

  getConflict(id: string): MemoryConflict | undefined {
    return this.get<MemoryConflict>("conflicts", id);
  }

  listConflicts(status?: string): MemoryConflict[] {
    return this.list<MemoryConflict>("conflicts")
      .filter((conflict) => !status || conflict.status === status)
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  }

  stats(): DashboardStats {
    const memories = this.list<Memory>("memories");
    const traces = this.listTraces(undefined, 1000);
    const conflicts = this.listConflicts("open");
    const usage = this.listUsage();
    const countsByKind: Record<string, number> = {};
    for (const memory of memories.filter((item) => !item.archived && !item.mergedInto)) {
      countsByKind[memory.kind] = (countsByKind[memory.kind] ?? 0) + 1;
    }
    const retrievalActivity = traces
      .filter((trace) => trace.type === "retrieval")
      .reduce<Record<string, number>>((accumulator, trace) => {
        const date = trace.createdAt.slice(0, 10);
        accumulator[date] = (accumulator[date] ?? 0) + 1;
        return accumulator;
      }, {});

    return {
      totalMemories: memories.length,
      activeMemories: memories.filter((memory) => !memory.archived && !memory.mergedInto).length,
      archivedMemories: memories.filter((memory) => memory.archived).length,
      pinnedMemories: memories.filter((memory) => memory.pinned).length,
      duplicateMemories: memories.filter((memory) => memory.duplicateOf).length,
      mergedMemories: memories.filter((memory) => memory.mergedInto).length,
      sessions: this.list<Session>("sessions").length,
      traces: traces.length,
      countsByKind,
      recentSessions: this.listSessions(5),
      recentTraces: this.listTraces(undefined, 5),
      retrievalActivity: Object.entries(retrievalActivity).map(([date, count]) => ({ date, count })),
      health: {
        lowConfidence: memories.filter((memory) => !memory.archived && !memory.mergedInto && memory.confidence < 0.45).length,
        stale: memories.filter((memory) => {
          const ageDays = Math.max(0, (Date.now() - Date.parse(memory.timestamp)) / 86_400_000);
          return !memory.archived && !memory.mergedInto && ageDays > 90;
        }).length,
        openConflicts: conflicts.length,
        recentlyReinforced: new Set(
          usage.filter((item) => Date.now() - Date.parse(item.timestamp) < 7 * 86_400_000).map((item) => item.memoryId)
        ).size
      }
    };
  }

  private migrate(): void {
    for (const table of tableNames) {
      this.db
        .prepare(
          `CREATE TABLE IF NOT EXISTS ${table} (
            id TEXT PRIMARY KEY,
            memory_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            data TEXT NOT NULL
          )`
        )
        .run();
      this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_${table}_created ON ${table}(created_at)`).run();
      this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_${table}_memory ON ${table}(memory_id)`).run();
    }
  }

  private upsert(table: (typeof tableNames)[number], id: string, entity: Entity, createdAt: string, memoryId?: string): void {
    const existing = this.db.prepare(`SELECT created_at FROM ${table} WHERE id = ?`).get(id) as { created_at: string } | undefined;
    this.db
      .prepare(
        `INSERT INTO ${table} (id, memory_id, created_at, updated_at, data)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          memory_id = excluded.memory_id,
          updated_at = excluded.updated_at,
          data = excluded.data`
      )
      .run(id, memoryId ?? null, existing?.created_at ?? createdAt, nowIso(), JSON.stringify(entity));
  }

  private get<T>(table: (typeof tableNames)[number], id: string): T | undefined {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }

  private list<T>(table: (typeof tableNames)[number]): T[] {
    const rows = this.db.prepare(`SELECT data FROM ${table}`).all() as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as T);
  }
}
