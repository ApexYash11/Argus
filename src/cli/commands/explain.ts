import { getFindingById } from "../../db/queries";
import { readScratchpadEvents } from "../../engine/scratchpad";

export async function explainFinding(
  findingId: string,
  showEvidence?: boolean,
  showTrace?: boolean
) {
  const finding = getFindingById(findingId);
  if (!finding) {
    return { error: `Finding ${findingId} not found` };
  }

  let trace;
  if (showTrace && finding.scratchpadRunId) {
    const scratchpadPath = `.audit/scratchpad/${finding.scratchpadRunId}.jsonl`;
    trace = readScratchpadEvents(scratchpadPath);
  }

  let evidence;
  if (showEvidence) {
    try {
      evidence = JSON.parse(finding.evidenceChain);
    } catch {
      evidence = { error: "malformed evidence chain", raw: finding.evidenceChain };
    }
  }

  return { finding, evidence, trace };
}
