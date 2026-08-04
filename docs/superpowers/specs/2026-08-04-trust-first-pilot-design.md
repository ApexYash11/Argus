# Argus Trust-First Pilot Design

## Purpose

Argus will become a trustworthy first-customer pilot for finance teams. The pilot prioritizes precise, reproducible, evidence-backed findings over detector breadth. A release is successful when a finance lead can ingest representative data, run the three production detectors, inspect the exact evidence and rule behind every finding, and verify the downloaded binary's origin.

## Product Positioning

Argus is a local-first financial control system. It is not a general chatbot, an autonomous payment actor, or an ERP replacement. Its core loop is:

1. ingest financial records with source provenance;
2. evaluate deterministic financial controls;
3. create an immutable evidence packet for each candidate finding;
4. surface only findings that pass production quality thresholds;
5. record human review as append-only lifecycle events; and
6. measure precision and recall against versioned evaluation data.

The CLI and SQLite workspace remain the product surface for the pilot. Live connectors, a web interface, team collaboration, and detector plugins are outside this release.

## Detector Maturity Model

Every detector has one of two maturity levels:

- `production`: enabled by default and subject to release-blocking evaluation gates.
- `experimental`: disabled by default, visibly labeled, and excluded from production quality claims.

The production set is:

- `duplicate-payments`
- `reconciliation`
- `policy-violations`

The experimental set is:

- `saas-waste`
- `vendor-overbilling`
- `anomaly-detection`
- `cashflow-risk`

`argus investigate` and `argus audit` run only production detectors by default. `--experimental` adds eligible experimental detectors. Selecting an experimental detector explicitly with `--type` is permitted but prints an experimental warning. `argus status` and reports display maturity alongside activation state.

## Deterministic Financial Decisions

Production detectors own all decisions involving amounts, matches, policy compliance, confidence factors, and severity. Their output must be reproducible from normalized records, workspace configuration, and a versioned rule identifier.

LLMs may be used for document field extraction and natural-language explanation. They may not decide whether two financial records match, compute impact, select severity, or override a policy result. Model output must be validated against an explicit schema before it enters normalized storage.

### Duplicate payments

Duplicate detection groups only cleared, positive payment records with the same currency. A record cannot match itself. Cancelled and pending payments are excluded. Negative and zero amounts are excluded from duplicate candidates and retain their ingestion quality flags. Candidate pairs require the same canonical vendor, amount within the configured tolerance, and dates within the configured window. Exact reference-number equality increases confidence; distinct reference numbers do not independently prove legitimacy. Every finding identifies the two record IDs and their source documents.

### Reconciliation

Reconciliation performs deterministic one-to-one matching between invoices and cleared payments. Matching uses canonical vendor, currency, amount tolerance, and date window. A record can participate in at most one matched pair. The detector distinguishes:

- invoice without payment;
- payment without invoice;
- partial payment; and
- overpayment.

Pending and cancelled payments do not satisfy an invoice. Aging is calculated from the normalized date and recorded as a confidence factor. Evidence includes both matched and unmatched record IDs needed to reproduce the result.

### Policy violations

Policy checks are deterministic and cite a stable rule ID plus the exact configured threshold. The pilot supports receipt requirements, prohibited categories, category limits, submission-window limits, and pre-approval thresholds already represented by workspace configuration. Limits are evaluated in the record currency. Currency-specific overrides may be supplied; if neither a matching override nor the workspace base currency applies, the control returns `not_evaluated` instead of converting money implicitly.

## Evidence and Lifecycle Model

Each surfaced finding stores an immutable `EvidencePacket` containing:

- schema version;
- detector type, maturity, and rule version;
- source document IDs and SHA-256 hashes;
- financial record IDs;
- normalized facts used by the rule;
- comparisons and confidence factors;
- impact amount and currency;
- creation timestamp; and
- a fingerprint derived from stable evidence identity.

Evidence facts are bounded and structured; raw documents are not copied into findings. Once written, the evidence packet is never updated. User actions such as resolve, dismiss, escalate, and reopen are stored as append-only finding events. The current status is derived from the latest valid lifecycle event while the existing status columns remain as a migration-compatible projection.

Ingestion calculates a SHA-256 hash for every source file. Re-ingesting the same content is detectable regardless of filename. Database migrations add new fields without discarding existing workspaces.

## Remote Data Safety

The default workspace policy is `remoteFinancialData: false`. With that setting, raw documents, extracted document text, normalized financial records, evidence packets, and database query results cannot be sent to Groq, OpenRouter, or another remote model.

All remote model calls go through one policy guard and declare their data classification. A remote call containing financial data is rejected unless the workspace has explicit consent. Local deterministic behavior remains available when consent is absent.

