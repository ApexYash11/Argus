# Argus Production CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a production-ready, one-command Argus audit workflow with deterministic financial analysis, optional grounded LLM reasoning, safe ingestion, responsive terminal output, and standalone Windows, macOS, and Linux binaries.

**Architecture:** Keep Argus as a Bun/TypeScript modular monolith backed by SQLite. Introduce a typed workspace context, application-level audit service, transactional ingestion, a declarative agent registry, a shared run snapshot, repository-owned persistence, optional LLM adapters, and presentation-only CLI renderers.

**Tech Stack:** Bun 1.3+, TypeScript 5, React 19, Ink 7, SQLite via `bun:sqlite`, Zod 4, `yaml`, `csv-parse`, `xlsx`, `pdf-parse`, Bun test, GitHub Actions.

## Global Constraints

- The default user workflow is exactly `argus audit <file-or-directory>`.
- A single-file audit uses the file's parent directory as its workspace.
- Automatic ingestion requires schema confidence `>= 0.80`; lower-confidence files require an explicit `--type` override.
- Core audits must complete without an API key; LLM reasoning is optional.
- Deterministic calculations and stored evidence are authoritative.
- The supported production scale is approximately 20,000 records per workspace.
- The deterministic 20,000-record CSV audit must complete within 60 seconds and below 512 MiB peak RSS on the designated Linux CI runner.
- Windows x64, macOS Apple Silicon, and Linux x64 standalone binaries are first-class release targets.
- New inactive agents must add no database scans, LLM calls, startup work, or background processing to unrelated audit runs.
- Keyboard navigation is immediate; only long-running work and meaningful completion feedback animate.
- Never send API keys, unrelated raw records, or secrets to an LLM provider.

---

## Planned File Structure

```text
src/
├── app/
│   ├── audit-service.ts              # Complete audit use case and event stream
│   ├── audit-run-context.ts          # Shared snapshot, metrics, cancellation
│   └── workspace-context.ts          # Resolved workspace, config, db, providers
├── config/
│   └── load-config.ts                # YAML parsing and Zod validation
├── db/
│   ├── index.ts                      # Connection lifecycle only
│   ├── migrations.ts                 # Ordered schema versions
│   ├── repositories/
│   │   ├── audit-run-repository.ts
│   │   ├── finding-repository.ts
│   │   ├── record-repository.ts
│   │   ├── source-repository.ts
│   │   └── vendor-repository.ts
│   └── test-utils.ts                 # Temporary database helper
├── ingest/
│   ├── discovery.ts                  # File/directory resolution and ignore rules
│   ├── classification.ts             # Bounded schema classification and acceptance
│   ├── ingestion-service.ts          # Transactional, idempotent ingestion
│   └── source-fingerprint.ts          # Stable file and record identities
├── agents/
│   ├── registry.ts                   # Declarative requirements and definitions
│   ├── snapshot.ts                   # Shared indexed read model
│   └── runner.ts                     # Immediate events and bounded concurrency
├── llm/
│   ├── provider.ts                   # Unified provider contract
│   ├── reasoning-service.ts          # Grounded explanations and answers
│   └── schemas.ts                    # Validated structured LLM output
├── cli/
│   ├── presenters/
│   │   ├── interactive-presenter.tsx
│   │   ├── json-presenter.ts
│   │   └── text-presenter.ts
│   ├── components/
│   │   ├── AuditProgress.tsx
│   │   ├── CompletionMenu.tsx
│   │   └── ResponsiveFindings.tsx
│   └── commands/
│       ├── audit.ts                  # Thin adapter to AuditService
│       └── ask.ts                    # Grounded optional LLM questions
└── __tests__/
    ├── fixtures/
    ├── integration/
    └── e2e/
```

Existing focused parser and agent files remain in place. Large command, query, and orchestration files are reduced as behavior moves behind these boundaries.

---

### Task 1: Restore a Reproducible Build and Real Test Runner

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `src/cli/commands/ingest.ts`
- Modify: `src/db/queries.ts`
- Modify: `src/ingest/contract-parser.ts`
- Modify: `src/ingest/normalizer.ts`
- Modify: `src/ingest/pdf-extractor.ts`
- Modify: `src/ingest/xlsx-parser.ts`
- Modify: `src/llm/groq.ts`
- Modify: `src/llm/local-fallback.ts`
- Modify: `src/llm/openrouter.ts`
- Create: `src/__tests__/smoke/toolchain.test.ts`

**Interfaces:**
- Consumes: existing CLI entry point `src/cli/index.tsx`.
- Produces: `bun run typecheck`, `bun test`, `bun run build`, and all three compile scripts as stable verification commands.

- [ ] **Step 1: Add the failing toolchain smoke test**

Create `src/__tests__/smoke/toolchain.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import packageJson from "../../../package.json";

describe("toolchain manifest", () => {
  test("declares every directly imported runtime package", () => {
    const dependencies = packageJson.dependencies as Record<string, string>;
    for (const name of ["ink-text-input", "react-devtools-core", "xlsx", "yaml"]) {
      expect(dependencies[name]).toBeString();
    }
  });

  test("build targets Bun", () => {
    expect(packageJson.scripts.build).toContain("--target bun");
  });
});
```

- [ ] **Step 2: Run the smoke test and type-check to confirm the current failures**

Run:

```powershell
bun test src/__tests__/smoke/toolchain.test.ts
bun x tsc --noEmit
bun run build
```

Expected: the smoke test fails for undeclared packages, TypeScript reports the current binding/nullability/unknown-response errors, and the build fails because it lacks `--target bun` and `react-devtools-core`.

- [ ] **Step 3: Repair the dependency manifest and scripts**

Update `package.json` scripts to:

```json
{
  "test": "bun test",
  "typecheck": "tsc --noEmit",
  "build": "bun build --target bun src/cli/index.tsx --outdir dist",
  "compile": "bun build --compile --target=bun-linux-x64 src/cli/index.tsx --outfile dist/argus-linux",
  "compile:win": "bun build --compile --target=bun-windows-x64 src/cli/index.tsx --outfile dist/argus.exe",
  "compile:mac": "bun build --compile --target=bun-darwin-arm64 src/cli/index.tsx --outfile dist/argus-mac"
}
```

Install every direct import and keep compiler tooling in `devDependencies`:

```powershell
bun add ink-text-input@6 react-devtools-core@6 xlsx@0.18 yaml@2
bun add --dev typescript@5 @types/bun@1
```

Commit the resulting `package.json` and `bun.lock` changes together.

- [ ] **Step 4: Fix all current TypeScript errors without weakening strictness**

Use prepared query objects for named SQLite parameters:

