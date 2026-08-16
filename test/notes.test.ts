/**
 * notes.test.ts — timestamped writes and the content-hash gating that
 * prevents duplicate agent invocations.
 */
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashContent, Notes } from "../src/notes.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "openpair-notes-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("Notes", () => {
  it("creates .pair and writes files with headers", async () => {
    const notes = new Notes(cwd);
    await notes.init();
    await notes.ensure("intent.md", "Intent");
    const content = await notes.read("intent.md");
    expect(content).toBe("# Intent\n");
  });

  it("appends ISO-timestamped entries with agent bylines", async () => {
    const notes = new Notes(cwd);
    await notes.init();
    await notes.ensure("plan.md", "Plan");
    await notes.append("plan.md", "Executor", "Plan", "Step 1: do the thing.");
    const content = await notes.read("plan.md");
    expect(content).toMatch(/## \[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(content).toContain("_Agent: Executor_");
    expect(content).toContain("Step 1: do the thing.");
  });

  it("returns empty string for missing files", async () => {
    const notes = new Notes(cwd);
    await notes.init();
    expect(await notes.read("review.md")).toBe("");
  });

  it("hashContent is stable and content-sensitive", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
  });

  it("gates on input changes per (agent, file)", async () => {
    const notes = new Notes(cwd);
    await notes.init();
    await notes.ensure("execution.md", "Execution");
    await notes.append("execution.md", "Executor", "Execution", "did work");

    // Never read → counts as changed.
    expect(await notes.inputsChanged("Vision", ["execution.md"])).toBe(true);

    // After reading, unchanged.
    await notes.readFor("Vision", "execution.md");
    expect(await notes.inputsChanged("Vision", ["execution.md"])).toBe(false);

    // A write by anyone flips the gate back.
    await notes.append("execution.md", "Executor", "Execution (revision)", "more work");
    expect(await notes.inputsChanged("Vision", ["execution.md"])).toBe(true);

    // Gating is per-agent: another agent has its own record.
    await notes.readFor("Vision", "execution.md");
    expect(await notes.inputsChanged("Executor", ["execution.md"])).toBe(true);
  });

  it("detects changes made outside the Notes writer", async () => {
    const notes = new Notes(cwd);
    await notes.init();
    await notes.ensure("qa.md", "Q&A");
    await notes.readFor("Vision", "qa.md");
    expect(await notes.inputsChanged("Vision", ["qa.md"])).toBe(false);
    await appendFile(join(cwd, ".pair", "qa.md"), "\nexternal edit\n", "utf8");
    expect(await notes.inputsChanged("Vision", ["qa.md"])).toBe(true);
  });
});
