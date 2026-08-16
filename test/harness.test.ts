/**
 * harness.test.ts — OpenCode harness preflight/execute against a mocked
 * process runner, plus fallback selection and env credential pass-through.
 */
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { createHarness, FALLBACK_NOTICE } from "../src/harness/index.js";
import { harnessEnv, OpenCodeHarness, type Runner } from "../src/harness/opencode.js";
import { FallbackHarness } from "../src/harness/fallback.js";
import { MockProvider } from "../src/providers/mock.js";

const config: Config = { provider: "openai", domain: "software", model: "gpt-4o", apiKey: "sk-test" };

const runnerWith = (behavior: (args: string[]) => { code: number; stdout: string; stderr: string }): Runner =>
  async (_cmd, args) => behavior(args);

describe("OpenCodeHarness", () => {
  it("preflight passes on exit 0 with parseable JSON", async () => {
    const run = runnerWith(() => ({ code: 0, stdout: '{"ok":true}', stderr: "" }));
    const harness = new OpenCodeHarness("/tmp", {}, run);
    const result = await harness.preflight();
    expect(result.ok).toBe(true);
  });

  it("preflight fails on non-zero exit with actionable troubleshooting", async () => {
    const run = runnerWith(() => ({ code: 1, stdout: "", stderr: "401 unauthorized: bad api_key" }));
    const harness = new OpenCodeHarness("/tmp", {}, run);
    const result = await harness.preflight();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("API key");
  });

  it("preflight fails on unparseable output", async () => {
    const run = runnerWith(() => ({ code: 0, stdout: "not json at all", stderr: "" }));
    const harness = new OpenCodeHarness("/tmp", {}, run);
    const result = await harness.preflight();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("unparseable");
  });

  it("isInstalled is false when the binary is missing (exit 127)", async () => {
    const run = runnerWith(() => ({ code: 127, stdout: "", stderr: "ENOENT" }));
    const harness = new OpenCodeHarness("/tmp", {}, run);
    expect(await harness.isInstalled()).toBe(false);
  });

  it("execute passes task, context, and --dir to opencode run", async () => {
    let seenArgs: string[] = [];
    const run: Runner = async (_cmd, args) => {
      seenArgs = args;
      return { code: 0, stdout: '{"done":true}', stderr: "" };
    };
    const harness = new OpenCodeHarness("/work", {}, run);
    const result = await harness.execute("build the thing", "Intent context");
    expect(result.ok).toBe(true);
    expect(seenArgs.slice(0, 4)).toEqual(["run", "--auto", "--format", "json"]);
    expect(seenArgs).toContain("--dir");
    expect(seenArgs).toContain("/work");
    const prompt = seenArgs[seenArgs.length - 1];
    expect(prompt).toContain("Intent context");
    expect(prompt).toContain("build the thing");
  });

  it("harnessEnv passes credentials through env only", () => {
    const env = harnessEnv(config);
    expect(env.OPENAI_API_KEY).toBe("sk-test");
    expect(env.OPENCODE_MODEL).toBe("gpt-4o");
    const anthropicEnv = harnessEnv({ ...config, provider: "anthropic" });
    expect(anthropicEnv.ANTHROPIC_API_KEY).toBe("sk-test");
  });
});

describe("createHarness", () => {
  const provider = new MockProvider(() => "DONE: ok");

  it("falls back with a notice when opencode is not installed", async () => {
    const run = runnerWith(() => ({ code: 127, stdout: "", stderr: "ENOENT" }));
    const { harness, notice } = await createHarness({ config, provider, cwd: "/tmp", runner: run });
    expect(harness).toBeInstanceOf(FallbackHarness);
    expect(notice).toBe(FALLBACK_NOTICE);
  });

  it("uses OpenCode when the binary is present", async () => {
    const run = runnerWith(() => ({ code: 0, stdout: "1.0.0", stderr: "" }));
    const { harness, notice } = await createHarness({ config, provider, cwd: "/tmp", runner: run });
    expect(harness).toBeInstanceOf(OpenCodeHarness);
    expect(notice).toBeUndefined();
  });

  it("both harnesses share the execute interface", async () => {
    const fallback = new FallbackHarness(provider, "/tmp");
    expect(typeof fallback.execute).toBe("function");
    expect(typeof fallback.preflight).toBe("function");
    const pre = await fallback.preflight();
    expect(pre.ok).toBe(true);
  });
});
