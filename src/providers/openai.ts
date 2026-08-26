/**
 * providers/openai.ts — OpenAI chat completions, also serving Ollama and
 * custom providers through the OpenAI-compatible `baseURL` override.
 * (Ollama exposes /v1; "custom" is defined as OpenAI-compatible.)
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
    // Side effect only: append one usage line per call. Never throws into
    // the chat path — a logging failure must not break a run.
    try {
      // DeepSeek extends the OpenAI usage object with cache fields the SDK
      // type doesn't know; read it as an open record.
      const u = response.usage as unknown as Record<string, number> | undefined;
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        model: this.model,
        prompt_tokens: u?.prompt_tokens ?? null,
        completion_tokens: u?.completion_tokens ?? null,
        prompt_cache_hit_tokens: u?.prompt_cache_hit_tokens ?? null,
        prompt_cache_miss_tokens: u?.prompt_cache_miss_tokens ?? null,
      });
      const logPath = resolve(process.env.OPENPAIR_USAGE_LOG ?? ".pair/usage.jsonl");
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, line + "\n");
    } catch {
      // Swallow: usage logging is best-effort.
    }
    return response.choices[0]?.message?.content ?? "";
  }
}