```ts
const insertRecord = db.query(`
  INSERT OR REPLACE INTO financial_records
  (id, type, vendor_id, amount, currency, date, period_start, period_end,
   description, status, source_doc_id, raw, ingested_at)
  VALUES ($id, $type, $vendorId, $amount, $currency, $date, $periodStart,
          $periodEnd, $description, $status, $sourceDocId, $raw, $ingestedAt)
`);
insertRecord.run({ $id: record.id, $type: record.type, $vendorId: record.vendorId,
  $amount: record.amount, $currency: record.currency, $date: record.date,
  $periodStart: record.periodStart ?? null, $periodEnd: record.periodEnd ?? null,
  $description: record.description ?? null, $status: record.status,
  $sourceDocId: record.sourceDocId ?? null, $raw: record.raw,
  $ingestedAt: record.ingestedAt });
```

Validate provider JSON before property access:

```ts
const ChatCompletionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }),
  })).min(1),
});
const data = ChatCompletionSchema.parse(await res.json());
const content = data.choices[0]!.message.content;
```

For array-derived values, return or throw explicitly when the element is absent instead of assigning `string | undefined`. Update the PDF page-count access to the actual `pdf-parse` result shape verified by its installed type declarations.

- [ ] **Step 5: Verify the restored foundation**

Run:

```powershell
bun run typecheck
bun test
bun run build
```

Expected: all commands exit `0`; Bun discovers at least one `.test.ts` file; `dist/index.js` is created.

- [ ] **Step 6: Commit the foundation**

```powershell
git add package.json bun.lock src/cli/commands/ingest.ts src/db/queries.ts src/ingest src/llm src/__tests__/smoke/toolchain.test.ts
git commit -m "build: restore reproducible toolchain"
```

---

### Task 2: Add Versioned Migrations, Configuration Loading, and WorkspaceContext

**Files:**
- Create: `src/db/migrations.ts`
- Create: `src/config/load-config.ts`
- Create: `src/app/workspace-context.ts`
- Create: `src/db/test-utils.ts`
- Create: `src/__tests__/integration/workspace-context.test.ts`
- Modify: `src/db/index.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/model/schemas.ts`
- Modify: `src/model/types.ts`
- Modify: `src/cli/commands/init.ts`

**Interfaces:**
- Produces: `loadConfig(workspaceDir: string): AppConfig`.
- Produces: `resolveAuditTarget(inputPath: string): AuditTarget`.
- Produces: `createWorkspaceContext(inputPath: string, overrides?: WorkspaceOverrides): Promise<WorkspaceContext>`.
- Produces: `runMigrations(db: Database): void`.

- [ ] **Step 1: Write failing workspace and configuration tests**

Create `src/__tests__/integration/workspace-context.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createWorkspaceContext, resolveAuditTarget } from "../../app/workspace-context";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    if (!dir.startsWith(tmpdir())) throw new Error(`Unsafe test path: ${dir}`);
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("WorkspaceContext", () => {
  test("uses a single file's parent as the workspace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "argus-workspace-"));
    dirs.push(dir);
    const file = join(dir, "transactions.csv");
    writeFileSync(file, "date,vendor,amount\n2026-01-01,AWS,10\n");
    expect(resolveAuditTarget(file)).toEqual({
      inputPath: file,
      workspaceDir: dir,
      kind: "file",
    });
  });

  test("loads YAML values into typed config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "argus-config-"));
    dirs.push(dir);
    writeFileSync(join(dir, "audit.yaml"), "company: Acme\ncurrency: USD\nconfidenceFloor: 0.72\nautoAcceptConfidence: 0.82\n");
    const ctx = await createWorkspaceContext(dir);
    expect(ctx.config.company).toBe("Acme");
    expect(ctx.config.confidenceFloor).toBe(0.72);
    expect(ctx.config.autoAcceptConfidence).toBe(0.82);
    ctx.close();
  });
});
```

- [ ] **Step 2: Run the workspace tests to verify missing interfaces**

Run:

```powershell
bun test src/__tests__/integration/workspace-context.test.ts
```

Expected: FAIL because `workspace-context.ts` does not exist.

- [ ] **Step 3: Extend and validate the configuration schema**

Add exact defaults to `ConfigSchema`:

```ts
autoAcceptConfidence: z.number().min(0).max(1).default(0.8),
discovery: z.object({
  ignore: z.array(z.string()).default([]),
  classificationConcurrency: z.number().int().min(1).max(8).default(4),
}).default({ ignore: [], classificationConcurrency: 4 }),
agents: z.object({
  concurrency: z.number().int().min(1).max(4).default(2),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
}).default({ concurrency: 2, timeoutMs: 120_000 }),
llm: z.object({
  enabled: z.boolean().default(true),
  provider: z.enum(["groq", "openrouter"]).default("groq"),
  reasoningModel: z.string().min(1).default("llama-3.3-70b-versatile"),
}).default({ enabled: true, provider: "groq", reasoningModel: "llama-3.3-70b-versatile" }),
```

Keep the existing `confidenceFloor` setting for agent finding confidence and add `autoAcceptConfidence` exclusively for file classification; neither value may serve as a fallback for the other. Use `yaml.parse` in `loadConfig`. Convert `ZodError` issues into `ConfigValidationError` entries with `path`, `received`, and `message`.

- [ ] **Step 4: Replace swallowed schema changes with ordered migrations**

Implement:

```ts
interface Migration { version: number; sql: string }

const migrations: Migration[] = [
  { version: 1, sql: SCHEMA_SQL },
  { version: 2, sql: "ALTER TABLE findings ADD COLUMN recommendation TEXT" },
];

export function runMigrations(db: Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const current = db.query("SELECT COALESCE(MAX(version), 0) AS version FROM schema_version").get() as { version: number };
  for (const migration of migrations.filter((item) => item.version > current.version)) {
    db.transaction(() => {
      db.exec(migration.sql);
      db.query("INSERT INTO schema_version(version) VALUES (?)").run(migration.version);
    })();
  }
}
```

For migration 2, first query `PRAGMA table_info(findings)` and run the `ALTER TABLE` only when `recommendation` is absent so existing workspaces migrate safely.

- [ ] **Step 5: Implement target resolution and WorkspaceContext**

Define:

```ts
export interface AuditTarget {
  inputPath: string;
  workspaceDir: string;
  kind: "file" | "directory";
}

export interface WorkspaceContext {
  target: AuditTarget;
  config: AppConfig;
  db: Database;
  signal: AbortSignal;
  close(): void;
}
```

`createWorkspaceContext` resolves the target, initializes `.audit` and `audit.yaml` when absent, loads validated configuration, opens one database connection, runs migrations, and returns an idempotent `close()` method.

- [ ] **Step 6: Run tests and type-check**

```powershell
bun test src/__tests__/integration/workspace-context.test.ts
bun run typecheck
```

Expected: PASS. The test must also assert that a malformed `confidenceFloor: high` produces a message containing `confidenceFloor` and `Expected number`.

