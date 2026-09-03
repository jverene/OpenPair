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

/** Turn budget for the fallback tool loop. Generous: the deadlock this
 *  replaced (15 turns spent, work done, run halted) came from verification
 *  steps after completion, not from real work. */
const FALLBACK_MAX_TURNS = 25;

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
      maxTurns: FALLBACK_MAX_TURNS,
      onEvent: this.transcript
        ? (kind, text) => {
            void this.transcript?.append("Executor", kind, text);
          }
        : undefined,
    });
    const output = [...outcome.transcript, outcome.text].join("\n\n");
    if (outcome.status === "done") {
      return { ok: true, output };
    }
    if (outcome.status === "max_turns") {
      // Partial work, not a failure: flow to review, which judges the
      // turn-capped run against the artifact manifest.
      return { ok: true, output, capped: true };
    }
    // protocol_failure (and anything else) is a genuine failure -> halt.
    return { ok: false, output, error: `Fallback harness ended with status: ${outcome.status}` };
  }
}
