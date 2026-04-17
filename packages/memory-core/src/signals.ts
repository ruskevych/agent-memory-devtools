// ---------------------------------------------------------------------------
// Signal wordlists used by the automation and ingestion pipelines.
// All lists are generic — not specific to any project, tool, or framework.
// Update these lists to tune what gets stored, ignored, or classified.
// ---------------------------------------------------------------------------

// Every natural past-tense verb that indicates a developer completed work.
export const COMPLETION_VERBS = [
  // create
  "built", "created", "developed", "generated", "implemented", "initialized",
  "introduced", "scaffolded", "bootstrapped", "wrote",
  // modify
  "added", "adjusted", "changed", "enhanced", "extended", "improved",
  "modified", "refactored", "reorganized", "restructured", "revised",
  "simplified", "standardized", "tweaked", "updated",
  // fix / resolve
  "addressed", "corrected", "debugged", "fixed", "handled", "patched",
  "repaired", "resolved", "squashed",
  // remove
  "archived", "cleaned", "deleted", "deprecated", "dropped", "eliminated",
  "pruned", "purged", "removed",
  // ship / deploy
  "deployed", "landed", "merged", "migrated", "published", "released",
  "shipped",
  // configure / integrate
  "configured", "connected", "disabled", "enabled", "integrated", "installed",
  "linked", "registered", "set up", "toggled", "wired",
  // move / rename
  "consolidated", "converted", "downgraded", "extracted", "moved",
  "optimized", "ported", "renamed", "replaced", "reverted", "split",
  "synchronized", "upgraded",
  // import / export
  "exported", "imported", "injected",
  // complete
  "completed", "finalized", "finished",
  // sync / onboard
  "synced", "synchronized", "initialized", "onboarded", "bootstrapped", "set up",
] as const;

// Phrases that turn a user prompt into a durable instruction.
// Grouped by pattern type for readability.
export const DURABLE_INSTRUCTION_VERBS = [
  "prefer", "always", "never", "avoid", "keep", "ensure", "enforce",
  "require", "prohibit", "forbid",
] as const;

export const DURABLE_INSTRUCTION_NOUNS = [
  "workflow", "convention", "style", "pattern", "guideline", "rule",
  "principle", "standard", "policy", "constraint", "approach", "practice",
  "process",
] as const;

