/**
 * providers/types.ts — the ChatProvider interface every LLM backend implements.
 *
 * The baseline interface is text-only so every provider (OpenAI, Anthropic,
 * Ollama, custom) stays implementable with a single method. Providers that
 * support NATIVE tool calling additionally implement `chatStructured`:
 * the tool loop then passes tool definitions through the API and consumes
 * structured `tool_calls` instead of parsing ACTION: text. Providers without
 * it (Ollama and friends) keep the text-directive protocol — see
 * agents/toolLoop.ts.
 */

/** A structured tool-call request emitted by the model. */
export interface ToolCallRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Provider-agnostic tool definition, passed via ChatOptions.tools. */
export interface ChatToolDef {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string; toolCalls?: ToolCallRequest[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ChatOptions {
  maxTokens?: number;
  /** When set and the provider implements chatStructured, tools are offered natively. */
  tools?: ChatToolDef[];
}

export interface ChatResult {
  /** Text content; null when the model only emitted tool calls. */
  content: string | null;
  /** Structured tool calls (native tool calling only). */
  toolCalls?: ToolCallRequest[];
  /** Token usage when the backend reports it. */
  usage?: { promptTokens: number; completionTokens: number };
}

export interface ChatProvider {
  readonly name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  /** Optional capability: structured chat with native tool calling. */
  chatStructured?(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
}
