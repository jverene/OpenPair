/**
 * usage.ts — per-agent context tracking for compaction (v0.2 §2.4).
 *
 * Wraps a ChatProvider so every call records the ACTOR's most recent
 * context size (prompt tokens when the backend reports them; a chars/4
 * estimate otherwise). The orchestrator checks these numbers at yield
 * boundaries and triggers self-authored compaction at ~75% of the model's
 * context limit — never mid-turn.
 */
import type { ChatMessage, ChatOptions, ChatProvider } from "./providers/types.js";

export interface AgentUsage {
  /** Context size of the agent's most recent call. */
  lastPromptTokens: number;
  /** Cumulative tokens across the run, for the ledger. */
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

export class UsageTracker {
  private readonly agents = new Map<string, AgentUsage>();

  get(actor: string): AgentUsage {
    return this.agents.get(actor) ?? { lastPromptTokens: 0, totalPromptTokens: 0, totalCompletionTokens: 0 };
  }

  record(actor: string, promptTokens: number, completionTokens: number): void {
    const prev = this.get(actor);
    this.agents.set(actor, {
      lastPromptTokens: promptTokens,
      totalPromptTokens: prev.totalPromptTokens + promptTokens,
      totalCompletionTokens: prev.totalCompletionTokens + completionTokens,
    });
  }
}

/** Rough context estimate when a backend reports no usage: ~4 chars/token. */
export function estimateTokens(messages: ChatMessage[]): number {
  return Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 4);
}

export class TrackingProvider implements ChatProvider {
  readonly name: string;
  /** Present ONLY when the inner provider supports it — the tool loop probes
   *  this property to pick native vs text protocol, so it must be absent
   *  (not merely throwing) for text-only providers like MockProvider. */
  chatStructured?: (messages: ChatMessage[], options?: ChatOptions) => Promise<import("./providers/types.js").ChatResult>;

  constructor(
    private readonly inner: ChatProvider,
    private readonly tracker: UsageTracker,
    private readonly actor: string,
  ) {
    this.name = inner.name;
    const innerStructured = inner.chatStructured?.bind(inner);
    if (innerStructured) {
      this.chatStructured = async (messages, options = {}) => {
        const result = await innerStructured(messages, options);
        this.tracker.record(this.actor, result.usage?.promptTokens ?? estimateTokens(messages), result.usage?.completionTokens ?? 0);
        return result;
      };
    }
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    if (this.chatStructured) {
      // Structured-without-tools is behaviorally identical and reports usage.
      const result = await this.chatStructured(messages, options);
      return result.content ?? "";
    }
    const reply = await this.inner.chat(messages, options);
    this.tracker.record(this.actor, estimateTokens(messages), estimateTokens([{ role: "user", content: reply }]));
    return reply;
  }
}
