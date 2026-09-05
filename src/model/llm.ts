import { groqComplete } from "../llm/groq";
import { localComplete } from "../llm/local-fallback";

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
}

export interface LLMProvider {
  name: string;
  complete(messages: LLMMessage[]): Promise<string>;
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
}

export class LocalProvider implements LLMProvider {
  name = "local";
  async complete(messages: LLMMessage[]): Promise<string> {
    const { prompt, system } = flatten(messages);
    const res = await localComplete(prompt, system);
    return res.content;
  }
}

export function pickProvider(): LLMProvider {
  return process.env.GROQ_API_KEY ? new GroqProvider() : new LocalProvider();
}
