/**
 * harness/fallback.ts — used when OpenCode is not installed.
 *
 * Implements the same Harness interface as OpenCodeHarness so the Executor
 * never branches. Execution is the shared JSON-directive tool loop over a
 * basic file/shell tool set. Preflight always passes (there is nothing
 * external to smoke-test).
 */
import type { ChatProvider } from "../providers/types.js";
import { fallbackTools } from "../tools/registry.js";
import { runToolLoop } from "../agents/toolLoop.js";
import type { Transcript } from "../transcript.js";
import type { Harness, HarnessResult } from "./types.js";

const FALLBACK_SYSTEM = `You are the execution engine of a pair-programming system, running with basic file and shell tools.
Work autonomously inside the working directory.`;

export class FallbackHarness implements Harness {
  readonly name = "fallback";

  constructor(
    provider: ChatProvider,
    private readonly cwd: string,
    private readonly transcript?: Transcript,
  ) {
    this.provider = provider;
  }

  private provider: ChatProvider;

  /** Orchestrator hook: run through the per-agent tracked provider (§2.4). */
  setProvider(provider: ChatProvider): void {
    this.provider = provider;
  }

  async preflight(): Promise<HarnessResult> {
    return { ok: true, output: "Fallback harness: no external preflight required." };
  }

  async execute(task: string, context: string): Promise<HarnessResult> {
    const tools = fallbackTools();
    const outcome = await runToolLoop({
      provider: this.provider,
      tools,
      system: FALLBACK_SYSTEM,
      task: context ? `${context}\n\nTask:\n${task}` : task,
      cwd: this.cwd,
      onEvent: this.transcript
        ? (kind, text) => {
            void this.transcript?.append("Executor", kind, text);
          }
        : undefined,
    });
    return {
      ok: outcome.status === "done",
      output: [...outcome.transcript, outcome.text].join("\n\n"),
      error: outcome.status === "done" ? undefined : `Fallback harness ended with status: ${outcome.status}`,
    };
  }
}
