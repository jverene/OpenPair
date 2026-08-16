/**
 * providers/openai.ts — OpenAI chat completions, also serving Ollama and
 * custom providers through the OpenAI-compatible `baseURL` override.
 * (Ollama exposes /v1; "custom" is defined as OpenAI-compatible.)
 */
import OpenAI from "openai";
import type { ChatMessage, ChatOptions, ChatProvider } from "./types.js";

export interface OpenAIProviderOptions {
  apiKey?: string;
  baseURL?: string;
  model: string;
  /** Label used for logging, e.g. "openai" or "ollama". */
  name?: string;
}

export class OpenAIProvider implements ChatProvider {
  readonly name: string;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(opts: OpenAIProviderOptions) {
    this.name = opts.name ?? "openai";
    this.model = opts.model;
    this.client = new OpenAI({
      // The SDK requires a key string; Ollama ignores it.
      apiKey: opts.apiKey ?? "openpair-no-key",
      baseURL: opts.baseURL,
    });
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: options.maxTokens,
    });
    return response.choices[0]?.message?.content ?? "";
  }
}
