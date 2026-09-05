/**
 * claude.test.ts — Claude Code harness: output parsing (JSON doc, JSONL
 * stream, plain text), preflight pass/fail, execute, and auto selection.
 */
import { describe, expect, it } from "vitest";
import { ClaudeCodeHarness, parseClaudeOutput, type ClaudeRunner } from "../src/harness/claude.js";
import { createHarness, FALLBACK_NOTICE } from "../src/harness/index.js";
import { FallbackHarness } from "../src/harness/fallback.js";
import { MockProvider } from "../src/providers/mock.js";

const config = { provider: "openai", domain: "software", model: "gpt-4o", apiKey: "sk-test" } as const;

const runnerWith = (behavior: (args: string[]) => { code: number; stdout: string; stderr: string }): ClaudeRunner =>
  async (args) => behavior(args);

describe("parseClaudeOutput", () => {
  it("parses the single JSON result document", () => {
    const r = parseClaudeOutput(JSON.stringify({ type: "result", result: "built the thing", total_cost_usd: 0.12 }));
    expect(r.ok).toBe(true);
    expect(r.text).toBe("built the thing");
    expect(r.costUsd).toBe(0.12);
  });

  it("parses a JSONL event stream, keeping result text", () => {
    const stream = [
      JSON.stringify({ type: "assistant", delta: { text: "working..." } }),
      JSON.stringify({ type: "result", result: "final output" }),
      JSON.stringify({ type: "result", total_cost_usd: 0.5 }),
    ].join("\n");
    const r = parseClaudeOutput(stream);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("final output");
  });

  it("falls back to plain text", () => {
    const r = parseClaudeOutput("just did it, no json here");
    expect(r.ok).toBe(true);
    expect(r.text).toContain("no json here");
  });

  it("fails cleanly on empty output", () => {
    expect(parseClaudeOutput("").ok).toBe(false);
  });
});

describe("ClaudeCodeHarness", () => {
  it("preflight passes on a parseable OK", async () => {
    const run = runnerWith(() => ({ code: 0, stdout: JSON.stringify({ result: "OK" }), stderr: "" }));
    const h = new ClaudeCodeHarness("/tmp", run);
    expect((await h.preflight()).ok).toBe(true);
  });

  it("preflight fails with actionable guidance on non-zero exit", async () => {
    const run = runnerWith(() => ({ code: 1, stdout: "", stderr: "not logged in" }));
    const h = new ClaudeCodeHarness("/tmp", run);
    const p = await h.preflight();
    expect(p.ok).toBe(false);
    expect(p.error).toContain("logged in");
    expect(p.error).toContain("fall back");
  });

  it("isInstalled is a cheap version check", async () => {
    const run = runnerWith((args) =>
      args[0] === "--version" ? { code: 0, stdout: "2.1.116", stderr: "" } : { code: 1, stdout: "", stderr: "x" });
    const h = new ClaudeCodeHarness("/tmp", run);
    expect(await h.isInstalled()).toBe(true);
  });

  it("execute passes task+context and parses the result", async () => {
    let seen: string[] = [];
    const run: ClaudeRunner = async (args) => {
      seen = args;
      return { code: 0, stdout: JSON.stringify({ result: "wrote app.py", total_cost_usd: 0.03 }), stderr: "" };
    };
    const h = new ClaudeCodeHarness("/work", run);
    const r = await h.execute("build the app", "Intent:\ndo it well");
    expect(r.ok).toBe(true);
    expect(r.output).toContain("wrote app.py");
    expect(seen).toContain("--permission-mode");
    expect(seen).toContain("acceptEdits");
    expect(seen[seen.indexOf("--allowed-tools") + 1]).toContain("Bash");
    const prompt = seen[1];
    expect(prompt).toContain("build the app");
    expect(prompt).toContain("do it well");
  });
});

describe("createHarness selection with claude present", () => {
  const provider = new MockProvider(() => "DONE: ok");

  it("explicit harness=claude selects the Claude Code harness", async () => {
    const { ClaudeCodeHarness } = await import("../src/harness/claude.js");
    const picked = await createHarness({
      config: { ...config, harness: "claude" },
      provider,
      cwd: "/tmp",
    });
    expect(picked.harness).toBeInstanceOf(ClaudeCodeHarness);
    expect(picked.notice).toBeUndefined();
  });

  it("auto falls back when claude and opencode binaries are both absent", async () => {
    const absent = async () => ({ code: 127, stdout: "", stderr: "ENOENT" });
    const picked = await createHarness({
      config,
      provider,
      cwd: "/tmp",
      runner: absent as Parameters<typeof createHarness>[0]["runner"],
      claudeRunner: absent as Parameters<typeof createHarness>[0]["claudeRunner"],
    });
    expect(picked.harness).toBeInstanceOf(FallbackHarness);
    expect(picked.notice).toBe(FALLBACK_NOTICE);
  });

  it("explicit harness=fallback forces the basic tools", async () => {
    const picked = await createHarness({
      config: { ...config, harness: "fallback" },
      provider,
      cwd: "/tmp",
    });
    expect(picked.harness).toBeInstanceOf(FallbackHarness);
    expect(picked.notice).toBe(FALLBACK_NOTICE);
  });
});
