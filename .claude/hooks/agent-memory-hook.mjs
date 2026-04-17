import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const mode = process.argv[2];
const input = await readJsonStdin();
const workspaceRoot = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const apiUrl = process.env.AGENT_MEMORY_API_URL || "http://127.0.0.1:4317";
const sessionId = typeof input.session_id === "string" ? input.session_id : "unknown-session";

if (mode === "user-prompt") {
  await captureEvents([
    {
      type: "user-prompt",
      tool: "claude-code",
      trigger: "hook",
      automatic: true,
      sessionId,
      cwd: workspaceRoot,
      content: typeof input.prompt === "string" ? input.prompt : "",
      metadata: baseMetadata(input)
    }
  ]);
  process.exit(0);
}

if (mode === "user-prompt-context") {
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!prompt.trim()) process.exit(0);
  const context = await retrieveContext(prompt);
  if (context) process.stdout.write(JSON.stringify({ context }));
  process.exit(0);
}

if (mode === "post-tool") {
  const next = pendingState();
  for (const filePath of extractPaths(input.tool_input, workspaceRoot)) {
    if (!next.files.includes(filePath)) next.files.push(filePath);
  }
  savePendingState(next);
  process.exit(0);
}

if (mode === "task-complete") {
  const content = [input.task_subject, input.task_description].filter((value) => typeof value === "string" && value.trim()).join(". ");
  if (!content) process.exit(0);
  await captureEvents([
    {
      type: "task-complete",
      tool: "claude-code",
      trigger: "hook",
      automatic: true,
      sessionId,
      cwd: workspaceRoot,
      content,
      metadata: {
        ...baseMetadata(input),
        taskSubject: typeof input.task_subject === "string" ? input.task_subject : undefined,
        taskDescription: typeof input.task_description === "string" ? input.task_description : undefined
      }
    }
  ]);
  process.exit(0);
}

if (mode === "stop" || mode === "session-end") {
  const pending = pendingState();
  const events = [];
  if (typeof input.last_assistant_message === "string" && input.last_assistant_message.trim()) {
    const summaryContent = extractMeaningfulSummary(input.last_assistant_message);
    if (summaryContent) {
      events.push({
        type: "agent-summary",
        tool: "claude-code",
        trigger: "hook",
        automatic: true,
        sessionId,
        cwd: workspaceRoot,
        content: summaryContent,
        metadata: baseMetadata(input)
      });
    }
  }
  if (pending.files.length) {
    events.push({
      type: "file-change",
      tool: "claude-code",
      trigger: "hook",
      automatic: true,
      sessionId,
      cwd: workspaceRoot,
      files: pending.files.map((filePath) => ({
        path: filePath,
        changeType: existsSync(resolve(workspaceRoot, filePath)) ? "modified" : "deleted",
        metadata: {
          hash: fileHash(resolve(workspaceRoot, filePath))
        }
      })),
      metadata: baseMetadata(input)
    });
  }
  if (!events.length) process.exit(0);
  const ok = await captureEvents(events);
  if (ok) clearPendingState();
  process.exit(0);
}

process.exit(0);

const COMPLETION_VERB_RE =
  /\b(built|created|developed|generated|implemented|initialized|introduced|scaffolded|bootstrapped|wrote|added|adjusted|changed|enhanced|extended|improved|modified|refactored|reorganized|restructured|revised|simplified|standardized|tweaked|updated|addressed|corrected|debugged|fixed|handled|patched|repaired|resolved|squashed|archived|cleaned|deleted|deprecated|dropped|eliminated|pruned|purged|removed|deployed|landed|merged|migrated|published|released|shipped|configured|connected|disabled|enabled|integrated|installed|linked|registered|set up|toggled|wired|consolidated|converted|downgraded|extracted|moved|optimized|ported|renamed|replaced|reverted|split|synchronized|upgraded|exported|imported|injected|completed|finalized|finished)\b/i;

function extractMeaningfulSummary(text) {
  const sentences = text
    .split(/(?<=[.!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && COMPLETION_VERB_RE.test(s));
  return sentences.length ? sentences.join(" ") : "";
}

async function captureEvents(events) {
  try {
    const response = await fetch(`${apiUrl}/automation/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session: {
          id: sessionId,
          agent: "claude-code",
          title: sessionTitle(events)
        },
        source: {
          type: "hook",
          agent: "claude-code",
          label: "Claude Code automatic capture",
          path: workspaceRoot,
          metadata: {
            hookEventNames: [...new Set(events.map((event) => event.metadata?.hookEventName).filter(Boolean))]
          }
        },
        events
      })
    });
    return response.ok;
  } catch {
    return false;
  }
}

function sessionTitle(events) {
  const first = events[0];
  if (!first) return "Claude Code automatic capture";
  if (first.type === "file-change") return "Claude Code code-change capture";
  const content = typeof first.content === "string" ? first.content : first.type;
  return content.slice(0, 80);
}

function baseMetadata(hookInput) {
  return {
    hookEventName: hookInput.hook_event_name,
    transcriptPath: hookInput.transcript_path,
    permissionMode: hookInput.permission_mode
  };
}

function pendingStatePath() {
  const workspaceHash = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 12);
  return join(homedir(), ".agent-memory", "claude-hooks", workspaceHash, `${sessionId}.json`);
}

function pendingState() {
  const path = pendingStatePath();
  if (!existsSync(path)) return { files: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { files: [] };
  }
}

function savePendingState(value) {
  const path = pendingStatePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ files: value.files, updatedAt: new Date().toISOString() }, null, 2));
}

function clearPendingState() {
  const path = pendingStatePath();
  if (existsSync(path)) unlinkSync(path);
}

function extractPaths(value, root, found = new Set()) {
  if (typeof value === "string") {
    const normalized = value.startsWith(root) ? relative(root, value) : value;
    if (looksLikeWorkspacePath(normalized)) found.add(normalized);
    return [...found];
  }
  if (Array.isArray(value)) {
    for (const item of value) extractPaths(item, root, found);
    return [...found];
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) extractPaths(entry, root, found);
  }
  return [...found];
}

function looksLikeWorkspacePath(value) {
  return (
    typeof value === "string" &&
    value.length > 2 &&
    !value.startsWith("http") &&
    !value.startsWith("npm ") &&
    !value.includes("\n") &&
    /[./]/.test(value) &&
    !/(^|\/)(node_modules|dist|coverage|\.git)(\/|$)/.test(value)
  );
}

function fileHash(filePath) {
  try {
    if (!existsSync(filePath)) return "deleted";
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
  } catch {
    return "unreadable";
  }
}

async function retrieveContext(query) {
  try {
    const response = await fetch(`${apiUrl}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, limit: 5 })
    });
    if (!response.ok) return "";
    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) return "";
    const lines = results.map((r) => {
      const score = typeof r.score === "number" ? ` (${r.score.toFixed(2)})` : "";
      const kind = r.memory?.kind ? `[${r.memory.kind}] ` : "";
      const content = r.memory?.summary || r.memory?.content || "";
      return `• ${kind}${content}${score}`;
    });
    return `Relevant project memory:\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}

async function readJsonStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(chunks.join(""));
  } catch {
    return {};
  }
}
