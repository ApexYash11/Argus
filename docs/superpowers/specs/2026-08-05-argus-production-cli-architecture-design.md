# Argus Production CLI and Architecture Design

**Date:** 2026-08-05

**Status:** Approved

## Summary

Argus will remain a local-first Bun and TypeScript modular monolith backed by SQLite. The production workflow will center on one command:

```text
argus audit <file-or-directory>
```

That command automatically initializes a workspace when necessary, discovers and classifies supported files, safely skips uncertain inputs, ingests valid data, runs only eligible investigation agents, optionally enriches deterministic findings with LLM reasoning, and presents a concise result with an interactive next-step menu.

The design targets approximately 20,000 financial records per workspace. It deliberately avoids distributed services, queues, and infrastructure intended for million-record workloads.

## Product Decisions

- The default product experience is `argus audit <path>`.
- New users should not need to learn the underlying ingest, investigate, findings, explain, or status commands.
- High-confidence files are processed automatically. The default automatic-ingestion threshold is schema confidence `>= 0.80`. Files below `0.80` are skipped unless the user supplies an explicit `--type` override. The threshold may be changed in validated workspace configuration.
- Low-confidence or unknown files are skipped safely and reported with a suggested `--type` override.
- Deterministic financial analysis is authoritative.
- LLM reasoning and natural-language answers are optional enhancements.
- Core audits work without an API key.
- The first production release supports standalone Windows, macOS, and Linux binaries.
- The supported workspace scale is approximately 20,000 records, with explicit regression tests at that size.

## Goals

1. Make the first successful audit require only a file or directory path.
2. Make the CLI understandable to a finance user without prior command-line expertise.
3. Repair build, dependency, type-check, configuration, activation, and testing failures that block production distribution.
4. Stream meaningful audit progress as work occurs.
5. Prevent malformed or uncertain inputs from contaminating trusted records.
6. Make future agents and optional features pay only for the data and work they use.
7. Preserve local-first operation and deterministic fallbacks.

## Non-Goals

- A web dashboard.
- A chatbot-first product experience.
- Microservices, distributed job queues, or remote database infrastructure.
- Unbounded scale beyond the 20,000-record target.
- Live accounting, banking, or payment connectors in this production-hardening scope.
- Autonomous financial actions such as paying, holding, or contacting a vendor.

## Primary CLI Experience

### Starting an audit

```text
argus audit ./finance-data
```

The command performs workspace setup automatically. It displays one stable progress region while long-running work is active. Completed stages settle into concise status lines, persistent warnings remain visible, and the final audit result becomes the dominant visual element.

The stages are:

1. Discover files.
2. Validate and classify schemas.
3. Ingest normalized records.
4. Report files that need review.
5. Run eligible investigation agents.
6. Optionally enrich findings with LLM reasoning.
7. Present the audit result.

### Next-step menu

After completion, Argus presents an interactive menu:

```text
Audit complete

2 critical · 4 high · 3 warnings
Potential exposure: INR 284,600

What would you like to do?

› Review important findings
  Ask Argus a question
  Export the report
  Finish
```

Arrow keys move the selection and Enter confirms it. Frequent keyboard actions respond immediately and do not animate. Motion is reserved for long-running progress and meaningful completion feedback. Reduced-motion terminals receive static or minimal feedback.

The menu appears only when standard input and output are interactive terminals. Redirected output and `--non-interactive` mode print the final summary and exit without waiting for input.

### Running Argus without arguments

When no workspace action is active, `argus` asks for a file or directory path:

```text
Drop a file or folder here to begin:

› _
```

### Advanced commands

Existing commands remain available for experienced users and automation, but they appear under an advanced section rather than dominating onboarding:

- `argus findings`
- `argus explain <finding-id>`
- `argus feedback <finding-id>`
- `argus status`
- `argus ingest <path>`
- `argus investigate`
- `argus ask "<question>"`

