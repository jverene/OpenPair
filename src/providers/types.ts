/**
 * providers/types.ts — the ChatProvider interface every LLM backend implements.
 *
 * Deliberately text-only: tool use is a prompt-level JSON action protocol
 * (see agents/prompts.ts), so this interface stays identical across
 * OpenAI, Anthropic, Ollama, and custom OpenAI-compatible endpoints, and
 * no provider-specific tool-result plumbing leaks into the agents.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
}

export interface ChatProvider {
  readonly name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}