- [ ] **Step 7: Commit workspace infrastructure**

```powershell
git add src/app src/config src/db src/model src/cli/commands/init.ts src/__tests__/integration/workspace-context.test.ts
git commit -m "feat: add typed workspace context"
```

---

### Task 3: Add Safe Discovery and Classification

**Files:**
- Create: `src/ingest/discovery.ts`
- Create: `src/ingest/classification.ts`
- Create: `src/__tests__/integration/discovery-classification.test.ts`
- Modify: `src/ingest/schema-detector.ts`
- Modify: `src/cli/commands/audit.ts`

**Interfaces:**
- Consumes: `AuditTarget`, `AppConfig`, and existing `inspectFile`/`detectSchema`.
- Produces: `discoverFiles(target: AuditTarget, config: AppConfig): Promise<DiscoveredFile[]>`.
- Produces: `classifyFiles(files: DiscoveredFile[], options: ClassificationOptions): AsyncGenerator<ClassificationEvent>`.

- [ ] **Step 1: Write failing discovery tests**

```ts
test("single-file discovery returns only that file", async () => {
  const files = await discoverFiles(resolveAuditTarget(csvPath), config);
  expect(files.map((item) => item.path)).toEqual([csvPath]);
});

test("directory discovery ignores dependency and workspace directories", async () => {
  writeFixture("finance/transactions.csv");
  writeFixture("node_modules/pkg/example.csv");
  writeFixture(".audit/scratchpad/export.csv");
  writeFixture("dist/example.csv");
  const files = await discoverFiles(resolveAuditTarget(root), config);
  expect(files.map((item) => item.relativePath)).toEqual(["finance/transactions.csv"]);
});

test("confidence below 0.80 is skipped without an override", () => {
  expect(decideClassification({ confidence: 0.79, data_type: "transactions" }, config)).toEqual({
    accepted: false,
    reason: "Schema confidence 79% is below the automatic threshold 80%",
  });
});
```

- [ ] **Step 2: Run the discovery tests to verify failure**

```powershell
bun test src/__tests__/integration/discovery-classification.test.ts
```

Expected: FAIL because discovery and classification modules do not exist.

- [ ] **Step 3: Implement explicit ignore rules and stable ordering**

Use this built-in ignore set:

```ts
const BUILTIN_IGNORES = new Set([".audit", ".git", ".superpowers", "dist", "node_modules"]);
const SUPPORTED_EXTENSIONS = new Set([".csv", ".xlsx", ".pdf"]);
```

Normalize configured ignore paths relative to the workspace, refuse ignore paths outside the workspace, do not follow symbolic-link directories, and return candidates sorted by normalized relative path.

- [ ] **Step 4: Implement bounded classification and acceptance decisions**

Define:

```ts
export interface ClassifiedFile extends DiscoveredFile {
  schema: SchemaDetectionResult;
  accepted: boolean;
  reason?: string;
}

export interface ClassificationOptions {
  config: AppConfig;
  forceRefresh: boolean;
  typeOverride?: DetectedDataType;
  signal?: AbortSignal;
}
```

Run at most `config.discovery.classificationConcurrency` inspections concurrently. An explicit valid `typeOverride` accepts the file and records the override. PDFs are not automatically treated as invoices; use filename/content classification and return `unknown` when evidence is insufficient.

- [ ] **Step 5: Replace recursive scanning in the old audit command**

Make `src/cli/commands/audit.ts` consume `discoverFiles` and `classifyFiles`. Remove its nested synchronous `walk()` function. Forward `--force` and `--type` from `src/cli/index.tsx`.

- [ ] **Step 6: Verify discovery behavior**

```powershell
bun test src/__tests__/integration/discovery-classification.test.ts
bun run typecheck
```

Expected: PASS; a single-file target never attempts to create `<file>/.audit`; ignored directories are not traversed; a 0.79 result is skipped.

- [ ] **Step 7: Commit safe discovery**

```powershell
git add src/ingest/discovery.ts src/ingest/classification.ts src/ingest/schema-detector.ts src/cli/commands/audit.ts src/cli/index.tsx src/__tests__/integration/discovery-classification.test.ts
git commit -m "feat: add safe audit discovery"
```

---

### Task 4: Implement Transactional, Idempotent Batch Ingestion

**Files:**
- Create: `src/ingest/source-fingerprint.ts`
- Create: `src/ingest/ingestion-service.ts`
- Create: `src/db/repositories/source-repository.ts`
- Create: `src/db/repositories/record-repository.ts`
- Create: `src/db/repositories/vendor-repository.ts`
- Create: `src/__tests__/integration/ingestion-service.test.ts`
- Modify: `src/db/migrations.ts`
- Modify: `src/ingest/vendor-resolver.ts`
- Modify: `src/cli/commands/ingest.ts`

**Interfaces:**
- Consumes: accepted `ClassifiedFile` values and `WorkspaceContext`.
- Produces: `ingestSource(ctx: WorkspaceContext, file: ClassifiedFile): Promise<FileIngestResult>`.
- Produces: `RecordRepository.insertBatch(records: FinancialRecord[]): number`.
- Produces: `VendorRepository.createLookup(): VendorLookup`.

- [ ] **Step 1: Write failing transaction and idempotency tests**

```ts
test("re-importing the same source creates no duplicate records", async () => {
  const first = await ingestSource(ctx, classifiedCsv);
  const second = await ingestSource(ctx, classifiedCsv);
  expect(first.insertedRecords).toBe(2);
  expect(second.insertedRecords).toBe(0);
  expect(second.status).toBe("unchanged");
  expect(recordRepository.count()).toBe(2);
});

test("a failed row batch rolls back the whole source", async () => {
  await expect(ingestSource(ctx, invalidClassifiedCsv)).rejects.toThrow("row 2");
  expect(recordRepository.count()).toBe(0);
  expect(sourceRepository.findByPath(invalidClassifiedCsv.path)).toBeNull();
});
```

- [ ] **Step 2: Run ingestion tests to verify failure**

```powershell
bun test src/__tests__/integration/ingestion-service.test.ts
```

Expected: FAIL because the service and source repository do not exist.

- [ ] **Step 3: Add source identity and structured quality storage**

Add migrations for:

```sql
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  relative_path TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  data_type TEXT NOT NULL,
  schema_confidence REAL NOT NULL,
  record_count INTEGER NOT NULL,
  imported_at TEXT NOT NULL
);
ALTER TABLE financial_records ADD COLUMN source_id TEXT REFERENCES sources(id);
ALTER TABLE financial_records ADD COLUMN source_row INTEGER;
ALTER TABLE financial_records ADD COLUMN quality_flags TEXT NOT NULL DEFAULT '[]';
CREATE INDEX idx_financial_records_source ON financial_records(source_id);
CREATE INDEX idx_financial_records_type_vendor_date ON financial_records(type, vendor_id, date);
```

