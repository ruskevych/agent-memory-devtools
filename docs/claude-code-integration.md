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

Install dependencies and start the local API:

```bash
npm install
npm run dev:api
```

Verify or reinstall the project hook config:

```bash
npm run cli -- integrate claude
npm run cli -- hooks status
```

Then open this repo in Claude Code and run:

```text
/hooks
```

Confirm the project hooks are listed.

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
npm run cli -- search "memory query"
npm run cli -- replay <trace-id>
```

Or use Memory Explorer and Replay Viewer in the web UI.

### 4. Manual Checkpoint If Needed

```bash
npm run cli -- capture changes --tool claude-code --summary "what changed and what remains"
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

- confirm `npm run dev:api` is still running
- run `npm run cli -- hooks status`
- make one meaningful edit instead of a tiny formatting-only change
- open the replay trace to see whether the automation filter ignored the event
