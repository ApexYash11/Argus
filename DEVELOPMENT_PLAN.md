# AI Spend Auditor — Development Plan

## Strategy

- **Phase**: Start with Phase 1 directly (all 7 agents, full SQLite, finding lifecycle)
- **Currency**: Currency-agnostic from the start
- **LLM**: Groq (fast steps) + OpenRouter (reasoning) — with local/fallback mode for development before API keys arrive
- **Test Data**: Include sample CSVs + PDF fixtures for immediate testing. Transactions span 4+ months with seeded anomalies.
- **Runtime**: Bun + TypeScript + Ink/React + LangGraph.js
- **Distribution**: Standalone binary via `bun build --compile`. No Node/Bun runtime required.
- **Timeline**: ~10 weeks, 8 sprints

---

## Architecture Overview

```
audit ingest → Normalization Layer → SQLite (bun:sqlite)
                                       ↓
audit investigate → Trigger Router → Supervisor Agent
                                       ↓
                              Per-Agent LangGraph State Machine
                              (classify → retrieve → compare → score → loop → generate)
                                       ↓
                              SQLite Findings Table + JSONL Scratchpad
                                       ↓
audit findings / audit explain → Ink+React Terminal UI
                                       ↓
audit feedback → Human Feedback Loop → Confidence Calibration (SQLite persisted)
```

---

## Project Structure

```
D:\Argus\
├── src/
│   ├── cli/                     Ink + React terminal UI
│   │   ├── App.tsx              Root component, command router
│   │   ├── components/
│   │   │   ├── InvestigationStream.tsx
│   │   │   ├── FindingCard.tsx
│   │   │   ├── FindingsTable.tsx
│   │   │   ├── EvidenceChain.tsx
│   │   │   ├── StatusBar.tsx
│   │   │   └── ParseErrorPreview.tsx
│   │   └── commands/
│   │       ├── init.ts
│   │       ├── ingest.ts
│   │       ├── investigate.ts
│   │       ├── findings.ts
│   │       ├── explain.ts
│   │       ├── feedback.ts
│   │       ├── status.ts
│   │       └── report.ts
│   │
│   ├── agents/                  LangGraph investigation agents
│   │   ├── supervisor.ts        Orchestrator, trigger routing, dedup, fingerprint check
│   │   ├── saas-waste.ts
│   │   ├── duplicate-payments.ts
│   │   ├── vendor-overbilling.ts
│   │   ├── policy-violations.ts
│   │   ├── reconciliation.ts
│   │   ├── anomaly-detection.ts
│   │   ├── cashflow-risk.ts
│   │   └── nodes/               Shared LangGraph node functions
│   │       ├── classify.ts
│   │       ├── retrieve-evidence.ts
│   │       ├── run-comparison.ts
│   │       ├── score-confidence.ts
│   │       └── generate-finding.ts
│   │
│   ├── engine/
│   │   ├── events.ts            AuditEvent type definitions
│   │   ├── scratchpad.ts        JSONL logging + retention pruning
│   │   ├── risk-scorer.ts       3-factor risk scoring
│   │   ├── finding-builder.ts   Structured finding generation + fingerprint hashing
│   │   ├── baseline.ts          Rolling averages for anomaly detection
│   │   └── activation.ts        Data-driven agent unlock + history-gating (60-day min)
│   │
│   ├── ingest/
│   │   ├── csv-parser.ts        CSV ingestion + Zod validation + error collection
│   │   ├── pdf-extractor.ts     PDF text extraction (text + scanned/OCR)
│   │   ├── contract-parser.ts   LLM extraction of ContractTerms from PDF
│   │   ├── normalizer.ts        Canonical schema mapping
│   │   └── vendor-resolver.ts   Canonical vendor registry + fuzzy match + LLM fallback
│   │
│   ├── db/
│   │   ├── index.ts             bun:sqlite connection + migrations
│   │   ├── queries.ts           Typed query functions
│   │   └── schema.ts            Table definitions, indexes
│   │
│   ├── llm/
│   │   ├── groq.ts              Groq client — fast agent steps
│   │   ├── openrouter.ts        OpenRouter client — finding generation
│   │   └── local-fallback.ts    Local/mock LLM for development
│   │
│   └── model/
│       ├── types.ts             Core type definitions
│       └── schemas.ts           Zod schemas for all external data + audit.yaml config
│
├── test-data/                   Sample data for development/testing
│   ├── subscriptions.csv        (47 records, unused seats seeded)
│   ├── usage.csv                (SSO login activity)
│   ├── transactions.csv         (200+ records, 4 months, deliberate spike & duplicates)
│   ├── invoices/                (PDF invoices with known overbilling)
│   ├── expense-reports.csv      (with policy violations)
│   └── committed-expenses.csv   (upcoming known payments)
│
├── audit.yaml                   Default workspace config (with Zod-validated schema)
├── .env.example                 API key template
├── package.json
├── tsconfig.json
└── README.md
```

