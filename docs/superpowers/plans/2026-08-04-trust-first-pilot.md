# Argus Trust-First Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a first-customer pilot in which three deterministic production controls generate reproducible evidence-backed findings, remote financial data is opt-in, quality is release-gated, and standalone releases are verifiable.

**Architecture:** Preserve the current Bun CLI and procedural detector engine. Add shared maturity, evidence, lifecycle, and privacy primitives around it; move production control logic into pure functions; then gate distribution with Bun tests, golden evaluation, compiled smoke tests, checksums, and Sigstore provenance.

**Tech Stack:** Bun 1.3+, TypeScript 5, bun:test, bun:sqlite, Zod 4, Ink 7, GitHub Actions, Sigstore cosign.

## Global Constraints

- Only `duplicate-payments`, `reconciliation`, and `policy-violations` are production controls.
- Remote financial data is disabled by default and every remote call must pass one central policy guard.
- LLMs never decide amounts, matches, compliance, confidence, or severity.
- New production findings carry immutable evidence packets with source lineage and rule versions.
- Production detector precision must be at least `0.90`; recall must be at least `0.75`.
- Existing `.audit` workspaces migrate without deleting records, findings, feedback, or scratchpads.
- Tagged releases include native smoke-tested binaries, SHA-256 checksums, and keyless Sigstore verification material.

---

### Task 1: Establish a Reliable Test, Typecheck, and Build Baseline

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `src/db/queries.ts`
- Modify: `src/cli/commands/ingest.ts`
- Modify: `src/ingest/contract-parser.ts`
- Modify: `src/ingest/normalizer.ts`
- Modify: `src/ingest/pdf-extractor.ts`
- Modify: `src/ingest/xlsx-parser.ts`
- Modify: `src/llm/groq.ts`
- Modify: `src/llm/openrouter.ts`
- Modify: `src/llm/local-fallback.ts`
- Create: `src/__tests__/smoke.test.ts`

**Interfaces:**
- Produces: `bun run typecheck`, `bun test`, and `bun run build` as stable local/CI gates.
- Produces: a Bun-targeted `dist/index.js` bundle and explicit runtime dependencies for `ink-text-input`, `xlsx`, and `react-devtools-core`.

- [ ] **Step 1: Write the failing smoke test**

```ts
import { describe, expect, test } from "bun:test";
import { generateFingerprint } from "../engine/finding-builder";

describe("release smoke", () => {
  test("core modules load and fingerprints are deterministic", () => {
    expect(generateFingerprint("duplicate-payments", "V1", 42, "2026-01"))
      .toBe(generateFingerprint("duplicate-payments", "V1", 42, "2026-01"));
  });
});
```

- [ ] **Step 2: Run the baseline gates and record the expected failures**

Run: `bun test src/__tests__/smoke.test.ts && bunx tsc --noEmit && bun run build`

Expected: the test passes, typecheck fails on Bun SQL binding overloads and unsafe indexed access, and build fails on missing packages plus the browser-default target.

- [ ] **Step 3: Add explicit scripts and runtime dependencies**

Set scripts to:

```json
{
  "test": "bun test",
  "typecheck": "tsc --noEmit",
  "build": "bun build src/cli/index.tsx --target=bun --outdir dist",
  "check": "bun run typecheck && bun test && bun run build"
}
```

Declare `ink-text-input`, `xlsx`, and `react-devtools-core` under `dependencies`; keep `typescript` and `@types/bun` under `devDependencies`.

- [ ] **Step 4: Fix strict type errors without changing behavior**

Use Bun's named-binding object overload consistently by assigning query statements before `.run()`/`.get()`, narrow `Response.json()` payloads with provider response interfaces, and guard optional array/index access. Do not relax compiler flags.

- [ ] **Step 5: Verify all baseline gates pass**

Run: `bun install && bun run check`

