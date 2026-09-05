/**
 * harness/index.ts — harness selection, done once so the Executor never branches.
 *
 * Software domain: which executor harness runs the coding. `config.harness`
 * picks explicitly ("claude" | "opencode" | "fallback"); default "auto"
 * prefers Claude Code (most common), then OpenCode, then the basic-tools
 * fallback with a visible notice. Research/writing: no harness — the
 * Executor uses its domain tools directly.
 */
import type { Config } from "../config.js";
import type { ChatProvider } from "../providers/types.js";
import { ClaudeCodeHarness, type ClaudeRunner } from "./claude.js";
import { FallbackHarness } from "./fallback.js";
import { harnessEnv, OpenCodeHarness, type Runner } from "./opencode.js";
import type { Harness } from "./types.js";
import type { Transcript } from "../transcript.js";

export const FALLBACK_NOTICE =
  "[Executor] No coding harness detected (Claude Code / OpenCode). Falling back to basic file/shell tools.";

export async function createHarness(opts: {
  config: Config;
  provider: ChatProvider;
  cwd: string;
  /** Shared transcript so the fallback's tool calls are visible (§2.1). */
  transcript?: Transcript;
  /** Test seam: substitute a prebuilt harness instead of detecting. */
  override?: Harness;
  /** Test seam: substitute the process runner used for detection. */
  runner?: Runner;
  /** Test seam: substitute Claude Code's runner for deterministic auto tests. */
  claudeRunner?: ClaudeRunner;
}): Promise<{ harness: Harness; notice?: string }> {
  if (opts.override) return { harness: opts.override };

  const choice = opts.config.harness ?? "auto";
  const opencode = new OpenCodeHarness(opts.cwd, harnessEnv(opts.config), opts.runner);
  const claude = new ClaudeCodeHarness(opts.cwd, opts.claudeRunner);
  const fallback = () => ({
    harness: new FallbackHarness(opts.provider, opts.cwd, opts.transcript) as Harness,
    notice: FALLBACK_NOTICE,
  });

  if (choice === "claude") return { harness: claude };
  if (choice === "opencode") {
    if (await opencode.isInstalled().catch(() => false)) return { harness: opencode };
    return fallback();
  }
  if (choice === "fallback") return fallback();

  // auto: cheap binary presence checks; the full preflight runs once before
  // the real task (a failed preflight falls back — never halts).
  if (await claude.isInstalled().catch(() => false)) return { harness: claude };
  if (await opencode.isInstalled().catch(() => false)) return { harness: opencode };
  return fallback();
}

export type { Harness, HarnessResult } from "./types.js";
