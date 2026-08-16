/**
 * tools/python.ts — run_python for the research domain.
 * Executes `python3 -c <code>` in the working directory with a timeout.
 */
import type { Tool } from "./registry.js";
import { runShell } from "./shell.js";

export const runPythonTool: Tool = {
  name: "run_python",
  description: "Run Python 3 code in the working directory (python3 -c). 120s timeout.",
  parameters: {
    type: "object",
    properties: { code: { type: "string", description: "Python source to execute." } },
    required: ["code"],
  },
  async execute(args, cwd) {
    const code = String(args.code ?? "");
    // Single-quote the code for the shell; embedded single quotes are escaped.
    const quoted = `'${code.replace(/'/g, `'\\''`)}'`;
    return runShell(`python3 -c ${quoted}`, cwd, 120_000);
  },
};
