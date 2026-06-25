import type { LLMResponse } from "./groq";

export async function localComplete(
  prompt: string,
  _systemPrompt?: string
): Promise<LLMResponse> {
  const start = performance.now();

  const content = generateLocalResponse(prompt);

  return {
    content,
    latencyMs: Math.round(performance.now() - start),
  };
}

function generateLocalResponse(prompt: string): string {
  const lower = prompt.toLowerCase();

  if (lower.includes("classify") || lower.includes("classify_event")) {
    return JSON.stringify({
      vendor: extractField(prompt, "vendor"),
      amount: extractField(prompt, "amount") || "0",
      period: extractField(prompt, "period") || extractField(prompt, "date") || "unknown",
    });
  }

  if (lower.includes("confidence")) {
    return JSON.stringify({
      score: 0.85,
      reason: "Local fallback: deterministic scoring based on available signals",
      signals: ["amount_match", "vendor_match", "period_overlap"],
    });
  }

  if (lower.includes("generate_finding") || lower.includes("finding")) {
    return JSON.stringify({
      title: "Potential finding detected",
      summary: "Local fallback generated this finding for testing purposes.",
      impact: 0,
      recommendations: ["Review the transaction", "Verify with vendor"],
      confidence: 0.85,
    });
  }

  return "Local fallback: response not available without LLM API key.";
}

function extractField(text: string, field: string): string | null {
  const patterns = [
    new RegExp(`${field}[:\s]+"?([^"\\n,]+)"?`, "i"),
    new RegExp(`${field}["\\]]?:\\s*"?([^"\\n,]+)"?`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}
