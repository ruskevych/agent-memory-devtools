import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { AutomationEventInput, AutomationFileChange, AutomationTool, AutomationTrigger, Metadata } from "@agent-memory/shared";
import { hashText, summarize, unique } from "@agent-memory/memory-core";

export interface FileChangeCaptureOptions {
  workspaceRoot: string;
  files?: string[];
  tool: AutomationTool;
  trigger: AutomationTrigger;
  sessionId?: string;
  metadata?: Metadata;
}

export function collectChangedFiles(workspaceRoot: string): string[] {
  const output = runGit(workspaceRoot, ["status", "--short", "--untracked-files=all"]);
  if (!output) return [];
  return unique(
    output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .map((path) => path.split(" -> ").at(-1) ?? path)
      .filter((path) => !shouldIgnorePath(path))
  );
}

export function describeChangedFiles(workspaceRoot: string, files: string[]): AutomationFileChange[] {
  return files
    .map((file) => describeChangedFile(workspaceRoot, file))
    .filter((file): file is AutomationFileChange => Boolean(file));
}

export function buildFileChangeEvent(options: FileChangeCaptureOptions): AutomationEventInput | undefined {
  const files = describeChangedFiles(options.workspaceRoot, options.files?.length ? options.files : collectChangedFiles(options.workspaceRoot));
  if (!files.length) return undefined;
  const summaries = files.map((file) => file.summary).filter((value): value is string => Boolean(value));
  const summary = summaries.length
    ? summarize(summaries.join(" "), 220)
    : summarize(`Changed ${files.map((file) => file.path).slice(0, 4).join(", ")}.`, 220);
  return {
    type: "file-change",
    tool: options.tool,
    trigger: options.trigger,
    automatic: options.trigger !== "manual",
    sessionId: options.sessionId,
    cwd: options.workspaceRoot,
    summary,
    files,
    metadata: options.metadata ?? {}
  };
}

function describeChangedFile(workspaceRoot: string, filePath: string): AutomationFileChange | undefined {
  if (shouldIgnorePath(filePath)) return undefined;
  const absolutePath = resolve(workspaceRoot, filePath);
  const exists = existsSync(absolutePath);
  const diff = gitDiff(workspaceRoot, filePath);
  const addedLines = countDiffLines(diff, "+");
  const deletedLines = countDiffLines(diff, "-");
  const content = exists ? safeReadText(absolutePath) : "";
  if (!exists && !diff) {
    return {
      path: filePath,
      changeType: "deleted",
      summary: deletedPathSummary(filePath),
      addedLines: 0,
      deletedLines: 0,
      symbols: [],
      libraries: [],
      metadata: {
        hash: hashText(filePath),
        area: pathArea(filePath) ?? null
      }
    };
  }
  if (exists && !content && !diff) return undefined;

  const libraries = detectLibraries(content, diff);
  const symbols = detectSymbols(content);
  const summary = summarizeChangedFile(filePath, content, diff, libraries, symbols);
  if (!summary && addedLines + deletedLines < 2 && libraries.length === 0 && symbols.length === 0) return undefined;

  return {
    path: filePath,
    changeType: exists ? "modified" : "deleted",
    summary,
    addedLines,
    deletedLines,
    symbols,
    libraries,
    metadata: {
      hash: hashText(content || diff || filePath),
      area: pathArea(filePath) ?? null,
      sizeBytes: exists ? statSync(absolutePath).size : 0
    }
  };
}

function summarizeChangedFile(
  filePath: string,
  content: string,
  diff: string,
  libraries: string[],
  symbols: string[]
): string | undefined {
  if (filePath === "package.json") {
    const addedDependencies = detectPackageJsonDependencyChanges(diff, "+");
    const removedDependencies = detectPackageJsonDependencyChanges(diff, "-");
    if (addedDependencies.length || removedDependencies.length) {
      const parts = [
        addedDependencies.length ? `Dependencies added: ${addedDependencies.join(", ")}` : "",
        removedDependencies.length ? `Dependencies removed: ${removedDependencies.join(", ")}` : ""
      ].filter(Boolean);
      return summarize(parts.join(". "), 180);
    }
    return "Updated workspace package scripts or dependency metadata.";
  }

  if (isInstructionPath(filePath)) {
    return "Updated agent workflow instructions or memory capture integration guidance.";
  }

  if (filePath.includes("apps/api/")) {
    const routes = detectRoutes(content || diff);
    return routes.length
      ? summarize(`Updated Fastify API routes for ${routes.join(", ")}.`, 180)
      : "Updated local API integration behavior.";
  }

  if (filePath.includes("packages/cli/")) {
    const commands = detectCommands(content || diff);
    return commands.length
      ? summarize(`Updated CLI commands for ${commands.join(", ")}.`, 180)
      : "Updated CLI integration or capture workflows.";
  }

  if (filePath.includes("packages/shared/")) {
    const schemas = detectSchemaNames(content);
    return schemas.length
      ? summarize(`Updated shared schemas for ${schemas.join(", ")}.`, 180)
      : "Updated shared schema contracts.";
  }

  if (filePath.includes("packages/memory-core/")) {
    const area = memoryCoreArea(content, diff);
    return `Updated memory-core ${area}.`;
  }

  if (filePath.includes("apps/web/")) {
    const components = detectReactComponents(content);
    return components.length
      ? summarize(`Updated UI surfaces for ${components.join(", ")}.`, 180)
      : "Updated web UI memory inspection surfaces.";
  }

  if (filePath.startsWith("docs/") || /(^|\/)(README|FEATURES|DEMO|ROADMAP)\.md$/.test(filePath)) {
    return "Updated memory workflow docs or setup guidance.";
  }

  if (libraries.length || symbols.length) {
    return summarize(
      `Updated ${filePath} around ${unique([...libraries, ...symbols]).slice(0, 4).join(", ")}.`,
      180
    );
  }

  return pathArea(filePath) ? `Updated ${pathArea(filePath)}.` : undefined;
}