---

## SQLite Schema

```sql
-- Canonical normalized financial records
CREATE TABLE financial_records (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,              -- invoice, payment, subscription, expense
  vendor_id TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  date TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  description TEXT,
  status TEXT,                     -- cleared, pending, cancelled
  source_doc_id TEXT,
  raw TEXT,                        -- original CSV row as JSON
  ingested_at TEXT DEFAULT (datetime('now'))
);

-- Resolved vendor registry
CREATE TABLE vendors (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  aliases TEXT NOT NULL,           -- JSON array of known name variants
  trust_score REAL DEFAULT 1.0,
  first_seen TEXT,
  last_seen TEXT
);

-- Source document references
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  type TEXT NOT NULL,              -- csv, pdf
  record_count INTEGER,
  extracted_text TEXT,
  ingested_at TEXT DEFAULT (datetime('now'))
);

-- All generated findings
CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE, -- SHA-256(agent_type + vendor_id + amount + period_start)
  agent_type TEXT NOT NULL,
  vendor_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_chain TEXT NOT NULL,     -- JSON
  impact_amount REAL,
  impact_currency TEXT,
  confidence REAL NOT NULL,
  severity TEXT NOT NULL,           -- critical, high, warning, info
  status TEXT DEFAULT 'open',       -- open, resolved, dismissed
  status_reason TEXT,
  scratchpad_run_id TEXT,           -- links to scratchpad run
  investigation_events TEXT,        -- JSON array of trace events
  dismissed_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

-- Human feedback records
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  action TEXT NOT NULL,             -- resolve, dismiss, escalate
  reason TEXT,
  confidence_delta REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Confidence calibration state (persisted across restarts)
CREATE TABLE calibration (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  agent_type TEXT NOT NULL,
  vendor_id TEXT,
  threshold_override REAL,
  dismiss_count INTEGER DEFAULT 0,
  last_updated TEXT,
  PRIMARY KEY (workspace_id, agent_type, vendor_id)
);

-- Per-run scratchpad log index
CREATE TABLE scratchpad_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  agent_type TEXT,
  finding_id TEXT,
  file_path TEXT NOT NULL,
  event_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## Development Phases & Timeline

### Sprint 1: Foundation (Week 1)

| Task | Details |
|---|---|
| **Project scaffolding** | Bun + TypeScript + Ink/React project setup, tsconfig, package.json scripts |
| **CLI framework** | Command routing with `meow`, all command stubs registered |
| **Core types** | `AuditEvent`, `Finding`, `InvestigationState`, `FinancialRecord`, `AgentType` in `src/model/types.ts` |
| **Zod schemas** | CSV row schemas (`src/model/schemas.ts`), finding schema, **audit.yaml ConfigSchema** with full validation |
| **Database layer** | All tables defined above in `src/db/schema.ts`. `src/db/index.ts` — bun:sqlite init + auto-migration. `src/db/queries.ts` — CRUD functions |
| **LLM client stubs** | `src/llm/groq.ts`, `src/llm/openrouter.ts`, `src/llm/local-fallback.ts` |
| **Test data** | Sample CSVs (4-month transactions with anomalies), invoice PDFs in `test-data/` |
| **audit init command** | Workspace initialization, `.audit/` directory, audit.yaml creation, config validation |
| **Finding fingerprint** | `fingerprint()` in `finding-builder.ts`: SHA-256 of `agent_type + vendor_id + amount + period_start` |
| **Config validation** | `ConfigSchema` Zod schema runs at `audit init` and `audit investigate` startup with line-numbered errors |

### Sprint 2: Ingestion & Normalization (Week 2)

| Task | Details |
|---|---|
| **CSV parser** | `src/ingest/csv-parser.ts` — generic CSV reader + Zod validation per type. Collects parse errors with line numbers, column names, and hints |
| **PDF extractor** | `src/ingest/pdf-extractor.ts` — `pdf-parse` for text PDFs + `tesseract.js` for scanned invoices. Layout-aware table extraction |
| **Normalizer** | `src/ingest/normalizer.ts` — canonical schema mapping from all input types to `FinancialRecord` |
| **Vendor resolver** | `src/ingest/vendor-resolver.ts` — canonical seed list (top 50 Indian SaaS/enterprise vendors), Dice coefficient fuzzy matching, LLM fallback for unrecognized names, human review flag |
| **Contract parser** | `src/ingest/contract-parser.ts` — LLM extraction of contract terms from PDF. Stored as ContractTerms in SQLite (cached, not re-extracted every run) |
| **ParseErrorPreview** | Ink component showing failed row count, first 3 errors (line + column + hint), "fix and re-run" prompt |
| **audit ingest command** | Wires parsers → normalizer → vendor resolver → DB write. Streams progress + parse errors |
| **Event system** | `src/engine/events.ts` — AuditEvent type + AsyncGenerator utilities |

### Sprint 3: Investigation Engine Core (Week 3)

| Task | Details |
|---|---|
| **LangGraph state machine** | Shared 6-node loop: classify → retrieve → compare → score → loop check → generate |
| **Supervisor agent** | `src/agents/supervisor.ts` — trigger routing, agent activation, **fingerprint dedup** (skip if open/resolved, skip if dismissed unless confidence delta > 10%), dedup merge |
| **Shared nodes** | `src/agents/nodes/classify.ts`, `retrieve-evidence.ts`, `run-comparison.ts`, `score-confidence.ts`, `generate-finding.ts` |
| **Scratchpad** | `src/engine/scratchpad.ts` — JSONL per-run audit trail. Retention pruning: keep last N runs (default 30, configurable in audit.yaml), auto-delete older files |
| **Activation engine** | `src/engine/activation.ts` — data-driven agent unlock. History-gating: anomaly/cashflow agents skip if < 60 days of data, emit `agent_skipped` event |
| **LLM routing** | Fast (Groq/local) for agent steps, heavy (OpenRouter/local) for finding generation |

### Sprint 4a: First 4 Agents (Week 4)

| Task | Details |
|---|---|
| **saas-waste.ts** | Zombie seats, unused tools, overlapping tools. Uses subscriptions + usage data |
| **duplicate-payments.ts** | Same vendor + amount + period, both cleared. Weighted signal scoring (amount:0.30, date:0.20, line_items:0.25, period:0.15, status:0.10) |
| **reconciliation.ts** | Invoice↔payment matching, orphan detection, aging buckets (<7d normal, 7-30d warning, >30d critical) |
| **policy-violations.ts** | Rule engine: per-diems, receipts, prohibited categories, pre-approval. Pure rule-based, no LLM needed |

### Sprint 4b: Remaining 3 Agents (Week 5)

| Task | Details |
|---|---|
| **vendor-overbilling.ts** | Contracted vs billed comparison, deviation detection, escalation checks. Uses cached ContractTerms |
| **anomaly-detection.ts** | Rolling 90d average + stddev, z-score > 2.0 flagged, trend/seasonality adjustment. Requires 60+ days of data or skipped |
| **cashflow-risk.ts** | Month-by-month projection, runway vs target, burn analysis. Requires 60+ days or skipped |

### Sprint 5: CLI UI & Finding Lifecycle (Weeks 6-7)

| Task | Details |
|---|---|
| **InvestigationStream** | Live streaming Ink+React component — agent steps, evidence, comparisons, token streaming |
| **FindingCard / FindingsTable** | Finding display with confidence, evidence, impact, severity. Color-coded severity |
| **EvidenceChain** | Deep-dive display for `audit explain` with evidence chain + comparison table |
| **StatusBar** | Agent health, data unlock status |
| **audit investigate command** | Wires supervisor → streaming UI. Includes `--watch` flag for continuous mode |
| **audit findings command** | Listing with filters (status, severity, type, since) |
| **audit explain command** | Finding detail + evidence chain + trace (chronological scratchpad events) |
| **audit explain --trace** | Formatted chronological trace output |
| **audit feedback command** | Resolve/dismiss/escalate with structured reason. Triggers calibration update |
| **audit status command** | Data sources, active agents, unlock prompts |
| **audit report command** | Real plain-text report: findings summary table, recovery estimate, open/critical count, CFO-ready summary |

### Sprint 6: Feedback Loop, Watch Mode & Hardening (Week 8)

| Task | Details |
|---|---|
| **audit investigate --watch** | Continuous monitoring mode using `setInterval` inside long-running Bun process. Debounced re-investigation. Status file for `audit status` watcher health |
| **Confidence calibration** | Auto-tune thresholds per workspace based on dismiss patterns. Updates `calibration` table |
| **Vendor trust scoring** | Repeated flags → elevated scrutiny. Updates `vendors.trust_score` |
| **Finding dedup** | Fingerprint check in supervisor. Cross-run dedup prevents duplicate findings |
| **Edge case handling** | Empty CSVs, malformed data, missing columns, encoding issues. Graceful error messages |
| **Error recovery** | Graceful failure at every agent step, clear error messages. Agent step failures captured as events, not crashes |
| **Performance tuning** | Investigation latency, LLM token budget, loop guards (max 5 iterations) |

### Sprint 7: Polish & Delivery (Week 9)

| Task | Details |
|---|---|
| **audit.yaml documentation** | All threshold options documented with defaults |
| **Sample data walkthrough** | End-to-end demo script with test data. All 7 agents produce findings from seeded data |
| **README** | Installation, quickstart, command reference, architecture overview |
| **Binary distribution** | `bun build --compile src/cli/App.tsx --outfile argus`. `npm install -g` as secondary. Documented in README |
| **Package scripts** | `audit` binary, `npm run dev`, `npm run build` |
| **Bug bash** | Manual testing of all 7 agents with test data, error paths, edge cases |
| **Release** | v1.0.0-alpha — packaged single binary for first customer trials |

---

## Command Implementation Map

| Command | File | Key Behavior |
|---|---|---|
| `audit init` | `src/cli/commands/init.ts` | Creates `.audit/` dir, validates + writes default `audit.yaml`, inits SQLite, runs migrations |
| `audit ingest` | `src/cli/commands/ingest.ts` | Reads file, parses (CSV/PDF), resolves vendors, normalizes, writes to DB, streams events + parse errors |
| `audit investigate` | `src/cli/commands/investigate.ts` | Checks activation, validates config, runs supervisor, streams `InvestigationStream`. `--watch` flag for daemon mode |
| `audit findings` | `src/cli/commands/findings.ts` | Queries SQLite with filters, renders `FindingsTable` |
| `audit explain` | `src/cli/commands/explain.ts` | Fetches finding + evidence chain + scratchpad trace. `--trace` flag shows chronological event log |
| `audit feedback` | `src/cli/commands/feedback.ts` | Updates finding status, stores reason, updates calibration table, triggers threshold tuning |
| `audit status` | `src/cli/commands/status.ts` | Data sources count, agent activation state, watcher health, unlock prompts |
| `audit report` | `src/cli/commands/report.ts` | Aggregates findings by period, renders plain-text summary with recovery estimates |

---

## LLM Strategy

| Step | Primary | Fallback (no API keys) |
|---|---|---|
| classify_event | Groq (llama-3.3-70b) | Rule-based: extract fields from `FinancialRecord` |
| retrieve_evidence | Deterministic (SQL queries) | Same (no LLM needed) |
| run_comparison | Deterministic / Groq | Rule-based comparison |
| score_confidence | Groq | Weighted formula scoring |
| generate_finding | OpenRouter (claude-sonnet-4-6) | Template-based finding generation |

The fallback mode allows full development and testing without any API keys. Agents produce real findings using deterministic logic. Swapping in real LLMs later just upgrades the quality.

---

## Key Design Decisions

1. **All 7 agents, same pattern**: Every agent uses the same 6-node LangGraph state machine. Adding a new agent = implement scoring logic + prompts.
2. **Data-driven activation**: Agents automatically enable/disable based on what data the user has ingested. No config needed.
3. **History-gating**: Anomaly and cashflow agents skip if < 60 days of data, emit clean `agent_skipped` event.
4. **Finding fingerprint**: SHA-256 hash of `(agent_type + vendor_id + amount + period_start)` prevents duplicate findings across runs. Fingerprint checked before every write.
5. **Config validation**: `audit.yaml` validated against Zod `ConfigSchema` at startup. Line-numbered errors for misconfiguration.
6. **Currency-agnostic**: All amounts stored as `number` + `currency` string. No hardcoded INR references.
7. **Local-first**: bun:sqlite means zero config, zero infrastructure. Everything runs locally.
8. **Immutable audit trail**: JSONL scratchpad per investigation run + SQLite finding history. Append-only. Pruned after N runs (configurable).
9. **Confidence floor**: No finding surfaced below 70% confidence. False positives kill trust.
10. **Calibration persistence**: Calibration state lives in SQLite, survives restarts. Dismiss 3× → auto-tune threshold.
11. **Binary distribution**: `bun build --compile` produces a single self-contained executable. No runtime dependency.

---

## Sample Test Data

| File | Content |
|---|---|
| `subscriptions.csv` | 47 subscription records (unused seats, zombie tool seeded) |
| `usage.csv` | Employee login activity for subscription mapping |
| `transactions.csv` | 200+ records across 4 months. Month 1-3: normal variance. Month 4: 2.5σ marketing spend spike + 2 duplicate payments seeded |
| `invoices/inv-001.pdf` | Text-based invoice (known overbilling vs contract) |
| `invoices/inv-002.pdf` | Scanned invoice (tests OCR path) |
| `expense-reports.csv` | 15 line items, 3 policy violations seeded (per diem breach, missing receipt, prohibited category) |
| `committed-expenses.csv` | 10 upcoming payments including payroll, contract renewals |

---

## Success Criteria

- [ ] `audit init` creates a working workspace with validated config
- [ ] `audit ingest` accepts CSV + PDF, resolves vendors, normalizes, writes to SQLite
- [ ] Parse errors display with line numbers, column names, and fix hints
- [ ] `audit investigate` runs active agents, streams live events, skips agents with insufficient history
- [ ] All 7 agents generate findings from the sample data set
- [ ] `audit findings` lists findings with filters (status, severity, type, since)
- [ ] `audit explain --trace` shows chronological investigation trace
- [ ] `audit feedback` updates finding status, stores reason, persists calibration
- [ ] `audit status` shows correct agent activation state + watcher health
- [ ] `audit report` generates a plain-text CFO-ready summary
- [ ] `audit investigate --watch` runs continuously with debounced re-investigation
- [ ] Running `audit investigate` twice produces NO duplicate findings (fingerprint dedup)
- [ ] Restarting the process preserves calibration state (SQLite persistence)
- [ ] Config errors produce clear, line-numbered messages
- [ ] False positive rate < 15% on sample data
- [ ] Time to first finding < 60 seconds from data ingestion
- [ ] Works without any LLM API keys (local fallback mode)
- [ ] `bun build --compile` produces a standalone binary