// Multi-word durable instruction patterns (tested separately as full phrases).
export const DURABLE_INSTRUCTION_PHRASES = [
  /\b(we|i) (always|never|use|prefer|avoid|follow|enforce|require|do not|don't)\b/i,
  /\buse\b.{1,40}\binstead\b/i,
  /\breplace\b.{1,50}\bwith\b/i,
  /\bswitch(ing)? (from|to)\b/i,
  /\bwhen (working|writing|building|adding|editing|implementing|creating|handling|dealing|touching|reviewing)\b/i,
  /\b(make sure|don't forget|from now on|going forward|every time|whenever|each time)\b/i,
  // Decision reasoning — captures architectural choices and their rationale
  /\b(chose|choosing|decided|went with|going with|picked)\b.{1,80}\bbecause\b/i,
  /\b(decided|choosing|went) against\b/i,
  /\b(chose|went with|picked)\b.{1,60}\bover\b/i,
  /\bthe (reason|rationale|tradeoff|decision) (is|was|being|here)\b/i,
  /\b(approach|architecture|design|structure) (is|was) (to|that)\b/i,
  /\bwe (ruled out|rejected|dropped|skipped)\b/i,
] as const;

// Words that signal unresolved or continuation work.
export const TASK_CONTINUATION_TERMS = [
  "todo", "unresolved", "blocked", "follow up", "next time", "remaining",
  "still need", "not done", "open task", "pending", "in progress", "will need",
  "plan to", "intend to", "upcoming", "backlog", "deferred", "postponed",
  "outstanding", "next steps", "revisit", "open question", "needs review",
  "needs testing", "partially", "incomplete", "work in progress", "wip",
] as const;

// Technical terms that place a chunk in a codebase context.
export const CODEBASE_PATH_PREFIXES = [
  "src/", "packages/", "apps/", "lib/", "libs/", "tests?/", "config/",
  "scripts/", "tools/", "infra/",
] as const;

export const CODEBASE_LANGUAGES = [
  "typescript", "javascript", "python", "rust", "go", "java", "ruby",
  "swift", "kotlin", "elixir", "clojure", "haskell", "scala",
] as const;

export const CODEBASE_FRAMEWORKS = [
  "react", "vue", "svelte", "angular", "solid", "qwik",
  "nextjs", "next\\.?js", "nuxt", "remix", "astro", "sveltekit",
  "vite", "webpack", "rollup", "esbuild", "turbo", "parcel",
  "express", "fastify", "koa", "hono", "nestjs", "trpc",
  "node", "deno", "bun",
] as const;

export const CODEBASE_DATA_TERMS = [
  "sqlite", "postgres", "postgresql", "mysql", "mongodb", "redis",
  "supabase", "planetscale", "turso", "neon",
  "prisma", "drizzle", "sequelize", "typeorm", "knex",
] as const;

export const CODEBASE_ARCHITECTURE_TERMS = [
  "api", "cli", "sdk", "orm", "rpc", "graphql", "rest", "grpc", "websocket",
  "schema", "database", "migration", "seed", "fixture", "model",
  "route", "endpoint", "middleware", "controller", "service", "repository",
  "monorepo", "workspace", "package", "module", "library",
  "repo", "codebase", "build", "bundle", "lint", "deploy", "pipeline",
] as const;

export const CODEBASE_FILE_EXTENSIONS = [
  "\\.ts", "\\.tsx", "\\.js", "\\.jsx", "\\.mjs", "\\.cjs",
  "\\.py", "\\.rs", "\\.go", "\\.java", "\\.rb",
  "\\.json", "\\.yaml", "\\.yml", "\\.toml", "\\.sql",
] as const;

// Short exact-match acknowledgements that add no information.
export const CONVERSATIONAL_ACKS = [
  "ok", "okay", "done", "thanks", "thank you", "great", "sure", "perfect",
  "awesome", "cool", "nice", "got it", "sounds good", "looks good",
  "makes sense", "of course", "absolutely", "exactly", "correct", "right",
  "yep", "yup", "nope", "agreed", "understood", "noted", "copy that",
  "will do", "on it", "no problem", "no worries", "my bad", "fair enough",
  "yeah", "yes", "no",
] as const;

// Regex patterns that identify system/tool output rather than developer intent.
export const SYSTEM_NOISE_PATTERNS: RegExp[] = [
  /\bpackages? are looking for funding\b/i,
  /\bfound \d+ vulnerabilities?\b/i,
  /\baudited \d+ packages?\b/i,
  /\badded \d+ packages?\b/i,
  /\bremoved \d+ packages?\b/i,
  /\bchanged \d+ packages?\b/i,
  /\brun `npm (fund|audit|install|ci)`\b/i,
  /^\s*at \S+\s*\(/m,
  /^\s*\d+\s+(passing|failing|pending)\b/m,
  /\b(build|compile) (succeeded|failed|completed) in \d+/i,
  /\bListening (on|at) (port |http)/i,
];

// ---------------------------------------------------------------------------
// Pre-built regexes (constructed once for performance)
// ---------------------------------------------------------------------------

export const COMPLETION_VERB_RE = new RegExp(
  `\\b(${COMPLETION_VERBS.map((v) => v.replace(/\s+/g, "\\s+")).join("|")})\\b`,
  "i"
);

export const DURABLE_INSTRUCTION_VERB_RE = new RegExp(
  `\\b(${[...DURABLE_INSTRUCTION_VERBS, ...DURABLE_INSTRUCTION_NOUNS].join("|")})\\b`,
  "i"
);

export const TASK_CONTINUATION_RE = new RegExp(
  `\\b(${TASK_CONTINUATION_TERMS.map((t) => t.replace(/\s+/g, "\\s+")).join("|")})\\b`,
  "i"
);

export const CODEBASE_CONTEXT_RE = new RegExp(
  [
    `\\b(${CODEBASE_PATH_PREFIXES.join("|")})`,
    `\\b(${CODEBASE_LANGUAGES.join("|")})\\b`,
    `\\b(${CODEBASE_FRAMEWORKS.join("|")})\\b`,
    `\\b(${CODEBASE_DATA_TERMS.join("|")})\\b`,
    `\\b(${CODEBASE_ARCHITECTURE_TERMS.join("|")})\\b`,
    `(${CODEBASE_FILE_EXTENSIONS.join("|")})\\b`,
  ].join("|"),
  "i"
);

export const CONVERSATIONAL_ACK_RE = new RegExp(
  `^(${CONVERSATIONAL_ACKS.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[.!]*$`,
  "i"
);