Expected: exit `0`, no TypeScript errors, all Bun tests pass, and `dist/index.js` is produced.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock tsconfig.json src src/__tests__/smoke.test.ts
git commit -m "build: establish release quality gates"
```

### Task 2: Add Detector Maturity and Default Production Routing

**Files:**
- Create: `src/agents/catalog.ts`
- Create: `src/agents/catalog.test.ts`
- Modify: `src/model/types.ts`
- Modify: `src/agents/supervisor.ts`
- Modify: `src/engine/activation.ts`
- Modify: `src/cli/index.tsx`
- Modify: `src/cli/commands/investigate.ts`
- Modify: `src/cli/commands/audit.ts`
- Modify: `src/cli/commands/status.ts`
- Modify: `src/cli/commands/report.ts`
- Modify: `src/cli/commands/chat.tsx`

**Interfaces:**
- Produces: `type DetectorMaturity = "production" | "experimental"`.
- Produces: `getDetectorMetadata(agent: AgentType): DetectorMetadata` and `selectDetectors(options: { requested?: AgentType; includeExperimental?: boolean }): AgentType[]`.
- Changes: `runSupervisor(..., options?: { requestedType?: AgentType; includeExperimental?: boolean; ... })` runs production controls by default.

- [ ] **Step 1: Write failing catalog tests**

```ts
import { expect, test } from "bun:test";
import { getDetectorMetadata, selectDetectors } from "./catalog";

test("default routing selects only production controls", () => {
  expect(selectDetectors({})).toEqual([
    "duplicate-payments", "policy-violations", "reconciliation",
  ]);
});

test("explicit experimental selection is allowed and labeled", () => {
  expect(selectDetectors({ requested: "cashflow-risk" })).toEqual(["cashflow-risk"]);
  expect(getDetectorMetadata("cashflow-risk").maturity).toBe("experimental");
});
```

- [ ] **Step 2: Verify the catalog tests fail**

Run: `bun test src/agents/catalog.test.ts`

Expected: FAIL because `catalog.ts` does not exist.

- [ ] **Step 3: Implement the immutable detector catalog**

```ts
export interface DetectorMetadata {
  type: AgentType;
  maturity: DetectorMaturity;
  ruleVersion: string;
}

export const DETECTOR_CATALOG: readonly DetectorMetadata[] = [
  { type: "duplicate-payments", maturity: "production", ruleVersion: "duplicate-payments/1" },
  { type: "policy-violations", maturity: "production", ruleVersion: "policy-violations/1" },
  { type: "reconciliation", maturity: "production", ruleVersion: "reconciliation/1" },
  { type: "saas-waste", maturity: "experimental", ruleVersion: "saas-waste/legacy" },
  { type: "vendor-overbilling", maturity: "experimental", ruleVersion: "vendor-overbilling/legacy" },
  { type: "anomaly-detection", maturity: "experimental", ruleVersion: "anomaly-detection/legacy" },
  { type: "cashflow-risk", maturity: "experimental", ruleVersion: "cashflow-risk/legacy" },
] as const;
```

- [ ] **Step 4: Route CLI, audit, chat, status, and report through the catalog**

Add the boolean `--experimental` flag. Default calls omit experimental detectors. Explicit experimental `--type` emits a visible warning event. Add `maturity` to activation and report rows.

- [ ] **Step 5: Run catalog and CLI tests**

Run: `bun test src/agents/catalog.test.ts && bun run src/cli/index.tsx --help`

Expected: tests pass and help lists `--experimental` for `audit` and `investigate`.

- [ ] **Step 6: Commit**

```bash
git add src/agents/catalog.ts src/agents/catalog.test.ts src/model/types.ts src/agents/supervisor.ts src/engine/activation.ts src/cli
git commit -m "feat: gate experimental detectors by default"
```

### Task 3: Add Source Provenance, Immutable Evidence Packets, and Lifecycle Events

**Files:**
- Create: `src/engine/evidence-packet.ts`
- Create: `src/engine/evidence-packet.test.ts`
- Create: `src/engine/finding-lifecycle.ts`
- Create: `src/engine/finding-lifecycle.test.ts`
- Modify: `src/model/types.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/index.ts`
- Modify: `src/db/queries.ts`
- Modify: `src/cli/commands/ingest.ts`
- Modify: `src/agents/nodes/generate-finding.ts`
- Modify: `src/cli/commands/feedback.ts`

**Interfaces:**
- Produces: `EvidencePacketV1`, `buildEvidencePacket(input): EvidencePacketV1`, and `fingerprintEvidence(packet): string`.
- Produces: `FindingLifecycleEvent` and `reduceFindingStatus(events): FindingStatus`.
- Produces DB queries: `insertFindingEvent`, `getFindingEvents`, `getDocumentByHash`, and transactional finding insertion.

- [ ] **Step 1: Write failing evidence and lifecycle tests**

```ts
test("evidence fingerprint is stable across display ordering", () => {
  const one = buildEvidencePacket(fixture({ recordIds: ["R2", "R1"] }));
  const two = buildEvidencePacket(fixture({ recordIds: ["R1", "R2"] }));
  expect(fingerprintEvidence(one)).toBe(fingerprintEvidence(two));
});