Machine-oriented flags such as `--json` and `--non-interactive` remain supported without appearing in the beginner flow.

### Responsive output

- Narrow terminals use a stacked finding list rather than a fixed-width table.
- Standard terminals show compact columns with truncation that preserves identifiers and severity.
- Wide terminals may show extended evidence and impact columns.
- Redirected output disables color and in-place animation automatically.
- All important state is conveyed with text and symbols, not color alone.

## Architecture

Argus remains one executable with clear internal boundaries:

```text
CLI presenters
    ↓
Application use cases
    ↓
Audit engine and agent registry
    ↓
Repositories and file/LLM adapters
```

### WorkspaceContext

`WorkspaceContext` is created once per invocation. It owns:

- The resolved workspace path.
- The validated application configuration.
- The initialized database connection.
- Available optional LLM providers.
- Cancellation and shutdown signals.
- Structured logging and run metrics.

No command or agent should independently rediscover the workspace, reopen the database, or parse configuration.

### AuditService

`AuditService` owns the complete `argus audit <path>` use case. It coordinates discovery, classification, ingestion, activation, investigation, optional reasoning, persistence, and summary generation. It emits structured `AuditEvent` values and contains no terminal rendering code.

### IngestionService

`IngestionService` owns:

- Supported-file discovery.
- Ignore rules for `.audit`, `node_modules`, build output, source-control metadata, temporary files, and configured exclusions.
- File inspection and schema classification.
- Data-quality reporting.
- Normalization.
- Idempotency and source fingerprints.
- Transactional batch storage.

Discovery and classification use bounded concurrency. Database writes remain controlled and transactional.

### AgentRegistry

Each agent registers a definition containing:

- Stable agent identifier.
- Required record and document types.
- Optional minimum history requirements.
- Required configuration sections.
- The deterministic investigation function.
- Whether optional LLM enrichment is supported.

Agent activation is calculated from data actually present in the workspace. The status view and investigation runner use the same activation result.

### AuditRunSnapshot

`AuditRunSnapshot` loads the data needed by active agents once. It exposes read-only indexed views by type, vendor, date range, source, and currency. Agents do not call unbounded `getAll*()` queries or reload the same records independently.

For the 20,000-record target, the snapshot may remain in process memory. Its interface allows targeted repository-backed views later without changing agent contracts.

### Repositories

Repositories own SQLite access and row mapping. They expose purpose-specific queries instead of leaking SQL or database globals into commands and agents. All database schema changes are performed through ordered, versioned migrations.

### Presentation layer

The presentation layer converts structured events into:

- Interactive terminal progress.
- Static redirected output.
- JSON automation output.
- Concise errors and recovery instructions.

Business logic does not write directly to `console` or depend on Ink components.

## Audit Data Flow

1. Resolve the requested file or directory and nearest valid workspace. For a single file, the workspace is its parent directory; Argus never treats the file path itself as a directory.
2. Initialize a workspace automatically if one does not exist.
3. Load and validate configuration into `WorkspaceContext`.
4. Discover supported files while applying ignore rules.
5. Inspect and classify candidates with bounded concurrency.
6. Accept high-confidence candidates.
7. Skip low-confidence or unknown candidates and emit actionable warnings.
8. Normalize accepted rows and collect quality flags.
9. Store each source file in one transaction using prepared statements and batches.
10. Create a shared `AuditRunSnapshot` from the stored data needed by eligible agents.
11. Calculate agent activation from actual data and configuration.
12. Run independent agents with limited concurrency while yielding events immediately.
13. Persist findings through controlled repository writes.
14. Optionally enrich deterministic findings with validated LLM output.
15. Persist run metrics and produce the final summary and menu.

## Deterministic Analysis and LLM Reasoning

Deterministic agents remain responsible for numeric and policy truth, including:

