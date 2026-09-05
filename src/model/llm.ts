import { groqComplete, groqStream } from "../llm/groq";
import { localComplete } from "../llm/local-fallback";
import { openrouterComplete, openrouterStream } from "../llm/openrouter";

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
}

export interface LLMProvider {
  name: string;
  complete(messages: LLMMessage[]): Promise<string>;
  /** Token streaming. Absent = caller falls back to complete(). */
  stream?(messages: LLMMessage[], signal?: AbortSignal): AsyncGenerator<string>;
}

function flatten(messages: LLMMessage[]): { prompt: string; system?: string } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const prompt = messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
  return { prompt, system: system || undefined };
}

export class GroqProvider implements LLMProvider {
  name = "groq";
  async complete(messages: LLMMessage[]): Promise<string> {
    const { prompt, system } = flatten(messages);
    const res = await groqComplete(prompt, system);
    return res.content;
  }
  async *stream(messages: LLMMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    const { prompt, system } = flatten(messages);
    for await (const chunk of groqStream(prompt, system, signal)) {
      if (chunk.type === "token") yield chunk.text;
    }
  }
}

export class LocalProvider implements LLMProvider {
  name = "local";
  async complete(messages: LLMMessage[]): Promise<string> {
    const { prompt, system } = flatten(messages);
    const res = await localComplete(prompt, system);
    return res.content;
  }
}

export class OpenRouterProvider implements LLMProvider {
  name = "openrouter";
  constructor(private model?: string) {}
  async complete(messages: LLMMessage[]): Promise<string> {
    const { prompt, system } = flatten(messages);
    const res = await openrouterComplete(prompt, system, this.model ? { model: this.model } : undefined);
    return res.content;
  }
  async *stream(messages: LLMMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    const { prompt, system } = flatten(messages);
    for await (const chunk of openrouterStream(prompt, system, signal, this.model ? { model: this.model } : undefined)) {
      if (chunk.type === "token") yield chunk.text;
    }
  }
}

export function pickProvider(): LLMProvider {
  if (process.env.OPENROUTER_API_KEY) return new OpenRouterProvider();
  if (process.env.GROQ_API_KEY) return new GroqProvider();
  return new LocalProvider();
}
