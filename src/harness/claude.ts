/**
 * harness/claude.ts — Claude Code as the software-domain Executor.
 *
 * Same Harness contract as OpenCode: the Executor delegates coding to a
 * headless `claude -p` run in the working directory. The user's Claude
 * auth is used (subscription or key); OpenPair's provider key is never
 * forwarded — Claude Code is an independent executor, not a client of the
 * pair's model account.
 *
 * Output parsing is tolerant: modern Claude Code emits a single JSON result
 * document with --output-format json, but we also accept a JSONL event
 * stream (stream-json) and plain text, because versions differ.
 */
import { execFile, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import type { Harness, HarnessResult } from "./types.js";

export const CLAUDE_TASK_TIMEOUT_MS = 600_000;
export const CLAUDE_PREFLIGHT_TIMEOUT_MS = 60_000;

/** Tools the harness may use: enough to build and verify, nothing more. */
const ALLOWED_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"].join(" ");

export interface ClaudeRunOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export type ClaudeRunner = (
  args: string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<ClaudeRunOutput>;

export const defaultClaudeRunner: ClaudeRunner = (args, opts) =>
  new Promise((resolve) => {
    execFile(
      "claude",
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        // Claude Code probes stdin when it is a pipe and complains about
        // "no stdin data" — give it nothing to wait on. (Runtime-supported;
        // the execFile type overload doesn't model stdio, hence the cast.)
        stdio: ["ignore", "pipe", "pipe"],
      } as ExecFileOptionsWithStringEncoding,
      (error, stdout, stderr) => {
        const anyError = error as (Error & { code?: number | string }) | null;
        if (anyError && typeof anyError.code === "string") {
          resolve({ code: 127, stdout: String(stdout), stderr: String(anyError.message) });
          return;
        }
        resolve({
          code: typeof anyError?.code === "number" ? anyError.code : 0,
          stdout: String(stdout),
          stderr: String(stderr) || (anyError ? anyError.message : ""),
        });
      },
    );
  });

/**
 * Extract the assistant's final text from Claude Code output.
 * Accepts: single JSON result document, JSONL event stream, or plain text.
 */
export function parseClaudeOutput(stdout: string): { ok: boolean; text: string; costUsd?: number } {
  const trimmed = stdout.trim();
  if (!trimmed) return { ok: false, text: "" };

  let costUsd: number | undefined;
  // Single JSON document (preferred --output-format json shape).
  try {
    const doc = JSON.parse(trimmed) as {
      type?: string;
      result?: unknown;
      text?: unknown;
      total_cost_usd?: unknown;
    };
    if (typeof doc.total_cost_usd === "number") costUsd = doc.total_cost_usd;
    if (typeof doc.result === "string") return { ok: true, text: doc.result, costUsd };
    if (typeof doc.text === "string") return { ok: true, text: doc.text, costUsd };
  } catch {
    // Fall through to JSONL.
  }

  // JSONL event stream: keep the last meaningful text we saw.
  const texts: string[] = [];
  let sawJson = false;
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    try {
      const ev = JSON.parse(l) as {
        type?: string;
        result?: unknown;
        event?: { delta?: { text?: unknown } };
        delta?: { text?: unknown };
        total_cost_usd?: unknown;
      };
      sawJson = true;
      if (typeof ev.total_cost_usd === "number") costUsd = ev.total_cost_usd;
      if (ev.type === "result" && typeof ev.result === "string") texts.push(ev.result);
      else if (typeof ev.delta?.text === "string") texts.push(ev.delta.text);
    } catch {
      // tolerate non-JSON lines
    }
  }
  if (sawJson) return { ok: texts.length > 0, text: texts.join("\n"), costUsd };

  // Plain text.
  return { ok: true, text: trimmed };
}

function buildArgs(task: string): string[] {
  return [
    "-p",
    task,
    "--output-format",
    "json",
    "--permission-mode",
    "acceptEdits",
    "--allowed-tools",
    ALLOWED_TOOLS,
  ];
}

export class ClaudeCodeHarness implements Harness {
  readonly name = "claude";

  constructor(
    private readonly cwd: string,
    private readonly run: ClaudeRunner = defaultClaudeRunner,
  ) {}

  /** Cheap presence check (no API call) for auto harness selection. */
  async isInstalled(): Promise<boolean> {
    const res = await this.run(["--version"], { cwd: this.cwd, timeoutMs: 15_000 });
    return res.code === 0;
  }

  /**
   * Preflight: binary present, authenticated, and able to complete a tiny
   * headless task. A 60-second failure beats a 10-minute mystery.
   */
  async preflight(): Promise<HarnessResult> {
    const res = await this.run(
      buildArgs("Reply with exactly: OK"),
      { cwd: this.cwd, timeoutMs: CLAUDE_PREFLIGHT_TIMEOUT_MS },
    );
    if (res.code !== 0) {
      return {
        ok: false,
        output: res.stdout,
        error:
          `Claude Code preflight failed (exit ${res.code}). ${res.stderr.slice(0, 400)}\n` +
          "Check: `claude --version` works and you are logged in (`claude` starts interactively). " +
          "This task will fall back to basic file/shell tools.",
      };
    }
    const parsed = parseClaudeOutput(res.stdout);
    if (!parsed.ok) {
      return {
        ok: false,
        output: res.stdout,
        error:
          "Claude Code returned no parseable output for the preflight task. " +
          "This task will fall back to basic file/shell tools.",
      };
    }
    return { ok: true, output: parsed.text };
  }

  async execute(task: string, context: string): Promise<HarnessResult> {
    const prompt = context ? `${context}\n\nTask:\n${task}` : task;
    const res = await this.run(buildArgs(prompt), {
      cwd: this.cwd,
      timeoutMs: CLAUDE_TASK_TIMEOUT_MS,
    });
    if (res.code !== 0) {
      return {
        ok: false,
        output: res.stdout,
        error: `Claude Code task failed (exit ${res.code}). ${res.stderr.slice(0, 400)}`,
      };
    }
    const parsed = parseClaudeOutput(res.stdout);
    if (!parsed.ok) {
      return {
        ok: false,
        output: res.stdout,
        error: "Claude Code returned no parseable output.",
      };
    }
    const costNote = parsed.costUsd !== undefined ? `\n\n(claude session cost: $${parsed.costUsd.toFixed(4)})` : "";
    return { ok: true, output: parsed.text + costNote };
  }
}
