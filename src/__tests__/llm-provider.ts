/**
 * OpenRouter provider verification (no network calls).
 * Run: bun src/__tests__/llm-provider.ts
 */
import { pickProvider, OpenRouterProvider, GroqProvider, LocalProvider } from "../model/llm";
import { resolveOpenRouterModel } from "../llm/openrouter";

let passed = 0;
let failed = 0;
function assert(c: boolean, name: string) {
  if (c) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
}

async function main() {
  console.log("=== LLM provider verification ===\n");

  const savedGroq = process.env.GROQ_API_KEY;
  const savedOR = process.env.OPENROUTER_API_KEY;
  const savedModel = process.env.OPENROUTER_MODEL;

  delete process.env.GROQ_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  assert(pickProvider() instanceof LocalProvider, "no keys → local fallback");

  process.env.GROQ_API_KEY = "test-groq";
  assert(pickProvider() instanceof GroqProvider, "groq key only → groq");

  process.env.OPENROUTER_API_KEY = "test-or";
  assert(pickProvider() instanceof OpenRouterProvider, "openrouter key wins over groq");
  assert(pickProvider().name === "openrouter", "provider name is openrouter");

  delete process.env.OPENROUTER_MODEL;
  assert(resolveOpenRouterModel() === "openrouter/free", "default model is openrouter/free router");
  process.env.OPENROUTER_MODEL = "openai/gpt-oss-20b:free";
  assert(resolveOpenRouterModel() === "openai/gpt-oss-20b:free", "OPENROUTER_MODEL pin respected");
  process.env.OPENROUTER_MODEL = "   ";
  assert(resolveOpenRouterModel() === "openrouter/free", "blank pin falls back to router");

  if (savedGroq === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = savedGroq;
  if (savedOR === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedOR;
  if (savedModel === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = savedModel;

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error("FAILED:", err); process.exit(1); });
