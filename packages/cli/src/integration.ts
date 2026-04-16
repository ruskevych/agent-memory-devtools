import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface IntegrationStatus {
  workspaceRoot: string;
  codex: {
    agentsInstructions: boolean;
    memorySkill: boolean;
    integrationDoc: boolean;
  };
  claude: {
    claudeInstructions: boolean;
    memorySkill: boolean;
    settings: boolean;
    hookScript: boolean;
    integrationDoc: boolean;
  };
}

export function claudeHookSettings(): Record<string, unknown> {
  return {
    hooks: {
      UserPromptSubmit: [
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
  };
}

export function installClaudeHooks(workspaceRoot: string): { path: string; changed: boolean } {
  const path = join(workspaceRoot, ".claude/settings.json");
  const next = `${JSON.stringify(claudeHookSettings(), null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (current === next) return { path, changed: false };
  writeFileSync(path, next, "utf8");
  return { path, changed: true };
}

export function detectIntegrationStatus(workspaceRoot: string): IntegrationStatus {
  return {
    workspaceRoot,
    codex: {
      agentsInstructions: existsSync(join(workspaceRoot, "AGENTS.md")),
      memorySkill: existsSync(join(workspaceRoot, ".agents/skills/memory-capture/SKILL.md")),
      integrationDoc: existsSync(join(workspaceRoot, "docs/codex-integration.md"))
    },
    claude: {
      claudeInstructions: existsSync(join(workspaceRoot, "CLAUDE.md")),
      memorySkill: existsSync(join(workspaceRoot, ".claude/skills/memory-capture/SKILL.md")),
      settings: existsSync(join(workspaceRoot, ".claude/settings.json")),
      hookScript: existsSync(join(workspaceRoot, ".claude/hooks/agent-memory-hook.mjs")),
      integrationDoc: existsSync(join(workspaceRoot, "docs/claude-code-integration.md"))
    }
  };
}
