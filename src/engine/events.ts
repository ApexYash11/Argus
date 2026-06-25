import type { AuditEvent } from "../model/types";

export async function* eventStream(events: AuditEvent[]): AsyncGenerator<AuditEvent> {
  for (const event of events) {
    yield event;
  }
}
