#!/usr/bin/env bun
import meow from "meow";
import React from "react";
import { render } from "ink";
import App from "./App";
import { initWorkspace } from "./commands/init";
import { ingestFile } from "./commands/ingest";
import { investigate, stopWatcher } from "./commands/investigate";
import { listFindings } from "./commands/findings";
import { explainFinding } from "./commands/explain";
import { submitFeedback } from "./commands/feedback";
import { getStatus } from "./commands/status";
import { generateReport } from "./commands/report";
import { startChat } from "./commands/chat";
import { audit } from "./commands/audit";
import { initDb } from "../db/index";
import "../agents/index";
import fs from "fs";
import path from "path";

function ensureDb(cwd: string) {
  const dbPath = path.join(cwd, ".audit", "spend-auditor.db");
  if (fs.existsSync(dbPath)) {
    initDb(cwd);
    return true;
  }
  return false;
}

const cli = meow(
  `
  Usage
    $ argus <command> [options]

  Commands
    init                           Initialize workspace
    ingest <path>                  Ingest financial data
    investigate [--type] [--watch] Run investigation engine
    findings [--status] [--type]   Browse findings
    audit [path] [--dry-run]       Discover, classify, ingest, and investigate (main verb)
    explain <finding-id>           Deep-dive a finding
    feedback <finding-id>          Submit review action
    report [--period]              Generate reports
    status [--fp-rate]             System health and agent FP/TP rates
    config                         Workspace configuration
    chat                           Interactive chat mode

  Examples
    $ argus init --company "Acme Corp"
    $ argus ingest ./your-data.csv
    $ argus investigate
    $ argus findings --status open --severity critical
    $ argus explain FINDING-003 --trace
    $ argus feedback FINDING-003 --resolve "Fixed with vendor"
    $ argus chat
`,
  {
    importMeta: import.meta,
    flags: {
      dir: { type: "string", shortFlag: "d" },
      company: { type: "string" },
      type: { type: "string" },
      schema: { type: "string", shortFlag: "s" },
      // deprecated: new pipeline is now the default
      force: { type: "boolean", default: false },
      dryRun: { type: "boolean", default: false },
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
      nonInteractive: { type: "boolean", default: false },
      fpRate: { type: "boolean", default: false },
    },
  }
);

process.on("SIGINT", () => { stopWatcher(); });
process.on("SIGTERM", () => { stopWatcher(); });

const [command, ...inputArgs] = cli.input;
const flags = cli.flags;
const cwd = flags.dir ? path.resolve(flags.dir) : process.cwd();

async function main() {
  switch (command) {
    case "init":
      await initWorkspace(cwd, flags.company);
      console.log("Workspace initialized.");
      break;

    case "ingest": {
      ensureDb(cwd);
      const filePath = inputArgs[0];
      if (!filePath) {
        console.error("Error: specify a file path to ingest");
        process.exit(1);
      }
      const stream = await ingestFile(cwd, filePath, {
        type: (flags.schema ?? flags.type) as string | undefined,
        // experimental flag removed; new pipeline is default
        force: flags.force as boolean,
        dryRun: flags.dryRun as boolean,
      });
      for await (const event of stream) {
        if (event.type === "step") console.log(`  ${event.message}`);
      }
      break;
    }

    case "investigate": {
      ensureDb(cwd);
      const stream = await investigate(cwd, flags.type as any, flags.watch);
      const { waitUntilExit, unmount } = render(
        <App command="investigate" props={{ stream, onComplete: () => unmount() }} />
      );
      await waitUntilExit;
      break;
    }

    case "audit": {
      const auditPath = inputArgs[0] || cwd;
      const resolvedAuditPath = path.resolve(auditPath);
      if (!ensureDb(resolvedAuditPath)) {
        console.log("Initializing workspace...");
        await initWorkspace(resolvedAuditPath, flags.company || "My Company");
        ensureDb(resolvedAuditPath);
      }
      const stream = audit(resolvedAuditPath, { dryRun: flags.dryRun, nonInteractive: flags.nonInteractive });
      for await (const event of stream) {
        if (event.type === "step") console.log(`  ${event.message}`);
        if (event.type === "finding") console.log(`  ${event.finding.id} | ${event.finding.title}`);
      }
      break;
    }

    case "findings": {
      if (!ensureDb(cwd)) { console.log("No workspace found. Run `argus init` first."); break; }
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
      if (!ensureDb(cwd)) { console.log("No workspace found. Run `argus init` first."); break; }
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
      if (!ensureDb(cwd)) { console.log("No workspace found. Run `argus init` first."); break; }
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
      if (!ensureDb(cwd)) { console.log("No workspace found. Run `argus init` first."); break; }
      if (flags.fpRate) {
        const { getFpRates } = await import("../db/queries");
        const rates = getFpRates();
        if (rates.length === 0) {
          console.log("  No findings have been reviewed yet. Submit feedback first.");
          break;
        }
        console.log("  Agent FP/TP Rates (by latest feedback action)");
        console.log(`  ${"\u2500".repeat(66)}`);
        console.log(`  ${"agent_type".padEnd(22)} ${"resolved".padStart(9)} ${"dismissed".padStart(9)} ${"escalated".padStart(9)}  ${"fp_rate".padStart(7)} ${"tp_rate".padStart(7)}`);
        console.log(`  ${"\u2500".repeat(66)}`);
        for (const r of rates) {
          const fp = r.fpRate !== null ? r.fpRate.toFixed(2) : "N/A";
          const tp = r.tpRate !== null ? r.tpRate.toFixed(2) : "N/A";
          console.log(`  ${r.agentType.padEnd(22)} ${String(r.resolved).padStart(9)} ${String(r.dismissed).padStart(9)} ${String(r.escalated).padStart(9)}  ${fp.padStart(7)} ${tp.padStart(7)}`);
        }
        break;
      }
      const status = await getStatus();
      const { waitUntilExit, unmount } = render(
        <App command="status" props={{
          recordCount: status.recordCount,
          vendorCount: status.vendorCount,
          agents: status.agents,
          dataSources: status.dataSources,
        }} />
      );
      unmount();
      await waitUntilExit;
      break;
    }

    case "report": {
      if (!ensureDb(cwd)) { console.log("No workspace found. Run `argus init` first."); break; }
      const report = await generateReport(flags.period);
      console.log(`\n  Report \u2014 ${report.period}`);
      console.log(`  ${"\u2500".repeat(40)}`);
      console.log(`  Total findings:  ${report.summary.total}`);
      console.log(`  Open:            ${report.summary.open}`);
      console.log(`  Critical:        ${report.summary.critical}`);
      console.log(`  Resolved:        ${report.summary.resolved}`);
      console.log(`  Dismissed:       ${report.summary.dismissed}`);
      console.log(`  Total impact:    ${report.summary.totalImpact.toLocaleString()}`);
      break;
    }

    case "chat": {
      if (!ensureDb(cwd)) {
        await initWorkspace(cwd, flags.company || "My Company");
        initDb(cwd);
      }
      await startChat(cwd);
      break;
    }

    default: {
      const auditDir = path.join(cwd, ".audit");
      if (!fs.existsSync(auditDir)) {
        const { default: WelcomeFlow } = await import("./components/WelcomeFlow.js");
        const { waitUntilExit } = render(<WelcomeFlow cwd={cwd} />);
        await waitUntilExit;
      } else {
        ensureDb(cwd);
        await startChat(cwd);
      }
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
