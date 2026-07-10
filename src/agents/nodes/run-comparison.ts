import type { Comparison } from "../../model/types";
import type { AgentContext } from "../state-machine";

// STUB: runComparison currently returns an empty array with no actual comparison logic.
// The shared compare node was intended to run generic comparison routines. Today each agent
// implements its own compare() method directly and this shared node is superseded.
// Tracked gap: either wire real shared comparison logic here or remove this node entirely
// in favor of per-agent implementations.
export async function runComparison(ctx: AgentContext): Promise<Comparison[]> {
  return [];
}
