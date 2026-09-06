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

export interface InitOptions {
  currency?: string;
  dataChoice?: "sample" | "folder" | "skip";
  folder?: string;
  llmChoice?: "skip" | "openrouter" | "groq";
  llmKey?: string;
  runDemo?: boolean;
}

export async function initWorkspace(dir: string, company?: string, opts: InitOptions = {}): Promise<void> {
  const auditDir = path.join(dir, ".audit");
  const scratchDir = path.join(auditDir, "scratchpad");
  fs.mkdirSync(auditDir, { recursive: true });
  fs.mkdirSync(scratchDir, { recursive: true });

  const configPath = path.join(dir, "audit.yaml");
  if (!fs.existsSync(configPath)) {
    const config = {
      ...DEFAULT_CONFIG,
      ...(company ? { company } : {}),
      ...(opts.currency ? { currency: opts.currency } : {}),
    };
    const validated = ConfigSchema.parse(config);
    const safeCompany = validated.company.replace(/['":#\[\]{}&*!|>%@`\n\r]/g, "").slice(0, 100);
    const yaml = `# AI Spend Auditor Configuration
company: "${safeCompany}"
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

  if (opts.llmChoice === "openrouter" && opts.llmKey) {
    const envPath = path.join(dir, ".env");
    const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
    if (!/^OPENROUTER_API_KEY=/m.test(existing)) {
      fs.appendFileSync(envPath, `OPENROUTER_API_KEY=${opts.llmKey}\n`);
    }
  } else if (opts.llmChoice === "groq" && opts.llmKey) {
    const envPath = path.join(dir, ".env");
    const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
    if (!/^GROQ_API_KEY=/m.test(existing)) {
      fs.appendFileSync(envPath, `GROQ_API_KEY=${opts.llmKey}\n`);
    }
  }
}