Compute `content_hash` with streaming SHA-256. Compute record IDs as SHA-256 of `sourceId + ":" + sourceRow`, making reruns stable.

- [ ] **Step 4: Implement batch repositories and cached vendor lookup**

Prepare statements once and execute batches inside one transaction:

```ts
export class RecordRepository {
  constructor(private readonly db: Database) {}

  insertBatch(records: FinancialRecord[]): number {
    const insert = this.db.query(INSERT_RECORD_SQL);
    return this.db.transaction((items: FinancialRecord[]) => {
      let inserted = 0;
      for (const record of items) {
        insert.run(toRecordBindings(record));
        inserted++;
      }
      return inserted;
    })(records);
  }
}
```

`VendorLookup` preloads canonical names and aliases into normalized `Map<string, Vendor>` indexes once per source import. Fuzzy matching operates on the cached list and persists only confirmed canonical vendor changes.

- [ ] **Step 5: Implement ingestion as one source transaction**

`ingestSource` checks path plus content hash. An unchanged source returns `status: "unchanged"`. A changed source deletes its prior records and replaces them in the same transaction. The service returns:

```ts
export interface FileIngestResult {
  sourceId: string;
  status: "imported" | "updated" | "unchanged";
  insertedRecords: number;
  skippedRows: number;
  qualityFlags: Record<string, number>;
  durationMs: number;
}
```

Do not emit one terminal event or one scratchpad disk write per row; report batch progress every 500 rows.

- [ ] **Step 6: Convert the advanced ingest command into a thin adapter**

`src/cli/commands/ingest.ts` should resolve one file, classify it, call `ingestSource`, and convert the result into structured events. Keep PDF extraction, usage ingestion, and contract extraction behind `IngestionService`; route contract PDFs through `contract-parser.ts` instead of classifying every PDF as an invoice.

- [ ] **Step 7: Verify idempotency, rollback, and type-check**

```powershell
bun test src/__tests__/integration/ingestion-service.test.ts
bun run typecheck
```

Expected: PASS. Add an assertion that the second import retains the original record IDs.

- [ ] **Step 8: Commit transactional ingestion**

```powershell
git add src/ingest src/db/migrations.ts src/db/repositories src/cli/commands/ingest.ts src/__tests__/integration/ingestion-service.test.ts
git commit -m "feat: add transactional source ingestion"
```

---

### Task 5: Unify Agent Registration, Activation, and Shared Snapshot Data

**Files:**
- Create: `src/agents/registry.ts`
- Create: `src/agents/snapshot.ts`
- Create: `src/__tests__/integration/agent-registry.test.ts`
- Create: `src/db/repositories/record-repository.ts`
- Modify: `src/agents/index.ts`
- Modify: `src/agents/state-machine.ts`
- Modify: `src/engine/activation.ts`
- Modify: `src/cli/commands/status.ts`
- Modify: all seven `src/agents/*.ts` implementation files

**Interfaces:**
- Produces: `AgentRegistry.register(definition: RegisteredAgent): void`.
- Produces: `AgentRegistry.activation(snapshot: AuditRunSnapshot, config: AppConfig): AgentActivation[]`.
- Produces: `AuditRunSnapshot.create(records: FinancialRecord[], usage: UsageRecord[], contracts: ContractTerms[]): AuditRunSnapshot`.

- [ ] **Step 1: Write failing activation and no-work tests**

```ts
test("status and runner derive activation from actual stored data", async () => {
  const snapshot = AuditRunSnapshot.create([payment], [], []);
  const activations = registry.activation(snapshot, config);
  expect(activations.find((item) => item.agent === "duplicate-payments")?.ready).toBe(false);
  expect(activations.find((item) => item.agent === "policy-violations")?.ready).toBe(false);
});

test("an inactive registered agent does not load unrelated data", async () => {
  const calls: string[] = [];
  const repositories = instrumentRepositories(calls);
  await buildSnapshotForActiveAgents(registry, repositories, config);
  expect(calls).not.toContain("load-contracts");
});
```

- [ ] **Step 2: Run the registry tests to verify failure**

```powershell
bun test src/__tests__/integration/agent-registry.test.ts
```

Expected: FAIL because the registry and snapshot do not exist.

- [ ] **Step 3: Define declarative agent requirements**

```ts
export interface AgentRequirements {
  recordTypes: FinancialRecordType[];
  minimumRecords?: number;
  minimumHistoryDays?: number;
  needsUsage?: boolean;
  needsContracts?: boolean;
}

export interface RegisteredAgent {
  type: AgentType;
  requirements: AgentRequirements;
  investigate(ctx: AgentExecutionContext): Promise<AgentResult>;
}
```

Register the seven agents with exact requirements. For example, duplicate payments requires two records among payment/invoice/expense; policy violations requires expense records; vendor overbilling requires invoices and contract terms; anomaly detection requires at least ten records and 60 history days.

- [ ] **Step 4: Implement the indexed snapshot**

Store immutable arrays and maps:

```ts
export class AuditRunSnapshot {
  readonly records: readonly FinancialRecord[];
  readonly byType: ReadonlyMap<FinancialRecordType, readonly FinancialRecord[]>;
  readonly byVendor: ReadonlyMap<string, readonly FinancialRecord[]>;
  readonly usage: readonly UsageRecord[];
  readonly contracts: ReadonlyMap<string, ContractTerms>;
  readonly historyDays: number;

  recordsOfType(type: FinancialRecordType): readonly FinancialRecord[] {
    return this.byType.get(type) ?? [];
  }
}
```

Build indexes in one pass and freeze exposed arrays in tests to catch accidental mutation.

- [ ] **Step 5: Adapt agents to consume the snapshot and typed config**

Replace `getAllFinancialRecords()` and agent-local `_cache` values with `ctx.snapshot.recordsOfType(...)`, `ctx.snapshot.byVendor`, `ctx.snapshot.usage`, and `ctx.snapshot.contracts`. Pass `ctx.config.policy`, `ctx.config.minRunwayMonths`, and `ctx.config.minOperatingReserve` directly. Remove the `as any` configuration access in `policy-violations.ts`.

- [ ] **Step 6: Make status use the same registry activation**

`getStatus` builds the lightweight workspace summary, creates the activation input, and returns the exact `registry.activation(...)` result used by investigation. Remove the static `SOURCE_CONFIG.map(...name)` activation input.

- [ ] **Step 7: Verify all agent activation behavior**

```powershell
bun test src/__tests__/integration/agent-registry.test.ts
bun test src/__tests__/integration
bun run typecheck
```

Expected: PASS; a workspace with only payments does not report contract, expense, subscription, or usage-dependent agents as ready.

