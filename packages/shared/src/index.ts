import { z } from "zod";

export const MemoryKindSchema = z.enum([
  "fact",
  "preference",
  "event",
  "task-context",
  "codebase-context",
  "summary"
]);
export type MemoryKind = z.infer<typeof MemoryKindSchema>;

export const SourceTypeSchema = z.enum(["session", "manual", "cli", "api", "import", "sample", "hook", "automation"]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const AutomationToolSchema = z.enum(["codex", "claude-code", "generic"]);
export type AutomationTool = z.infer<typeof AutomationToolSchema>;

export const AutomationTriggerSchema = z.enum(["hook", "watch", "cli", "manual"]);
export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>;

export const AutomationEventTypeSchema = z.enum([
  "user-prompt",
  "agent-summary",
  "file-change",
  "task-complete",
  "session-checkpoint"
]);
export type AutomationEventType = z.infer<typeof AutomationEventTypeSchema>;

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema)
  ])
);
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const MetadataSchema = z.record(JsonValueSchema).default({});
export type Metadata = z.infer<typeof MetadataSchema>;

export const MemorySourceSchema = z.object({
  type: SourceTypeSchema,
  agent: z.string().optional(),
  label: z.string().optional(),
  path: z.string().optional(),
  runId: z.string().optional(),
  stepId: z.string().optional(),
  timestamp: z.string().datetime().optional(),
  metadata: MetadataSchema.optional().default({})
});
export type MemorySource = z.infer<typeof MemorySourceSchema>;

export const MemoryScopeSchema = z.enum(["project", "global"]);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MemorySchema = z.object({
  id: z.string(),
  content: z.string().min(1),
  summary: z.string().min(1),
  kind: MemoryKindSchema,
  source: MemorySourceSchema,
  tags: z.array(z.string()).default([]),
  timestamp: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  pinned: z.boolean().default(false),
  archived: z.boolean().default(false),
  scope: MemoryScopeSchema.default("project"),
  duplicateOf: z.string().optional(),
  mergedInto: z.string().optional(),
  relatedSessionId: z.string().optional(),
  metadata: MetadataSchema.optional().default({})
});
export type Memory = z.infer<typeof MemorySchema>;

export const MemoryFactSchema = z.object({
  id: z.string(),
  memoryId: z.string(),
  subject: z.string(),
  predicate: z.string(),
  object: z.string(),
  confidence: z.number().min(0).max(1),
  timestamp: z.string().datetime(),
  source: MemorySourceSchema,
  metadata: MetadataSchema.optional().default({})
});
export type MemoryFact = z.infer<typeof MemoryFactSchema>;

export const MemoryEventSchema = z.object({
  id: z.string(),
  sessionId: z.string().optional(),
  memoryId: z.string().optional(),
  kind: z.string(),
  title: z.string(),
  content: z.string(),
  timestamp: z.string().datetime(),
  metadata: MetadataSchema.optional().default({})
});
export type MemoryEvent = z.infer<typeof MemoryEventSchema>;

export const MemoryEmbeddingSchema = z.object({
  id: z.string(),
  memoryId: z.string(),
  provider: z.string(),
  model: z.string(),
  vector: z.array(z.number()),
  updatedAt: z.string().datetime()
});
export type MemoryEmbedding = z.infer<typeof MemoryEmbeddingSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  agent: z.string().default("unknown"),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
  summary: z.string().optional(),
  metadata: MetadataSchema.optional().default({})
});
export type Session = z.infer<typeof SessionSchema>;

export const SessionStepSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  index: z.number().int().nonnegative(),
  role: z.enum(["system", "user", "assistant", "tool", "event"]),
  content: z.string(),
  timestamp: z.string().datetime(),
  metadata: MetadataSchema.optional().default({})
});
export type SessionStep = z.infer<typeof SessionStepSchema>;

export const RetrievalExplanationSchema = z.object({
  keywordScore: z.number(),
  semanticScore: z.number(),
  recencyScore: z.number(),
  pinnedBoost: z.number(),
  importanceBoost: z.number(),
  sourceBoost: z.number(),
  matchedTerms: z.array(z.string()),
  reason: z.string(),
  components: z.record(z.number()).default({})
});
export type RetrievalExplanation = z.infer<typeof RetrievalExplanationSchema>;

