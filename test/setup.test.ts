/**
 * setup.test.ts — the ECC-style setup: Claude Code detection, MCP
 * registration command shape, slash-command install, and graceful skip
 * when the claude CLI is absent.
 */
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installClaudeIntegration } from "../src/setup.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "setup-home-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("installClaudeIntegration", () => {
  it("registers MCP at user scope and installs the slash command", async () => {
    const calls: [string, string[]][] = [];
    const r = await installClaudeIntegration({
      home,
      packageRoot: "/Users/hjiang/Developer/OpenPair",
      runExec: async (cmd, args) => {
        calls.push([cmd, args]);
        return { code: 0, stderr: "" };
      },
    });
    expect(r.claudeDetected).toBe(true);
    expect(r.mcpRegistered).toBe(true);
    expect(r.commandInstalled).toBe(true);
    // The exact registration Claude Code understands.
    const mcpCall = calls.find(([, args]) => args[0] === "mcp");
    expect(mcpCall?.[0]).toBe("claude");
    expect(mcpCall?.[1].slice(0, 5)).toEqual(["mcp", "add", "--scope", "user", "openpair"]);
    expect(mcpCall?.[1]).toContain("--");
    expect(mcpCall?.[1].slice(-3)).toEqual(["npx", "@jverene/openpair", "mcp"]);
    // The command file landed where Claude Code looks for user commands.
    const cmd = await readFile(join(home, ".claude", "commands", "openpair.md"), "utf8");
    expect(cmd).toContain("Run OpenPair");
  });

  it("skips cleanly when the claude CLI is absent", async () => {
    const r = await installClaudeIntegration({
      home,
      runExec: async () => ({ code: 127, stderr: "ENOENT" }),
    });
    expect(r.claudeDetected).toBe(false);
    expect(r.mcpRegistered).toBe(false);
    expect(r.notes.join(" ")).toContain("Claude Code CLI not found");
    await expect(stat(join(home, ".claude"))).rejects.toThrow();
  });

  it("reports a manual fallback command when MCP registration fails", async () => {
    const r = await installClaudeIntegration({
      home,
      runExec: async (cmd, args) =>
        args[0] === "mcp" ? { code: 1, stderr: "boom" } : { code: 0, stderr: "" },
    });
    expect(r.mcpRegistered).toBe(false);
    expect(r.commandInstalled).toBe(true); // slash command still installed
    expect(r.notes.join(" ")).toContain("claude mcp add --scope user openpair");
  });
});
