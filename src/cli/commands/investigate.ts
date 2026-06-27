import fs from "fs";
import path from "path";
import type { AuditEvent, AgentType, FinancialEvent } from "../../model/types";
import { runSupervisor } from "../../agents/supervisor";

let watcherStopped = false;
let workspaceDir = process.cwd();

function writeWatcherStatus(state: string, findingsCount?: number): void {
  try {
    const dir = path.join(workspaceDir, ".audit");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "watcher.json"),
      JSON.stringify({
        pid: process.pid,
        state,
        lastRun: new Date().toISOString(),
        findingsCount: findingsCount ?? 0,
      })
    );
  } catch { }
}

export async function investigate(
  cwd: string,
  type?: AgentType,
  watch?: boolean
): Promise<AsyncGenerator<AuditEvent>> {
  workspaceDir = cwd;
  async function* gen(): AsyncGenerator<AuditEvent> {
    const trigger: FinancialEvent = {
      type: "daily_tick",
      timestamp: new Date().toISOString(),
    };

    const runCycle = async function* (): AsyncGenerator<AuditEvent> {
      writeWatcherStatus("running");
      let cycleFindings = 0;
      const stream = await runSupervisor(cwd, trigger, type);
      for await (const event of stream) {
        yield event;
        if (event.type === "finding") cycleFindings++;
        if (event.type === "done") writeWatcherStatus("idle", cycleFindings);
      }
    };

    if (watch) {
      yield { type: "step", agent: "investigate", message: "Starting watch mode (30s interval)..." };
      yield* runCycle();
      while (!watcherStopped) {
        yield { type: "step", agent: "investigate", message: `Waiting 30s until next check...` };
        await new Promise((resolve) => setTimeout(resolve, 30_000));
        if (watcherStopped) break;
        yield* runCycle();
      }
      yield { type: "step", agent: "investigate", message: "Watch mode stopped." };
      return;
    }

    yield* runCycle();
  }

  return gen();
}

export function stopWatcher(): void {
  watcherStopped = true;
  writeWatcherStatus("stopped");
}

export function getWatcherStatus(): { running: boolean } {
  return { running: !watcherStopped };
}
