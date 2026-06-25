import type { AuditEvent } from "../../model/types";

export async function ingestFile(
  _filePath: string,
  _type?: string
): Promise<AsyncGenerator<AuditEvent>> {
  async function* gen(): AsyncGenerator<AuditEvent> {
    yield { type: "step", agent: "ingest", message: `Ingestion not yet implemented for ${_filePath}` };
  }
  return gen();
}