- Duplicate comparisons.
- Policy thresholds.
- Reconciliation matching.
- Statistical anomaly calculations.
- SaaS utilization calculations.
- Contract-versus-invoice calculations.
- Cash-flow projections.
- Confidence inputs derived from evidence and data quality.

The optional `ReasoningService` may:

- Resolve ambiguous column or document meaning.
- Relate evidence across records.
- Prioritize findings.
- Produce clear explanations and recommended next steps.
- Answer natural-language questions grounded in stored records and findings.

LLM output must use validated structured schemas. The LLM cannot introduce unsupported amounts, change deterministic evidence, silently override confidence, or create financial actions. Answers cite finding, record, or document identifiers.

If an LLM provider is missing, times out, or returns invalid output, the deterministic audit completes. The result states that enhanced reasoning was unavailable without presenting the audit itself as failed.

Only the minimum evidence required for a reasoning request is sent to the configured provider. API keys and secrets are excluded from prompts, reports, metrics, and scratchpad logs.

## Configuration

`audit.yaml` is loaded and validated once when `WorkspaceContext` is created. Its values flow through typed configuration rather than being read ad hoc.

The configuration controls:

- Company identity and currency.
- Confidence floor.
- Maximum investigation iterations.
- Policy limits and prohibited categories.
- Runway target and operating reserve.
- Scratchpad retention.
- Discovery ignore paths.
- Optional LLM provider and model choices.

Invalid configuration produces a concise message naming the exact field, received value, accepted values, and corrective action. Argus never silently replaces an explicitly invalid value with a default.

## Findings and Audit Records

Every finding stores:

- Finding and run identifiers.
- Originating agent.
- Referenced record and document identifiers.
- Deterministic calculations and comparisons.
- Data-quality warnings.
- Confidence score and contributing reasons.
- Optional LLM explanation.
- Current lifecycle status.
- Human feedback history.

Each audit run stores:

- Start and completion timestamps.
- Source path.
- Per-file outcome and record counts.
- Activated and skipped agents with reasons.
- Stage timings.
- Quality-warning counts.
- LLM usage and failure state without secrets.
- Generated and duplicate-suppressed finding counts.
- Completion, partial-success, cancellation, or failure state.

Source fingerprints make repeated ingestion idempotent. Re-running the same source does not duplicate records.

## Reliability and Failure Isolation

- Each source file is processed independently.
- Each accepted source is committed in one database transaction.
- A failed file rolls back only its own writes.
- A malformed or unknown file cannot corrupt existing trusted records.
- Agent failures are isolated and do not prevent unrelated eligible agents from completing.
- Agent and LLM calls have timeouts.
- Cancellation propagates through discovery, ingestion, agents, and LLM requests.
- `Ctrl+C` leaves the database and workspace in a valid state.
- SQLite uses WAL mode, foreign-key enforcement, integrity checks, and explicit checkpoints.
- Scratchpad events are buffered and flushed in batches instead of synchronously appending every event.

User-facing messages state:

1. What happened.
2. What remained safe or completed.
3. What the user should do next.

Process exit codes remain available for automation but are not explained in the beginner experience.

## Performance Design

The production performance target is approximately 20,000 records per workspace.

Required protections include:

- Prepared statements and transactional batch inserts.
- Cached vendor lookup maps during ingestion instead of scanning all vendors for every row.
- One shared run snapshot for eligible agents.
- Bounded file-classification and agent concurrency.
- A single controlled finding writer to avoid SQLite write contention.
- Targeted indexed repository queries.
- Structured quality fields instead of repeated unindexed searches through raw JSON.
- A bounded CLI event history and throttled rendering for streamed tokens and events.
- No recursive scanning of dependency, build, audit, or hidden metadata directories.

Adding an inactive agent or optional feature must not add database scans, LLM calls, startup work, or background processing to an unrelated audit.

## Visual and Motion Direction

The approved CLI direction uses a dark, instrument-panel aesthetic with restrained cyan and violet accents, clear severity colors, and a strong completion state. Progress feels live without turning the terminal into decorative animation.

