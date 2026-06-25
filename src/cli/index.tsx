#!/usr/bin/env bun
import meow from "meow";
import React from "react";
import { render } from "ink";
import App from "./App";
import { initWorkspace } from "./commands/init";
import { ingestFile } from "./commands/ingest";
import { investigate } from "./commands/investigate";
import { listFindings } from "./commands/findings";
import { explainFinding } from "./commands/explain";
import { submitFeedback } from "./commands/feedback";
import { getStatus } from "./commands/status";
import { generateReport } from "./commands/report";
import { initDb } from "../db/index";
import "../agents/index";
import fs from "fs";
import path from "path";

function ensureDb() {
  const dbPath = path.join(process.cwd(), ".audit", "spend-auditor.db");
  if (fs.existsSync(dbPath)) {
    initDb(process.cwd());
    return true;
  }
  return false;
}

const cli = meow(
  `
  Usage
    $ audit <command> [options]

  Commands
    init                           Initialize workspace
    ingest <path>                  Ingest financial data
    investigate [--type] [--watch] Run investigation engine
    findings [--status] [--type]   Browse findings
    explain <finding-id>           Deep-dive a finding
    feedback <finding-id>          Submit review action
    report [--period]              Generate reports
    status                         System and agent health
    config                         Workspace configuration

  Examples
    $ audit init --company "Acme Corp"
    $ audit ingest transactions.csv
    $ audit investigate
    $ audit findings --status open --severity critical
    $ audit explain FINDING-003 --trace
    $ audit feedback FINDING-003 --resolve "Fixed with vendor"
`,
  {
    importMeta: import.meta,
    flags: {
      company: { type: "string" },
      type: { type: "string" },
      watch: { type: "boolean", default: false },
      status: { type: "string" },
      severity: { type: "string" },
      since: { type: "string" },
      evidence: { type: "boolean", default: false },
      trace: { type: "boolean", default: false },
      export: { type: "string" },
      period: { type: "string" },
      resolve: { type: "string" },
      dismiss: { type: "string" },
      escalate: { type: "string" },
      reason: { type: "string" },
      to: { type: "string" },
    },
  }
);

const [command, ...inputArgs] = cli.input;
const flags = cli.flags;

async function main() {
  switch (command) {
    case "init":
      await initWorkspace(process.cwd(), flags.company);
      console.log("Workspace initialized.");
      break;

    case "ingest": {
      ensureDb();
      const filePath = inputArgs[0];
      if (!filePath) {
        console.error("Error: specify a file path to ingest");
        process.exit(1);
      }
      const stream = await ingestFile(filePath, flags.type as string | undefined);
      for await (const event of stream) {
        if (event.type === "step") console.log(`  ${event.message}`);
      }
      break;
    }

    case "investigate": {
      ensureDb();
      const stream = await investigate(flags.type as any, flags.watch);
      const { waitUntilExit, unmount } = render(
        <App command="investigate" props={{ stream, onComplete: () => unmount() }} />
      );
      await waitUntilExit;
      break;
    }

    case "findings": {
      if (!ensureDb()) { console.log("No workspace found. Run `audit init` first."); break; }
      const findings = await listFindings({
        status: flags.status,
        severity: flags.severity,
        type: flags.type,
        since: flags.since,
      });
      if (findings.length === 0) {
        console.log("No findings found.");
        break;
      }
      const { waitUntilExit, unmount } = render(
        <App command="findings" props={{ findings }} />
      );
      unmount();
      await waitUntilExit;
      break;
    }

    case "explain": {
      if (!ensureDb()) { console.log("No workspace found. Run `audit init` first."); break; }
      const findingId = inputArgs[0];
      if (!findingId) {
        console.error("Error: specify a finding ID");
        process.exit(1);
      }
      const res = await explainFinding(findingId, flags.evidence, flags.trace);
      if ("error" in res) {
        console.error(res.error);
        process.exit(1);
      }
      const { waitUntilExit, unmount } = render(
        <App command="explain" props={{
          finding: res.finding,
          evidence: res.evidence,
          trace: res.trace,
          showTrace: flags.trace,
        }} />
      );
      unmount();
      await waitUntilExit;
      break;
    }

    case "feedback": {
      if (!ensureDb()) { console.log("No workspace found. Run `audit init` first."); break; }
      const findingId = inputArgs[0];
      if (!findingId) {
        console.error("Error: specify a finding ID");
        process.exit(1);
      }
      const action = flags.resolve ? "resolve" : flags.dismiss ? "dismiss" : flags.escalate ? "escalate" : null;
      if (!action) {
        console.error("Error: specify --resolve, --dismiss, or --escalate");
        process.exit(1);
      }
      const reason = flags.reason || undefined;
      const res = await submitFeedback(findingId, action as any, reason as string);
      if ("error" in res) {
        console.error(res.error);
        process.exit(1);
      }
      console.log(res.message);
      break;
    }

    case "status": {
      if (!ensureDb()) { console.log("No workspace found. Run `audit init` first."); break; }
      const dataSources = ["subscriptions", "transactions", "expense-reports", "invoices", "committed-expenses"];
      const status = await getStatus(dataSources);
      const { waitUntilExit, unmount } = render(
        <App command="status" props={{
          recordCount: status.recordCount,
          vendorCount: status.vendorCount,
          agents: status.agents,
          dataSources,
        }} />
      );
      unmount();
      await waitUntilExit;
      break;
    }

    case "report": {
      if (!ensureDb()) { console.log("No workspace found. Run `audit init` first."); break; }
      const report = await generateReport(flags.period);
      console.log(`\n  Report — ${report.period}`);
      console.log(`  ${"─".repeat(40)}`);
      console.log(`  Total findings:  ${report.summary.total}`);
      console.log(`  Open:            ${report.summary.open}`);
      console.log(`  Critical:        ${report.summary.critical}`);
      console.log(`  Resolved:        ${report.summary.resolved}`);
      console.log(`  Dismissed:       ${report.summary.dismissed}`);
      console.log(`  Total impact:    ${report.summary.totalImpact.toLocaleString()}`);
      break;
    }

    default:
      cli.showHelp();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
