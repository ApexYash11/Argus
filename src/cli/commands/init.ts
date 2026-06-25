import fs from "fs";
import path from "path";
import { initDb } from "../../db/index";
import { ConfigSchema, type ConfigInput } from "../../model/schemas";

const DEFAULT_CONFIG: ConfigInput = {
  company: "My Company",
  currency: "INR",
  minRunwayMonths: 8,
  minOperatingReserve: 0,
  maxIterations: 5,
  confidenceFloor: 0.7,
  scratchpad: { retentionCount: 30 },
};

export async function initWorkspace(dir: string, company?: string): Promise<void> {
  const auditDir = path.join(dir, ".audit");
  const scratchDir = path.join(auditDir, "scratchpad");
  fs.mkdirSync(auditDir, { recursive: true });
  fs.mkdirSync(scratchDir, { recursive: true });

  const configPath = path.join(dir, "audit.yaml");
  if (!fs.existsSync(configPath)) {
    const config = { ...DEFAULT_CONFIG, ...(company ? { company } : {}) };
    const validated = ConfigSchema.parse(config);
    const yaml = `# AI Spend Auditor Configuration
company: ${validated.company}
currency: ${validated.currency}
minRunwayMonths: ${validated.minRunwayMonths}
minOperatingReserve: ${validated.minOperatingReserve}
maxIterations: ${validated.maxIterations}
confidenceFloor: ${validated.confidenceFloor}
scratchpad:
  retentionCount: ${validated.scratchpad.retentionCount}
`;
    fs.writeFileSync(configPath, yaml);
  }

  initDb(dir);
}
