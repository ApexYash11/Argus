# Argus Chat Mode — Full Walkthrough

Argus includes an interactive chat mode that lets you converse with the autonomous financial investigator in real time.

> **Note:** The compiled binary is named `audit` (see `package.json` `"bin"`), but the project is called Argus. Commands below use `bun run` since no compiled binary exists yet.

---

## 1. Setup (one time)

From the project root (`D:\Argus`):

```bash
# Install dependencies
bun install

# Copy environment file and add your API keys
# (GROQ_API_KEY is needed for LLM-powered questions)
```

Make sure `D:\Argus\.env` has your key in **uppercase**:

```
GROQ_API_KEY=gsk_your_key_here
```

---

## 2. Initialize a workspace

```bash
bun run src/cli/index.tsx init --company "My Company"
```

This creates `.audit/` directory and `audit.yaml` in the current folder.

---

## 3. Ingest some data

Use the demo data provided:

```bash
bun run src/cli/index.tsx ingest test-data/subscriptions.csv
bun run src/cli/index.tsx ingest test-data/transactions.csv
bun run src/cli/index.tsx ingest test-data/expense-reports.csv
bun run src/cli/index.tsx ingest test-data/committed-expenses.csv
bun run src/cli/index.tsx ingest test-data/usage.csv
```

Or run the full demo pipeline:

```bash
bun run demo
```

---

## 4. Launch chat mode

```bash
# Explicit chat command:
bun run src/cli/index.tsx chat

# Or just run with no args (auto-launches chat when .audit/ exists):
bun run src/cli/index.tsx
```

You should see:

```
╸ARGUS╺  chat mode  ·  type "exit" to quit  ·  Ctrl+C to stop

argus › 
```

---

## 5. Using the chat prompt

Type any of these commands at the `argus ›` prompt:

| Intent | Type this |
|--------|-----------|
| Run investigation agents | `investigate` |
| List all findings | `findings` |
| Inspect a specific finding | `explain FINDING-001` |
| Ingest a new file | `ingest path/to/file.csv` |
| Ask about your data | Type any question (sent to Groq LLM) |
| Quit | `exit` or `quit` |

---

## 6. Full example session

```
PS D:\Argus> bun run src/cli/index.tsx chat

╸ARGUS╺  chat mode  ·  type "exit" to quit  ·  Ctrl+C to stop

argus › findings
  ◆ FINDING-001 | Duplicate Payment — AWS 2026-03-01 | [critical] 92% — open
  ◆ FINDING-002 | Subscription Waste — Unused Slack Pro seats | [high] 85% — open

argus › explain FINDING-002
  FINDING-002
  Title: Subscription Waste — Unused Slack Pro seats
  Severity: high
  Confidence: 85%
  Status: open
  Summary: 12 Slack Pro seats ($15.99/mo each) with zero login activity for 60+ days

argus › investigate
  Starting investigation...
  ◆ Supervisor routing trigger: daily_tick
  ◆ Dispatching saas-waste agent
  ◆ Dispatching duplicate-payments agent
  ...

argus › exit
  Goodbye.
```

---

## 7. Using --dir with chat

Point to a different workspace directory:

```bash
bun run src/cli/index.tsx --dir ./client-a chat
bun run src/cli/index.tsx -d ./client-a chat
```

---

## 8. Quick reference — all run methods

| What | Command |
|------|---------|
| Start chat | `bun run src/cli/index.tsx chat` |
| Auto chat (no args) | `bun run src/cli/index.tsx` |
| Chat with custom dir | `bun run src/cli/index.tsx --dir ./my-project chat` |
| Initialize workspace | `bun run src/cli/index.tsx init --company "Acme"` |
| Ingest a file | `bun run src/cli/index.tsx ingest data.csv` |
| Run investigation | `bun run src/cli/index.tsx investigate` |
| List findings | `bun run src/cli/index.tsx findings` |
| Full demo | `bun run demo` |
| Compile Windows exe | `bun run compile:win` (produces `dist/argus.exe`) |

---

## Requirements

- [Bun](https://bun.sh) installed (`winget install Bun.Labs.Bun` on Windows)
- `.env` file with `GROQ_API_KEY` for LLM-powered questions (investigation + ingestion work without it)
- A workspace initialized via `init` (or the auto-setup wizard on first run)