Interaction rules:

- Keyboard navigation is immediate.
- Only long-running status indicators animate.
- Completed rows settle and remain readable.
- Warnings persist until the user acknowledges or exits.
- No animation blocks input.
- Reduced-motion output removes movement while preserving status changes.
- Enter and completion feedback remain restrained and professional.

## Build and Distribution

The dependency manifest and lockfile must describe every runtime dependency. A clean checkout must install, type-check, test, and build without relying on undeclared packages already present in `node_modules`.

The release pipeline uses native CI runners for:

- Windows x64.
- macOS Apple Silicon.
- Linux x64.

Each runner builds its standalone binary and executes platform-specific smoke tests. Releases publish versioned artifacts and SHA-256 checksums. `argus --version` reports the application version and target platform.

## Testing Strategy

### Unit tests

- Date, amount, and currency parsing.
- Schema confidence and classification decisions.
- Configuration validation.
- Vendor resolution.
- Agent calculations and confidence scoring.
- LLM structured-output validation and deterministic fallback.

Tests call production functions rather than copied implementations.

### Integration tests

- Temporary SQLite workspace initialization and migration.
- Per-file transactions and rollback.
- Idempotent source ingestion.
- Actual data-driven agent activation.
- Finding persistence and feedback lifecycle.
- Cancellation and timeout behavior.

### End-to-end tests

- `argus audit <single-file>`.
- `argus audit <directory>`.
- Mixed supported, malformed, and unknown files.
- Deterministic operation without API keys.
- Optional reasoning with recorded provider responses.
- Repeated audit without duplicate records.
- Interactive completion menu and non-interactive JSON mode.

### CLI verification

- Snapshot coverage for narrow, standard, and wide terminals.
- Redirected output without ANSI control sequences.
- Reduced-motion behavior.
- Clear recovery instructions for common failures.

### Performance regression

A deterministic 20,000-record CSV fixture measures discovery, ingestion, investigation, total elapsed time, peak memory, query counts, and LLM calls. In deterministic mode on the designated Linux CI performance runner, the initial production gate is a complete audit within 60 seconds and peak resident memory below 512 MiB. The optimized implementation also records stage and query-count baselines. Subsequent changes fail CI when elapsed time or peak memory regresses by more than 15% from the recorded baseline, even when still below the absolute ceiling.

## Production Acceptance Criteria

- TypeScript type-check completes with zero errors.
- `bun test` discovers and passes the real test suite.
- A clean install provides every imported runtime dependency.
- Windows, macOS, and Linux standalone binaries build and pass smoke tests.
- `argus audit <single-file>` and `argus audit <directory>` complete successfully.
- The configuration file is loaded and affects agent execution.
- Status and investigation use the same actual activation decision.
- Investigation events stream as they occur rather than after an agent finishes.
- Low-confidence files are skipped without contaminating stored records.
- Re-running the same source does not duplicate records.
- Core audits complete without an API key.
- Optional LLM output is grounded, validated, and safely fallible.
- The CLI remains usable at narrow terminal widths.
- A 20,000-record performance baseline is captured and enforced.
- Adding an inactive agent creates no measurable work in unrelated audit runs.

## Migration Direction

Implementation should preserve working agent logic while moving it behind the new boundaries. The migration order is:

1. Repair dependency, type-check, build, and test foundations.
2. Introduce configuration loading, migrations, and `WorkspaceContext`.
3. Introduce source identity, transactional batch ingestion, and safe single-file/directory resolution.
4. Introduce the shared activation model, `AgentRegistry`, and `AuditRunSnapshot`.
5. Stream events immediately and isolate finding writes.
6. Implement the simplified one-command CLI and completion menu.
7. Add optional grounded reasoning and `argus ask`.
8. Establish native release builds and the 20,000-record performance gate.

No step requires a second runtime service or changes the local-first storage model.
