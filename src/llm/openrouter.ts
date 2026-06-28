import type { LLMChunk } from "./groq";

export interface LLMResponse {
  content: string;
  latencyMs: number;
}

const LLM_TIMEOUT = 60_000;

export async function openrouterComplete(
  prompt: string,
  _systemPrompt?: string
): Promise<LLMResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not set in .env");
  }

  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com/ApexYash11/Argus",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "poolside/laguna-xs.2:free",
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
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("OpenRouter response missing content");
    }

    return {
      content,
      latencyMs: Math.round(performance.now() - start),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function* openrouterStream(
  prompt: string,
  systemPrompt?: string,
  signal?: AbortSignal
): AsyncGenerator<LLMChunk> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    yield { type: "done", text: "OPENROUTER_API_KEY not set in .env" };
    return;
  }

  const start = performance.now();
  let fullText = "";

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com/ApexYash11/Argus",
        "X-Title": "Argus Financial Investigator",
      },
      signal,
      body: JSON.stringify({
        model: "poolside/laguna-xs.2:free",
        stream: true,
        messages: [
          { role: "system", content: systemPrompt ?? "You are a financial investigation agent." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      yield { type: "done", text: `OpenRouter API error (${res.status}): ${text}` };
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      yield { type: "done", text: "No response body from OpenRouter" };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    loop: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") break loop;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            yield { type: "token", text: delta };
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6);
        if (data !== "[DONE]") {
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              yield { type: "token", text: delta };
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      yield { type: "done", text: fullText || "Cancelled." };
      return;
    }
    yield { type: "done", text: fullText || `Error: ${err.message}` };
    return;
  }

  yield {
    type: "done",
    text: fullText,
  };
}
