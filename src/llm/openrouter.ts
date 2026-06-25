export interface LLMResponse {
  content: string;
  latencyMs: number;
}

export async function openrouterComplete(
  prompt: string,
  _systemPrompt?: string
): Promise<LLMResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not set in .env");
  }

  const start = performance.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/ApexYash11/Argus",
    },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4-6",
      messages: [
        { role: "system", content: _systemPrompt ?? "You are a financial investigation agent generating structured findings." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 1000,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    content: data.choices[0].message.content,
    latencyMs: Math.round(performance.now() - start),
  };
}
