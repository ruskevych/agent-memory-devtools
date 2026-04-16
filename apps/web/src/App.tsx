import { FormEvent, MouseEvent, ReactElement, ReactNode, useEffect, useMemo, useState } from "react";
import {
  DashboardStats,
  Memory,
  MemoryConfidenceReport,
  MemoryConflict,
  MemoryFeedback,
  MissingMemorySuggestion,
  ReplayStage,
  ReplayTrace,
  RetrievalResult,
  Session
} from "@agent-memory/shared";
import { ApiClient, SessionDetail } from "./api.js";

type Page = "dashboard" | "memories" | "sessions" | "replay" | "settings";

const pages: Array<{ id: Page; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "memories", label: "Memory Explorer" },
  { id: "sessions", label: "Session Explorer" },
  { id: "replay", label: "Replay" },
  { id: "settings", label: "Settings" }
];

const memoryKinds = ["fact", "preference", "event", "task-context", "codebase-context", "summary"];
const sampleQueries = ["typescript zod api", "remember repo preferences", "unresolved task", "codebase validation rules"];

export function App(): ReactElement {
  const [api] = useState(() => new ApiClient());
  const [page, setPageState] = useState<Page>("dashboard");
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [traces, setTraces] = useState<ReplayTrace[]>([]);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [selectedFeedback, setSelectedFeedback] = useState<MemoryFeedback[]>([]);
  const [selectedConfidence, setSelectedConfidence] = useState<MemoryConfidenceReport | null>(null);
  const [openConflicts, setOpenConflicts] = useState<MemoryConflict[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null);
  const [missingSuggestions, setMissingSuggestions] = useState<MissingMemorySuggestion[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<ReplayTrace | null>(null);
  const [retrievalResults, setRetrievalResults] = useState<RetrievalResult[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [tag, setTag] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [apiUrl, setApiUrl] = useState(api.baseUrl);

  const setPage = (newPage: Page) => {
    setPageState(newPage);
    setMessage("");
  };

  async function refresh(): Promise<void> {
    try {
      await api.health();
      setStatus("online");
      const [nextStats, nextMemories, nextSessions, nextTraces] = await Promise.all([
        api.stats(),
        api.memories({ q: query, kind, tag, includeArchived: showArchived, includeMerged: showArchived }),
        api.sessions(),
        api.traces()
      ]);
      setStats(nextStats);
      setMemories(nextMemories);
      setSessions(nextSessions);
      setTraces(nextTraces);
      setSelectedTrace((current) => current ?? nextTraces[0] ?? null);
      setSelectedMemory((current) => nextMemories.find((memory) => memory.id === current?.id) ?? current);
    } catch (error) {
      setStatus("offline");
      setMessage(error instanceof Error ? error.message : "API unavailable");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (page === "memories") void refresh();
  }, [kind, tag, showArchived]);

  useEffect(() => {
    if (!selectedMemory) {
      setSelectedFeedback([]);
      return;
    }
    api.feedback({ memoryId: selectedMemory.id })
      .then(setSelectedFeedback)
      .catch(() => setSelectedFeedback([]));
    api.confidence(selectedMemory.id)
      .then(setSelectedConfidence)
      .catch(() => setSelectedConfidence(null));
    api.conflicts("open")
      .then(setOpenConflicts)
      .catch(() => setOpenConflicts([]));
  }, [api, selectedMemory?.id]);

  async function runSearch(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    await runSearchFor(query);
  }

  async function runSearchFor(searchQuery: string): Promise<void> {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setRetrievalResults([]);
      await refresh();
      return;
    }
    try {
      setQuery(trimmed);
      const response = await api.search(trimmed, 12);
      setRetrievalResults(response.results);
      setSelectedTrace(response.trace);
      setTraces((items) => [response.trace, ...items.filter((trace) => trace.id !== response.trace.id)]);
      setMemories(response.results.map((result) => result.memory));
      setSelectedMemory(response.results[0]?.memory ?? null);
      setStats(await api.stats());
      setMessage(`Search "${trimmed}" returned ${response.results.length} explainable matches.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Search failed");
    }
  }

  async function updateMemory(memory: Memory, patch: Partial<Memory>): Promise<void> {
    const previous = memories;
    const optimistic = { ...memory, ...patch };
    setMemories(memories.map((item) => (item.id === memory.id ? optimistic : item)));
    setSelectedMemory(optimistic);
    try {
      const updated = await api.updateMemory(memory.id, patch);
      setMemories((items) => items.map((item) => (item.id === memory.id ? updated : item)));
      setSelectedMemory(updated);
      void refresh();
    } catch (error) {
      setMemories(previous);
      setMessage(error instanceof Error ? error.message : "Update failed");
    }
  }

  async function deleteMemory(memory: Memory): Promise<void> {
    if (!window.confirm(`Delete "${memory.summary}"?`)) return;
    const previous = memories;
    setMemories(memories.filter((item) => item.id !== memory.id));
    setSelectedMemory(null);
    try {
      await api.deleteMemory(memory.id);
      void refresh();
    } catch (error) {
      setMemories(previous);
      setMessage(error instanceof Error ? error.message : "Delete failed");
    }
  }

  async function mergeMemory(memory: Memory, targetId: string): Promise<void> {
    if (!targetId.trim()) return;
    try {
      const merged = await api.mergeMemory(memory.id, targetId.trim());
      setSelectedMemory(merged);
      setMessage(`Merged ${memory.id} into ${targetId.trim()}.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Merge failed");
    }
  }

  async function fixMemory(memory: Memory, type: string, patch: Record<string, unknown> = {}, createRule = false): Promise<void> {
    try {
      const result = await api.addFeedback({
        targetType: "memory",
        targetId: memory.id,
        memoryId: memory.id,
        type,
        patch,
        apply: true,
        createRule
      });
      if (result.memory) setSelectedMemory(result.memory);
      setMessage(`${type} feedback applied${result.rule ? ` with rule ${result.rule.id}` : ""}.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fix failed");
    }
  }

  async function rememberDecision(decisionId: string, traceId?: string): Promise<void> {
    try {
      const result = await api.addFeedback({
        targetType: "decision",
        targetId: decisionId,
        traceId,
        type: "should-remember",
        apply: true,
        createRule: true
      });
      setMessage(result.memory ? `Created memory ${result.memory.id} from ignored decision.` : "Could not create memory from decision.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Remember action failed");
    }
  }

  async function fixWrongMerge(decisionId: string, memoryId?: string, traceId?: string): Promise<void> {
    if (!memoryId) return;
    try {
      await api.addFeedback({
        targetType: "memory",
        targetId: memoryId,
        memoryId,
        traceId,
        type: "wrong-merge",
        apply: true,
        createRule: true
      });
      setMessage(`Restored ${memoryId} and recorded a never-merge rule.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wrong merge fix failed");
    }
  }

  async function rememberStep(stepId: string, sessionId: string): Promise<void> {
    try {
      const result = await api.addFeedback({
        targetType: "session-step",
        targetId: stepId,
        sessionId,
        type: "should-remember",
        apply: true,
        createRule: true
      });
      setMessage(result.memory ? `Created memory ${result.memory.id} from session step.` : "Could not create memory from session step.");
      await refresh();
      await openSession(sessionId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Create memory from step failed");
    }
  }

  async function seedDemo(nextPage: Page | "stay" = "memories"): Promise<void> {
    try {
      const result = await api.seed();
      setMessage(`Loaded ${result.sessions.length} demo sessions, ${result.memories.length} memories, and ${result.traces.length} traces.`);
      await refresh();
      if (nextPage !== "stay") setPage(nextPage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Seed failed");
    }
  }

  async function openSession(id: string): Promise<void> {
    try {
      const [session, missing] = await Promise.all([api.session(id), api.missing(id).catch(() => [])]);
      setSelectedSession(session);
      setMissingSuggestions(missing);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Session failed to load");
    }
  }

  async function analyzeMissing(sessionId: string): Promise<void> {
    try {
      const result = await api.analyzeMissing(sessionId, { refresh: true, limit: 8 });
      setMissingSuggestions(result.suggestions);
      setMessage(`Found ${result.suggestions.length} missing-memory suggestions.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Missing-memory analysis failed");
    }
  }

  async function acceptMissing(id: string): Promise<void> {
    try {
      const result = await api.acceptMissing(id);
      setMissingSuggestions((items) => items.filter((item) => item.id !== id));
      setMessage(`Accepted suggestion as memory ${result.memory.id}.`);
      await refresh();
      if (result.suggestion.sessionId) await openSession(result.suggestion.sessionId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Accept suggestion failed");
    }
  }

  async function dismissMissing(id: string): Promise<void> {
    try {
      await api.dismissMissing(id);
      setMissingSuggestions((items) => items.filter((item) => item.id !== id));
      setMessage("Suggestion dismissed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Dismiss suggestion failed");
    }
  }

  async function recomputeConfidence(memoryId?: string): Promise<void> {
    try {
      const result = await api.recomputeConfidence(memoryId);
      setMessage(`Recomputed ${result.reports.length} confidence report${result.reports.length === 1 ? "" : "s"}.`);
      await refresh();
      if (memoryId) setSelectedConfidence(await api.confidence(memoryId));
      else setStats(await api.stats());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Confidence recompute failed");
    }
  }

  async function detectConflicts(): Promise<void> {
    try {
      const result = await api.detectConflicts();
      setMessage(`Detected ${result.conflicts.length} new conflict${result.conflicts.length === 1 ? "" : "s"}.`);
      setOpenConflicts(await api.conflicts("open"));
      setStats(await api.stats());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Conflict detection failed");
    }
  }

  async function resolveConflict(id: string): Promise<void> {
    try {
      await api.resolveConflict(id, { action: "dismiss", reason: "Dismissed from Memory Explorer" });
      setOpenConflicts(await api.conflicts("open"));
      setMessage("Conflict dismissed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Conflict resolution failed");
    }
  }

  async function openTrace(id: string): Promise<void> {
    try {
      setSelectedTrace(await api.trace(id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Trace failed to load");
    }
  }

  async function trySampleSearch(searchQuery: string): Promise<void> {
    setPage("memories");
    await runSearchFor(searchQuery);
  }

  const allTags = useMemo(() => Array.from(new Set(memories.flatMap((memory) => memory.tags))).sort(), [memories]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">AM</span>
          <div>
            <strong>Agent Memory</strong>
            <small>Explainable local memory</small>
          </div>
        </div>
        <nav aria-label="Primary">
          {pages.map((item) => (
            <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <strong>Local-first</strong>
          <span>SQLite storage, deterministic local ranking, replayable decisions.</span>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Inspectable memory devtool for coding agents</p>
            <h1>{pages.find((item) => item.id === page)?.label}</h1>
            <p>{subtitleFor(page)}</p>
          </div>
          <div className={`status ${status}`}>{status}</div>
        </header>

        {message ? (
          <div className="notice">
            <span>{message}</span>
            <button onClick={() => setMessage("")}>Dismiss</button>
          </div>
        ) : null}

        {status === "offline" ? (
          <section className="empty">
            <h2>API unavailable</h2>
            <p>Start the Fastify API on {api.baseUrl}, then retry.</p>
            <button onClick={() => void refresh()}>Retry</button>
          </section>
        ) : null}

        {page === "dashboard" && (
          <Dashboard
            stats={stats}
            onSeed={() => void seedDemo("stay")}
            onRefresh={() => void refresh()}
            onOpen={setPage}
            onSampleSearch={(value) => void trySampleSearch(value)}
            selectedTraceId={selectedTrace?.id}
          />
        )}
        {page === "memories" && (
          <MemoryExplorer
            memories={memories}
            query={query}
            setQuery={setQuery}
            runSearch={runSearch}
            kind={kind}
            setKind={setKind}
            tag={tag}
            setTag={setTag}
            tags={allTags}
            showArchived={showArchived}
            setShowArchived={setShowArchived}
            selected={selectedMemory}
            setSelected={setSelectedMemory}
            onPin={(memory) => void updateMemory(memory, { pinned: !memory.pinned })}
            onArchive={(memory) => void updateMemory(memory, { archived: !memory.archived })}
            onDelete={(memory) => void deleteMemory(memory)}
            onMerge={(memory, targetId) => void mergeMemory(memory, targetId)}
            onFix={(memory, type, patch, createRule) => void fixMemory(memory, type, patch, createRule)}
            feedback={selectedFeedback}
            confidence={selectedConfidence}
            conflicts={openConflicts}
            onRecomputeConfidence={(memory) => void recomputeConfidence(memory.id)}
            onDetectConflicts={() => void detectConflicts()}
            onResolveConflict={(id) => void resolveConflict(id)}
            retrievalResults={retrievalResults}
            onSampleSearch={(value) => void trySampleSearch(value)}
          />
        )}
        {page === "sessions" && (
          <SessionExplorer
            sessions={sessions}
            selected={selectedSession}
            suggestions={missingSuggestions}
            onSelect={(id) => void openSession(id)}
            onSeed={() => void seedDemo("sessions")}
            onRememberStep={(stepId, sessionId) => void rememberStep(stepId, sessionId)}
            onAnalyze={(sessionId) => void analyzeMissing(sessionId)}
            onAcceptSuggestion={(id) => void acceptMissing(id)}
            onDismissSuggestion={(id) => void dismissMissing(id)}
          />
        )}
        {page === "replay" && (
          <ReplayViewer
            traces={traces}
            selected={selectedTrace}
            onSelect={(id) => void openTrace(id)}
            onSeed={() => void seedDemo("replay")}
            onRememberDecision={(decisionId) => void rememberDecision(decisionId, selectedTrace?.id)}
            onWrongMerge={(decisionId, memoryId) => void fixWrongMerge(decisionId, memoryId, selectedTrace?.id)}
          />
        )}
        {page === "settings" && (
          <Settings
            apiUrl={apiUrl}
            setApiUrl={setApiUrl}
            save={() => {
              api.setBaseUrl(apiUrl);
              void refresh();
            }}
            onSeed={() => void seedDemo("stay")}
            stats={stats}
          />
        )}
      </main>
    </div>
  );
}

function Dashboard({
  stats,
  onSeed,
  onRefresh,
  onOpen,
  onSampleSearch,
  selectedTraceId
}: {
  stats: DashboardStats | null;
  onSeed: () => void;
  onRefresh: () => void;
  onOpen: (page: Page) => void;
  onSampleSearch: (query: string) => void;
  selectedTraceId?: string;
}): ReactElement {
  if (!stats) return <section className="empty">Loading dashboard...</section>;

  const hasDemoData = stats.sessions > 0 || stats.activeMemories > 0;
  const hasRetrieval = stats.retrievalActivity.some((item) => item.count > 0);
  const latestRetrieval = stats.recentTraces.find((trace) => trace.type === "retrieval");

  return (
    <section className="stack">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Open source memory inspector</p>
          <h2>See what your coding agent remembers, why it remembered it, and why it comes back later.</h2>
          <p>
            Agent Memory Devtools turns local agent context into searchable SQLite records with replay traces for ingestion,
            dedupe, merge, and retrieval decisions.
          </p>
        </div>
        <div className="hero-actions">
          <button className="primary" onClick={onSeed}>Load Demo Data</button>
          <button onClick={() => onSampleSearch(sampleQueries[0])}>Try Sample Search</button>
          <button onClick={onRefresh}>Refresh</button>
        </div>
      </section>

      <section className="getting-started">
        <div>
          <p className="eyebrow">Guided demo</p>
          <h2>60-second product tour</h2>
        </div>
        <div className="demo-steps">
          <DemoStep index={1} done={hasDemoData} title="Seed demo data" action="Load Demo Data" onClick={onSeed} />
          <DemoStep index={2} done={hasDemoData} title="Open Memory Explorer" action="Open Explorer" onClick={() => onOpen("memories")} />
          <DemoStep index={3} done={hasRetrieval} title="Run a sample search" action="Search" onClick={() => onSampleSearch(sampleQueries[0])} />
          <DemoStep
            index={4}
            done={Boolean(latestRetrieval ?? selectedTraceId)}
            title="Inspect replay trace"
            action="Open Replay"
            onClick={() => onOpen("replay")}
          />
        </div>
      </section>

      <div className="metrics">
        <Metric label="Active memories" value={stats.activeMemories} helper="Inspectable context records" />
        <Metric label="Pinned" value={stats.pinnedMemories} helper="Durable preferences" />
        <Metric label="Archived" value={stats.archivedMemories} helper="Hidden but retained" />
        <Metric label="Merged duplicates" value={stats.mergedMemories} helper="Noise collapsed" />
        <Metric label="Sessions" value={stats.sessions} helper="Ingested agent runs" />
        <Metric label="Replay traces" value={stats.traces} helper="Auditable decisions" />
        <Metric label="Low confidence" value={stats.health?.lowConfidence ?? 0} helper="Needs review" />
        <Metric label="Open conflicts" value={stats.health?.openConflicts ?? 0} helper="Contradictions" />
        <Metric label="Reinforced" value={stats.health?.recentlyReinforced ?? 0} helper="Used this week" />
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <PanelHeader title="Memory Counts by Kind" detail="Active, non-merged memories" />
          {Object.keys(stats.countsByKind).length ? (
            <div className="bars">
              {memoryKinds.map((kind) => (
                <div className="bar" key={kind}>
                  <span>{kind}</span>
                  <div><strong style={{ width: `${Math.max(10, (stats.countsByKind[kind] ?? 0) * 28)}px` }}>{stats.countsByKind[kind] ?? 0}</strong></div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No memories yet" body="Load demo data or ingest a transcript to see memory kinds." action="Load Demo Data" onClick={onSeed} />
          )}
        </section>

        <section className="panel">
          <PanelHeader title="Recent Sessions" detail="Latest ingested agent runs" />
          <div className="list compact">
            {stats.recentSessions.length ? (
              stats.recentSessions.map((session) => (
                <article key={session.id} className="row-card">
                  <strong>{session.title}</strong>
                  <span>{session.agent} - {formatDate(session.startedAt)}</span>
                </article>
              ))
            ) : (
              <EmptyState title="No sessions" body="Seed the demo to inspect session timelines and generated memories." action="Seed Demo" onClick={onSeed} />
            )}
          </div>
        </section>

        <section className="panel">
          <PanelHeader title="Duplicate and Merge Health" detail="Noise reduction outcomes" />
          <div className="stat-row">
            <MiniStat label="Duplicates found" value={stats.duplicateMemories} />
            <MiniStat label="Merged records" value={stats.mergedMemories} />
          </div>
          <TraceTeaser traces={stats.recentTraces.filter((trace) => trace.type === "ingestion")} empty="No ingestion traces yet." />
        </section>

        <section className="panel">
          <PanelHeader title="Retrieval Activity" detail="Search traces by day" />
          {stats.retrievalActivity.length ? (
            <div className="activity-list">
              {stats.retrievalActivity.slice(-5).map((item) => (
                <div className="activity-row" key={item.date}>
                  <span>{item.date}</span>
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No retrievals yet" body="Run a sample search to create an explainable ranking trace." action="Try Sample Search" onClick={() => onSampleSearch(sampleQueries[0])} />
          )}
        </section>
      </div>
    </section>
  );
}

function MemoryExplorer(props: {
  memories: Memory[];
  query: string;
  setQuery: (value: string) => void;
  runSearch: (event?: FormEvent) => void;
  kind: string;
  setKind: (value: string) => void;
  tag: string;
  setTag: (value: string) => void;
  tags: string[];
  showArchived: boolean;
  setShowArchived: (value: boolean) => void;
  selected: Memory | null;
  setSelected: (memory: Memory | null) => void;
  onPin: (memory: Memory) => void;
  onArchive: (memory: Memory) => void;
  onDelete: (memory: Memory) => void;
  onMerge: (memory: Memory, targetId: string) => void;
  onFix: (memory: Memory, type: string, patch?: Record<string, unknown>, createRule?: boolean) => void;
  feedback: MemoryFeedback[];
  confidence: MemoryConfidenceReport | null;
  conflicts: MemoryConflict[];
  onRecomputeConfidence: (memory: Memory) => void;
  onDetectConflicts: () => void;
  onResolveConflict: (id: string) => void;
  retrievalResults: RetrievalResult[];
  onSampleSearch: (query: string) => void;
}): ReactElement {
  const explanationById = new Map(props.retrievalResults.map((result) => [result.memory.id, result]));
  const [mergeTargetId, setMergeTargetId] = useState("");
  const selectedConflictIds = new Set(props.conflicts.filter((conflict) => props.selected?.id && conflict.memoryIds.includes(props.selected.id)).map((conflict) => conflict.id));

  return (
    <section className="explorer">
      <div className="filters">
        <form className="search-box" onSubmit={(event) => props.runSearch(event)}>
          <input
            value={props.query}
            onChange={(event) => props.setQuery(event.target.value)}
            placeholder='Search memories, for example "typescript zod api"'
            aria-label="Search memories"
          />
          <button className="primary" type="submit">Search</button>
        </form>
        <select value={props.kind} onChange={(event) => props.setKind(event.target.value)} aria-label="Filter by kind">
          <option value="">All kinds</option>
          {memoryKinds.map((kind) => (
            <option key={kind} value={kind}>{kind}</option>
          ))}
        </select>
        <select value={props.tag} onChange={(event) => props.setTag(event.target.value)} aria-label="Filter by tag">
          <option value="">All tags</option>
          {props.tags.map((tag) => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
        <label className="toggle">
          <input type="checkbox" checked={props.showArchived} onChange={(event) => props.setShowArchived(event.target.checked)} />
          Include archived
        </label>
        <span className="count">{props.memories.length} memories</span>
      </div>

      <div className="sample-strip">
        <span>Sample searches</span>
        {sampleQueries.map((item) => (
          <button key={item} onClick={() => props.onSampleSearch(item)}>{item}</button>
        ))}
      </div>

      <div className="split">
        <div className="table-wrap">
          {props.memories.length ? (
            <table>
              <thead>
                <tr>
                  <th>Memory</th>
                  <th>Signals</th>
                  <th>Explainability</th>
                  <th>Score</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {props.memories.map((memory) => {
                  const result = explanationById.get(memory.id);
                  return (
                    <tr key={memory.id} onClick={() => props.setSelected(memory)} className={props.selected?.id === memory.id ? "selected" : ""}>
                      <td className="memory-cell">
                        <strong>{memory.summary}</strong>
                        <small>{memory.content}</small>
                        <StateBadges memory={memory} />
                        <AutomationBadge memory={memory} />
                        <ConfidenceBadge memory={memory} conflicts={props.conflicts} />
                      </td>
                      <td>
                        <KindChip kind={memory.kind} />
                        <TagList tags={memory.tags} limit={4} />
                      </td>
                      <td className="why-cell">
                        <strong>{result ? result.explanation.reason : decisionReason(memory)}</strong>
                        <small>{result?.explanation.matchedTerms.length ? `Matched: ${result.explanation.matchedTerms.join(", ")}` : sourceLabel(memory)}</small>
                      </td>
                      <td>{result ? <Score value={result.score} /> : "-"}</td>
                      <td>
                        <div className="quick-actions">
                          <button title={memory.pinned ? "Unpin memory" : "Pin memory"} onClick={(event) => stop(event, () => props.onPin(memory))}>
                            {memory.pinned ? "Unpin" : "Pin"}
                          </button>
                          <button title={memory.archived ? "Restore memory" : "Archive memory"} onClick={(event) => stop(event, () => props.onArchive(memory))}>
                            {memory.archived ? "Restore" : "Archive"}
                          </button>
                          <button className="danger" title="Delete memory" onClick={(event) => stop(event, () => props.onDelete(memory))}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState
              title="No memories match this view"
              body="Load demo data, clear filters, or try one of the sample searches above."
              action="Try Sample Search"
              onClick={() => props.onSampleSearch(sampleQueries[0])}
            />
          )}
        </div>

        <aside className="detail">
          {props.selected ? (
            <>
              <div className="detail-heading">
                <div>
                  <KindChip kind={props.selected.kind} />
                  <h2>{props.selected.summary}</h2>
                  {isAutomaticMemory(props.selected) ? <p className="muted-copy">{automationSummary(props.selected)}</p> : null}
                </div>
                <StateBadges memory={props.selected} />
              </div>
              <p className="content-preview">{props.selected.content}</p>
              <div className="actions">
                <button onClick={() => props.onPin(props.selected!)}>{props.selected.pinned ? "Unpin" : "Pin"}</button>
                <button onClick={() => props.onArchive(props.selected!)}>{props.selected.archived ? "Restore" : "Archive"}</button>
                <button className="danger" onClick={() => props.onDelete(props.selected!)}>Delete</button>
              </div>

              <ExplanationCard title="Why this memory exists" tone="strong">
                <p>{decisionReason(props.selected)}</p>
                {isAutomaticMemory(props.selected) ? <p>{automationSummary(props.selected)}</p> : null}
                <div className="explain-facts">
                  <MiniStat label="Confidence" value={props.selected.confidence.toFixed(2)} />
                  <MiniStat label="Importance" value={props.selected.importance.toFixed(2)} />
                  <MiniStat label="Health" value={confidenceLabel(props.selected, props.conflicts)} />
                </div>
              </ExplanationCard>

              {props.confidence ? (
                <ExplanationCard title="Confidence">
                  <div className="actions">
                    <button onClick={() => props.onRecomputeConfidence(props.selected!)}>Recompute</button>
                    <button onClick={props.onDetectConflicts}>Detect conflicts</button>
                  </div>
                  <p>{props.confidence.label} confidence at {props.confidence.confidence.toFixed(2)}.</p>
                  <div className="score-breakdown">
                    {Object.entries(props.confidence.components).map(([name, component]) => (
                      <div className="score-row" key={name}>
                        <span>{name}</span>
                        <div><strong style={{ width: `${Math.max(4, component.contribution * 240)}px` }} /></div>
                        <em>{component.contribution.toFixed(2)}</em>
                      </div>
                    ))}
                  </div>
                  <p>Usage {props.confidence.usageCount}; conflicts {props.confidence.conflictIds.length}.</p>
                </ExplanationCard>
              ) : null}

              {selectedConflictIds.size ? (
                <section className="detail-section">
                  <h3>Open Conflicts</h3>
                  <div className="conflict-list">
                    {props.conflicts
                      .filter((conflict) => selectedConflictIds.has(conflict.id))
                      .map((conflict) => (
                        <article key={conflict.id}>
                          <strong>{conflict.summary}</strong>
                          <span>severity {conflict.severity.toFixed(2)} - {conflict.memoryIds.join(", ")}</span>
                          <button onClick={() => props.onResolveConflict(conflict.id)}>Dismiss</button>
                        </article>
                      ))}
                  </div>
                </section>
              ) : null}

              {explanationById.get(props.selected.id) ? (
                <ExplanationCard title="Why this memory was retrieved">
                  <p>{explanationById.get(props.selected.id)?.explanation.reason}</p>
                  <ScoreBreakdown result={explanationById.get(props.selected.id)!} />
                </ExplanationCard>
              ) : null}

              <section className="detail-section">
                <h3>Fix Memory</h3>
                <div className="fix-grid">
                  <button onClick={() => props.onFix(props.selected!, "boost-importance", {}, true)}>Boost importance</button>
                  <button onClick={() => props.onFix(props.selected!, "lower-importance", {}, true)}>Lower importance</button>
                  <button onClick={() => props.onFix(props.selected!, "should-not-remember", {}, true)}>Should not remember</button>
                  <button onClick={() => props.onFix(props.selected!, "wrong-kind", { kind: nextKind(props.selected!.kind) }, true)}>
                    Change kind to {nextKind(props.selected.kind)}
                  </button>
                </div>
                <div className="feedback-history">
                  {props.feedback.length ? (
                    props.feedback.slice(0, 5).map((item) => (
                      <article key={item.id}>
                        <strong>{item.type}</strong>
                        <span>{item.status} - {formatDate(item.createdAt)}</span>
                      </article>
                    ))
                  ) : (
                    <p className="muted-copy">No feedback recorded for this memory yet.</p>
                  )}
                </div>
              </section>

              <section className="detail-section">
                <h3>Tags and Source</h3>
                <TagList tags={props.selected.tags} limit={12} />
                <dl>
                  <dt>ID</dt><dd>{props.selected.id}</dd>
                  <dt>Source</dt><dd>{sourceLabel(props.selected)}</dd>
                  <dt>Capture</dt><dd>{isAutomaticMemory(props.selected) ? automationSource(memoryOrigin(props.selected)) : "manual or transcript ingest"}</dd>
                  <dt>Trigger</dt><dd>{automationTrigger(props.selected) ?? "none"}</dd>
                  <dt>Origin</dt><dd>{memoryOrigin(props.selected) ?? "session transcript"}</dd>
                  <dt>Evidence</dt><dd>{evidenceFiles(props.selected).join(", ") || "none"}</dd>
                  <dt>Session</dt><dd>{props.selected.relatedSessionId ?? "none"}</dd>
                  <dt>Created</dt><dd>{formatDate(props.selected.timestamp)}</dd>
                </dl>
              </section>

              <section className="detail-section">
                <h3>Dedupe and Merge</h3>
                <dl>
                  <dt>Duplicate of</dt><dd>{props.selected.duplicateOf ?? "none"}</dd>
                  <dt>Merged into</dt><dd>{props.selected.mergedInto ?? "none"}</dd>
                  <dt>Merged children</dt><dd>{mergedIds(props.selected).join(", ") || "none"}</dd>
                </dl>
                <div className="merge-box">
                  <input value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)} placeholder="Canonical memory id" />
                  <button onClick={() => props.onMerge(props.selected!, mergeTargetId)}>Merge</button>
                </div>
              </section>
            </>
          ) : (
            <EmptyState title="Select a memory" body="Inspect source, ranking factors, and the reason it was stored or merged." />
          )}
        </aside>
      </div>
    </section>
  );
}

function SessionExplorer({
  sessions,
  selected,
  suggestions,
  onSelect,
  onSeed,
  onRememberStep,
  onAnalyze,
  onAcceptSuggestion,
  onDismissSuggestion
}: {
  sessions: Session[];
  selected: SessionDetail | null;
  suggestions: MissingMemorySuggestion[];
  onSelect: (id: string) => void;
  onSeed: () => void;
  onRememberStep: (stepId: string, sessionId: string) => void;
  onAnalyze: (sessionId: string) => void;
  onAcceptSuggestion: (id: string) => void;
  onDismissSuggestion: (id: string) => void;
}): ReactElement {
  return (
    <section className="split">
      <div className="list-panel">
        <div className="toolbar">
          <button className="primary" onClick={onSeed}>Load Demo Data</button>
        </div>
        {sessions.length ? (
          sessions.map((session) => (
            <button key={session.id} className="session-row" onClick={() => onSelect(session.id)}>
              <strong>{session.title}</strong>
              <span>{session.agent} - {formatDate(session.startedAt)}</span>
              <TagList tags={session.tags} limit={4} />
            </button>
          ))
        ) : (
          <EmptyState title="No sessions yet" body="Load demo sessions to inspect timelines, extracted memories, and trace links." action="Load Demo Data" onClick={onSeed} />
        )}
      </div>
      <aside className="detail wide">
        {selected ? (
          <>
            <div className="detail-heading">
              <div>
                <p className="eyebrow">{selected.agent}</p>
                <h2>{selected.title}</h2>
              </div>
              <span className="pill">{formatDate(selected.startedAt)}</span>
            </div>
            <p>{selected.summary}</p>
            <div className="actions">
              <button className="primary" onClick={() => onAnalyze(selected.id)}>Analyze missing memories</button>
            </div>
            <h3>Missing memory suggestions</h3>
            <div className="suggestion-list">
              {suggestions.length ? (
                suggestions.map((suggestion) => (
                  <article className="suggestion-card" key={suggestion.id}>
                    <div className="rank-heading">
                      <KindChip kind={suggestion.kind} />
                      <div>
                        <strong>{suggestion.summary}</strong>
                        <span>{suggestion.reason}</span>
                      </div>
                      <Score value={suggestion.score} />
                    </div>
                    <p>{suggestion.content}</p>
                    <TagList tags={suggestion.tags} limit={5} />
                    {suggestion.evidence.length ? (
                      <div className="evidence-list">
                        {suggestion.evidence.slice(0, 3).map((evidence) => (
                          <small key={`${suggestion.id}-${evidence.stepId}`}>{evidence.reason}: {evidence.snippet}</small>
                        ))}
                      </div>
                    ) : null}
                    {suggestion.matchedMemoryIds.length ? <small>Possibly covered: {suggestion.matchedMemoryIds.join(", ")}</small> : null}
                    <div className="actions">
                      <button onClick={() => onAcceptSuggestion(suggestion.id)}>Accept</button>
                      <button onClick={() => onDismissSuggestion(suggestion.id)}>Dismiss</button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="muted-copy">No open suggestions for this session.</p>
              )}
            </div>
            <h3>Timeline</h3>
            <div className="timeline">
              {selected.steps.map((step) => (
                <article key={step.id}>
                  <span>{step.index + 1}</span>
                  <div>
                    <strong>{step.role}</strong>
                    <p>{step.content}</p>
                    <button onClick={() => onRememberStep(step.id, selected.id)}>Create memory</button>
                  </div>
                </article>
              ))}
            </div>
            <h3>Related memories</h3>
            <div className="list compact">
              {selected.memories.length ? (
                selected.memories.map((memory) => (
                  <article className="row-card" key={memory.id}>
                    <strong>{memory.summary}</strong>
                    <span>{memory.kind} - {decisionReason(memory)}</span>
                    <TagList tags={memory.tags} limit={5} />
                  </article>
                ))
              ) : (
                <EmptyState title="No memories from this session" body="This session did not produce durable memory records." />
              )}
            </div>
          </>
        ) : (
          <EmptyState title="Select a session" body="View the transcript timeline and the memories created from it." />
        )}
      </aside>
    </section>
  );
}

function ReplayViewer({
  traces,
  selected,
  onSelect,
  onSeed,
  onRememberDecision,
  onWrongMerge
}: {
  traces: ReplayTrace[];
  selected: ReplayTrace | null;
  onSelect: (id: string) => void;
  onSeed: () => void;
  onRememberDecision: (decisionId: string) => void;
  onWrongMerge: (decisionId: string, memoryId?: string) => void;
}): ReactElement {
  return (
    <section className="split replay-layout">
      <div className="list-panel">
        <div className="toolbar">
          <button className="primary" onClick={onSeed}>Load Demo Data</button>
        </div>
        {traces.length ? (
          traces.map((trace) => (
            <button key={trace.id} className={`session-row ${selected?.id === trace.id ? "active" : ""}`} onClick={() => onSelect(trace.id)}>
              <strong>{trace.title}</strong>
              <span>{trace.type} - {formatDate(trace.createdAt)}</span>
              <TraceOutcome trace={trace} />
            </button>
          ))
        ) : (
          <EmptyState title="No replay traces yet" body="Load demo data or run a search to create readable ingestion and retrieval traces." action="Load Demo Data" onClick={onSeed} />
        )}
      </div>
      <aside className="detail wide">
        {selected ? (
          <>
            <div className="detail-heading">
              <div>
                <p className="eyebrow">{selected.type} trace</p>
                <h2>{selected.title}</h2>
              </div>
              <span className="pill">{formatDate(selected.createdAt)}</span>
            </div>
            <div className="trace-meta">{selected.id}</div>

            <TraceSummary trace={selected} />

            <h3>Decision Pipeline</h3>
            <div className="pipeline">
              {selected.stages.map((stage, index) => (
                <PipelineStage key={`${stage.name}-${index}`} stage={stage} index={index + 1} />
              ))}
            </div>

            {selected.decisions.length ? (
              <>
                <h3>Store, Ignore, and Merge Decisions</h3>
                <div className="decision-list">
                  {selected.decisions.map((decision) => (
                    <article className={`decision-card ${decision.action}`} key={decision.id}>
                      <span>{decision.action}</span>
                      <strong>{decision.reason}</strong>
                      <small>
                        importance {decision.importance.toFixed(2)} - confidence {decision.confidence.toFixed(2)}
                        {decision.duplicateOf ? ` - merged into ${decision.duplicateOf}` : ""}
                      </small>
                      {decision.action === "ignore" ? <button onClick={() => onRememberDecision(decision.id)}>Remember this</button> : null}
                      {decision.action === "merge" ? <button onClick={() => onWrongMerge(decision.id, decision.memoryId)}>Wrong merge</button> : null}
                    </article>
                  ))}
                </div>
              </>
            ) : null}

            {selected.results.length ? (
              <>
                <h3>Ranked Results</h3>
                <div className="ranked-list">
                  {selected.results.map((result, index) => (
                    <article className="row-card" key={result.memory.id}>
                      <div className="rank-heading">
                        <span className="rank">#{index + 1}</span>
                        <div>
                          <strong>{result.memory.summary}</strong>
                          <span>{result.explanation.reason}</span>
                        </div>
                        <Score value={result.score} />
                      </div>
                      <ScoreBreakdown result={result} />
                    </article>
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <EmptyState title="No trace selected" body="Choose a replay trace to inspect the decision pipeline." />
        )}
      </aside>
    </section>
  );
}

function Settings({
  apiUrl,
  setApiUrl,
  save,
  onSeed,
  stats
}: {
  apiUrl: string;
  setApiUrl: (value: string) => void;
  save: () => void;
  onSeed: () => void;
  stats: DashboardStats | null;
}): ReactElement {
  return (
    <section className="settings">
      <label>
        API base URL
        <input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} />
      </label>
      <div className="actions">
        <button className="primary" onClick={save}>Save</button>
        <button onClick={onSeed}>Load Demo Data</button>
      </div>
      <ExplanationCard title="Local-first runtime">
        <dl>
          <dt>Embedding mode</dt><dd>local deterministic hash embeddings</dd>
          <dt>Storage</dt><dd>SQLite via better-sqlite3</dd>
          <dt>Current memories</dt><dd>{stats?.totalMemories ?? 0}</dd>
          <dt>Auth and cloud</dt><dd>intentionally out of scope for this local devtool</dd>
        </dl>
      </ExplanationCard>
    </section>
  );
}

function Metric({ label, value, helper }: { label: string; value: number; helper?: string }): ReactElement {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </article>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }): ReactElement {
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PanelHeader({ title, detail }: { title: string; detail: string }): ReactElement {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      <span>{detail}</span>
    </div>
  );
}

function DemoStep({ index, done, title, action, onClick }: { index: number; done: boolean; title: string; action: string; onClick: () => void }): ReactElement {
  return (
    <article className={done ? "demo-step done" : "demo-step"}>
      <span>{done ? "Done" : index}</span>
      <strong>{title}</strong>
      <button onClick={onClick}>{action}</button>
    </article>
  );
}

function EmptyState({ title, body, action, onClick }: { title: string; body: string; action?: string; onClick?: () => void }): ReactElement {
  return (
    <div className="empty">
      <div>
        <h2>{title}</h2>
        <p>{body}</p>
        {action && onClick ? <button className="primary" onClick={onClick}>{action}</button> : null}
      </div>
    </div>
  );
}

function ExplanationCard({ title, tone, children }: { title: string; tone?: "strong"; children: ReactNode }): ReactElement {
  return (
    <section className={tone === "strong" ? "explanation strong" : "explanation"}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function KindChip({ kind }: { kind: string }): ReactElement {
  return <span className={`chip kind-${kind.replace(/[^a-z]/g, "-")}`}>{kind}</span>;
}

function TagList({ tags, limit = 6 }: { tags: string[]; limit?: number }): ReactElement {
  const visible = tags.slice(0, limit);
  return (
    <div className="tag-list">
      {visible.map((item) => <span className="tag" key={item}>{item}</span>)}
      {tags.length > visible.length ? <span className="tag muted">+{tags.length - visible.length}</span> : null}
    </div>
  );
}

function StateBadges({ memory }: { memory: Memory }): ReactElement {
  const states = [
    memory.pinned ? "pinned" : undefined,
    memory.archived ? "archived" : undefined,
    memory.mergedInto ? "merged" : undefined,
    !memory.archived && !memory.mergedInto ? "active" : undefined
  ].filter(Boolean) as string[];
  return (
    <div className="state-badges">
      {states.map((state) => <span key={state}>{state}</span>)}
    </div>
  );
}

function AutomationBadge({ memory }: { memory: Memory }): ReactElement | null {
  if (!isAutomaticMemory(memory)) return null;
  return <span className="pill">automatic</span>;
}

function Score({ value }: { value: number }): ReactElement {
  return <span className="score">{value.toFixed(3)}</span>;
}

function ConfidenceBadge({ memory, conflicts }: { memory: Memory; conflicts: MemoryConflict[] }): ReactElement {
  const label = confidenceLabel(memory, conflicts);
  return <span className={`confidence-badge ${label}`}>{label}</span>;
}

function ScoreBreakdown({ result }: { result: RetrievalResult }): ReactElement {
  const components = Object.entries(result.explanation.components).sort((a, b) => b[1] - a[1]);
  return (
    <div className="score-breakdown">
      {components.map(([name, value]) => (
        <div className="score-row" key={name}>
          <span>{name}</span>
          <div><strong style={{ width: `${Math.max(4, value * 180)}px` }} /></div>
          <em>{value.toFixed(3)}</em>
        </div>
      ))}
      {result.explanation.matchedTerms.length ? (
        <p>Matched terms: {result.explanation.matchedTerms.join(", ")}</p>
      ) : (
        <p>No exact keyword match; ranked by local semantic similarity, recency, and boosts.</p>
      )}
    </div>
  );
}

function TraceSummary({ trace }: { trace: ReplayTrace }): ReactElement {
  const stored = trace.decisions.filter((decision) => decision.action === "store").length;
  const ignored = trace.decisions.filter((decision) => decision.action === "ignore").length;
  const merged = trace.decisions.filter((decision) => decision.action === "merge").length;
  const acceptedEvents = metadataList(trace.metadata, "acceptedEventIds").length;
  const ignoredEvents = metadataList(trace.metadata, "ignoredEventIds").length;
  return (
    <section className="trace-summary">
      {trace.type === "retrieval" ? (
        <>
          <MiniStat label="Ranked results" value={trace.results.length} />
          <MiniStat label="Query" value={String(trace.input.query ?? "")} />
          <MiniStat label="Top score" value={trace.results[0]?.score.toFixed(3) ?? "none"} />
        </>
      ) : (
        <>
          <MiniStat label="Stored" value={stored} />
          <MiniStat label="Ignored" value={ignored} />
          <MiniStat label="Merged" value={merged} />
          {trace.metadata?.automatic ? <MiniStat label="Auto accepted" value={acceptedEvents} /> : null}
          {trace.metadata?.automatic ? <MiniStat label="Auto ignored" value={ignoredEvents} /> : null}
        </>
      )}
    </section>
  );
}

function TraceOutcome({ trace }: { trace: ReplayTrace }): ReactElement {
  if (trace.type === "retrieval") return <span className="trace-outcome">{trace.results.length} ranked results</span>;
  const merged = trace.decisions.filter((decision) => decision.action === "merge").length;
  const ignored = trace.decisions.filter((decision) => decision.action === "ignore").length;
  const stored = trace.decisions.filter((decision) => decision.action === "store").length;
  return <span className="trace-outcome">{stored} stored - {merged} merged - {ignored} ignored</span>;
}

function PipelineStage({ stage, index }: { stage: ReplayStage; index: number }): ReactElement {
  return (
    <article className="pipeline-stage">
      <span>{index}</span>
      <div>
        <strong>{stage.name}</strong>
        <p>{stage.summary}</p>
        {stage.items?.length ? <StageItems stage={stage} /> : null}
      </div>
    </article>
  );
}

function StageItems({ stage }: { stage: ReplayStage }): ReactElement {
  return (
    <div className="stage-items">
      {stage.items?.slice(0, 6).map((item, index) => {
        const row = item as Record<string, unknown>;
        return (
          <article key={index}>
            <strong>{stageItemTitle(row, index)}</strong>
            <span>{stageItemDetail(row)}</span>
            {typeof row.components === "object" && row.components ? <ComponentInline components={row.components as Record<string, number>} /> : null}
          </article>
        );
      })}
      {(stage.items?.length ?? 0) > 6 ? <small>{(stage.items?.length ?? 0) - 6} more items hidden for scanability.</small> : null}
    </div>
  );
}

function ComponentInline({ components }: { components: Record<string, number> }): ReactElement {
  return (
    <div className="component-inline">
      {Object.entries(components).map(([name, value]) => (
        <span key={name}>{name}: {value.toFixed(3)}</span>
      ))}
    </div>
  );
}

function TraceTeaser({ traces, empty }: { traces: ReplayTrace[]; empty: string }): ReactElement {
  if (!traces.length) return <p className="muted-copy">{empty}</p>;
  return (
    <div className="list compact">
      {traces.slice(0, 3).map((trace) => (
        <article className="row-card" key={trace.id}>
          <strong>{trace.title}</strong>
          <TraceOutcome trace={trace} />
        </article>
      ))}
    </div>
  );
}

function stageItemTitle(row: Record<string, unknown>, index: number): string {
  if (typeof row.action === "string") return row.action;
  if (typeof row.type === "string") return row.type;
  if (typeof row.kind === "string") return row.kind;
  if (typeof row.memoryId === "string") return row.memoryId;
  if (typeof row.id === "string") return row.id;
  return `Item ${index + 1}`;
}

function stageItemDetail(row: Record<string, unknown>): string {
  if (typeof row.reason === "string") return row.reason;
  if (typeof row.summary === "string") return row.summary;
  if (typeof row.content === "string") return row.content;
  if (typeof row.score === "number") return `score ${row.score.toFixed(3)}`;
  return Object.entries(row)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" - ");
}

function sourceLabel(memory: Memory): string {
  return [memory.source.agent ?? "unknown", memory.source.type, memory.source.label].filter(Boolean).join(" / ");
}

function isAutomaticMemory(memory: Memory): boolean {
  return memory.source.type === "hook" || memory.source.type === "automation" || memory.source.metadata?.automatic === true;
}

function automationTrigger(memory: Memory): string | undefined {
  const value = memory.metadata?.automationTrigger ?? memory.source.metadata?.trigger;
  return typeof value === "string" ? value : undefined;
}

function memoryOrigin(memory: Memory): string | undefined {
  const value = memory.metadata?.sourceEventType;
  return typeof value === "string" ? value : undefined;
}

function automationSource(origin: string | undefined): string {
  return origin ?? "automatic workflow";
}

function automationSummary(memory: Memory): string {
  const parts = [memory.source.agent ?? "agent", automationTrigger(memory), memoryOrigin(memory)].filter(Boolean);
  return `Automatic capture from ${parts.join(" / ")}.`;
}

function evidenceFiles(memory: Memory): string[] {
  const value = memory.metadata?.filePaths;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function decisionReason(memory: Memory): string {
  const reason = memory.metadata?.decisionReason;
  return typeof reason === "string" ? reason : "Stored as durable context from an ingested agent session.";
}

function mergedIds(memory: Memory): string[] {
  const value = memory.metadata?.mergedDuplicateIds;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function metadataList(metadata: Record<string, unknown> | undefined, key: string): string[] {
  const value = metadata?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function nextKind(kind: string): string {
  const index = memoryKinds.indexOf(kind);
  return memoryKinds[(index + 1) % memoryKinds.length] ?? "summary";
}

function confidenceLabel(memory: Memory, conflicts: MemoryConflict[]): string {
  if (conflicts.some((conflict) => conflict.memoryIds.includes(memory.id))) return "conflicted";
  const label = memory.metadata?.confidenceLabel;
  if (typeof label === "string") return label;
  const ageDays = Math.max(0, (Date.now() - Date.parse(memory.timestamp)) / 86_400_000);
  if (memory.confidence < 0.45) return "low";
  if (ageDays > 120) return "stale";
  return memory.confidence >= 0.72 ? "high" : "medium";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function stop(event: MouseEvent, action: () => void): void {
  event.stopPropagation();
  action();
}

function subtitleFor(page: Page): string {
  switch (page) {
    case "dashboard":
      return "The health, activity, and demo path for local explainable memory.";
    case "memories":
      return "Search, inspect, and act on remembered coding-agent context.";
    case "sessions":
      return "Replay the sessions that produced memories.";
    case "replay":
      return "Read ingestion, dedupe, merge, ignore, and retrieval decisions.";
    case "settings":
      return "Local API and storage configuration.";
  }
}
