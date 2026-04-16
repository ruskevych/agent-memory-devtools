# Claude Code Integration

This repo ships a real Claude Code project hook path in `.claude/settings.json`.

## What The Hooks Capture

The committed project hooks can submit automatic memory events for:

- `UserPromptSubmit`
- `PostToolUse` on `Edit`, `Write`, and `MultiEdit`
- `TaskCompleted`
- `Stop`
- `SessionEnd` pending-file flush

Those events go to the local API and then through the normal automation capture pipeline.

## Setup

### Step 1: Build and Start the API

The hooks require the local API to be running:

```bash
npm install
npm run build
npm run dev:api
```

Keep this terminal open with the API running.

### Step 2: Verify Hook Configuration

In a new terminal, verify the hooks are configured:

```bash
npm run cli:prod -- integrate claude
npm run cli:prod -- hooks status
```

Expected output should show the hook files in `.claude/`:
- `.claude/settings.json`
- `.claude/hooks/agent-memory-hook.mjs`

### Step 3: Confirm in Claude Code

Open this repo in Claude Code and run:

```text
/hooks
```

Confirm the project hooks are listed:
- UserPromptSubmit
- PostToolUse
- TaskCompleted
- Stop
- SessionEnd

## Recommended Workflow

### 1. Start Work

- open the repo in Claude Code
- confirm `/hooks`
- work normally; durable prompts and meaningful edits can be captured automatically

### 2. After A Meaningful Turn

The hook helper will:

- capture durable prompts immediately
- track changed files during edit/write tool use
- flush file changes and assistant summaries at stop/task-complete boundaries

### 3. Inspect What Happened

```bash
npm run cli:prod -- list
npm run cli:prod -- search "memory query"
npm run cli:prod -- replay <trace-id>
```

Or use Memory Explorer and Replay Viewer in the web UI:

```bash
npm run dev:web
```

Then visit `http://localhost:5173`

### 4. Manual Checkpoint If Needed

```bash
npm run cli:prod -- capture changes --tool claude-code --summary "what changed and what remains"
```

## What Is Automatic

- durable user prompts
- changed files tracked during tool use
- end-of-turn assistant summaries
- task-complete summaries

## What Is Explicit

- transcript imports
- manual checkpoints outside the Claude hook path
- correction through feedback and rules

## Limitations

- the local API must be running for the hook path to submit capture events
- the hooks intentionally aggregate changed files instead of storing every tiny edit separately
- low-signal chat and secret-like content are filtered out

## Verification Checklist

- `hooks status` reports the Claude hook files
- `/hooks` shows the project hooks in Claude Code
- a durable prompt creates or updates a replay trace
- a meaningful edit shows up as a `file-change` origin in Memory Explorer
- the Replay Viewer shows `automation-events` and `automation-filtering`

## Troubleshooting

If hooks appear active but no memory updates are visible:

1. **Confirm the API is running**:
```bash
curl http://127.0.0.1:4317/health
```
Expected: `{"status":"ok"}`

2. **Check hook status**:
```bash
npm run cli:prod -- hooks status
```

3. **Verify hooks are active in Claude Code**:
```text
/hooks
```

4. **Check if events were filtered out**:
```bash
npm run cli:prod -- replay <trace-id>
```
Look for `automation-filtering` decisions — the system intentionally ignores:
- Conversational acknowledgements (`ok`, `done`, `sounds good`, and 30 others)
- Questions (any content ending with `?`)
- System output (npm notices, build lines, stack traces, test summaries)
- Secret-like content (tokens, passwords, private keys)
- Stop-event assistant messages with no completion verbs

5. **Make a meaningful edit**: A substantial code change with clear purpose, or a prompt containing a durable instruction (`prefer`, `always`, `never`, `avoid`, `when writing`, etc.)
