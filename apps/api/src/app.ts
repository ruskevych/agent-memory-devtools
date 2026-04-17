import cors from "@fastify/cors";
import Fastify, { FastifyInstance } from "fastify";
import { AutomationCaptureRequestSchema, IngestRequestSchema, MemoryRuleSchema, MemorySchema, SearchRequestSchema } from "@agent-memory/shared";
import { defaultDbPath, MemoryFilters, MemoryService, seedDemoData, SqliteMemoryStore } from "@agent-memory/memory-core";

export interface ApiOptions {
  dbPath?: string;
  service?: MemoryService;
}

export function createApp(options: ApiOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });
  const service = options.service ?? new MemoryService(new SqliteMemoryStore(options.dbPath ?? defaultDbPath()));

  app.register(cors, { origin: true });

  app.get("/health", async () => ({
    ok: true,
    name: "agent-memory-api",
    dbPath: options.dbPath ?? process.env.AGENT_MEMORY_DB ?? defaultDbPath()
  }));

  app.get("/stats", async () => service.stats());

  app.get("/memories", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return service.listMemories({
      query: query.q,
      kind: query.kind,
      tag: query.tag,
      sourceType: query.sourceType,
      sessionId: query.sessionId,
      scope: query.scope,
      includeArchived: query.includeArchived === "true",
      includeMerged: query.includeMerged === "true",
      limit: query.limit ? Number(query.limit) : undefined
    });
  });

  app.get("/memories/export", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const format = query.format === "markdown" ? "markdown" : "json";
    const filters: MemoryFilters = {
      kind: query.kind,
      tag: query.tag,
      scope: query.scope,
      includeArchived: query.includeArchived === "true",
      includeMerged: query.includeMerged === "true"
    };
    const data = service.exportMemories(filters, format);
    const ext = format === "markdown" ? "md" : "json";
    const filename = `memories-${new Date().toISOString().slice(0, 10)}.${ext}`;
    return reply
      .header("content-type", format === "markdown" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(data);
  });

  app.post("/memories/import", async (request, reply) => {
    const body = request.body as { data?: string; overwrite?: boolean };
    if (!body.data) return reply.code(400).send({ error: "data is required" });
    return service.importMemories(body.data, { overwrite: body.overwrite });
  });

  app.post("/memories", async (request, reply) => {
    const body = MemorySchema.omit({ id: true, timestamp: true }).partial({ pinned: true, archived: true, tags: true }).parse(request.body);
    const memory = service.createMemory({
      ...body,
      tags: body.tags ?? [],
      pinned: body.pinned ?? false,
      archived: body.archived ?? false,
      metadata: body.metadata ?? {}
    });
    return reply.code(201).send(memory);
  });

  app.get("/memories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const memory = service.getMemory(id);
    if (!memory) return reply.code(404).send({ error: "Memory not found" });
    return memory;
  });

  app.get("/memories/:id/confidence", async (request, reply) => {
    const { id } = request.params as { id: string };
    const report = service.confidenceReport(id);
    if (!report) return reply.code(404).send({ error: "Memory not found" });
    return report;
  });

  app.patch("/memories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const patch = MemorySchema.partial().omit({ id: true }).parse(request.body);
    const memory = service.updateMemory(id, patch);
    if (!memory) return reply.code(404).send({ error: "Memory not found" });
    return memory;
  });

  app.delete("/memories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!service.deleteMemory(id)) return reply.code(404).send({ error: "Memory not found" });
    return { ok: true };
  });

  app.post("/memories/:id/merge", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { targetId } = request.body as { targetId?: string };
    if (!targetId) return reply.code(400).send({ error: "targetId is required" });
    const memory = service.mergeMemory(id, targetId);
    if (!memory) return reply.code(404).send({ error: "Memory or target not found" });
    return memory;
  });

  app.get("/feedback", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return service.listFeedback({ memoryId: query.memoryId, sessionId: query.sessionId, status: query.status });
  });

  app.post("/feedback", async (request, reply) => {
    const body = request.body as {
      targetType?: string;
      targetId?: string;
      type?: string;
      reason?: string;
      patch?: Record<string, unknown>;
      apply?: boolean;
      createRule?: boolean;
      memoryId?: string;
      sessionId?: string;
      traceId?: string;
    };
    if (!body.targetType || !body.targetId || !body.type) {
      return reply.code(400).send({ error: "targetType, targetId, and type are required" });
    }
    return reply.code(201).send(
      service.addFeedback(
        {
          targetType: body.targetType as never,
          targetId: body.targetId,
          type: body.type as never,
          reason: body.reason,
          patch: (body.patch ?? {}) as never,
          memoryId: body.memoryId,
          sessionId: body.sessionId,
          traceId: body.traceId
        },
        { apply: body.apply, createRule: body.createRule }
      )
    );
  });

  app.post("/feedback/:id/apply", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { createRule?: boolean };
    const result = service.applyFeedback(id, { apply: true, createRule: body.createRule });
    if (!result) return reply.code(404).send({ error: "Feedback not found" });
    return result;
  });

  app.get("/rules", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return service.listRules({
      scope: query.scope,
      enabled: query.enabled === undefined ? undefined : query.enabled === "true"
    });
  });

  app.post("/rules", async (request, reply) => {
    const body = MemoryRuleSchema.omit({ id: true, createdAt: true, updatedAt: true }).parse(request.body);
    return reply.code(201).send(service.createRule(body));
  });

  app.patch("/rules/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const patch = MemoryRuleSchema.partial().omit({ id: true, createdAt: true }).parse(request.body);
    const rule = service.updateRule(id, patch);
    if (!rule) return reply.code(404).send({ error: "Rule not found" });
    return rule;
  });

  app.get("/sessions", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return service.listSessions(query.limit ? Number(query.limit) : undefined);
  });

  app.get("/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = service.getSession(id);
    if (!session) return reply.code(404).send({ error: "Session not found" });
    return session;
  });

  app.post("/sessions/:id/analyze-missing", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!service.getSession(id)) return reply.code(404).send({ error: "Session not found" });
    const body = request.body as { refresh?: boolean; limit?: number };
    return service.analyzeMissingMemories(id, { refresh: body.refresh, limit: body.limit });
  });

  app.get("/sessions/:id/missing", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!service.getSession(id)) return reply.code(404).send({ error: "Session not found" });
    const query = request.query as Record<string, string | undefined>;
    return service.listMissingSuggestions(id, query.status ?? "open");
  });

  app.post("/missing/:id/accept", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = service.acceptMissingSuggestion(id);
    if (!result) return reply.code(404).send({ error: "Suggestion not found" });
    return result;
  });

  app.post("/missing/:id/dismiss", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string };
    const suggestion = service.dismissMissingSuggestion(id, body.reason);
    if (!suggestion) return reply.code(404).send({ error: "Suggestion not found" });
    return suggestion;
  });

  app.post("/ingest", async (request, reply) => {
    const result = service.ingest(IngestRequestSchema.parse(request.body));
    return reply.code(201).send(result);
  });

  app.post("/automation/capture", async (request, reply) => {
    const result = service.captureAutomation(AutomationCaptureRequestSchema.parse(request.body));
    return reply.code(201).send(result);
  });

  app.post("/search", async (request) => service.search(SearchRequestSchema.parse(request.body)));

  app.post("/confidence/recompute", async (request) => {
    const body = request.body as { memoryId?: string };
    return { reports: service.recomputeConfidence(body.memoryId) };
  });

  app.get("/conflicts", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return service.listConflicts(query.status ?? "open");
  });

  app.post("/conflicts/detect", async () => ({ conflicts: service.detectConflicts() }));

  app.post("/conflicts/:id/resolve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { action?: "dismiss" | "archive-memory" | "merge" | "mark-resolved"; memoryId?: string; targetId?: string; reason?: string };
    if (!body.action) return reply.code(400).send({ error: "action is required" });
    const conflict = service.resolveConflict(id, { action: body.action, memoryId: body.memoryId, targetId: body.targetId, reason: body.reason });
    if (!conflict) return reply.code(404).send({ error: "Conflict not found" });
    return conflict;
  });

  app.post("/usage", async (request, reply) => {
    const body = request.body as { memoryId?: string; traceId?: string; query?: string; rank?: number; score?: number; event?: "selected" | "applied" | "returned"; metadata?: Record<string, unknown> };
    if (!body.memoryId || !body.event) return reply.code(400).send({ error: "memoryId and event are required" });
    service.addUsage({
      memoryId: body.memoryId,
      traceId: body.traceId,
      query: body.query,
      rank: body.rank,
      score: body.score,
      event: body.event,
      metadata: (body.metadata ?? {}) as never
    });
    return { ok: true };
  });

  app.get("/replay", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const type = query.type === "ingestion" || query.type === "retrieval" ? query.type : undefined;
    return service.listTraces(type, query.limit ? Number(query.limit) : undefined);
  });

  app.get("/replay/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const trace = service.getTrace(id);
    if (!trace) return reply.code(404).send({ error: "Trace not found" });
    return trace;
  });

  app.post("/dev/seed", async () => {
    const responses = seedDemoData(service);
    return {
      ok: true,
      sessions: responses.map((response) => response.session),
      memories: responses.flatMap((response) => response.stored),
      traces: responses.map((response) => response.trace)
    };
  });

  app.addHook("onClose", async () => service.close());
  return app;
}