test("latest lifecycle event derives status without mutating evidence", () => {
  expect(reduceFindingStatus([
    event("created"), event("dismissed"), event("reopened"), event("resolved"),
  ])).toBe("resolved");
});
```

- [ ] **Step 2: Verify both tests fail for missing modules**

Run: `bun test src/engine/evidence-packet.test.ts src/engine/finding-lifecycle.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement evidence and lifecycle pure functions**

`EvidencePacketV1` must contain `schemaVersion: 1`, detector metadata, sorted unique source document IDs/hashes and record IDs, bounded structured facts, comparisons, confidence factors, impact, and `createdAt`. Fingerprinting excludes timestamps and display prose.

- [ ] **Step 4: Add transactional migrations and backup behavior**

Add `schema_migrations`, document `sha256`, finding `evidence_packet`, and `finding_events` tables/columns. Before applying a pending migration, copy `spend-auditor.db` to `.audit/backups/spend-auditor-<timestamp>.db`; execute each migration in a transaction and record its version.

- [ ] **Step 5: Hash source files and persist immutable packets**

Use `Bun.CryptoHasher("sha256")` or `crypto.createHash("sha256")` over file bytes during ingestion. `generateFinding` builds the packet once, inserts finding plus `created` event transactionally, and never updates `evidence_packet`.

- [ ] **Step 6: Record feedback as lifecycle events**

Keep compatibility status columns updated in the same transaction, but derive new reads from ordered lifecycle events. Add `reopened` to `FindingStatus` transitions only where explicitly supported by the reducer.

- [ ] **Step 7: Run unit and migration integration tests**

Run: `bun test src/engine/evidence-packet.test.ts src/engine/finding-lifecycle.test.ts src/db`

Expected: stable fingerprints, append-only lifecycle behavior, migration backup creation, and existing workspace data preservation pass.

- [ ] **Step 8: Commit**

```bash
git add src/engine src/model/types.ts src/db src/cli/commands/ingest.ts src/cli/commands/feedback.ts src/agents/nodes/generate-finding.ts
git commit -m "feat: add immutable finding provenance"
```

### Task 4: Make Duplicate-Payment Detection Deterministic

**Files:**
- Create: `src/agents/controls/duplicate-payments.ts`
- Create: `src/agents/controls/duplicate-payments.test.ts`
- Modify: `src/agents/duplicate-payments.ts`

**Interfaces:**
- Produces: `detectDuplicatePayments(records: readonly FinancialRecord[], options: DuplicateOptions): DuplicateCandidate[]`.
- `DuplicateCandidate` contains `recordIds`, `sourceDocIds`, `vendorId`, `currency`, `impactAmount`, `confidenceFactors`, and structured comparisons.

- [ ] **Step 1: Write failing edge-case tests**

Cover exact duplicates, self-match prevention, mixed currencies, pending/cancelled rows, negative refunds, zero amounts, different vendors, outside date window, and stable pair ordering.

