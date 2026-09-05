/**
 * setup.ts — the ECC-style `npx @jverene/openpair` flow.
 *
 * `openpair setup` (also what a bare npx invocation does) runs the config
 * wizard, then — when a Claude Code CLI is present — registers the MCP
 * server and installs the /openpair slash command at user scope, so the
 * next Claude Code session has OpenPair automatically.
 */
import { execFile } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import prompts from "prompts";
import { runWizard } from "./wizard.js";
import { loadConfig } from "./config.js";

export interface IntegrationResult {
  claudeDetected: boolean;
  mcpRegistered: boolean;
  commandInstalled: boolean;
  notes: string[];
}

export interface IntegrationDeps {
  /** Injection seams for tests. */
  home?: string;
  packageRoot?: string;
  runExec?: (cmd: string, args: string[]) => Promise<{ code: number; stderr: string }>;
}

export const defaultExec = (cmd: string, args: string[]) =>
  new Promise<{ code: number; stderr: string }>((resolve) => {
    execFile(cmd, args, { timeout: 60_000 }, (error, _stdout, stderr) => {
      const anyError = error as (Error & { code?: number | string }) | null;
      const code = typeof anyError?.code === "number" ? anyError.code : anyError ? 1 : 0;
      resolve({ code, stderr: String(stderr || anyError?.message || "") });
    });
  });

/** Source of the bundled slash-command file (ships in the npm package). */
export function bundledCommandPath(packageRoot?: string): string {
  const root = packageRoot ?? fileURLToPath(new URL("..", import.meta.url));
  return join(root, "claude-plugin", "commands", "openpair.md");
}

/**
 * Register OpenPair with Claude Code:
 *   1. MCP server at user scope: every session gets pair_run/pair_preflight.
 *   2. /openpair slash command copied into ~/.claude/commands/.
 */
export async function installClaudeIntegration(deps: IntegrationDeps = {}): Promise<IntegrationResult> {
  const home = deps.home ?? homedir();
  const run = deps.runExec ?? defaultExec;
  const result: IntegrationResult = { claudeDetected: false, mcpRegistered: false, commandInstalled: false, notes: [] };

  const version = await run("claude", ["--version"]);
  result.claudeDetected = version.code === 0;
  if (!result.claudeDetected) {
    result.notes.push("Claude Code CLI not found — skipped MCP + slash-command install. Install Claude Code and re-run `openpair setup` to enable them.");
    return result;
  }

  const mcp = await run("claude", ["mcp", "add", "--scope", "user", "openpair", "--", "npx", "@jverene/openpair", "mcp"]);
  result.mcpRegistered = mcp.code === 0;
  if (!result.mcpRegistered) {
    result.notes.push(`MCP registration failed: ${mcp.stderr.slice(0, 200)} — add manually: claude mcp add --scope user openpair -- npx @jverene/openpair mcp`);
  }

  try {
    const destDir = join(home, ".claude", "commands");
    await mkdir(destDir, { recursive: true });
    await copyFile(bundledCommandPath(deps.packageRoot), join(destDir, "openpair.md"));
    result.commandInstalled = true;
  } catch (err) {
    result.notes.push(`Slash-command install failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/** Full first-run flow: config wizard, then Claude Code integration. */
export async function runSetup(): Promise<void> {
  console.log("OpenPair setup");
  console.log("──────────────");

  const existing = await loadConfig();
  if (existing) {
    console.log(`Existing configuration found (${existing.provider}/${existing.model}, domain: ${existing.domain}). You can keep or change it.`);
  }

  const config = await runWizard();
  if (!config) {
    console.log("Setup cancelled — nothing was saved.");
    return;
  }
  console.log(`Configuration saved: ${config.provider}/${config.model}, domain: ${config.domain}.`);

  // Claude Code integration — only worth offering if the CLI exists.
  const claudeCheck = await defaultExec("claude", ["--version"]);
  if (claudeCheck.code !== 0) {
    console.log("Claude Code not detected — skipping MCP/slash-command install. Re-run `openpair setup` after installing Claude Code.");
    return;
  }
  const answer = await prompts({
    type: "confirm",
    name: "integrate",
    message: "Integrate with Claude Code now? (registers `pair_run` MCP tools and installs the /openpair slash command for all sessions)",
    initial: true,
  });
  if (!answer.integrate) {
    console.log("Skipped. Re-run `openpair setup` or use `claude mcp add --scope user openpair -- npx @jverene/openpair mcp` later.");
    return;
  }

  console.log("Registering with Claude Code...");
  const integration = await installClaudeIntegration();
  for (const note of integration.notes) console.log(note);
  if (integration.mcpRegistered && integration.commandInstalled) {
    console.log("Done. Open a NEW Claude Code session and you will have:");
    console.log("  - MCP tools: pair_run, pair_preflight (openpair server)");
    console.log("  - /openpair slash command");
  }
}
