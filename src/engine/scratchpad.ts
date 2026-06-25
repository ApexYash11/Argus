import fs from "fs";
import path from "path";

export interface ScratchpadEntry {
  type: string;
  agent?: string;
  message?: string;
  key?: string;
  value?: string;
  sourceDocId?: string;
  label?: string;
  expected?: string;
  actual?: string;
  delta?: string;
  score?: number;
  reason?: string;
  findingId?: string;
  token?: string;
  timestamp: string;
}

let scratchpadFile: string | null = null;
let eventCount = 0;

export function initScratchpad(workspaceDir: string): string {
  const scratchDir = path.join(workspaceDir, ".audit", "scratchpad");
  fs.mkdirSync(scratchDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  scratchpadFile = path.join(scratchDir, `${timestamp}.jsonl`);
  eventCount = 0;
  return scratchpadFile;
}

export function getScratchpadFile(): string | null {
  return scratchpadFile;
}

export function writeScratchpadEntry(entry: Omit<ScratchpadEntry, "timestamp">): void {
  if (!scratchpadFile) return;
  const fullEntry: ScratchpadEntry = { ...entry, timestamp: new Date().toISOString() };
  fs.appendFileSync(scratchpadFile, JSON.stringify(fullEntry) + "\n");
  eventCount++;
}

export function getEventCount(): number {
  return eventCount;
}

export function pruneScratchpad(workspaceDir: string, retentionCount: number = 30): void {
  const scratchDir = path.join(workspaceDir, ".audit", "scratchpad");
  if (!fs.existsSync(scratchDir)) return;

  const files = fs.readdirSync(scratchDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ name: f, time: fs.statSync(path.join(scratchDir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  if (files.length <= retentionCount) return;

  const toDelete = files.slice(retentionCount);
  for (const file of toDelete) {
    fs.unlinkSync(path.join(scratchDir, file.name));
  }
}

export function readScratchpadEvents(filePath: string): ScratchpadEntry[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as ScratchpadEntry];
      } catch {
        return [];
      }
    });
}
