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
import { renderToolDocs, runToolLoop } from "../agents/toolLoop.js";
import type { Harness, HarnessResult } from "./types.js";

const FALLBACK_SYSTEM = `You are the execution engine of a pair-programming system, running with basic file and shell tools.
Work autonomously inside the working directory. Use tools via directives on the first line of your reply:
  ACTION: {"tool": "<name>", "args": {...}}
When the task is fully complete, reply: DONE: <summary of what you did>.
Available tools:
{TOOLS}`;

export class FallbackHarness implements Harness {
  readonly name = "fallback";

  constructor(
    private readonly provider: ChatProvider,
    private readonly cwd: string,
  ) {}

  async preflight(): Promise<HarnessResult> {
    return { ok: true, output: "Fallback harness: no external preflight required." };
  }

  async execute(task: string, context: string): Promise<HarnessResult> {
    const tools = fallbackTools();
    const outcome = await runToolLoop({
      provider: this.provider,
      tools,
      system: FALLBACK_SYSTEM.replace("{TOOLS}", renderToolDocs(tools)),
      task: context ? `${context}\n\nTask:\n${task}` : task,
      cwd: this.cwd,
    });
    return {
      ok: outcome.status === "done",
      output: [...outcome.transcript, outcome.text].join("\n\n"),
      error: outcome.status === "done" ? undefined : `Fallback harness ended with status: ${outcome.status}`,
    };
  }
}
