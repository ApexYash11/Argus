# AI Spend Auditor

Autonomous financial investigation engine for startups. Ingests financial data (CSVs, PDFs), runs up to 7 LangGraph-based investigation agents, and surfaces structured findings with evidence chains.

## Installation

```bash
# Prerequisites: Bun >= 1.2
curl -fsSL https://bun.sh/install | bash

# Clone and install
git clone <repo>
cd argus
bun install

# Standalone binary (no Bun required at runtime)
bun run compile          # outputs dist/argus-linux
./dist/argus-linux --help

# Or add to PATH for bare `audit` commands:
# export PATH="$PWD/dist:$PATH"
```

## Quickstart

```bash
# Initialize workspace
bun run src/cli/index.tsx init --company "Acme Corp"

# Or if the binary is on PATH:
# audit init --company "Acme Corp"

# Ingest financial data
audit ingest transactions.csv
audit ingest subscriptions.csv
audit ingest expense-reports.csv
audit ingest invoices/inv-001.pdf

# Run investigation (all 7 agents)
audit investigate

# Browse results
audit findings
audit findings --status open --severity critical
audit findings --type duplicate-payments

# Deep-dive a finding
audit explain FINDING-003
audit explain FINDING-003 --evidence --trace

# Submit feedback (triggers calibration)
audit feedback FINDING-003 --dismiss --reason "Manual review OK"
audit feedback FINDING-003 --resolve --reason "Fixed with vendor"

# System status and reports
audit status
audit report
audit report --period Q1-2026

# Continuous monitoring
audit investigate --watch
```

## Commands

| Command | Description |
|---------|-------------|
| `audit init` | Initialize workspace, create `.audit/` directory and config |
| `audit ingest <path>` | Ingest CSV or PDF financial data |
| `audit investigate` | Run investigation engine against all active agents |
| `audit investigate --type <agent>` | Run a single agent |
| `audit investigate --watch` | Continuous monitoring (30s polling) |
| `audit findings` | List findings with optional filters |
| `audit explain <id>` | Deep-dive a finding with evidence and trace |
| `audit feedback <id>` | Submit resolve/dismiss/escalate feedback |
| `audit status` | System health, agent activation, data source stats |
| `audit report` | Generate plain-text findings summary |

### Filter Flags

| Flag | Used With | Values |
|------|-----------|--------|
| `--status` | findings | `open`, `resolved`, `dismissed` |
| `--severity` | findings | `critical`, `high`, `warning`, `info` |
| `--type` | findings, investigate | Agent name, e.g. `duplicate-payments` |
| `--since` | findings | Number of days, e.g. `30` |
| `--evidence` | explain | Show evidence chain |
| `--trace` | explain | Show chronological scratchpad events |
| `--period` | report | Period label, e.g. `Q1-2026` |

## Architecture

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
audit feedback → Human Feedback Loop → Confidence Calibration
```

### Investigation Agents

All 7 agents share the same 6-node LangGraph state machine pattern:

| Agent | Detects | Data Required |
|-------|---------|--------------|
| **saas-waste** | Unused seats, zombie tools, overlapping subscriptions | subscriptions.csv, usage.csv |
| **duplicate-payments** | Same vendor + amount + period, both cleared | transactions.csv |
| **vendor-overbilling** | Contracted vs billed price deviations | transactions.csv, invoices/, contracts |
| **policy-violations** | Per-diem breaches, missing receipts, prohibited categories | expense-reports.csv |
| **reconciliation** | Invoice↔payment mismatches, orphan records | transactions.csv, invoices/ |
| **anomaly-detection** | Statistical outliers (z-score > 2.0) | transactions.csv (60+ days) |
| **cashflow-risk** | Runway depletion, burn rate, coverage gaps | transactions.csv, committed-expenses.csv (60+ days) |

### Key Design Decisions

- **Local-first**: bun:sqlite means zero config, zero infrastructure
- **Currency-agnostic**: All amounts stored as `number` + `currency` string
- **Data-driven activation**: Agents auto-enable based on ingested data types
- **History-gating**: Anomaly/cashflow agents require 60+ days of data
- **Finding fingerprint**: SHA-256 hash prevents duplicate findings across runs
- **Confidence floor**: No finding surfaced below 70% (auto-raised via calibration)
- **LLM fallback**: Works without API keys using deterministic rule-based logic
- **Binary distribution**: `bun build --compile` produces standalone executable

### Configuration

See `audit.yaml` for all available options. Created by `audit init`.

Key thresholds:

| Option | Default | Description |
|--------|---------|-------------|
| `confidenceFloor` | 0.7 | Minimum confidence (auto-raised on repeated dismissals) |
| `maxIterations` | 5 | Max investigation loops per agent |
| `scratchpad.retentionCount` | 30 | Recent JSONL run files to retain |
| `policy.*` | — | Custom expense policy rules |

## Development

```bash
bun run dev          # Run CLI in dev mode
bun run build        # Bundle as JS
bun run compile      # Compile standalone binary
./demo.ps1           # Run end-to-end demo (Windows PowerShell)
./demo.sh            # Run end-to-end demo (Linux/Mac)
```

## Test Data

| File | Records | Seeded Anomalies |
|------|---------|-----------------|
| `subscriptions.csv` | 47 | Unused seats, zombie tool |
| `usage.csv` | — | Employee login activity |
| `transactions.csv` | 200+ | 2.5σ marketing spike, 2 duplicate payments |
| `expense-reports.csv` | 15 | 3 policy violations |
| `committed-expenses.csv` | 10 | Upcoming payments |
| `invoices/inv-001.pdf` | 1 | Known overbilling vs contract |

## License

Proprietary — Internal use.
