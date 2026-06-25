import type { AuditEvent, AgentType, FinancialEvent } from "../../model/types";
import { runSupervisor } from "../../agents/supervisor";

let watcherTimer: ReturnType<typeof setInterval> | null = null;

export async function investigate(
  type?: AgentType,
  watch?: boolean
): Promise<AsyncGenerator<AuditEvent>> {
  async function* gen(): AsyncGenerator<AuditEvent> {
    const trigger: FinancialEvent = {
      type: "daily_tick",
      timestamp: new Date().toISOString(),
    };

    if (watch) {
      yield { type: "step", agent: "investigate", message: "Starting watch mode (30s interval)..." };
      const stream = await runSupervisor(trigger, type);
      for await (const event of stream) {
        yield event;
      }
      watcherTimer = setInterval(async () => {
        const stream = await runSupervisor(trigger, type);
        for await (const _ of stream) { /* re-run in background */ }
      }, 30_000);
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
}
