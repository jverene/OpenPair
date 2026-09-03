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

/**
 * Parse `opencode run --format json` output. Current opencode emits a JSONL
 * event stream (one JSON object per line: step_start / text / step_finish);
 * older versions emitted a single JSON document. Both are accepted; stray
 * non-JSON lines (spinner noise, warnings) are tolerated.
 * @returns ok=true when at least one JSON event/document was parsed.
 */
export function parseOpenCodeOutput(stdout: string): { ok: boolean; text: string } {
  const trimmed = stdout.trim();
  if (!trimmed) return { ok: false, text: "" };

  // Legacy single-document format.
  try {
    const doc = JSON.parse(trimmed) as { text?: unknown; content?: unknown };
    const legacyText =
      typeof doc.text === "string" ? doc.text : typeof doc.content === "string" ? doc.content : trimmed;
    return { ok: true, text: legacyText };
  } catch {
    // Fall through to the JSONL event stream.
  }

  const texts: string[] = [];
  let sawJson = false;
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    try {
      const ev = JSON.parse(l) as {
        type?: string;
        part?: { type?: string; text?: unknown };
        text?: unknown;
      };
      sawJson = true;
      if (ev.type === "text" && typeof ev.part?.text === "string") texts.push(ev.part.text);
      else if (ev.type === "result" && typeof ev.text === "string") texts.push(ev.text);
    } catch {
      // Tolerate non-JSON lines (spinner output, warnings).
    }
  }
  return { ok: sawJson, text: texts.join("\n") };
}

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
    const parsed = parseOpenCodeOutput(res.stdout);
    if (!parsed.ok) {
      return {
        ok: false,
        output: res.stdout,
        error:
          "OpenCode returned no parseable output (neither JSONL events nor a JSON document). " +
          "Check your OpenCode installation (https://opencode.ai/docs) — this task will fall back to basic tools.",
      };
    }
    return { ok: true, output: parsed.text || res.stdout };
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
    const parsed = parseOpenCodeOutput(res.stdout);
    if (!parsed.ok) {
      return {
        ok: false,
        output: res.stdout,
        error: "OpenCode returned no parseable output. Check your OpenCode installation (https://opencode.ai/docs).",
      };
    }
    return { ok: true, output: parsed.text || res.stdout };
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
