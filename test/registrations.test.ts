/**
 * registrations.test.ts — the per-CLI MCP registration writers: correct
 * shapes for Cursor/Codex/Gemini/ZCode, idempotency, and the never-clobber
 * guarantee for existing user config.
 */
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectClis, registerWithCli } from "../src/registrations.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "reg-home-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("registerWithCli (config-file CLIs)", () => {
  it("cursor: merges into ~/.cursor/mcp.json without disturbing neighbors", async () => {
    const dir = join(home, ".cursor");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "mcp.json"), JSON.stringify({ mcpServers: { other: { command: "node", args: ["x.js"] } } }), "utf8");

    const r = await registerWithCli("cursor", { home });
    expect(r.ok).toBe(true);
    const cfg = JSON.parse(await readFile(join(dir, "mcp.json"), "utf8"));
    expect(cfg.mcpServers.other).toEqual({ command: "node", args: ["x.js"] });
    expect(cfg.mcpServers.openpair).toEqual({ command: "npx", args: ["@jverene/openpair", "mcp"] });

    const again = await registerWithCli("cursor", { home });
    expect(again.note).toContain("already registered");
    const cfg2 = JSON.parse(await readFile(join(dir, "mcp.json"), "utf8"));
    expect(Object.keys(cfg2.mcpServers)).toEqual(["other", "openpair"]);
  });

  it("gemini: creates ~/.gemini/settings.json when none exists", async () => {
    const r = await registerWithCli("gemini", { home });
    expect(r.ok).toBe(true);
    const cfg = JSON.parse(await readFile(join(home, ".gemini", "settings.json"), "utf8"));
    expect(cfg.mcpServers.openpair.command).toBe("npx");
  });

  it("codex: appends the TOML block, preserves existing config, and is idempotent", async () => {
    const dir = join(home, ".codex");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "config.toml"), 'model = "gpt-5"\n\n[profiles.fast]\nreasoning = "low"\n', "utf8");

    const r = await registerWithCli("codex", { home });
    expect(r.ok).toBe(true);
    const toml = await readFile(join(dir, "config.toml"), "utf8");
    expect(toml).toContain('model = "gpt-5"');
    expect(toml).toContain("[profiles.fast]");
    expect(toml).toContain("[mcp_servers.openpair]");
    expect(toml).toContain('args = ["@jverene/openpair", "mcp"]');
    expect(toml.match(/\[mcp_servers\.openpair\]/g)).toHaveLength(1);

    const again = await registerWithCli("codex", { home });
    expect(again.note).toContain("already registered");
    expect((await readFile(join(dir, "config.toml"), "utf8")).match(/\[mcp_servers\.openpair\]/g)).toHaveLength(1);
  });

  it("zcode: nests under mcp.servers in ~/.zcode/cli/config.json, preserving other keys", async () => {
    const dir = join(home, ".zcode", "cli");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "config.json"), JSON.stringify({ plugins: { "official/foo": { enabled: true } } }), "utf8");

    const r = await registerWithCli("zcode", { home });
    expect(r.ok).toBe(true);
    const cfg = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
    expect(cfg.plugins["official/foo"]).toEqual({ enabled: true });
    expect(cfg.mcp.servers.openpair).toEqual({ command: "npx", args: ["@jverene/openpair", "mcp"] });
  });

  it("never clobbers an existing-but-invalid JSON config", async () => {
    const dir = join(home, ".cursor");
    await mkdir(dir, { recursive: true });
    const garbage = "{not json at all";
    await writeFile(join(dir, "mcp.json"), garbage, "utf8");

    const r = await registerWithCli("cursor", { home });
    expect(r.ok).toBe(false);
    expect(r.note).toContain("not valid JSON");
    expect(r.note).toContain("add manually");
    expect(await readFile(join(dir, "mcp.json"), "utf8")).toBe(garbage);
  });
});

describe("detectClis", () => {
  it("detects the claude binary and config-dir CLIs independently", async () => {
    await mkdir(join(home, ".cursor"), { recursive: true });
    await mkdir(join(home, ".zcode", "cli"), { recursive: true });
    const detected = await detectClis({
      home,
      runExec: async (cmd) => (cmd === "claude" ? { code: 0, stderr: "" } : { code: 127, stderr: "ENOENT" }),
    });
    expect(detected.get("claude")).toBe(true);
    expect(detected.get("cursor")).toBe(true);
    expect(detected.get("zcode")).toBe(true);
    expect(detected.get("codex")).toBe(false);
    expect(detected.get("gemini")).toBe(false);
  });
});
