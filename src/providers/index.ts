/**
 * providers/index.ts — build a ChatProvider from the user's config.
 * Ollama and custom providers ride the OpenAI-compatible path.
 */
import { resolveApiKey, type Config } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import type { ChatProvider } from "./types.js";

export function createProvider(config: Config): ChatProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider({
        apiKey: resolveApiKey(config),
        model: config.model,
      });
    case "openai":
      return new OpenAIProvider({
        apiKey: resolveApiKey(config),
        model: config.model,
      });
    case "ollama":
      return new OpenAIProvider({
        name: "ollama",
        baseURL: config.baseURL ?? "http://localhost:11434/v1",
        model: config.model,
      });
    case "custom":
      return new OpenAIProvider({
        name: "custom",
        apiKey: resolveApiKey(config),
        baseURL: config.baseURL,
        model: config.model,
      });
  }
}

export type { ChatProvider } from "./types.js";