```ts
test("does not pair equal amounts in different currencies", () => {
  expect(detectDuplicatePayments([
    payment("A", 100, "USD"), payment("B", 100, "INR"),
  ], defaults)).toEqual([]);
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `bun test src/agents/controls/duplicate-payments.test.ts`

Expected: FAIL because the pure detector does not exist.

- [ ] **Step 3: Implement the minimum pure pair detector**

Filter to cleared positive payments, group by canonical vendor and currency, compare each stable pair once, apply amount/date tolerance, and return structured candidates sorted by stable record identity.

- [ ] **Step 4: Adapt the registered agent to pure candidates**

The registered agent retrieves records, invokes the pure detector once, converts candidates to events, scores from named confidence factors, and passes candidate evidence to `generateFinding`. Remove confidence parsing from display strings.

- [ ] **Step 5: Run duplicate tests and the end-to-end pipeline**

Run: `bun test src/agents/controls/duplicate-payments.test.ts && bun run src/__tests__/e2e-pipeline.ts`

Expected: all edge cases pass and the seeded duplicate finding remains detectable.

- [ ] **Step 6: Commit**

```bash
git add src/agents/controls/duplicate-payments.ts src/agents/controls/duplicate-payments.test.ts src/agents/duplicate-payments.ts
git commit -m "feat: harden duplicate payment control"
```

### Task 5: Implement One-to-One Reconciliation

**Files:**
- Create: `src/agents/controls/reconciliation.ts`
- Create: `src/agents/controls/reconciliation.test.ts`
- Modify: `src/agents/reconciliation.ts`

**Interfaces:**
- Produces: `reconcileRecords(invoices, payments, options): ReconciliationResult`.
- `ReconciliationResult` contains `matchedPairs` plus issues of type `invoice_without_payment`, `payment_without_invoice`, `partial_payment`, or `overpayment`.

- [ ] **Step 1: Write failing one-to-one and issue classification tests**

Include one payment/two invoices, two payments/one invoice, mixed currencies, pending payment, exact match, partial payment, overpayment, and deterministic tie-breaking by date delta then record ID.

- [ ] **Step 2: Verify the tests fail**

Run: `bun test src/agents/controls/reconciliation.test.ts`

Expected: FAIL because `reconcileRecords` does not exist.

- [ ] **Step 3: Implement deterministic candidate ranking and one-to-one matching**

Build eligible same-vendor/currency pairs, rank by amount fit, absolute date delta, then stable IDs, and consume each record once. Classify unmatched near-pairs as partial/overpayment and remaining records as missing counterpart issues.

- [ ] **Step 4: Adapt the registered reconciliation agent**

Replace vendor-total comparisons with `ReconciliationResult`. Use an injected/reference date for aging so tests are deterministic. Emit issue-specific evidence and packet inputs.

- [ ] **Step 5: Run reconciliation and pipeline tests**

Run: `bun test src/agents/controls/reconciliation.test.ts && bun run src/__tests__/e2e-pipeline.ts`

Expected: one-to-one behavior passes and no existing pipeline stage crashes.

- [ ] **Step 6: Commit**

```bash
git add src/agents/controls/reconciliation.ts src/agents/controls/reconciliation.test.ts src/agents/reconciliation.ts
git commit -m "feat: add one-to-one reconciliation control"
```

### Task 6: Add Rule-Cited, Currency-Safe Policy Evaluation

**Files:**
- Create: `src/agents/controls/policy-violations.ts`
- Create: `src/agents/controls/policy-violations.test.ts`
- Modify: `src/model/types.ts`
- Modify: `src/model/schemas.ts`
- Modify: `src/agents/policy-violations.ts`
- Modify: `audit.yaml`

**Interfaces:**
- Produces: `evaluatePolicy(records, policy, workspaceCurrency, now): PolicyEvaluation[]`.
- Adds `PolicyLimit = number | Record<string, number>` input compatibility and normalized `CurrencyPolicyLimit` output.
- Each evaluation has `ruleId`, `result: "violation" | "pass" | "not_evaluated"`, threshold, actual value, currency, and record IDs.

- [ ] **Step 1: Write failing policy tests**

Cover receipt, prohibited category, category limit, submission window, pre-approval, base-currency compatibility, currency override, and unsupported currency returning `not_evaluated`.

- [ ] **Step 2: Verify tests fail**

Run: `bun test src/agents/controls/policy-violations.test.ts`

Expected: FAIL because the pure evaluator does not exist.

- [ ] **Step 3: Extend schema with backward-compatible currency limits**

Accept existing numeric thresholds as workspace-base-currency values and currency maps such as `{ USD: 100, INR: 8000 }`. Reject unknown currency keys that are not three uppercase letters.

- [ ] **Step 4: Implement and adapt policy evaluation**

Evaluate each configured rule independently, cite stable IDs such as `policy/receipt-required/1`, and do not create findings from `not_evaluated`. Aggregate violations per report/source document while retaining individual rule evidence.

- [ ] **Step 5: Run policy and config tests**

Run: `bun test src/agents/controls/policy-violations.test.ts src/model`

Expected: all deterministic and compatibility cases pass.

- [ ] **Step 6: Commit**

```bash
git add src/agents/controls/policy-violations.ts src/agents/controls/policy-violations.test.ts src/agents/policy-violations.ts src/model audit.yaml
git commit -m "feat: make policy controls currency safe"
```

### Task 7: Enforce Opt-In Remote Financial Data

**Files:**
- Create: `src/llm/remote-data-policy.ts`
- Create: `src/llm/remote-data-policy.test.ts`
- Modify: `src/model/types.ts`
- Modify: `src/model/schemas.ts`
- Modify: `src/llm/groq.ts`
- Modify: `src/llm/openrouter.ts`
- Modify: `src/ingest/schema-detector.ts`
- Modify: `src/ingest/contract-parser.ts`
- Modify: `src/agents/nodes/generate-finding.ts`
- Modify: `src/cli/commands/chat.tsx`
- Modify: `src/cli/commands/init.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `type DataClassification = "public" | "financial" | "raw-document"`.
- Produces: `assertRemoteDataAllowed(config, classification): void` and `RemoteDataDeniedError`.
- Changes provider calls to accept `{ classification, config }` metadata before prompt content.

