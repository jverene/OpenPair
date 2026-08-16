/**
 * tools/registry.ts — domain → capability set, per the PRD:
 *
 *   software: the OpenCode harness (or the fallback harness) — no direct tools
 *   research: file + shell + python tools
 *   writing:  file tools only
 *
 * A Tool is a provider-facing ToolSpec plus its local implementation.
 */
import type { Domain } from "../config.js";
import { fileTools } from "./files.js";
import { runShellTool } from "./shell.js";
import { runPythonTool } from "./python.js";

export interface Tool {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments, rendered into the Executor's prompt. */
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, cwd: string): Promise<string>;
}

/** Tools the Executor calls directly in a tool-use loop. */
export function toolsForDomain(domain: Domain): Tool[] {
  switch (domain) {
    case "software":
      // Software execution goes through the harness (OpenCode or fallback).
      return [];
    case "research":
      return [...fileTools, runShellTool, runPythonTool];
    case "writing":
      return [...fileTools];
  }
}

/** The fallback harness's basic tool set when OpenCode is unavailable. */
export function fallbackTools(): Tool[] {
  return [...fileTools, runShellTool];
}
