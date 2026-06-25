import fs from "fs";
import path from "path";
import type { AuditEvent, AgentType, FinancialEvent } from "../../model/types";
import { runSupervisor } from "../../agents/supervisor";

let watcherTimer: ReturnType<typeof setInterval> | null = null;
let watchCycleRunning = false;

function writeWatcherStatus(state: string, findingsCount?: number): void {
  try {
    const dir = path.join(process.cwd(), ".audit");
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
  type?: AgentType,
  watch?: boolean
): Promise<AsyncGenerator<AuditEvent>> {
  if (watch && watcherTimer) {
    async function* alreadyRunning(): AsyncGenerator<AuditEvent> {
      yield { type: "step", agent: "investigate", message: "Watch mode already active." };
    }
    return alreadyRunning();
  }

  async function* gen(): AsyncGenerator<AuditEvent> {
    const trigger: FinancialEvent = {
      type: "daily_tick",
      timestamp: new Date().toISOString(),
    };

    if (watch) {
      yield { type: "step", agent: "investigate", message: "Starting watch mode (30s interval)..." };
      writeWatcherStatus("running");
      const stream = await runSupervisor(trigger, type);
      for await (const event of stream) {
        yield event;
        if (event.type === "done") writeWatcherStatus("idle", event.totalFindings);
      }

      const runWatchCycle = async () => {
        if (watchCycleRunning) return;
        watchCycleRunning = true;
        try {
          writeWatcherStatus("running");
          let cycleFindings = 0;
          const stream = await runSupervisor(trigger, type);
          for await (const event of stream) {
            if (event.type === "finding") cycleFindings++;
            if (event.type === "done") writeWatcherStatus("idle", cycleFindings);
            if (event.type === "step" || event.type === "finding") {
              console.log(`[watch] ${event.type}: ${(event as any).message ?? (event as any).finding?.title ?? ""}`);
            }
          }
        } catch (err) {
          writeWatcherStatus("error");
          console.error("Watch mode error:", err);
        } finally {
          watchCycleRunning = false;
        }
      };
      watcherTimer = setInterval(runWatchCycle, 30_000);
      yield { type: "step", agent: "investigate", message: "Watch mode active. Press Ctrl+C to stop." };
      return;
    }

    const stream = await runSupervisor(trigger, type);
    for await (const event of stream) {
      yield event;
    }
  }

  return gen();
}

export function stopWatcher(): void {
  if (watcherTimer) {
    clearInterval(watcherTimer);
    watcherTimer = null;
  }
  writeWatcherStatus("stopped");
  watchCycleRunning = false;
}

export function getWatcherStatus(): { running: boolean } {
  return { running: watcherTimer !== null };
}
