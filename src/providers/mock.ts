/**
 * providers/mock.ts — a scripted ChatProvider used by the test suite and by
 * `openpair --mock`, which runs the whole loop with no API keys so the UX
 * and handoff mechanics are verifiable offline.
 */
import type { ChatMessage, ChatOptions, ChatProvider } from "./types.js";

export type MockScript = (
  messages: ChatMessage[],
  callIndex: number,
  options: ChatOptions,
) => string | Promise<string>;

export class MockProvider implements ChatProvider {
  readonly name = "mock";
  readonly calls: ChatMessage[][] = [];

  constructor(private readonly script: MockScript) {}

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    this.calls.push(messages);
    return this.script(messages, this.calls.length - 1, options);
  }
}

/**
 * The default --mock screenplay: a full happy-path loop.
 * Vision writes intent, Executor plans and immediately reports DONE,
 * Vision approves on the first review.
 */
export function defaultMockScript(): MockScript {
  return (messages) => {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const user = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");

    if (system.includes("You are the Vision Holder")) {
      if (user.includes("Review the execution")) {
        return [
          "APPROVE",
          "",
          "The mock execution satisfies the mock intent. All sections present, handoff mechanics exercised.",
        ].join("\n");
      }
      return [
        "INTENT:",
        "Demonstrate the OpenPair loop end to end in mock mode.",
        "",
        "INTENT NOTES:",
        "Mock run: no real LLM, no real artifacts. Scope is the loop mechanics only.",
      ].join("\n");
    }
    // Executor
    if (user.includes("Write your plan")) {
      return [
        "PLAN:",
        "1. Acknowledge intent. 2. Report mock completion.",
        "",
        "PLAN NOTES:",
        "Mock mode performs no real work; rejected doing anything fancier because the point is exercising the handoff, not the LLM.",
      ].join("\n");
    }
    return "DONE: Mock execution complete. No artifacts produced (mock mode). Handoff mechanics verified.";
  };
}
