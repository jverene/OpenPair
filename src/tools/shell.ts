/**
 * tools/shell.ts — run_shell with a timeout and an output cap.
 * Commands run with cwd as the working directory; the sandbox is the
 * project directory by convention (the PRD's "files and commands only").
 */
import { exec } from "node:child_process";
import type { Tool } from "./registry.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 50_000;

export async function runShell(
  command: string,
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolvePromise) => {
    exec(
      command,
      { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        let out = "";
        if (stdout) out += stdout;
        if (stderr) out += (out ? "\n" : "") + stderr;
        if (error && !out) out = `Command failed: ${error.message}`;
        else if (error) out += `\n(exit: ${error.code ?? "unknown"})`;
        if (out.length > MAX_OUTPUT_CHARS) {
          out = out.slice(0, MAX_OUTPUT_CHARS) + "\n…(output truncated)";
        }
        resolvePromise(out || "(no output)");
      },
    );
  });
}

export const runShellTool: Tool = {
  name: "run_shell",
  description: "Run a shell command in the working directory. 60s timeout, output capped.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to run." },
      timeout_ms: { type: "number", description: "Optional timeout in milliseconds (default 60000)." },
    },
    required: ["command"],
  },
  async execute(args, cwd) {
    const timeout = typeof args.timeout_ms === "number" ? args.timeout_ms : DEFAULT_TIMEOUT_MS;
    return runShell(String(args.command ?? ""), cwd, timeout);
  },
};
