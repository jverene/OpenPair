/**
 * mcp.test.ts — the pairRun tool handler: happy path against a scripted
 * provider, artifact reporting, and the unconfigured-config error.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pairRun } from "../src/mcp.js";
import { MockProvider, type MockScript } from "../src/providers/mock.js";
import type { Config } from "../src/config.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "openpair-mcp-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const INTENT = "INTENT:\nDo the thing.\n\nINTENT NOTES:\nSmall scope.";
const scripted = (): MockScript => (messages) => {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  if (system.includes("You are the Vision Holder")) {
    if (user.includes("Review the execution")) return "APPROVE\n\nverified against the manifest.";
    if (user.includes("SILENT") && user.includes("OBJECT")) return "SILENT";
    return INTENT;
  }
  if (user.includes("Write your plan")) return "PLAN:\nPlan v1.\n\nPLAN NOTES:\nn/a";
  if (user.includes("Execute this plan") || user.includes("RESULT:")) {
    return 'ACTION: {"tool": "write_file", "args": {"path": "deliverable.md", "content": "hello"}}';
  }
  return "DONE: wrote deliverable.md";
};

const mockConfig: Config = { provider: "custom", domain: "writing", model: "mock" };

describe("pairRun (MCP tool handler)", () => {
  it("runs the loop headlessly and reports status, verdict, and artifacts", async () => {
    const r = await pairRun(
      { goal: "write a hello deliverable", cwd },
      { config: mockConfig, provider: new MockProvider(scripted()) },
    );
    expect(r.status).toBe("approved");
    expect(r.reviewCycles).toBe(0);
    expect(r.notesDir).toBe(join(cwd, ".pair"));
    expect(r.reviewTail).toContain("verified against the manifest");
    expect(r.artifacts).toContain("deliverable.md");
  });

  it("survives a domain override", async () => {
    const r = await pairRun(
      { goal: "g", domain: "research", cwd },
      { config: mockConfig, provider: new MockProvider(scripted()) },
    );
    expect(r.config.domain).toBe("research");
  });

  it("throws an actionable error when unconfigured", async () => {
    const realHome = process.env.HOME;
    const fakeHome = await mkdtemp(join(tmpdir(), "empty-home-"));
    process.env.HOME = fakeHome;
    try {
      await expect(pairRun({ goal: "g", cwd })).rejects.toThrow(/not configured/i);
    } finally {
      process.env.HOME = realHome;
      await rm(fakeHome, { recursive: true, force: true });
    }
  });
});