export const RetrievalResultSchema = z.object({
  memory: MemorySchema,
  score: z.number(),
  explanation: RetrievalExplanationSchema
});
export type RetrievalResult = z.infer<typeof RetrievalResultSchema>;

export const DecisionActionSchema = z.enum(["store", "ignore", "merge", "update"]);
export const MemoryDecisionSchema = z.object({
  id: z.string(),
  traceId: z.string(),
  candidateId: z.string(),
  memoryId: z.string().optional(),
  action: DecisionActionSchema,
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  duplicateOf: z.string().optional(),
  timestamp: z.string().datetime(),
  metadata: MetadataSchema.optional().default({})
});
export type MemoryDecision = z.infer<typeof MemoryDecisionSchema>;

export const MutationTypeSchema = z.enum([
  "create",
  "update",
  "pin",
  "archive",
  "delete",
  "merge",
  "restore"
]);
export const MemoryMutationSchema = z.object({
  id: z.string(),
  memoryId: z.string(),
  type: MutationTypeSchema,
  before: MetadataSchema.optional(),
  after: MetadataSchema.optional(),
  actor: z.string().default("system"),
  reason: z.string().optional(),
  timestamp: z.string().datetime()
});
export type MemoryMutation = z.infer<typeof MemoryMutationSchema>;

export const FeedbackTargetTypeSchema = z.enum(["memory", "decision", "session-step", "retrieval-result"]);
export type FeedbackTargetType = z.infer<typeof FeedbackTargetTypeSchema>;

export const FeedbackTypeSchema = z.enum([
  "should-remember",
  "should-not-remember",
  "wrong-kind",
  "wrong-tags",
  "wrong-summary",
  "wrong-content",
  "wrong-merge",
  "duplicate",
  "boost-importance",
  "lower-importance"
]);
export type FeedbackType = z.infer<typeof FeedbackTypeSchema>;

export const FeedbackStatusSchema = z.enum(["pending", "applied", "dismissed"]);
export type FeedbackStatus = z.infer<typeof FeedbackStatusSchema>;

export const MemoryFeedbackSchema = z.object({
  id: z.string(),
  targetType: FeedbackTargetTypeSchema,
  targetId: z.string(),
  memoryId: z.string().optional(),
  sessionId: z.string().optional(),
  traceId: z.string().optional(),
  type: FeedbackTypeSchema,
  actor: z.string().default("user"),
  reason: z.string().optional(),
  patch: MetadataSchema.optional().default({}),
  createdAt: z.string().datetime(),
  appliedAt: z.string().datetime().optional(),
  status: FeedbackStatusSchema.default("pending"),
  metadata: MetadataSchema.optional().default({})
});
export type MemoryFeedback = z.infer<typeof MemoryFeedbackSchema>;

export const MemoryRuleSchema = z.object({
  id: z.string(),
  scope: z.enum(["ingestion", "dedupe", "retrieval"]),
  condition: MetadataSchema.default({}),
  effect: MetadataSchema.default({}),
  enabled: z.boolean().default(true),
  createdFromFeedbackId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: MetadataSchema.optional().default({})
});
export type MemoryRule = z.infer<typeof MemoryRuleSchema>;

export const MissingMemoryEvidenceSchema = z.object({
  stepId: z.string(),
  snippet: z.string(),
  reason: z.string()
});
export type MissingMemoryEvidence = z.infer<typeof MissingMemoryEvidenceSchema>;

export const MissingMemorySuggestionSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  stepIds: z.array(z.string()).default([]),
  content: z.string().min(1),
  summary: z.string().min(1),
  kind: MemoryKindSchema,
  tags: z.array(z.string()).default([]),
  reason: z.string(),
  evidence: z.array(MissingMemoryEvidenceSchema).default([]),
  score: z.number().min(0).max(1),
  matchedMemoryIds: z.array(z.string()).default([]),
  status: z.enum(["open", "accepted", "dismissed"]).default("open"),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  metadata: MetadataSchema.optional().default({})
});
export type MissingMemorySuggestion = z.infer<typeof MissingMemorySuggestionSchema>;

export const MemoryUsageSchema = z.object({
  id: z.string(),
  memoryId: z.string(),
  traceId: z.string().optional(),
  query: z.string().optional(),
  rank: z.number().int().positive().optional(),
  score: z.number().optional(),
  event: z.enum(["returned", "selected", "applied"]),
  timestamp: z.string().datetime(),
  metadata: MetadataSchema.optional().default({})
});
export type MemoryUsage = z.infer<typeof MemoryUsageSchema>;

