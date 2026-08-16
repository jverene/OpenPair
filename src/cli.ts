#!/usr/bin/env node
/**
 * cli.ts — `openpair "<goal>"`
 *
 * One command: wizard on first run, then the pair loop with live,
 * color-coded progress. `--mock` runs the whole loop against a scripted
 * provider and a no-op harness so the UX is verifiable without API keys.
 */
import { Command } from "commander";
import { loadConfig, type Config } from "./config.js";
import { createProvider } from "./providers/index.js";
import { MockProvider, defaultMockScript } from "./providers/mock.js";
import { createHarness } from "./harness/index.js";
import type { Harness, HarnessResult } from "./harness/types.js";
import { runPairLoop } from "./orchestrator.js";
import { UI } from "./ui.js";
import { runWizard } from "./wizard.js";

/** No-op harness for --mock mode: exercises the harness path without OpenCode. */
class MockHarness implements Harness {
  readonly name = "mock";
  async preflight(): Promise<HarnessResult> {
    return { ok: true, output: "mock preflight ok" };
  }
  async execute(task: string): Promise<HarnessResult> {
    return { ok: true, output: `(mock harness) would run: ${task.slice(0, 200)}` };
  }
}

const program = new Command();

program
  .name("openpair")
  .description("Two agents. One vision. One executor. Every decision documented.")
  .argument("[goal]", "what the pair should build, research, or write")
  .option("--mock", "run the full loop against a mock provider (no API keys needed)")
  .option("--reconfigure", "re-run the setup wizard")
  .action(async (goal: string | undefined, opts: { mock?: boolean; reconfigure?: boolean }) => {
    const ui = new UI();
    const cwd = process.cwd();

    if (!goal) {
      program.help();
      return;
    }

    let config: Config | null;
    let provider;
    let harness: Harness | undefined;

    if (opts.mock) {
      config = { provider: "custom", domain: "software", model: "mock" };
      provider = new MockProvider(defaultMockScript());
      harness = new MockHarness();
      ui.system("Mock mode: scripted provider, no-op harness, no API keys.");
    } else {
      config = opts.reconfigure ? null : await loadConfig();
      if (!config) {
        ui.system("First run — setup wizard.");
        config = await runWizard();
        if (!config) {
          ui.system("Setup cancelled.");
          return;
        }
      }
      provider = createProvider(config);

      if (config.domain === "software") {
        const selected = await createHarness({ config, provider, cwd });
        harness = selected.harness;
        if (selected.notice) ui.system(selected.notice);
      }
    }

    ui.system(`Provider: ${provider.name} · Model: ${config.model} · Domain: ${config.domain}`);
    const result = await runPairLoop({ goal, config, provider, cwd, ui, harness });

    if (result.status === "approved") {
      process.exitCode = 0;
    } else {
      // needs_human / halted are not crashes; they are the loop working as designed.
      ui.system(`Loop ended: ${result.status}${result.reason ? ` — ${result.reason.split("\n")[0]}` : ""}`);
    }
  });

program.parse();
