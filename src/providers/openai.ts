/**
 * providers/openai.ts — OpenAI chat completions, also serving Ollama and
 * custom providers through the OpenAI-compatible `baseURL` override.
 * (Ollama exposes /v1; "custom" is defined as OpenAI-compatible.)
 *
 * Implements chatStructured (native tool calling) in addition to the
 * text-only chat(): OpenAI-compatible endpoints — including DeepSeek —
 * accept `tools` and return structured `tool_calls`.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type {
  ChatMessage,
  ChatOptions,
  ChatProvider,
  ChatResult,
  ChatToolDef,
  ToolCallRequest,
} from "./types.js";

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
    const response = await this.create(messages, options, false);
    return contentOf(response) ?? "";
  }

  async chatStructured(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const response = await this.create(messages, options, options.tools !== undefined && options.tools.length > 0);
    const message = response.choices[0]?.message;
    const toolCalls =
      message?.tool_calls
        ?.map((call) => {
          if (call.type !== "function") return null;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
          } catch {
            args = { _unparseable_arguments: call.function.arguments };
          }
          return { id: call.id, name: call.function.name, args } satisfies ToolCallRequest;
        })
        .filter((c): c is ToolCallRequest => c !== null) ?? [];
    return {
      content: message?.content ?? null,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: response.usage
        ? { promptTokens: response.usage.prompt_tokens ?? 0, completionTokens: response.usage.completion_tokens ?? 0 }
        : undefined,
    };
  }

  /** Single request path for both entry points, so usage logging is shared. */
  private async create(
    messages: ChatMessage[],
    options: ChatOptions,
    withTools: boolean,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: messages.map(toSdkMessage),
      max_tokens: options.maxTokens,
    };
    if (withTools && options.tools) {
      params.tools = options.tools.map(toSdkTool);
      params.tool_choice = "auto";
    }
    const response = await this.client.chat.completions.create(params);
    this.logUsage(response);
    return response;
  }

  /** Side effect only: append one usage line per call. Never throws into
   *  the chat path — a logging failure must not break a run. */
  private logUsage(response: OpenAI.Chat.Completions.ChatCompletion): void {
    try {
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
  }
}

function contentOf(response: OpenAI.Chat.Completions.ChatCompletion): string | null {
  return response.choices[0]?.message?.content ?? null;
}

function toSdkMessage(m: ChatMessage): ChatCompletionMessageParam {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    const assistant: ChatCompletionMessageParam = {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      })),
    };
    return assistant;
  }
  return { role: m.role, content: m.content };
}

function toSdkTool(tool: ChatToolDef): ChatCompletionTool {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}