export const MemoryConflictSchema = z.object({
  id: z.string(),
  memoryIds: z.array(z.string()).min(2),
  kind: z.enum(["preference-contradiction", "fact-contradiction", "duplicate-risk"]).default("preference-contradiction"),
  subject: z.string(),
  summary: z.string(),
  severity: z.number().min(0).max(1),
  status: z.enum(["open", "resolved", "dismissed"]).default("open"),
  detectedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  metadata: MetadataSchema.optional().default({})
});
export type MemoryConflict = z.infer<typeof MemoryConflictSchema>;

export const MemoryConfidenceComponentSchema = z.object({
  score: z.number().min(0).max(1),
  weight: z.number(),
  contribution: z.number()
});
export type MemoryConfidenceComponent = z.infer<typeof MemoryConfidenceComponentSchema>;

export const MemoryConfidenceReportSchema = z.object({
  memoryId: z.string(),
  confidence: z.number().min(0).max(1),
  label: z.enum(["high", "medium", "low", "conflicted", "stale"]),
  components: z.record(MemoryConfidenceComponentSchema),
  reasons: z.array(z.string()).default([]),
  usageCount: z.number().int().nonnegative().default(0),
  lastUsedAt: z.string().datetime().optional(),
  conflictIds: z.array(z.string()).default([]),
  updatedAt: z.string().datetime(),
  metadata: MetadataSchema.optional().default({})
});
export type MemoryConfidenceReport = z.infer<typeof MemoryConfidenceReportSchema>;

export const ReplayStageSchema = z.object({
  name: z.string(),
  summary: z.string(),
  items: z.array(MetadataSchema).optional(),
  metadata: MetadataSchema.optional()
});
export type ReplayStage = z.infer<typeof ReplayStageSchema>;

export const ReplayTraceSchema = z.object({
  id: z.string(),
  type: z.enum(["ingestion", "retrieval"]),
  title: z.string(),
  createdAt: z.string().datetime(),
  input: MetadataSchema,
  stages: z.array(ReplayStageSchema),
  decisions: z.array(MemoryDecisionSchema).default([]),
  results: z.array(RetrievalResultSchema).default([]),
  metadata: MetadataSchema.optional().default({})
});
export type ReplayTrace = z.infer<typeof ReplayTraceSchema>;

export const IngestStepSchema = z.object({
  role: SessionStepSchema.shape.role.default("event"),
  content: z.string(),
  timestamp: z.string().datetime().optional(),
  metadata: MetadataSchema.optional().default({})
});
export type IngestStep = z.input<typeof IngestStepSchema>;

export const IngestRequestSchema = z.object({
  rawContent: z.string().optional(),
  steps: z.array(IngestStepSchema).optional(),
  session: z
    .object({
      id: z.string().optional(),
      title: z.string().optional(),
      agent: z.string().optional(),
      tags: z.array(z.string()).optional(),
      metadata: MetadataSchema.optional()
    })
    .optional(),
  source: MemorySourceSchema.partial().optional(),
  metadata: MetadataSchema.optional().default({})
});
export type IngestRequest = z.input<typeof IngestRequestSchema>;

