/**
 * harness/index.ts — harness selection, done once so the Executor never branches.
 *
 * Software domain: OpenCode if the binary is installed, else the fallback
 * (with the user-visible notice). Research/writing: no harness — the
 * Executor uses its domain tools directly.
 */
import type { Config } from "../config.js";
import type { ChatProvider } from "../providers/types.js";
import { FallbackHarness } from "./fallback.js";
import { harnessEnv, OpenCodeHarness, type Runner } from "./opencode.js";
import type { Harness } from "./types.js";

export const FALLBACK_NOTICE =
  "[Executor] OpenCode not detected. Install: npm install -g opencode. Falling back to basic tools.";

export async function createHarness(opts: {
  config: Config;
  provider: ChatProvider;
  cwd: string;
  /** Test seam: substitute a prebuilt harness instead of detecting. */
  override?: Harness;
  /** Test seam: substitute the process runner used for detection. */
  runner?: Runner;
}): Promise<{ harness: Harness; notice?: string }> {
  if (opts.override) return { harness: opts.override };

  const opencode = new OpenCodeHarness(opts.cwd, harnessEnv(opts.config), opts.runner);
  if (await opencode.isInstalled()) {
    return { harness: opencode };
  }
  return {
    harness: new FallbackHarness(opts.provider, opts.cwd),
    notice: FALLBACK_NOTICE,
  };
}

export type { Harness, HarnessResult } from "./types.js";