- [ ] **Step 1: Write failing deny-by-default tests**

```ts
test("financial prompts are denied by default", () => {
  expect(() => assertRemoteDataAllowed(baseConfig(), "financial"))
    .toThrow("Remote financial data is disabled");
});

test("explicit workspace consent allows financial prompts", () => {
  expect(() => assertRemoteDataAllowed(consentingConfig(), "financial")).not.toThrow();
});
```

- [ ] **Step 2: Verify the policy tests fail**

Run: `bun test src/llm/remote-data-policy.test.ts`

Expected: FAIL because the guard does not exist.

- [ ] **Step 3: Add privacy config and central guard**

Add `privacy.remoteFinancialData` with default `false`. Public prompts remain allowed. Financial and raw-document prompts require `true`; errors contain classification and remediation but never prompt content.

- [ ] **Step 4: Route every remote provider call through the guard**

Require classification metadata in Groq/OpenRouter APIs and update all call sites. Delimit untrusted file text inside explicit data markers. Validate structured extraction locally before persistence. Chat tool results and database summaries are classified as financial.

- [ ] **Step 5: Add call-site safety tests**

Inject a fake fetch/provider transport and assert zero transport calls occur when consent is absent. Assert log/error text never contains fixture financial values.

- [ ] **Step 6: Run privacy and integration tests**

Run: `bun test src/llm src/ingest src/agents/nodes`

Expected: deny-by-default and explicit-consent behavior pass with no network calls in tests.

- [ ] **Step 7: Commit**

```bash
git add src/llm src/model src/ingest/schema-detector.ts src/ingest/contract-parser.ts src/agents/nodes/generate-finding.ts src/cli/commands/chat.tsx src/cli/commands/init.ts .env.example
git commit -m "feat: require consent for remote financial data"
```

### Task 8: Build Golden Precision and Recall Gates

**Files:**
- Create: `src/evaluation/types.ts`
- Create: `src/evaluation/evaluate.ts`
- Create: `src/evaluation/evaluate.test.ts`
- Create: `scripts/evaluate-golden.ts`
- Create: `test-data/golden/duplicate-payments.json`
- Create: `test-data/golden/reconciliation.json`
- Create: `test-data/golden/policy-violations.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `evaluateDetector(actual, expected): DetectorMetrics` with TP, FP, FN, precision, recall, and pass.
- Produces: `bun run evaluate` with nonzero exit on empty labels or threshold failure.

- [ ] **Step 1: Write failing metric tests**

Cover perfect, false-positive, false-negative, mixed, and empty-label cases. Empty labels must throw `Evaluation dataset contains no labeled cases`.

- [ ] **Step 2: Verify tests fail**

Run: `bun test src/evaluation/evaluate.test.ts`

Expected: FAIL because the evaluator does not exist.

- [ ] **Step 3: Implement metrics and stable fixture matching**

Match on detector type plus sorted fixture record IDs and rule ID. Compute zero-denominator precision/recall explicitly; never treat an empty dataset as passing.

- [ ] **Step 4: Add labeled golden datasets for all production controls**

Each dataset includes positive and negative cases for every edge case introduced in Tasks 4–6. Keep fixtures synthetic and free of customer data.

- [ ] **Step 5: Add the release-gating CLI**

`scripts/evaluate-golden.ts` runs pure controls, prints per-detector metrics, and exits `1` when precision is below `0.90`, recall below `0.75`, or cases are empty.

- [ ] **Step 6: Run evaluator tests and gate**

Run: `bun test src/evaluation/evaluate.test.ts && bun run evaluate`

Expected: all metric tests pass and each production detector clears both thresholds.

- [ ] **Step 7: Commit**

```bash
git add src/evaluation scripts/evaluate-golden.ts test-data/golden package.json
git commit -m "test: gate production control quality"
```

### Task 9: Add CI, Native Release Builds, Checksums, and Signatures

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `scripts/smoke-binary.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: PR gate for install, typecheck, tests, golden evaluation, and Bun build.
- Produces: tag workflow for Windows x64, Linux x64/arm64, and macOS x64/arm64 binaries with checksum and Sigstore assets.

