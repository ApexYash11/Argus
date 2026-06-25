import { getFindings } from "../../db/queries";

export async function listFindings(filters?: {
  status?: string;
  severity?: string;
  type?: string;
  since?: string;
}) {
  return getFindings({
    status: filters?.status,
    severity: filters?.severity,
    agentType: filters?.type,
    since: filters?.since,
  });
}