Uploaded files and extracted text are untrusted data. They are delimited as data, never concatenated into system instructions, and cannot request tools or alter policy. Remote structured extraction uses strict JSON Schema where the selected provider supports it, followed by local schema validation. Provider errors and invalid output fail closed without writing partial normalized records.

Secrets and raw financial content are excluded from normal logs, error messages, and release telemetry.

## Evaluation and Release Gates

Each production detector has versioned golden fixtures with labeled expected findings. Evaluation matches findings using stable fixture identities rather than generated display IDs. It reports true positives, false positives, false negatives, precision, and recall per detector.

Release-blocking minimums are:

- precision at least `0.90` for every production detector;
- recall at least `0.75` for every production detector;
- zero crashes on empty, malformed, negative, zero, mixed-currency, and repeated-ingestion fixtures; and
- no unapproved remote model call in safety tests.

The evaluator fails when a detector has no labeled cases, preventing vacuous success. Experimental detector metrics are reported but do not block a pilot release.

The automated test layers are:

1. unit tests for pure detector rules, evidence construction, lifecycle reduction, and remote policy;
2. ingestion and database integration tests using temporary workspaces;
3. golden end-to-end evaluations for the production set; and
4. compiled-binary smoke tests for CLI help, initialization, ingestion, investigation, findings, and status.

## Storage and Runtime Hardening

SQLite remains the pilot system of record. Writes use transactions, foreign keys are enabled, and migrations are versioned. New tables use SQLite `STRICT` mode where Bun's bundled SQLite version supports it. WAL mode is used for local workspaces, with documented constraints against network filesystems. Integrity checks are included in status diagnostics.

Ingestion batches writes rather than inserting one record per transaction. Evidence arrays have explicit size limits and preserve summaries plus source references when the limit is reached.

The project must pass strict TypeScript checking. Runtime dependencies used by source files are declared explicitly. Build scripts target Bun so `bun:sqlite` and Node-compatible modules compile correctly.

## Distribution

GitHub Actions is the release authority. Pull requests run dependency installation with the lockfile, typechecking, all tests, golden evaluation, and a Bun-targeted build. Tagged releases additionally build standalone binaries for Windows x64, Linux x64, Linux arm64, macOS x64, and macOS arm64.

Release assets include:

- platform binary;
- SHA-256 checksum manifest;
- keyless Sigstore signature and certificate for each binary; and
- build provenance attestation when supported by the repository's GitHub plan.

The release workflow smoke-tests each native binary on its matching runner before upload. Apple notarization and Windows Authenticode publisher signing are excluded because they require organization-owned credentials; the documentation distinguishes those OS trust indicators from Sigstore verification.

## CLI and Documentation

Help text, the README, status output, and architecture documentation describe the implemented procedural detector engine rather than the removed LangGraph design. User-facing output calls production detectors “controls” where helpful and marks experimental results consistently.

The pilot documentation includes:

- a five-minute local quickstart;
- supported input schemas and data-quality behavior;
- the remote-data policy and consent implications;
- detector maturity and known limitations;
- how to interpret and verify an evidence packet;
- how to run the evaluation suite; and
- how to verify downloaded checksums and Sigstore signatures.

Chat remains available only if it can obey the same remote-data policy. No new chat capabilities are part of this design.

## Error Handling

Failures are explicit and scoped. A malformed file is quarantined with line-level errors; it does not partially enter the canonical record set. A failed detector emits a detector-specific failure and does not prevent other eligible detectors from completing. A timed-out detector is reported as timed out. A rejected remote call explains that workspace consent is required without echoing the blocked data.

Release and evaluation commands use nonzero exit codes on failed gates. CLI error output remains concise by default and offers structured JSON output where automation needs details.

## Compatibility and Migration

Existing `.audit` workspaces migrate in place with a schema-version table and transactional migrations. Existing findings receive a compatibility evidence packet derived from their stored evidence chain and are marked with the legacy rule version. Existing status and feedback remain readable.

No migration deletes source records, findings, feedback, or scratchpad logs. Before changing a workspace schema, Argus creates a recoverable database backup and reports its path.

## Acceptance Criteria

The trust-first pilot is complete when:

1. the three production detectors meet all golden evaluation gates;
2. the four other detectors are experimental and excluded by default;
3. every new production finding has immutable, reproducible source lineage;
4. remote financial data cannot leave the workspace without explicit consent;
5. install, typecheck, test, build, and native binary smoke checks pass in CI;
6. tagged releases produce checksummed and keylessly signed binaries; and
7. public documentation accurately describes behavior, limitations, privacy, and verification.
