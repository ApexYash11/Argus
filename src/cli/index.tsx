#!/usr/bin/env bun
import "../ingest/dom-shim";
import meow from "meow";
import React from "react";
import { render } from "ink";
import App from "./App";
import { initWorkspace } from "./commands/init";
import { stopWatcher } from "./commands/investigate";
import { listFindings } from "./commands/findings";
import { explainFinding } from "./commands/explain";
import { submitFeedback } from "./commands/feedback";
import { getStatus } from "./commands/status";
import { startChat } from "./commands/chat";
import { audit } from "./commands/audit";
import { initDb } from "../db/index";
import "../agents/index";
import fs from "fs";
import path from "path";
import { VERSION } from "./theme";

function c(n: number) { return (s: string) => `\x1b[38;5;${n}m${s}\x1b[0m`; }
const col = { cyan: c(81), green: c(78), gray: c(245), label: c(110), white: c(231), red: c(196) };

function ensureDb(dir: string) {
  const dbPath = path.join(dir, ".audit", "spend-auditor.db");
  if (fs.existsSync(dbPath)) {
    initDb(dir);
    return true;
  }
  return false;
}

function findWorkspaceDir(dir: string): string | null {
  let current = path.resolve(dir);
  while (true) {
    if (fs.existsSync(path.join(current, ".audit"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const cli = meow(
  `
  Usage
    $ argus <command> [options]

  Commands
    init                  Start here — set up a workspace
    audit <folder>        Check your spending (does everything)
    findings              See what was found
    chat                  Ask in plain English

  More: explain, feedback, digest, status, web — see README.

  Examples
    $ argus init --company "Acme Corp"
    $ argus audit ./your-exports/
    $ argus findings --status open
    $ argus chat

  Tip: every command starts with argus.
`,
  {
    importMeta: import.meta,
    flags: {
      dir: { type: "string", shortFlag: "d" },
      company: { type: "string" },
      type: { type: "string" },
      schema: { type: "string", shortFlag: "s" },
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
      share: { type: "boolean", default: false },
      open: { type: "boolean", default: false },
      out: { type: "string" },
      webhook: { type: "string" },
      alertMin: { type: "string", default: "high" },
      resolve: { type: "string" },
      dismiss: { type: "string" },
      escalate: { type: "string" },
      reason: { type: "string" },
      to: { type: "string" },
      nonInteractive: { type: "boolean", default: false },
      fpRate: { type: "boolean", default: false },
      wizard: { type: "boolean", default: false },
      currency: { type: "string" },
      port: { type: "number", default: 7333 },
    },
  }
);

process.on("SIGINT", () => { stopWatcher(); });
process.on("SIGTERM", () => { stopWatcher(); });

const [command, ...inputArgs] = cli.input;
const flags = cli.flags;
const cwd = flags.dir ? path.resolve(flags.dir) : process.cwd();
const wsDir = findWorkspaceDir(cwd);

async function main() {
  switch (command) {
    case "help":
      cli.showHelp();
      break;

    case "init":
      if (flags.wizard) {
        const { render } = await import("ink");
        const InitWizard = (await import("./components/InitWizard")).default;
        const { runDemo } = await import("./commands/demo");
        const { initDb } = await import("../db/index");
        initDb(cwd);
        const onComplete = async (state: any) => {
          await initWorkspace(cwd, state.company, { currency: state.currency, llmChoice: state.llmChoice, llmKey: state.llmKey });
          if (state.dataChoice === "sample") {
            const r = await runDemo(cwd);
            console.log(`Ingested ${r.ingested} sample file(s), ${r.findings} finding(s).`);
          }
        };
        const { waitUntilExit } = render(<InitWizard cwd={cwd} onComplete={onComplete} />);
        await waitUntilExit;
      } else {
        await initWorkspace(cwd, flags.company, { currency: flags.currency as string | undefined });
        console.log("\n  Workspace ready. What next?");
        console.log("    1. argus audit ./your-exports/   Check your spending");
        console.log("    2. argus findings                See what was found");
        console.log("    3. argus chat                    Ask in plain English");
        console.log("\n  Tip: every command starts with `argus`. Try `argus --help`.");
      }
      break;

    case "demo": {
      const { runDemo } = await import("./commands/demo");
      await initWorkspace(cwd, undefined, { runDemo: true });
      const r = await runDemo(cwd);
      console.log(`\nDemo workspace ready.`);
      console.log(`  Files ingested: ${r.files.length}`);
      console.log(`  Findings:       ${r.findings}`);
      if (r.errors.length > 0) {
        console.log(`  Errors:`);
        for (const e of r.errors) console.log(`    - ${e}`);
      }
      console.log(`\nNext:`);
      console.log(`  argus status     — system overview`);
      console.log(`  argus findings   — see what was found`);
      console.log(`  argus chat       — ask in plain English`);
      console.log(`  argus audit --share — shareable HTML`);
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
      const alertMin = ["critical", "high", "warning", "info"].includes(String(flags.alertMin))
        ? (flags.alertMin as "critical" | "high" | "warning" | "info")
        : "high";
      const stream = audit(resolvedAuditPath, {
        dryRun: flags.dryRun,
        nonInteractive: flags.nonInteractive,
        agentType: flags.type as any,
        webhookUrl: flags.webhook as string | undefined,
        alertMin,
      });
      for await (const event of stream) {
        if (event.type === "step") console.log(`  ${event.message}`);
        if (event.type === "finding") console.log(`  ${event.finding.id} | ${event.finding.title}`);
      }
      if (flags.share && !flags.dryRun) {
        const { generateReport } = await import("./commands/report");
        const { writeShareReport } = await import("./commands/share");
        const report = await generateReport(flags.period as string | undefined);
        const outPath = await writeShareReport(resolvedAuditPath, report, { out: flags.out as string | undefined });
        console.log(`  Shared:          ${outPath}`);
        if (flags.open) {
          try {
            const { exec } = await import("child_process");
            const cmd = process.platform === "win32" ? `start "" "${outPath}"` : process.platform === "darwin" ? `open "${outPath}"` : `xdg-open "${outPath}"`;
            exec(cmd);
          } catch { console.log("  (could not auto-open browser)"); }
        }
      }
      break;
    }

    case "findings": {
      const wd = wsDir || cwd;
      if (!ensureDb(wd)) { console.log("No workspace found. Run `argus init` first."); break; }
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
      const wd = wsDir || cwd;
      if (!ensureDb(wd)) { console.log("No workspace found. Run `argus init` first."); break; }
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
      const wd = wsDir || cwd;
      if (!ensureDb(wd)) { console.log("No workspace found. Run `argus init` first."); break; }
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
      const wd = wsDir || cwd;
      if (!ensureDb(wd)) { console.log("No workspace found. Run `argus init` first."); break; }
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
      const llm = (status as { llm?: { provider: string; ready: boolean; hint: string } }).llm;
      console.log("");
      if (!llm?.ready) {
        console.log(`  ${"\u26A0".padEnd(2)} LLM: ${llm?.provider ?? "unknown"} (not ready)`);
        console.log(`      ${llm?.hint ?? "Set OPENROUTER_API_KEY in .env to enable LLM features."}`);
      } else {
        console.log(`  ${"\u2713".padEnd(2)} LLM: ${llm.provider}`);
      }
      console.log("");
      const { waitUntilExit, unmount } = render(
        <App command="status" props={{
          recordCount: status.recordCount,
          vendorCount: status.vendorCount,
          agents: status.agents,
          dataSources: status.dataSources,
          spend: (status as { spend?: unknown }).spend,
        }} />
      );
      unmount();
      await waitUntilExit;
      break;
    }

    case "report": {
      console.log("  `report` moved into `audit --share` — run `argus audit --share`.");
      break;
    }

    case "digest": {
      const wd = wsDir || cwd;
      if (!ensureDb(wd)) { console.log("No workspace found. Run `argus init` first."); break; }
      const { generateDigest } = await import("./commands/digest");
      console.log(await generateDigest(flags.period as string | undefined));
      break;
    }

    case "chat": {
      const wd = wsDir || cwd;
      if (!ensureDb(wd)) {
        await initWorkspace(wd, flags.company || "My Company");
        initDb(wd);
      }
      await startChat(wd);
      break;
    }

    case "web": {
      const wd = wsDir || cwd;
      if (!ensureDb(wd)) { console.log("No workspace found. Run `argus init` first."); break; }
      const { startWebServer } = await import("./commands/web");
      const { url } = await startWebServer(wd, flags.port as number);
      console.log(`\n  Argus web viewer: ${url}`);
      console.log(`  Bound to 127.0.0.1 only. Press Ctrl+C to stop.`);
      if (flags.open) {
        try {
          const { exec } = await import("child_process");
          const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
          exec(cmd);
        } catch { console.log("  (could not auto-open browser)"); }
      }
      await new Promise(() => {});
      break;
    }

    default: {
      if (command === "ingest" || command === "investigate") {
        console.log(`  \`argus ${command}\` was folded into \`argus audit\` — run \`argus audit <path> [--share] [--type <agent>]\`.`);
        break;
      }
      if (!wsDir) {
        console.log(`\n  ${col.cyan("ARGUS")} ${col.gray(VERSION)} — autonomous spend investigator`);
        console.log(`\n  ${col.white("Start here:")}`);
        console.log(`    1. ${col.cyan("argus init")}              Set up this folder`);
        console.log(`    2. ${col.cyan("argus audit ./exports/")}  Check your spending`);
        console.log(`    3. ${col.cyan("argus chat")}              Ask in plain English`);
        console.log(`\n  ${col.gray("Tip: every command starts with argus. Full list: argus --help.")}`);
        console.log("");
      } else {
        ensureDb(wsDir);
        const status = await getStatus();
        console.log(`\n  ${col.cyan("ARGUS")} ${col.gray(VERSION)}`);
        console.log(`  ${col.green("\u25CF")} ${col.label("Records")} ${col.white(String(status.recordCount))}    ${col.cyan("\u25CF")} ${col.label("Vendors")} ${col.white(String(status.vendorCount))}`);
        if (status.recordCount === 0) {
          console.log(`\n  ${col.white("Next:")} ${col.cyan("argus audit ./your-exports/")}  ${col.gray("then argus findings")}`);
        } else {
          console.log(`  ${col.gray("Try:")} ${col.cyan("argus findings")}  ${col.cyan("argus chat")}  ${col.cyan("argus audit --share")}`);
        }
        if (wsDir !== path.resolve(cwd)) {
          console.log(`  ${col.gray("Workspace:")} ${wsDir}`);
        }
        console.log("");
      }
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
