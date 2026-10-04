/**
 * setup.ts — the ECC-style `npx @jverene/openpair` flow.
 *
 * `openpair setup` (also what a bare npx invocation does) runs the config
 * wizard, then offers to register the MCP server into every coding CLI it
 * detects (Claude Code, Cursor, Codex, Gemini CLI, ZCode), so the next
 * session in any of them has the pair_* tools automatically.
 */
import prompts from "prompts";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { runWizard } from "./wizard.js";
import { loadConfig } from "./config.js";
import {
  CLI_LABELS,
  defaultExec,
  detectClis,
  registerWithCli,
  type CliId,
  type RegistrationDeps,
  type RegistrationOutcome,
} from "./registrations.js";

export interface IntegrationResult {
  claudeDetected: boolean;
  mcpRegistered: boolean;
  commandInstalled: boolean;
  notes: string[];
}

export type { RegistrationDeps, RegistrationOutcome };
export { bundledCommandPath } from "./registrations.js";

/**
 * Backwards-compatible Claude-only registration; the wizard now goes
 * through registerWithCli for every detected CLI.
 */
export async function installClaudeIntegration(deps: RegistrationDeps = {}): Promise<IntegrationResult> {
  const home = deps.home ?? (await import("node:os")).homedir();
  const run = deps.runExec ?? defaultExec;
  const version = await run("claude", ["--version"]);
  if (version.code !== 0) {
    return {
      claudeDetected: false,
      mcpRegistered: false,
      commandInstalled: false,
      notes: ["Claude Code CLI not found — skipped MCP + slash-command install. Install Claude Code and re-run `openpair setup` to enable them."],
    };
  }
  const outcome = await registerWithCli("claude", deps);
  let commandInstalled = false;
  try {
    await stat(join(home, ".claude", "commands", "openpair.md"));
    commandInstalled = true;
  } catch {
    // Copy failed — reflected in outcome.note.
  }
  return {
    claudeDetected: true,
    mcpRegistered: outcome.ok,
    commandInstalled,
    notes: outcome.ok ? [] : [outcome.note],
  };
}

/** Full first-run flow: config wizard, then MCP registration into detected CLIs. */
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

  const detected = [...(await detectClis())].filter(([, present]) => present).map(([id]) => id);
  if (detected.length === 0) {
    console.log("No supported coding CLI detected — nothing to register. Re-run `openpair setup` after installing one.");
    return;
  }

  const answer = await prompts({
    type: "multiselect",
    name: "clis",
    message: "Register the OpenPair MCP server into:",
    choices: detected.map((id) => ({ title: CLI_LABELS[id], value: id, selected: true })),
    hint: "space to toggle, return to confirm",
  });
  const selected = (answer.clis ?? []) as CliId[];
  if (selected.length === 0) {
    console.log("Skipped registration. Re-run `openpair setup` any time.");
    return;
  }

  let anyOk = false;
  for (const id of selected) {
    const outcome = await registerWithCli(id);
    console.log(`${CLI_LABELS[id]}: ${outcome.note}`);
    anyOk ||= outcome.ok;
  }
  if (anyOk) {
    console.log("Done. Open a NEW session in the registered CLI(s) and you will have:");
    console.log("  - MCP tools: pair_review, pair_run, pair_preflight (openpair server)");
    console.log("  - Claude Code also gets the /openpair slash command");
  }
}
