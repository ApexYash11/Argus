export interface LLMResponse {
  content: string;
  latencyMs: number;
}

export interface LLMChunk {
  type: "token" | "done";
  text: string;
}

const LLM_TIMEOUT = 30_000;

export async function groqComplete(
  prompt: string,
  _systemPrompt?: string
): Promise<LLMResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY not set in .env");
  }

  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
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
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Groq response missing content");
    }

    return {
      content,
      latencyMs: Math.round(performance.now() - start),
    };
  } finally {
    clearTimeout(timer);
  }
}

function timeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return {
    signal: ctrl.signal,
    clear: () => clearTimeout(timer),
  };
}

function combineSignals(...signals: (AbortSignal | undefined)[]): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController();
  const cleanups: (() => void)[] = [];
  for (const sig of signals) {
    if (!sig) continue;
    if (sig.aborted) { ctrl.abort(sig.reason); break; }
    const onAbort = () => ctrl.abort(sig.reason);
    sig.addEventListener("abort", onAbort);
    cleanups.push(() => sig.removeEventListener("abort", onAbort));
  }
  return {
    signal: ctrl.signal,
    cleanup: () => { for (const fn of cleanups) fn(); },
  };
}

export async function* groqStream(
  prompt: string,
  systemPrompt?: string,
  signal?: AbortSignal
): AsyncGenerator<LLMChunk> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    yield { type: "done", text: "GROQ_API_KEY not set in .env" };
    return;
  }

  const timeout = timeoutSignal(LLM_TIMEOUT);
  const combined = combineSignals(signal, timeout.signal);
  const start = performance.now();
  let fullText = "";

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: combined.signal,
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
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
      yield { type: "done", text: `Groq API error (${res.status}): ${text}` };
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      yield { type: "done", text: "No response body from Groq" };
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

    // Process any remaining data in buffer (last line without trailing newline)
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
  } finally {
    timeout.clear();
    combined.cleanup();
  }

  yield {
    type: "done",
    text: fullText,
  };
}
