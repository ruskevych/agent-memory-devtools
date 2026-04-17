import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface OnboardResult {
  dir: string;
  created: string[];
  skipped: string[];
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function claudeSettingsTemplate(): string {
  return JSON.stringify(
    {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-memory-hook.mjs" user-prompt-context',
                timeout: 8,
                statusMessage: "Loading relevant memory context"
              }
            ]
          },
          {
            hooks: [
              {
                type: "command",
                command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-memory-hook.mjs" user-prompt',
                async: true,
                timeout: 20,
                statusMessage: "Capturing durable prompt memory"
              }
            ]
          }
        ],
        PostToolUse: [
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [
              {
                type: "command",
                command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-memory-hook.mjs" post-tool',
                async: true,
                timeout: 10,
                statusMessage: "Tracking changed files for memory capture"
              }
            ]
          }
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-memory-hook.mjs" stop',
                async: true,
                timeout: 20,
                statusMessage: "Capturing automatic memory summary"
              }
            ]
          }
        ],
        TaskCompleted: [
          {
            hooks: [
              {
                type: "command",
                command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-memory-hook.mjs" task-complete',
                async: true,
                timeout: 20,
                statusMessage: "Capturing completed task memory"
              }
            ]
          }
        ],
        SessionEnd: [
          {
            hooks: [
              {
                type: "command",
                command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-memory-hook.mjs" session-end',
                async: true,
                timeout: 10,
                statusMessage: "Flushing pending memory capture"
              }
            ]
          }
        ]
      }
    },
    null,
    2
  ) + "\n";
}

export const HOOK_SCRIPT_TEMPLATE = `import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const mode = process.argv[2];
const input = await readJsonStdin();
const workspaceRoot = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const apiUrl = process.env.AGENT_MEMORY_API_URL || "http://127.0.0.1:4317";
const sessionId = typeof input.session_id === "string" ? input.session_id : "unknown-session";

if (mode === "user-prompt-context") {
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!prompt.trim()) process.exit(0);
  const context = await retrieveContext(prompt);
  if (context) process.stdout.write(JSON.stringify({ context }));
  process.exit(0);
}

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
  /\\b(built|created|developed|generated|implemented|initialized|introduced|scaffolded|bootstrapped|wrote|added|adjusted|changed|enhanced|extended|improved|modified|refactored|reorganized|restructured|revised|simplified|standardized|tweaked|updated|addressed|corrected|debugged|fixed|handled|patched|repaired|resolved|squashed|archived|cleaned|deleted|deprecated|dropped|eliminated|pruned|purged|removed|deployed|landed|merged|migrated|published|released|shipped|configured|connected|disabled|enabled|integrated|installed|linked|registered|set up|toggled|wired|consolidated|converted|downgraded|extracted|moved|optimized|ported|renamed|replaced|reverted|split|synchronized|upgraded|exported|imported|injected|completed|finalized|finished)\\b/i;

function extractMeaningfulSummary(text) {
  const sentences = text
    .split(/(?<=[.!])\\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && COMPLETION_VERB_RE.test(s));
  return sentences.length ? sentences.join(" ") : "";
}

async function retrieveContext(query) {
  try {
    const response = await fetch(\`\${apiUrl}/search\`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, limit: 5 })
    });
    if (!response.ok) return "";
    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) return "";
    const lines = results.map((r) => {
      const score = typeof r.score === "number" ? \` (\${r.score.toFixed(2)})\` : "";
      const kind = r.memory?.kind ? \`[\${r.memory.kind}] \` : "";
      const content = r.memory?.summary || r.memory?.content || "";
      return \`• \${kind}\${content}\${score}\`;
    });
    return \`Relevant project memory:\\n\${lines.join("\\n")}\`;
  } catch {
    return "";
  }
}

async function captureEvents(events) {
  try {
    const response = await fetch(\`\${apiUrl}/automation/capture\`, {
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
  return join(homedir(), ".agent-memory", "claude-hooks", workspaceHash, \`\${sessionId}.json\`);
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
    !value.includes("\\n") &&
    /[./]/.test(value) &&
    !/(^|\\/)(node_modules|dist|coverage|\\.git)(\\/|$)/.test(value)
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
`;

