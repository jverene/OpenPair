/**
 * harness/opencode.ts — the software-domain Executor harness.
 *
 * Spawns OpenCode headless instead of hand-rolling file/shell/git tools:
 *   opencode run --auto --format json --dir <cwd> "<task>"
 *
 * - Credentials pass through as environment variables only
 *   (OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, OPENCODE_MODEL).
 *   OpenCode's config files are never touched.
 * - Preflight (15s) runs before every real task; real tasks get 300s.
 * - The process runner is injectable so tests can mock spawn behavior.
 */
import { execFile } from "node:child_process";
import type { Config } from "../config.js";
import type { Harness, HarnessResult } from "./types.js";

export const PREFLIGHT_TIMEOUT_MS = 15_000;
export const TASK_TIMEOUT_MS = 300_000;
export const PREFLIGHT_TASK = "Read README.md and report its first line";

export interface RunOutput {
  code: number;
  stdout: string;
  stderr: string;
}

/** Injectable process runner (tests substitute a mock). */
export type Runner = (
  command: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<RunOutput>;

export const defaultRunner: Runner = (command, args, opts) =>
  new Promise((resolveRun) => {
    execFile(
      command,
      args,
      {
        cwd: opts.cwd,
        env: opts.env,
        timeout: opts.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        // execFile reports non-zero exits and ENOENT via error; capture both.
        const anyError = error as (Error & { code?: number | string }) | null;
        if (anyError && typeof anyError.code === "string") {
          // e.g. ENOENT — binary not installed.
          resolveRun({ code: 127, stdout: String(stdout), stderr: String(anyError.message) });
          return;
        }
        resolveRun({
          code: typeof anyError?.code === "number" ? anyError.code : 0,
          stdout: String(stdout),
          stderr: String(stderr) || (anyError ? anyError.message : ""),
        });
      },
    );
  });

/** Env-only credential pass-through; OpenCode config files stay untouched. */
export function harnessEnv(config: Config): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (config.apiKey) {
    if (config.provider === "anthropic") env.ANTHROPIC_API_KEY = config.apiKey;
    else env.OPENAI_API_KEY = config.apiKey;
  }
  if (process.env.OPENROUTER_API_KEY) env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  env.OPENCODE_MODEL = config.model;
  return env;
}

export class OpenCodeHarness implements Harness {
  readonly name = "opencode";

  constructor(
    private readonly cwd: string,
    private readonly env: NodeJS.ProcessEnv,
    private readonly run: Runner = defaultRunner,
  ) {}

  /** Presence check only — is the binary there? (Not the preflight.) */
  async isInstalled(): Promise<boolean> {
    const res = await this.run("opencode", ["--version"], {
      cwd: this.cwd,
      env: this.env,
      timeoutMs: PREFLIGHT_TIMEOUT_MS,
    });
    return res.code === 0;
  }

  async preflight(): Promise<HarnessResult> {
    const res = await this.run(
      "opencode",
      ["run", "--auto", "--format", "json", "--dir", ".", PREFLIGHT_TASK],
      { cwd: this.cwd, env: this.env, timeoutMs: PREFLIGHT_TIMEOUT_MS },
    );
    if (res.code !== 0) {
      return {
        ok: false,
        output: res.stdout,
        error: troubleshoot(res.stderr || res.stdout),
      };
    }
    try {
      JSON.parse(res.stdout);
    } catch {
      return {
        ok: false,
        output: res.stdout,
        error:
          "OpenCode returned unparseable output (expected --format json). " +
          "Check that your OpenCode version supports `opencode run --format json` (upgrade: npm install -g opencode@latest).",
      };
    }
    return { ok: true, output: res.stdout };
  }

  async execute(task: string, context: string): Promise<HarnessResult> {
    const prompt = context ? `${context}\n\nTask:\n${task}` : task;
    const res = await this.run(
      "opencode",
      ["run", "--auto", "--format", "json", "--dir", this.cwd, prompt],
      { cwd: this.cwd, env: this.env, timeoutMs: TASK_TIMEOUT_MS },
    );
    if (res.code !== 0) {
      return { ok: false, output: res.stdout, error: troubleshoot(res.stderr || res.stdout) };
    }
    return { ok: true, output: res.stdout };
  }
}

/** Turn raw OpenCode failure output into actionable troubleshooting. */
function troubleshoot(detail: string): string {
  const hints: string[] = ["OpenCode task failed."];
  const lower = detail.toLowerCase();
  if (lower.includes("api_key") || lower.includes("api key") || lower.includes("unauthorized") || lower.includes("401")) {
    hints.push("Likely cause: missing or invalid API key. Fix: re-run `openpair --reconfigure` or set the provider's API key env var.");
  } else if (lower.includes("model")) {
    hints.push("Likely cause: invalid or unavailable model. Fix: check OPENCODE_MODEL / your OpenPair model setting.");
  } else if (lower.includes("econnrefused") || lower.includes("network") || lower.includes("timeout") || lower.includes("enotfound")) {
    hints.push("Likely cause: network issue or unreachable endpoint. Fix: check connectivity, proxy, or provider base URL.");
  } else {
    hints.push("Check: API key valid? model name correct? network reachable? Run `opencode run \"hi\"` manually to reproduce.");
  }
  hints.push(`Raw output: ${detail.slice(0, 2000)}`);
  return hints.join("\n");
}