- [ ] **Step 8: Commit registry and snapshot**

```powershell
git add src/agents src/engine/activation.ts src/cli/commands/status.ts src/db/repositories/record-repository.ts src/__tests__/integration/agent-registry.test.ts
git commit -m "refactor: unify agent activation and data access"
```

---

### Task 6: Stream Agent Events Immediately with Bounded Concurrency

**Files:**
- Create: `src/agents/runner.ts`
- Create: `src/app/audit-run-context.ts`
- Create: `src/app/audit-service.ts`
- Create: `src/db/repositories/audit-run-repository.ts`
- Create: `src/db/repositories/finding-repository.ts`
- Create: `src/engine/async-event-queue.ts`
- Create: `src/__tests__/integration/audit-streaming.test.ts`
- Modify: `src/agents/supervisor.ts`
- Modify: `src/agents/state-machine.ts`
- Modify: `src/cli/commands/investigate.ts`
- Modify: `src/engine/events.ts`
- Modify: `src/model/types.ts`

**Interfaces:**
- Produces: `AuditService.run(request: AuditRequest): AsyncGenerator<AuditEvent>`.
- Produces: `AgentRunner.run(agents: RegisteredAgent[], ctx: AuditRunContext): AsyncGenerator<AuditEvent>`.
- Produces: `AsyncEventQueue<T>` with `push`, `end`, `fail`, and async iteration.

- [ ] **Step 1: Write the failing streaming-order test**

```ts
test("yields the first agent step before that agent completes", async () => {
  const gate = Promise.withResolvers<void>();
  registry.register(fakeAgent("slow-agent", async (ctx) => {
    ctx.emit({ type: "step", agent: "slow-agent", message: "started" });
    await gate.promise;
    return emptyAgentResult("slow-agent");
  }));

  const stream = runner.run(registry.all(), runContext);
  const first = await stream.next();
  expect(first.value).toMatchObject({ type: "agent_start" });
  const second = await stream.next();
  expect(second.value).toMatchObject({ type: "step", message: "started" });
  gate.resolve();
});
```

Add tests that concurrency never exceeds `config.agents.concurrency`, timeout produces an `agent_failed` event, and cancellation produces a final run state of `cancelled`.

- [ ] **Step 2: Run streaming tests to verify the buffered implementation fails**

```powershell
bun test src/__tests__/integration/audit-streaming.test.ts
```

Expected: FAIL because events are currently buffered in `supervisor.ts` until `runInvestigation` returns.

- [ ] **Step 3: Implement AsyncEventQueue**

```ts
export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  end(): void {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined as T, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.ended) return Promise.resolve({ value: undefined as T, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
```

Add a stored error and `fail(error)` path so producer failures reject the consumer's next read.

- [ ] **Step 4: Implement bounded agent execution**

Use a worker pool of `config.agents.concurrency`. Each worker claims the next active agent, links the run signal to a per-agent timeout controller, and pushes every event directly to the shared queue. Only `FindingRepository` performs finding writes; agent tasks return immutable `AgentResult` values.

- [ ] **Step 5: Add audit-run persistence and event types**

Add migrations and repository methods for `audit_runs` and `audit_run_files`. Extend `AuditEvent` with:

```ts
| { type: "stage_started"; stage: AuditStage; message: string; timestamp?: string }
| { type: "stage_completed"; stage: AuditStage; durationMs: number; timestamp?: string }
| { type: "file_skipped"; path: string; reason: string; timestamp?: string }
| { type: "agent_failed"; agent: AgentType; message: string; timestamp?: string }
| { type: "run_completed"; summary: AuditSummary; timestamp?: string }
```

Persist run status as `running | completed | partial | cancelled | failed`.

- [ ] **Step 6: Compose the full AuditService pipeline**

Define this public request boundary:

```ts
export interface AuditRequest {
  path: string;
  forceRefresh?: boolean;
  typeOverride?: DetectedDataType;
  llmEnabled?: boolean;
  signal?: AbortSignal;
}
```

Implement `AuditService.run()` as the following exact sequence:

1. Call `openWorkspace(request.path)` once and create the `audit_runs` row with status `running`.
2. Yield `stage_started(discovery)`, call `discoverAuditFiles(ctx.target)`, then yield `stage_completed(discovery)`.
3. Call `classifyFiles(discovered, { typeOverride: request.typeOverride })`; yield one `file_skipped` event for every result below `0.80` without an override.
4. For every accepted file, call `IngestionService.ingestFile()` and persist its source result in `audit_run_files`; do not ingest skipped files.
5. Load one `AuditRunSnapshot`, construct the activation input from that snapshot, and call `registry.activation(input)` once.
6. Yield each event from `AgentRunner.run(activeAgents, runContext)` as soon as the runner produces it.
7. If optional reasoning is enabled, enrich only completed deterministic findings through `ReasoningService`; provider failure records a warning and retains the deterministic finding.
8. Derive `completed` versus `partial` from file and agent outcomes, persist the final metrics and status, and yield exactly one `run_completed` event.
9. On abort, persist `cancelled` and rethrow an `AbortError`; on an unhandled failure, persist `failed` and rethrow the original error.
10. Close the workspace in `finally`; no repository or presenter may close it independently.

Put timing around each numbered stage with `performance.now()` and emit its matching `stage_completed` event before moving to the next stage. The service owns orchestration only: discovery, ingestion, activation, agent execution, reasoning, and persistence remain behind their Task 2-5 interfaces.

- [ ] **Step 7: Verify streaming, timeouts, and cancellation**

```powershell
bun test src/__tests__/integration/audit-streaming.test.ts
bun run typecheck
```

Expected: PASS; the test observes the first `step` event before resolving the slow agent gate.

- [ ] **Step 8: Commit streaming orchestration**

```powershell
git add src/agents src/app src/db/repositories src/db/migrations.ts src/engine src/model/types.ts src/cli/commands/investigate.ts src/__tests__/integration/audit-streaming.test.ts
git commit -m "feat: stream bounded audit execution"
```

---

### Task 7: Buffer Scratchpad Events and Capture Structured Run Metrics

**Files:**
- Create: `src/engine/run-metrics.ts`
- Create: `src/__tests__/integration/run-metrics.test.ts`
- Modify: `src/engine/scratchpad.ts`
- Modify: `src/app/audit-run-context.ts`
- Modify: `src/db/repositories/audit-run-repository.ts`
- Modify: `src/model/types.ts`

**Interfaces:**
- Produces: `RunMetrics.start(runId: string): RunMetrics`.
- Produces: `ScratchpadWriter` with `append`, `flush`, and `close`.

- [ ] **Step 1: Write failing batching and metrics tests**

