export interface LLMResponse {
  content: string;
  latencyMs: number;
}

export async function groqComplete(
  prompt: string,
  _systemPrompt?: string
): Promise<LLMResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY not set in .env");
  }

  const start = performance.now();
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: _systemPrompt ?? "You are a financial investigation agent." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    content: data.choices[0].message.content,
    latencyMs: Math.round(performance.now() - start),
  };
}
