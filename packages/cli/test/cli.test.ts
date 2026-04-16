import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildFileChangeEvent } from "../src/change-capture.js";
import { detectIntegrationStatus, installClaudeHooks } from "../src/integration.js";

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "agent-memory-cli-test-"));
}

describe("change capture helpers", () => {
  it("summarizes CLI command changes as file-change events", () => {
    const workspace = makeWorkspace();
    const filePath = join(workspace, "packages/cli/src");
    mkdirSync(filePath, { recursive: true });
    writeFileSync(
      join(filePath, "index.ts"),
      'program.command("integrate")\nprogram.command("capture")\nprogram.command("watch")\n',
      "utf8"
    );

    const event = buildFileChangeEvent({
      workspaceRoot: workspace,
      files: ["packages/cli/src/index.ts"],
      tool: "codex",
      trigger: "cli"
    });

    expect(event?.type).toBe("file-change");
    expect(event?.summary).toMatch(/CLI/i);
    expect(event?.files[0]?.summary).toMatch(/integrate|capture|watch/i);
  });

  it("keeps agent instruction changes visible to automation capture", () => {
    const workspace = makeWorkspace();
    writeFileSync(join(workspace, "AGENTS.md"), "# Agent instructions\nUse memory capture.\n", "utf8");

    const event = buildFileChangeEvent({
      workspaceRoot: workspace,
      files: ["AGENTS.md"],
      tool: "codex",
      trigger: "cli"
    });

    expect(event?.files[0]?.summary).toMatch(/instruction|memory capture/i);
  });
});

describe("integration helpers", () => {
  it("writes the committed Claude hook settings file", () => {
    const workspace = makeWorkspace();
    const result = installClaudeHooks(workspace);

    expect(result.changed).toBe(true);
    const content = readFileSync(result.path, "utf8");
    expect(content).toMatch(/UserPromptSubmit/);
    expect(content).toMatch(/agent-memory-hook\.mjs/);
  });

  it("reports Codex and Claude integration files", () => {
    const workspace = makeWorkspace();
    mkdirSync(join(workspace, ".agents/skills/memory-capture"), { recursive: true });
    mkdirSync(join(workspace, ".claude/skills/memory-capture"), { recursive: true });
    mkdirSync(join(workspace, ".claude/hooks"), { recursive: true });
    mkdirSync(join(workspace, "docs"), { recursive: true });
    writeFileSync(join(workspace, "AGENTS.md"), "", "utf8");
    writeFileSync(join(workspace, "CLAUDE.md"), "", "utf8");
    writeFileSync(join(workspace, ".agents/skills/memory-capture/SKILL.md"), "", "utf8");
    writeFileSync(join(workspace, ".claude/skills/memory-capture/SKILL.md"), "", "utf8");
    writeFileSync(join(workspace, ".claude/hooks/agent-memory-hook.mjs"), "", "utf8");
    writeFileSync(join(workspace, ".claude/settings.json"), "{}", "utf8");
    writeFileSync(join(workspace, "docs/codex-integration.md"), "", "utf8");
    writeFileSync(join(workspace, "docs/claude-code-integration.md"), "", "utf8");

    const status = detectIntegrationStatus(workspace);

    expect(status.codex.agentsInstructions).toBe(true);
    expect(status.codex.memorySkill).toBe(true);
    expect(status.claude.settings).toBe(true);
    expect(status.claude.hookScript).toBe(true);
  });
});