export const CLAUDE_SKILL_TEMPLATE = `---
name: memory-capture
description: Use when Claude Code work should create, verify, or correct local memory capture in Agent Memory Devtools.
---

# Memory-Capture Skill – Agent Memory Devtools

You are using **Agent Memory Devtools** — a local SQLite memory layer for durable project knowledge.

## SYNC INSTRUCTION

> **When you receive any of these:** "sync memory skill", "sync all MD files", "adapt memory to this project", "initialize memory" — execute the steps below immediately and completely. No confirmation needed.

**Execute now:**

1. Read \`package.json\`, \`README.md\`, and the top-level folder structure. Scan key source files to understand the tech stack, architecture, conventions, and build/test commands.

2. Rewrite **\`CLAUDE.md\`** with real content:
   - Actual build, test, lint, and dev-server commands (from \`package.json\` scripts)
   - High-level architecture: key folders, packages/apps, data flow, design constraints
   - Non-obvious conventions, gotchas, important decisions

3. Rewrite **\`AGENTS.md\`** with real content:
   - Project-specific constraints and important files for agents to know
   - Actual validation commands

4. Rewrite **\`.claude/skills/memory-capture/SKILL.md\`** with project-specific capture rules:
   - Real file paths, real command names, real decisions worth remembering
   - Project-specific durable signals and naming conventions
   - Remove the SYNC INSTRUCTION section

5. Rewrite **\`.agents/skills/memory-capture/SKILL.md\`** with the same project-specific content adapted for Codex (no hooks — explicit capture only). Remove the SYNC INSTRUCTION section.

6. Capture the baseline with two commands (run both):
   \`\`\`bash
   agent-memory capture session --summary "Initialized <project name> memory baseline. Stack: <tech stack>. Key files: <2-3 critical paths>."
   agent-memory capture session --summary "We always capture: <list the 3-4 project-specific capture rules you added above>."
   \`\`\`

7. Confirm: "Synced for <project name>. Key signals: <2–3 bullets of what you learned>."

---

## 1. Memory Using (every new request — ALWAYS first)

Hooks automatically inject relevant memory before each prompt when the API is running.

Manual check when hooks are off or context feels wrong:
\`\`\`bash
agent-memory context "<2-4 keywords from the request>"
\`\`\`

## 2. Memory Saving

Hooks capture prompts, file edits, task completions, and session ends automatically.

Explicit capture for high-importance decisions hooks might miss:
\`\`\`bash
agent-memory capture changes --summary "<what changed and why>"
agent-memory capture session --summary "<checkpoint: decisions + remaining work>"
\`\`\`

Fix bad captures immediately:
\`\`\`bash
agent-memory fix remember <id> --rule
agent-memory fix forget <id> --rule
\`\`\`

**Capture rules** (add project-specific ones here after sync):
- Kinds: \`fact\`, \`preference\`, \`codebase-context\`, \`task-context\`
- Include evidence: file paths, routes, schemas, CLI commands

## 3. Golden Rules

- Search first, act second.
- Capture last.
- Prefer memory over repetition: "Per memory ID X: …"
`;