export const IngestResponseSchema = z.object({
  session: SessionSchema,
  steps: z.array(SessionStepSchema),
  stored: z.array(MemorySchema),
  ignored: z.array(MemoryDecisionSchema),
  merged: z.array(MemoryDecisionSchema),
  facts: z.array(MemoryFactSchema),
  events: z.array(MemoryEventSchema),
  trace: ReplayTraceSchema
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;

export const MemoryExportSchema = z.object({
  version: z.literal("1"),
  exportedAt: z.string().datetime(),
  count: z.number().int().nonnegative(),
  memories: z.array(MemorySchema)
});
export type MemoryExport = z.infer<typeof MemoryExportSchema>;

export const MemoryImportResultSchema = z.object({
  imported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(z.string())
});
export type MemoryImportResult = z.infer<typeof MemoryImportResultSchema>;

export const AutomationFileChangeSchema = z.object({
  path: z.string(),
  changeType: z.enum(["added", "modified", "deleted"]).default("modified"),
  summary: z.string().optional(),
  addedLines: z.number().int().nonnegative().default(0),
  deletedLines: z.number().int().nonnegative().default(0),
  symbols: z.array(z.string()).default([]),
  libraries: z.array(z.string()).default([]),
  metadata: MetadataSchema.optional().default({})
});
export type AutomationFileChange = z.infer<typeof AutomationFileChangeSchema>;

export const AutomationEventInputSchema = z.object({
  id: z.string().optional(),
  type: AutomationEventTypeSchema,
  tool: AutomationToolSchema.default("generic"),
  trigger: AutomationTriggerSchema.default("cli"),
  automatic: z.boolean().default(true),
  sessionId: z.string().optional(),
  taskId: z.string().optional(),
  cwd: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  summary: z.string().optional(),
  timestamp: z.string().datetime().optional(),
  files: z.array(AutomationFileChangeSchema).default([]),
  metadata: MetadataSchema.optional().default({})
});
export type AutomationEventInput = z.input<typeof AutomationEventInputSchema>;

export const AutomationEventSchema = z.object({
  id: z.string(),
  type: AutomationEventTypeSchema,
  tool: AutomationToolSchema,
  trigger: AutomationTriggerSchema,
  automatic: z.boolean().default(true),
  sessionId: z.string().optional(),
  taskId: z.string().optional(),
  cwd: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  summary: z.string().optional(),
  timestamp: z.string().datetime(),
  files: z.array(AutomationFileChangeSchema).default([]),
  metadata: MetadataSchema.optional().default({})
});
export type AutomationEvent = z.infer<typeof AutomationEventSchema>;

export const AutomationCaptureRequestSchema = z.object({
  session: z
    .object({
      id: z.string().optional(),
      title: z.string().optional(),
      agent: z.string().optional(),
      tags: z.array(z.string()).optional(),
      metadata: MetadataSchema.optional()
    })
    .optional(),
  source: MemorySourceSchema.partial().optional(),
  events: z.array(AutomationEventInputSchema).min(1),
  metadata: MetadataSchema.optional().default({})
});
export type AutomationCaptureRequest = z.input<typeof AutomationCaptureRequestSchema>;

export const AutomationCaptureDecisionSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  type: AutomationEventTypeSchema,
  action: z.enum(["accept", "ignore"]),
  reason: z.string(),
  role: SessionStepSchema.shape.role.optional(),
  content: z.string().optional(),
  fingerprint: z.string().optional(),
  metadata: MetadataSchema.optional().default({})
});
export type AutomationCaptureDecision = z.infer<typeof AutomationCaptureDecisionSchema>;

export const AutomationCaptureResponseSchema = z.object({
  session: SessionSchema.optional(),
  steps: z.array(SessionStepSchema),
  stored: z.array(MemorySchema),
  ignored: z.array(MemoryDecisionSchema),
  merged: z.array(MemoryDecisionSchema),
  facts: z.array(MemoryFactSchema),
  events: z.array(MemoryEventSchema),
  trace: ReplayTraceSchema,
  captureDecisions: z.array(AutomationCaptureDecisionSchema),
  acceptedEventIds: z.array(z.string()).default([]),
  ignoredEventIds: z.array(z.string()).default([])
});
export type AutomationCaptureResponse = z.infer<typeof AutomationCaptureResponseSchema>;

export const SearchRequestSchema = z.object({
  query: z.string(),
  limit: z.number().int().min(1).max(100).default(10),
  kind: MemoryKindSchema.optional(),
  tags: z.array(z.string()).optional(),
  sourceType: SourceTypeSchema.optional(),
  sessionId: z.string().optional(),
  includeArchived: z.boolean().default(false)
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const SearchResponseSchema = z.object({
  query: z.string(),
  results: z.array(RetrievalResultSchema),
  trace: ReplayTraceSchema
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const DashboardStatsSchema = z.object({
  totalMemories: z.number(),
  activeMemories: z.number(),
  archivedMemories: z.number(),
  pinnedMemories: z.number(),
  duplicateMemories: z.number(),
  mergedMemories: z.number(),
  sessions: z.number(),
  traces: z.number(),
  countsByKind: z.record(z.number()),
  recentSessions: z.array(SessionSchema),
  recentTraces: z.array(ReplayTraceSchema),
  retrievalActivity: z.array(z.object({ date: z.string(), count: z.number() })),
  health: z
    .object({
      lowConfidence: z.number(),
      stale: z.number(),
      openConflicts: z.number(),
      recentlyReinforced: z.number()
    })
    .optional()
});
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;
