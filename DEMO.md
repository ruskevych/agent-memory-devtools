# Demo Script

Use this 2-3 minute walkthrough to show Agent Memory Devtools as a debuggable, correctable memory system for AI coding agents.

## Setup

Terminal 1:

```bash
npm install
npm run dev:api
```

Terminal 2:

```bash
npm run dev:web
```

Terminal 3:

```bash
npm run cli -- dev:seed
```

Open `http://127.0.0.1:5173`.

## Product Walkthrough

### 1. Start with the Dashboard

Show that the project is local-first and inspectable:

- active, pinned, archived, low-confidence, reinforced, and conflicted memory counts
- memory counts by kind
- recent sessions and replay traces
- duplicate and merge health
- retrieval activity

If the database is empty, click **Load Demo Data**.

### 2. Search Memory

Open **Memory Explorer** and search:

```text
typescript zod api
```

Select the top result and show:

- memory kind, tags, source, session, and state badges
- why the memory exists
- why it was retrieved
- keyword, local semantic, recency, importance, pinned, and source score components

### 3. Inspect Confidence

In the selected memory detail panel, show the **Confidence** card:

- label and confidence score
- component breakdown
- usage count
- conflict count

Click **Recompute** to show that confidence can be refreshed after usage, feedback, or conflict changes.

### 4. Fix a Memory

Use the **Fix Memory** controls on the selected memory:

1. Click **Boost importance** or **Lower importance**.
2. Point out that feedback is applied and appears in feedback history.
3. Explain that applied feedback can create deterministic rules for future ingestion or dedupe behavior.

Optional CLI equivalent:

```bash
npm run cli -- fix forget <memory-id> --rule
npm run cli -- feedback list --status applied
npm run cli -- rule list
```

### 5. Open a Replay Trace

Open **Replay** and select the latest retrieval trace. Show:

- candidate filtering
- ranking stage
- matched terms
- score components
- ranked results

Then select an ingestion trace and show:

- input normalization
- chunking
- classification
- rule application, if rules exist
- store, ignore, and merge decisions

For an ignored decision, click **Remember this** to create a memory from the trace.

### 6. Run Missing Memory Analysis

Open **Session Explorer**, select a session, and click **Analyze missing memories**.

Show each suggestion:

- suggested kind and score
- reason
- evidence snippets
- possible existing coverage

Click **Accept** on one suggestion, then open **Memory Explorer** and confirm the accepted suggestion appears as a memory with confidence and source metadata. Use **Dismiss** for suggestions that should not become memory.

### 7. Check Conflicts

Back in **Memory Explorer**, click **Detect conflicts** from the confidence panel. If conflicts appear, show:

- conflicted confidence label
- conflict summary and severity
- dismiss action in the UI

CLI equivalents:

```bash
npm run cli -- conflicts detect
npm run cli -- conflicts list
npm run cli -- confidence show <memory-id>
```

## API Snapshot

Run a search and copy the returned trace ID into the Replay Viewer:

```bash
curl -X POST http://127.0.0.1:4317/search \
  -H "content-type: application/json" \
  -d '{"query":"unresolved task","limit":5}'
```

Analyze a session for missed memories:

```bash
curl -X POST http://127.0.0.1:4317/sessions/<session-id>/analyze-missing \
  -H "content-type: application/json" \
  -d '{"refresh":true,"limit":8}'
```

## Closing Message

This is not just memory retrieval. It is local agent memory you can inspect, correct, replay, and keep honest.