```ts
test("scratchpad batches entries instead of appending per event", async () => {
  const writes: string[] = [];
  const writer = new ScratchpadWriter(file, { batchSize: 3, write: (text) => writes.push(text) });
  writer.append(entry("one"));
  writer.append(entry("two"));
  expect(writes).toHaveLength(0);
  writer.append(entry("three"));
  expect(writes).toHaveLength(1);
  await writer.close();
});

test("metrics capture stage, file, agent, finding, and LLM counts", () => {
  const metrics = RunMetrics.start("RUN-1");
  metrics.stageCompleted("ingestion", 120);
  metrics.fileCompleted("transactions.csv", 200, 2);
  metrics.agentCompleted("duplicate-payments", 1, 40);
  metrics.llmCompleted("groq", 20, 8, 55);
  expect(metrics.snapshot().recordsInserted).toBe(200);
});
```

- [ ] **Step 2: Run metrics tests to verify failure**

```powershell
bun test src/__tests__/integration/run-metrics.test.ts
```

Expected: FAIL because the classes do not exist.

- [ ] **Step 3: Implement buffered append-only scratchpad output**

Use an in-memory array capped by `batchSize: 100` or `flushIntervalMs: 250`. Serialize one JSON line per entry and call `appendFile` once per batch. `close()` clears the timer, flushes pending events, and can be called more than once.

- [ ] **Step 4: Implement typed RunMetrics**

```ts
export interface RunMetricsSnapshot {
  runId: string;
  durationMs: number;
  stages: Record<string, number>;
  filesAccepted: number;
  filesSkipped: number;
  recordsInserted: number;
  rowsSkipped: number;
  agentsRun: number;
  agentsSkipped: number;
  findingsCreated: number;
  duplicateFindingsSuppressed: number;
  llmCalls: number;
  llmFailures: number;
}
```

Metrics count actions already emitted by services; they must not query full tables after the run.

- [ ] **Step 5: Persist metrics and verify**

Store the metrics snapshot as JSON on the audit-run row during finalization. Run:

```powershell
bun test src/__tests__/integration/run-metrics.test.ts
bun run typecheck
```

Expected: PASS and no synchronous `appendFileSync` call remains in the audit hot path.

- [ ] **Step 6: Commit metrics and buffered logs**

```powershell
git add src/engine src/app/audit-run-context.ts src/db/repositories/audit-run-repository.ts src/model/types.ts src/__tests__/integration/run-metrics.test.ts
git commit -m "perf: buffer audit logs and metrics"
```

---

### Task 8: Add Optional Grounded LLM Reasoning and `argus ask`

**Files:**
- Create: `src/llm/provider.ts`
- Create: `src/llm/schemas.ts`
- Create: `src/llm/reasoning-service.ts`
- Create: `src/cli/commands/ask.ts`
- Create: `src/__tests__/integration/reasoning-service.test.ts`
- Modify: `src/llm/groq.ts`
- Modify: `src/llm/openrouter.ts`
- Modify: `src/engine/finding-builder.ts`
- Modify: `src/app/audit-service.ts`
- Modify: `src/model/schemas.ts`

**Interfaces:**
- Produces: `LLMProvider.complete(request: LLMRequest): Promise<LLMResult>`.
- Produces: `ReasoningService.enrich(finding: Finding, evidence: GroundingRecord[]): Promise<ReasoningResult>`.
- Produces: `ReasoningService.answer(question: string, grounding: GroundingBundle): AsyncGenerator<string>`.

- [ ] **Step 1: Write failing grounding and fallback tests**

```ts
test("rejects an explanation that cites an unknown record", async () => {
  provider.complete = async () => ({
    text: JSON.stringify({ explanation: "Duplicate charge", recommendation: "Review", citations: ["REC-999"] }),
    usage: { inputTokens: 10, outputTokens: 5 },
  });
  await expect(service.enrich(finding, [record("REC-1")])).rejects.toThrow("Unknown citation REC-999");
});

test("provider failure preserves the deterministic finding", async () => {
  provider.complete = async () => { throw new Error("timeout"); };
  const result = await service.enrichSafely(finding, [record("REC-1")]);
  expect(result.finding.id).toBe(finding.id);
  expect(result.enhanced).toBe(false);
  expect(result.warning).toContain("enhanced reasoning was unavailable");
});
```

- [ ] **Step 2: Run reasoning tests to verify failure**

```powershell
bun test src/__tests__/integration/reasoning-service.test.ts
```

Expected: FAIL because the unified provider and reasoning service do not exist.

- [ ] **Step 3: Define provider and structured output contracts**

```ts
export interface LLMRequest {
  system: string;
  prompt: string;
  model: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface LLMResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

export const ReasoningOutputSchema = z.object({
  explanation: z.string().min(1).max(2_000),
  recommendation: z.string().min(1).max(1_000),
  citations: z.array(z.string()).min(1),
});
```

Adapt Groq and OpenRouter behind this interface. Provider errors must not return user-facing error strings as successful completions.

- [ ] **Step 4: Implement evidence minimization and citation validation**

Build prompts from the finding's cited records/documents only. Redact keys matching `/api[_-]?key|token|secret|password/i`. Reject citations not in the grounding bundle. Do not expose raw record JSON unless a cited calculation needs a specific field.

- [ ] **Step 5: Add optional enrichment to AuditService**

Run enrichment only when configuration enables LLMs and a provider key is present. Limit enrichment concurrency to `1` so audit calculations and SQLite writes remain responsive. Store the explanation and recommendation separately from deterministic evidence.

- [ ] **Step 6: Implement grounded `ask`**

`argus ask` retrieves a bounded bundle of matching findings and their cited records. When no provider is configured, return:

```text
Enhanced answers are unavailable because no LLM provider is configured.
Your deterministic audit results are unchanged. Run `argus findings` to review them.
```

Every answer ends with a `Sources:` line containing finding, record, or document IDs.

- [ ] **Step 7: Verify reasoning behavior**

```powershell
bun test src/__tests__/integration/reasoning-service.test.ts
bun run typecheck
```

Expected: PASS; invalid citations fail validation; provider failure leaves deterministic findings intact.

- [ ] **Step 8: Commit optional reasoning**

```powershell
git add src/llm src/cli/commands/ask.ts src/engine/finding-builder.ts src/app/audit-service.ts src/model/schemas.ts src/__tests__/integration/reasoning-service.test.ts
git commit -m "feat: add grounded optional reasoning"
```

---

### Task 9: Build the One-Command Interactive CLI and Responsive Presenters

**Files:**
- Create: `src/cli/presenters/text-presenter.ts`
- Create: `src/cli/presenters/json-presenter.ts`
- Create: `src/cli/presenters/interactive-presenter.tsx`
- Create: `src/cli/components/AuditProgress.tsx`
- Create: `src/cli/components/CompletionMenu.tsx`
- Create: `src/cli/components/ResponsiveFindings.tsx`
- Create: `src/__tests__/cli/cli-output.test.tsx`
- Modify: `src/cli/index.tsx`
- Modify: `src/cli/App.tsx`
- Modify: `src/cli/theme.ts`
- Modify: `src/cli/commands/audit.ts`
- Modify: `src/cli/components/FindingsTable.tsx`
- Modify: `src/cli/components/InvestigationStream.tsx`

