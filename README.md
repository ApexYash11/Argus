# AI Spend Auditor

Autonomous financial investigation engine for startups. Ingests financial data (CSVs, PDFs), runs 7 deterministic investigation agents, and surfaces structured findings with evidence chains.

## Installation

```bash
# Prerequisites: Bun >= 1.2
curl -fsSL https://bun.sh/install | bash

# Install (no clone needed)
bun install --global argus-audit
argus --help
```

From source instead:

```bash
git clone <repo>
cd argus
bun install
bun install --global .
```

Alternative: standalone binary (no Bun required at runtime, CSV/XLSX
workflows; scanned-PDF OCR needs the Bun runtime path above):

```bash
bun run compile:win   # dist/argus.exe (Windows)
bun run compile       # dist/argus-linux (Linux)
bun run compile:mac   # dist/argus-mac (macOS arm64)
```

## Quickstart

```bash
# Initialize workspace
argus init --company "Acme Corp"

# Main verb: ingest + investigate a file or folder in one go
argus audit ./your-exports/
argus audit transactions.csv --share

# Browse results
argus findings
argus findings --status open --severity critical
argus findings --type duplicate-payments

# Deep-dive a finding
argus explain FINDING-003
argus explain FINDING-003 --evidence --trace

# Submit feedback (triggers calibration)
argus feedback FINDING-003 --dismiss --reason "Manual review OK"
argus feedback FINDING-003 --resolve --reason "Fixed with vendor"

# System status, digest, web viewer, chat
argus status
argus digest
argus web --open
argus chat
```

## Commands

| Command | Description |
|---------|-------------|
| `argus init` | Initialize workspace, create `.audit/` directory and config |
| `argus audit [path]` | Ingest + investigate a file or folder (main verb) |
| `argus findings` | List findings with optional filters |
| `argus explain <id>` | Deep-dive a finding with evidence and trace |
| `argus feedback <id>` | Submit resolve/dismiss/escalate feedback |
| `argus digest` | Weekly markdown digest |
| `argus status` | System health, agent activation, data source stats |
| `argus web` | Local web viewer (charts, runway simulator, findings) |
| `argus chat` | Interactive agentic chat mode |

### Filter Flags

| Flag | Used With | Values |
|------|-----------|--------|
| `--status` | findings | `open`, `resolved`, `dismissed` |
| `--severity` | findings | `critical`, `high`, `warning`, `info` |
| `--type` | findings, audit | Agent name, e.g. `duplicate-payments` |
| `--since` | findings | Number of days, e.g. `30` |
| `--evidence` | explain | Show evidence chain |
| `--trace` | explain | Show chronological scratchpad events |
| `--period` | digest | Period label, e.g. `Q1-2026` |
| `--share` | audit | Write shareable HTML report after the run |

## Architecture

```
audit [path] → Normalization Layer → SQLite (bun:sqlite)
                                        ↓
              Supervisor Agent (7 deterministic detectors)
                                        ↓
                               SQLite Findings Table + JSONL Scratchpad
                                        ↓
audit findings / audit explain → Ink+React Terminal UI
                                        ↓
audit feedback → Human Feedback Loop → Confidence Calibration
```

### Agentic chat

`argus chat` adds an LLM loop on top: the model plans tool calls
(`list_findings`, `get_finding`, `get_status`, `run_investigation`) from
your words. Detection stays deterministic; the model orchestrates and explains.

### Investigation Agents

All 7 agents share the same deterministic state machine pattern
(classify → retrieve → compare → score → loop → generate):

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
