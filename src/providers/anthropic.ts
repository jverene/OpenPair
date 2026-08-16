/**
 * providers/anthropic.ts — Anthropic messages API, text-only.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatOptions, ChatProvider } from "./types.js";

export interface AnthropicProviderOptions {
  apiKey?: string;
  model: string;
}

export class AnthropicProvider implements ChatProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: AnthropicProviderOptions) {
    this.model = opts.model;
    this.client = new Anthropic({ apiKey: opts.apiKey });
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    // Anthropic takes system separately from the conversation turns.
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const turns = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const response = await this.client.messages.create({
      model: this.model,
      system: system || undefined,
      messages: turns,
      max_tokens: options.maxTokens ?? 4096,
    });

    return response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
}