export const CODEX_SKILL_TEMPLATE = `---
name: memory-capture
description: Use when a Codex task changes durable repo behavior, introduces important codebase context, or reaches a meaningful checkpoint that should become memory.
---

# Memory-Capture Skill – Agent Memory Devtools

You are using **Agent Memory Devtools** — a local SQLite memory layer for durable project knowledge.

## SYNC INSTRUCTION

> **When you receive any of these:** "sync memory skill", "sync all MD files", "adapt memory to this project", "initialize memory" — execute the steps below immediately and completely. No confirmation needed.

**Execute now:**

1. Read \`package.json\`, \`README.md\`, and the top-level folder structure. Scan key source files to understand the tech stack, architecture, conventions, and build/test commands.

2. Rewrite **\`AGENTS.md\`** with real content:
   - Project-specific constraints and important files for agents to know
   - Actual validation commands

3. Rewrite **\`CLAUDE.md\`** with real content:
   - Actual build, test, lint, and dev-server commands
   - High-level architecture: key folders, data flow, design constraints
   - Non-obvious conventions and important decisions

4. Rewrite **\`.agents/skills/memory-capture/SKILL.md\`** with project-specific capture rules:
   - Real file paths, real command names, real decisions worth remembering
   - Project-specific durable signals and naming conventions
   - Remove the SYNC INSTRUCTION section

5. Rewrite **\`.claude/skills/memory-capture/SKILL.md\`** with the same project-specific content adapted for Claude Code (hooks are automatic — focus on the explicit capture cases). Remove the SYNC INSTRUCTION section.

6. Capture the baseline with two commands (run both):
   \`\`\`bash
   agent-memory capture session --tool codex --summary "Initialized <project name> memory baseline. Stack: <tech stack>. Key files: <2-3 critical paths>."
   agent-memory capture session --tool codex --summary "We always capture: <list the 3-4 project-specific capture rules you added above>."
   \`\`\`

7. Confirm: "Synced for <project name>. Key signals: <2–3 bullets of what you learned>."

---

## 1. Memory Using (every new session — ALWAYS first)

\`\`\`bash
agent-memory context "<2-4 keywords from your current task>"
\`\`\`

Read before planning. If context feels missing: \`agent-memory analyze-missing --refresh\`

## 2. Memory Saving (explicit — no automatic hooks)

After file changes or architecture decisions:
\`\`\`bash
agent-memory capture changes --tool codex --summary "<what changed and why>"
\`\`\`

At the end of a task or session:
\`\`\`bash
agent-memory capture session --tool codex --summary "<checkpoint: decisions + remaining work>"
\`\`\`

Fix bad captures immediately:
\`\`\`bash
agent-memory fix remember <id> --rule
agent-memory fix forget <id> --rule
\`\`\`

**Capture rules** (add project-specific ones here after sync):
- Kinds: \`fact\`, \`preference\`, \`codebase-context\`, \`task-context\`
- Include evidence: file paths, routes, schemas, CLI commands

## 3. Golden Rules

- Search first, act second.
- Capture last.
- Prefer memory over repetition: "Per memory ID X: …"
`;

export const CLAUDE_MD_TEMPLATE = `# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- SYNC: This file was generated by \`agent-memory onboard\`. Send "sync all MD files with this project" to Claude Code to replace this with real project content. -->

## Commands

\`\`\`bash
# Fill in after sync: build, test, lint, dev server commands
\`\`\`

## Architecture

Fill in after sync: high-level structure, key packages/apps, data flow, and design constraints.

## Development Notes

Fill in after sync: important conventions, gotchas, and non-obvious decisions.
`;

export const AGENTS_MD_TEMPLATE = `# Agent Instructions

<!-- SYNC: This file was generated by \`agent-memory onboard\`. Send "sync all MD files with this project" to Claude Code or Codex to replace this with real project content. -->

## Working In This Repo

Fill in after sync: key constraints, package boundaries, important files to know.

## Codex Workflow

**At the start of every session:**
\`\`\`bash
agent-memory context "<keywords from your task>"
\`\`\`

After meaningful changes:
\`\`\`bash
agent-memory capture changes --tool codex --summary "<what changed and why>"
\`\`\`

## Claude Code Workflow

Hooks capture prompts, edits, and summaries automatically. Use explicit capture only for high-importance decisions.

## Validation

Fill in after sync: build, test, and lint commands for this project.
`;

// ---------------------------------------------------------------------------
// Onboard logic
// ---------------------------------------------------------------------------

const FILES: Array<{ rel: string; content: () => string }> = [
  { rel: ".claude/settings.json", content: claudeSettingsTemplate },
  { rel: ".claude/hooks/agent-memory-hook.mjs", content: () => HOOK_SCRIPT_TEMPLATE },
  { rel: ".claude/skills/memory-capture/SKILL.md", content: () => CLAUDE_SKILL_TEMPLATE },
  { rel: ".agents/skills/memory-capture/SKILL.md", content: () => CODEX_SKILL_TEMPLATE },
  { rel: "CLAUDE.md", content: () => CLAUDE_MD_TEMPLATE },
  { rel: "AGENTS.md", content: () => AGENTS_MD_TEMPLATE }
];

export function onboard(dir: string, force = false): OnboardResult {
  const created: string[] = [];
  const skipped: string[] = [];

  for (const { rel, content } of FILES) {
    const abs = join(dir, rel);
    if (!force && existsSync(abs)) {
      skipped.push(rel);
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content(), "utf8");
    created.push(rel);
  }

  return { dir, created, skipped };
}