**Interfaces:**
- Consumes: `AuditService.run(request)` and structured `AuditEvent` values.
- Produces: `renderAudit(request: AuditRequest, mode: "interactive" | "text" | "json"): Promise<AuditSummary>`.
- Produces: `CompletionAction = "review" | "ask" | "export" | "finish"`.

- [ ] **Step 1: Write failing CLI behavior tests**

Use Ink's test renderer and injected TTY capabilities:

```ts
test("no arguments asks for a path instead of showing command clutter", async () => {
  const output = await runCli([], { stdinTTY: true, stdoutTTY: true });
  expect(output).toContain("Drop a file or folder here to begin");
  expect(output).not.toContain("investigate [--type]");
});

test("non-interactive output never waits for the completion menu", async () => {
  const result = await runCli(["audit", fixtureDir, "--non-interactive"], { stdinTTY: false, stdoutTTY: false });
  expect(result).toContain("Audit complete");
  expect(result).not.toContain("What would you like to do?");
});

test("narrow findings keep identifiers and severity visible", () => {
  const output = renderFindings(findings, { columns: 48 });
  expect(output).toContain("FINDING-003");
  expect(output).toContain("critical");
});
```

- [ ] **Step 2: Run CLI tests to verify current behavior fails**

```powershell
bun test src/__tests__/cli/cli-output.test.tsx
```

Expected: FAIL because the default command prints passive status and the fixed-width table does not adapt.

- [ ] **Step 3: Split command routing from presentation**

Make `index.tsx` parse flags and call command adapters only. Remove direct audit/status/report formatting from the switch. Detect presentation mode with:

```ts
const mode = flags.json
  ? "json"
  : process.stdin.isTTY && process.stdout.isTTY && !flags.nonInteractive
    ? "interactive"
    : "text";
```

Keep advanced commands in help under an `Advanced` heading. Remove the unimplemented `config` entry unless a working command is added in the same task.

- [ ] **Step 4: Implement the stable progress presenter**

`AuditProgress` keeps one row per stage, updates the active stage in place, preserves skipped-file warnings, bounds retained event detail to 200 entries, and throttles rendering to at most 30 frames per second. It uses cyan/violet accents, severity-specific warning colors, text labels, and no movement for keyboard actions.

- [ ] **Step 5: Implement the completion menu**

```ts
export const COMPLETION_ACTIONS: ReadonlyArray<{ value: CompletionAction; label: string }> = [
  { value: "review", label: "Review important findings" },
  { value: "ask", label: "Ask Argus a question" },
  { value: "export", label: "Export the report" },
  { value: "finish", label: "Finish" },
];
```

Arrow keys change selection instantly; Enter resolves the selected action; `q` resolves `finish`; `Ctrl+C` cancels through the shared abort signal.

- [ ] **Step 6: Implement responsive findings**

At `< 72` columns render stacked records. At `72-119` render ID, severity, confidence, and title. At `>= 120` add status, impact, and date. Never truncate the finding ID or severity.

- [ ] **Step 7: Implement text and JSON presenters**

The text presenter writes no cursor-control sequences. The JSON presenter emits one valid JSON document matching a Zod `AuditOutputSchema` and sends progress logs to stderr only when `--verbose` is set.

- [ ] **Step 8: Verify CLI modes and accessibility**

```powershell
bun test src/__tests__/cli/cli-output.test.tsx
bun run typecheck
bun run src/cli/index.tsx --help
```

Expected: PASS. Help begins with `argus audit <file-or-directory>` and contains a separate advanced section.

- [ ] **Step 9: Commit the production CLI**

```powershell
git add src/cli src/__tests__/cli/cli-output.test.tsx
git commit -m "feat: simplify the production CLI"
```

---

### Task 10: Close Agent Correctness Gaps and Add End-to-End Regression Coverage

**Files:**
- Create: `src/__tests__/e2e/audit-file.test.ts`
- Create: `src/__tests__/e2e/audit-directory.test.ts`
- Create: `src/__tests__/fixtures/expected-findings.json`
- Modify: `src/agents/policy-violations.ts`
- Modify: `src/agents/vendor-overbilling.ts`
- Modify: `src/agents/cashflow-risk.ts`
- Modify: `src/ingest/contract-parser.ts`
- Modify: `src/cli/commands/report.ts`
- Remove: `src/__tests__/fix-verification.ts`
- Replace: `src/__tests__/e2e-pipeline.ts` with discoverable `.test.ts` coverage

**Interfaces:**
- Consumes: the complete AuditService, real configuration, real agents, and temporary workspaces.
- Produces: deterministic end-to-end audit fixtures and expected finding fingerprints.

- [ ] **Step 1: Write failing end-to-end tests**

```ts
test("audits a single file from an uninitialized workspace", async () => {
  const result = await runArgus(["audit", fixture("transactions.csv"), "--non-interactive", "--no-llm"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Audit complete");
  expect(result.stderr).not.toContain("ENOTDIR");
});

test("uses audit.yaml policy and runway settings", async () => {
  writeWorkspaceConfig({ currency: "USD", minRunwayMonths: 6,
    policy: { maxExpenseWithoutReceipt: 25 } });
  const summary = await runDeterministicAudit(workspaceDir);
  expect(summary.findings.some((item) => item.agentType === "policy-violations")).toBe(true);
  expect(summary.findings.every((item) => item.impactCurrency === "USD" || item.impactCurrency == null)).toBe(true);
});
```

Add a directory case containing valid CSVs, an unknown CSV, a contract PDF fixture, and a malformed file; assert partial completion and no records from skipped files.

- [ ] **Step 2: Run end-to-end tests to expose correctness gaps**

```powershell
bun test src/__tests__/e2e
```

Expected: at least the config-sensitive cash-flow or contract assertion fails until the agent fixes are applied.

- [ ] **Step 3: Wire policy configuration directly**

Use `ctx.config.policy` with the dominant/configured currency. Parse structured quality flags from `record.qualityFlags`, not `JSON.parse(record.raw)` with an empty catch. Include the exact violated rule and record ID in every comparison.

- [ ] **Step 4: Complete contract ingestion and overbilling evidence**

Contract PDFs populate `contract_terms` during ingestion and retain `extractedFrom`. Vendor overbilling activates only when both invoice records and contract terms exist. Calculations cite invoice and contract source IDs and account for configured escalation clauses.

- [ ] **Step 5: Correct cash-flow projection semantics**

