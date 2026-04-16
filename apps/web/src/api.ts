import {
  DashboardStats,
  IngestResponse,
  Memory,
  MemoryConfidenceReport,
  MemoryConflict,
  MemoryFeedback,
  MemoryRule,
  MissingMemorySuggestion,
  ReplayTrace,
  SearchResponse,
  Session
} from "@agent-memory/shared";

const defaultBaseUrl = import.meta.env.VITE_AGENT_MEMORY_API_URL ?? "http://127.0.0.1:4317";

export interface SessionDetail extends Session {
  steps: Array<{ id: string; index: number; role: string; content: string; timestamp: string }>;
  memories: Memory[];
}

export class ApiClient {
  constructor(public baseUrl = localStorage.getItem("agent-memory-api-url") ?? defaultBaseUrl) {}

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
    localStorage.setItem("agent-memory-api-url", baseUrl);
  }

  health(): Promise<{ ok: boolean; dbPath: string }> {
    return this.request("/health");
  }

  stats(): Promise<DashboardStats> {
    return this.request("/stats");
  }

  memories(params: Record<string, string | boolean | undefined> = {}): Promise<Memory[]> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") query.set(key, String(value));
    }
    return this.request(`/memories?${query.toString()}`);
  }

  updateMemory(id: string, patch: Partial<Memory>): Promise<Memory> {
    return this.request(`/memories/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  }

  deleteMemory(id: string): Promise<{ ok: true }> {
    return this.request(`/memories/${id}`, { method: "DELETE" });
  }

  mergeMemory(id: string, targetId: string): Promise<Memory> {
    return this.request(`/memories/${id}/merge`, { method: "POST", body: JSON.stringify({ targetId }) });
  }

  feedback(params: Record<string, string | undefined> = {}): Promise<MemoryFeedback[]> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, value);
    }
    return this.request(`/feedback?${query.toString()}`);
  }

  addFeedback(body: {
    targetType: string;
    targetId: string;
    type: string;
    reason?: string;
    patch?: Record<string, unknown>;
    apply?: boolean;
    createRule?: boolean;
    memoryId?: string;
    sessionId?: string;
    traceId?: string;
  }): Promise<{ feedback: MemoryFeedback; memory?: Memory; rule?: MemoryRule }> {
    return this.request("/feedback", { method: "POST", body: JSON.stringify(body) });
  }

  sessions(): Promise<Session[]> {
    return this.request("/sessions");
  }

  session(id: string): Promise<SessionDetail> {
    return this.request(`/sessions/${id}`);
  }

  analyzeMissing(sessionId: string, body: { refresh?: boolean; limit?: number } = {}): Promise<{
    sessionId: string;
    suggestions: MissingMemorySuggestion[];
    analyzedAt: string;
  }> {
    return this.request(`/sessions/${sessionId}/analyze-missing`, { method: "POST", body: JSON.stringify(body) });
  }

  missing(sessionId: string): Promise<MissingMemorySuggestion[]> {
    return this.request(`/sessions/${sessionId}/missing`);
  }

  acceptMissing(id: string): Promise<{ suggestion: MissingMemorySuggestion; memory: Memory }> {
    return this.request(`/missing/${id}/accept`, { method: "POST", body: JSON.stringify({}) });
  }

  dismissMissing(id: string): Promise<MissingMemorySuggestion> {
    return this.request(`/missing/${id}/dismiss`, { method: "POST", body: JSON.stringify({}) });
  }

  confidence(memoryId: string): Promise<MemoryConfidenceReport> {
    return this.request(`/memories/${memoryId}/confidence`);
  }

  recomputeConfidence(memoryId?: string): Promise<{ reports: MemoryConfidenceReport[] }> {
    return this.request("/confidence/recompute", { method: "POST", body: JSON.stringify({ memoryId }) });
  }

  conflicts(status = "open"): Promise<MemoryConflict[]> {
    return this.request(`/conflicts?status=${encodeURIComponent(status)}`);
  }

  detectConflicts(): Promise<{ conflicts: MemoryConflict[] }> {
    return this.request("/conflicts/detect", { method: "POST", body: JSON.stringify({}) });
  }

  resolveConflict(id: string, body: { action: string; memoryId?: string; targetId?: string; reason?: string }): Promise<MemoryConflict> {
    return this.request(`/conflicts/${id}/resolve`, { method: "POST", body: JSON.stringify(body) });
  }

  seed(): Promise<{ ok: boolean; sessions: Session[]; memories: Memory[]; traces: ReplayTrace[] }> {
    return this.request("/dev/seed", { method: "POST", body: JSON.stringify({}) });
  }

  search(query: string, limit = 10): Promise<SearchResponse> {
    return this.request("/search", { method: "POST", body: JSON.stringify({ query, limit, includeArchived: false }) });
  }

  traces(type?: "ingestion" | "retrieval"): Promise<ReplayTrace[]> {
    return this.request(`/replay${type ? `?type=${type}` : ""}`);
  }

  trace(id: string): Promise<ReplayTrace> {
    return this.request(`/replay/${id}`);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init.headers
      }
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }
}