function detectLibraries(content: string, diff: string): string[] {
  const libraries = new Set<string>();
  for (const text of [content, diff]) {
    for (const match of text.matchAll(/from\s+["'`]([^"'`/][^"'`]*)["'`]/g)) libraries.add(match[1]);
    for (const match of text.matchAll(/require\(\s*["'`]([^"'`/][^"'`]*)["'`]\s*\)/g)) libraries.add(match[1]);
  }
  return [...libraries].slice(0, 6);
}

function detectSymbols(content: string): string[] {
  const symbols = new Set<string>();
  for (const match of content.matchAll(/\b(?:export\s+)?(?:async\s+)?function\s+([A-Z_a-z][A-Za-z0-9_]*)/g)) symbols.add(match[1]);
  for (const match of content.matchAll(/\b(?:export\s+)?(?:const|class|interface|type)\s+([A-Z_a-z][A-Za-z0-9_]*)/g)) symbols.add(match[1]);
  return [...symbols].slice(0, 6);
}

function detectSchemaNames(content: string): string[] {
  const schemas = new Set<string>();
  for (const match of content.matchAll(/\b([A-Z_a-z][A-Za-z0-9_]*Schema)\b/g)) schemas.add(match[1]);
  return [...schemas].slice(0, 6);
}

function detectRoutes(content: string): string[] {
  const routes = new Set<string>();
  for (const match of content.matchAll(/\.(?:get|post|patch|put|delete)\(\s*["'`]([^"'`]+)["'`]/g)) routes.add(match[1]);
  return [...routes].slice(0, 6);
}

function detectCommands(content: string): string[] {
  const commands = new Set<string>();
  for (const match of content.matchAll(/\.command\(\s*["'`]([^"'`]+)["'`]/g)) commands.add(match[1]);
  return [...commands].slice(0, 8);
}

function detectReactComponents(content: string): string[] {
  const components = new Set<string>();
  for (const match of content.matchAll(/\bfunction\s+([A-Z][A-Za-z0-9_]*)\s*\(/g)) components.add(match[1]);
  for (const match of content.matchAll(/\bconst\s+([A-Z][A-Za-z0-9_]*)\s*=\s*\(/g)) components.add(match[1]);
  return [...components].slice(0, 6);
}

function detectPackageJsonDependencyChanges(diff: string, prefix: "+" | "-"): string[] {
  return unique(
    diff
      .split("\n")
      .filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}${prefix}`))
      .map((line) => line.slice(1).trim())
      .filter((line) => /^"[^"]+":\s*"[^"]+"/.test(line))
      .map((line) => line.match(/^"([^"]+)"/)?.[1] ?? "")
      .filter(Boolean)
  ).slice(0, 8);
}

function memoryCoreArea(content: string, diff: string): string {
  const text = `${content}\n${diff}`;
  if (/\bautomation|capture|hook|watch\b/i.test(text)) return "automation capture behavior";
  if (/\bingest|classification|candidate|dedupe\b/i.test(text)) return "ingestion behavior";
  if (/\bretriev|ranking|search\b/i.test(text)) return "retrieval behavior";
  if (/\bconfidence\b/i.test(text)) return "confidence behavior";
  if (/\bconflict\b/i.test(text)) return "conflict handling";
  return "service behavior";
}

function deletedPathSummary(filePath: string): string {
  return `Removed ${filePath} from the local memory workflow.`;
}

function shouldIgnorePath(filePath: string): boolean {
  return /(^|\/)(dist|node_modules|coverage|\.git|docs\/screenshots)(\/|$)/.test(filePath) || /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(filePath);
}

function isInstructionPath(filePath: string): boolean {
  return (
    /(^|\/)(AGENTS\.md|CLAUDE\.md)$/.test(filePath) ||
    /(^|\/)\.(agents|claude)\/skills\//.test(filePath) ||
    /(^|\/)\.claude\/settings\.json$/.test(filePath)
  );
}

function pathArea(filePath: string): string | undefined {
  if (filePath.includes("packages/memory-core/")) return "memory-core capture behavior";
  if (filePath.includes("packages/shared/")) return "shared schema contracts";
  if (filePath.includes("packages/cli/")) return "CLI integration workflows";
  if (filePath.includes("apps/api/")) return "local API routes";
  if (filePath.includes("apps/web/")) return "web UI surfaces";
  if (isInstructionPath(filePath)) return "agent instructions";
  if (filePath.startsWith("docs/") || /(^|\/)(README|FEATURES|DEMO|ROADMAP)\.md$/.test(filePath)) return "memory workflow docs";
  return basename(filePath);
}

function countDiffLines(diff: string, prefix: "+" | "-"): number {
  return diff
    .split("\n")
    .filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}${prefix}`))
    .length;
}

function gitDiff(workspaceRoot: string, filePath: string): string {
  return runGit(workspaceRoot, ["diff", "--unified=0", "--no-color", "HEAD", "--", filePath]);
}

function runGit(workspaceRoot: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function safeReadText(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf8");
    if (content.includes("\u0000")) return "";
    return content;
  } catch {
    return "";
  }
}