Use current balance, committed outflows by due month, average variable burn, configured operating reserve, and `minRunwayMonths`. Do not treat total commitments as available cash. When current balance is absent, skip the runway finding with the explicit reason `Current balance is unavailable`.

- [ ] **Step 6: Replace copied verification logic with real imports**

Delete `fix-verification.ts`. Move each date, vendor, and XLSX regression into `.test.ts` files that import the production functions. Rename or replace `e2e-pipeline.ts` so `bun test` discovers it and all workspace writes occur under validated temporary directories.

- [ ] **Step 7: Verify deterministic findings and idempotency**

```powershell
bun test src/__tests__/e2e
bun test
bun run typecheck
```

Expected: PASS. Run the directory audit twice and assert record count and finding fingerprints remain unchanged.

- [ ] **Step 8: Commit correctness and E2E coverage**

```powershell
git add src/agents src/ingest/contract-parser.ts src/cli/commands/report.ts src/__tests__
git commit -m "test: cover production audit workflows"
```

---

### Task 11: Add the 20k Performance Gate and Native Release Pipeline

**Files:**
- Create: `scripts/generate-performance-fixture.ts`
- Create: `scripts/measure-audit.ts`
- Create: `scripts/check-performance.ts`
- Create: `test-data/performance/baseline.json`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `src/__tests__/smoke/compiled-binary.test.ts`
- Create: `src/__tests__/performance/performance-check.test.ts`
- Modify: `scripts/check-regression.js`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the standalone CLI and JSON audit output.
- Produces: `performance:generate`, `performance:measure`, and `performance:check` scripts.
- Produces: native Windows x64, macOS Apple Silicon, and Linux x64 release artifacts with SHA-256 checksums.

- [ ] **Step 1: Write the failing performance checker test**

```ts
test("rejects time or memory regressions above fifteen percent", () => {
  const baseline = { durationMs: 40_000, peakRssMiB: 300 };
  expect(checkPerformance({ durationMs: 46_001, peakRssMiB: 300 }, baseline).ok).toBe(false);
  expect(checkPerformance({ durationMs: 40_000, peakRssMiB: 345.1 }, baseline).ok).toBe(false);
});

test("enforces absolute ceilings", () => {
  const result = checkPerformance({ durationMs: 60_001, peakRssMiB: 512.1 }, { durationMs: 59_000, peakRssMiB: 500 });
  expect(result.failures).toContain("duration exceeds 60000ms");
  expect(result.failures).toContain("peak RSS exceeds 512MiB");
});
```

- [ ] **Step 2: Run the checker test to verify failure**

```powershell
bun test src/__tests__/performance/performance-check.test.ts
```

Expected: FAIL because the checker is absent.

- [ ] **Step 3: Generate a deterministic 20,000-record fixture**

Use a fixed seeded PRNG and write CSV rows covering payments, invoices, expenses, subscriptions, and commitments. Seed known duplicate, policy, anomaly, reconciliation, overbilling, SaaS-waste, and cash-flow cases. The generator must produce the same SHA-256 hash on every platform.

- [ ] **Step 4: Measure deterministic audit performance**

`measure-audit.ts` creates a fresh temporary workspace, launches the compiled CLI as a child process with `audit <fixture> --non-interactive --no-llm --json`, samples that child process's RSS every 50 ms, and writes a JSON object containing `records`, `durationMs`, `peakRssMiB`, `findings`, and the generator-computed `fixtureSha256`.

Run three warm measurements on the designated Linux CI runner. Commit `test-data/performance/baseline.json` using the median duration, the highest observed RSS, the exact finding count, and the generated fixture hash. Reject the baseline commit if any run exceeds the absolute 60-second or 512-MiB ceilings; the committed file must contain measured values only.

- [ ] **Step 5: Implement performance regression checks**

Fail when duration or RSS exceeds the absolute ceiling or grows by more than 15% relative to baseline. Extend `check-regression.js` to compare deterministic finding fingerprints and fail on missing expected findings; extra findings remain warnings until reviewed.

- [ ] **Step 6: Add native CI and release workflows**

`ci.yml` runs install, type-check, unit/integration/E2E tests, and Bun-target build. The Linux job runs the performance gate. `release.yml` uses native runners:

```yaml
strategy:
  matrix:
    include:
      - os: windows-latest
        script: compile:win
        artifact: dist/argus.exe
      - os: macos-14
        script: compile:mac
        artifact: dist/argus-mac
      - os: ubuntu-latest
        script: compile
        artifact: dist/argus-linux
```

Each runner invokes its binary with `--version` and audits a minimal fixture with `--no-llm --non-interactive`. Generate SHA-256 checksum files using platform-native commands and upload both binary and checksum.

- [ ] **Step 7: Update scripts and documentation**

Add:

```json
{
  "performance:generate": "bun run scripts/generate-performance-fixture.ts",
  "performance:measure": "bun run scripts/measure-audit.ts",
  "performance:check": "bun run scripts/check-performance.ts"
}
```

Rewrite README quickstart around `argus audit ./finance-data`, move lower-level commands under `Advanced`, document deterministic operation without API keys, and list the three release artifacts. Add `.superpowers/` and generated performance CSV files to `.gitignore`; keep the small baseline JSON tracked.

- [ ] **Step 8: Run the full production gate**

```powershell
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
bun run compile:win
bun run performance:generate
bun run performance:measure
bun run performance:check
git diff --check
```

Expected: every command exits `0`; the compiled Windows binary prints its version and completes a deterministic smoke audit; performance remains inside absolute and relative limits.

- [ ] **Step 9: Commit performance and release automation**

```powershell
git add scripts test-data/performance .github package.json README.md .gitignore src/__tests__/smoke/compiled-binary.test.ts src/__tests__/performance/performance-check.test.ts
git commit -m "ci: add production release gates"
```

---

## Final Verification

- [ ] Run every required check from a clean dependency state:

```powershell
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
bun run compile:win
bun run performance:check
git status --short
```

- [ ] Manually exercise the beginner flow in a 48-column and 120-column terminal:

```powershell
dist\argus.exe audit test-data --no-llm
```

Confirm that the path is the only required input, uncertain files are skipped with recovery instructions, progress remains stable, findings retain IDs and severity at both widths, and the completion menu responds immediately.

- [ ] Verify non-interactive and JSON contracts:

```powershell
dist\argus.exe audit test-data --no-llm --non-interactive
dist\argus.exe audit test-data --no-llm --json
```

Confirm the first command does not wait for input and the second emits exactly one valid JSON document on stdout.

- [ ] Review the final diff against every production acceptance criterion in `docs/superpowers/specs/2026-08-05-argus-production-cli-architecture-design.md`.

- [ ] Commit any verification-only documentation corrections:

```powershell
git add README.md docs
git commit -m "docs: finalize production CLI guidance"
```