- [ ] **Step 1: Write the binary smoke script before release workflow**

The script accepts a binary path, creates a temporary workspace, and asserts exit `0` for `--help`, `init`, fixture `ingest`, `investigate`, `findings`, and `status`.

- [ ] **Step 2: Verify smoke fails without a compiled binary**

Run: `bun run scripts/smoke-binary.ts dist/missing-argus`

Expected: FAIL with `Binary not found`.

- [ ] **Step 3: Add CI workflow**

Use `oven-sh/setup-bun`, `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`, `bun run evaluate`, and `bun run build` on Windows, Ubuntu, and macOS.

- [ ] **Step 4: Add native release matrix**

Compile on matching runners, smoke-test natively, upload per-platform artifacts, assemble a SHA-256 manifest, install cosign, and sign each blob keylessly with GitHub OIDC. Attach `.sig` and `.pem` files. Add GitHub build-provenance attestation behind the supported repository permission.

- [ ] **Step 5: Validate workflows and local native smoke**

Run: `bun run compile:win && bun run scripts/smoke-binary.ts dist/argus.exe`

Expected: compiled Windows binary completes the smoke workflow.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows scripts/smoke-binary.ts package.json .gitignore
git commit -m "ci: add verifiable native releases"
```

### Task 10: Align Documentation and Complete Release Verification

**Files:**
- Modify: `README.md`
- Modify: `DEVELOPMENT_PLAN.md`
- Modify: `docs/architecture-comparison.md`
- Modify: `docs/production-readiness-analysis.md`
- Create: `docs/security-and-privacy.md`
- Create: `docs/release-verification.md`

**Interfaces:**
- Documents: actual procedural engine, maturity behavior, supported schemas, evidence packets, remote-data consent, evaluation, known limits, and release verification.

- [ ] **Step 1: Add documentation assertions to smoke tests**

Verify README command examples use `argus`, name all three production controls, document `--experimental`, and contain checksum plus Sigstore verification commands.

- [ ] **Step 2: Verify documentation assertions fail**

Run: `bun test src/__tests__/smoke.test.ts`

Expected: FAIL because current README still claims LangGraph and omits maturity/privacy/release verification.

- [ ] **Step 3: Rewrite user-facing documentation to match behavior**

Include the five-minute quickstart, exact input expectations, evidence inspection, default privacy behavior, experimental limitations, evaluation command, release checksums, and `cosign verify-blob --certificate ... --signature ...` example.

- [ ] **Step 4: Update historical architecture documents without erasing history**

Mark old LangGraph and all-seven-production descriptions as superseded by the trust-first pilot. Resolve contradictory pending/fixed tables with current code evidence.

- [ ] **Step 5: Run the complete verification suite**

Run:

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run evaluate
bun run build
bun run compile:win
bun run scripts/smoke-binary.ts dist/argus.exe
git diff --check
```

Expected: every command exits `0`, tests emit no unexpected warnings, and Git reports no whitespace errors.

- [ ] **Step 6: Commit**

```bash
git add README.md DEVELOPMENT_PLAN.md docs src/__tests__/smoke.test.ts
git commit -m "docs: publish trust-first pilot guidance"
```

### Task 11: Final Review, Push, and Pull Request

**Files:**
- Review all files changed from `origin/v1`.

**Interfaces:**
- Produces: a pushed `v2-trust-first-pilot` branch and PR targeting `v1`.

- [ ] **Step 1: Review the complete diff and commit history**

Run: `git diff --stat origin/v1...HEAD && git log --oneline origin/v1..HEAD`

Expected: only trust-first pilot, release, tests, and documentation changes are present; commits are focused and conventional.

- [ ] **Step 2: Re-run release verification from a clean state**

Run: `bun run check && bun run evaluate && bun run compile:win && bun run scripts/smoke-binary.ts dist/argus.exe`

Expected: all commands exit `0` immediately before push.

- [ ] **Step 3: Push without rewriting history**

Run: `git push -u origin v2-trust-first-pilot`

- [ ] **Step 4: Open the PR against `v1`**

Use a PR body with sections for summary, trust model, tests, release artifacts, known limitations, and follow-ups. Do not claim Apple notarization or Windows Authenticode signing.

- [ ] **Step 5: Inspect CI and address every failure**

Run: `gh pr checks --watch`

Expected: all required checks pass before final handoff.
