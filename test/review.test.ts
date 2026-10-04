/**
 * review.test.ts — the standalone review engine behind pair_review:
 * verdict parsing against ground truth, git evidence injection, the paper
 * trail in .pair/review.md, and the unconfigured error.
 */
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reviewWork } from "../src/review.js";
import { MockProvider, type MockScript } from "../src/providers/mock.js";
import type { Config } from "../src/config.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "openpair-review-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const mockConfig: Config = { provider: "custom", domain: "writing", model: "mock" };

/** Scripted Vision replies for the standalone review prompt. */
const visionScript = (reply: string): MockScript => (messages) => {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  expect(system).toContain("Vision Holder");
  expect(user).toContain("Review the CURRENT STATE");
  return reply;
};

describe("reviewWork (pair_review engine)", () => {
  it("returns APPROVE and appends the review to .pair/review.md", async () => {
    await writeFile(join(cwd, "report.md"), "# findings\n", "utf8");
    const r = await reviewWork(
      { goal: "produce report.md with findings", cwd },
      { config: mockConfig, provider: new MockProvider(visionScript("APPROVE\n\nreport.md exists and matches the goal.")) },
    );
    expect(r.verdict).toBe("APPROVE");
    expect(r.manifestCount).toBe(1);
    expect(r.gitDetected).toBe(false);
    expect(r.reviewPath).toBe(join(cwd, ".pair", "review.md"));
    const review = await readFile(r.reviewPath, "utf8");
    expect(review).toContain("# Review");
    expect(review).toContain("Standalone review (pair_review)");
    expect(review).toContain("report.md exists and matches the goal.");
  });

  it("treats an unparseable reply as REVISE (conservative, like the loop)", async () => {
    const r = await reviewWork(
      { goal: "g", cwd },
      { config: mockConfig, provider: new MockProvider(visionScript("Hmm, looks okay I guess?")) },
    );
    expect(r.verdict).toBe("REVISE");
  });

  it("feeds git status and diff to the reviewer when inside a work tree", async () => {
    await writeFile(join(cwd, "changed.ts"), "export {};\n", "utf8");
    const calls: string[][] = [];
    const runGit = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "rev-parse") return "true";
      if (args[0] === "status") return " M changed.ts";
      if (args.includes("--stat")) return " changed.ts | 1 +";
      return "+export {};";
    };
    const provider = new MockProvider((messages) => {
      const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      if (user.includes("Review the CURRENT STATE")) {
        expect(user).toContain(" M changed.ts");
        expect(user).toContain("+export {};");
        return "APPROVE\n\ndiff matches the goal.";
      }
      return "APPROVE";
    });
    const r = await reviewWork({ goal: "g", cwd }, { config: mockConfig, provider, runGit });
    expect(r.gitDetected).toBe(true);
    expect(calls[0]).toEqual(["rev-parse", "--is-inside-work-tree"]);
  });

  it("merges an existing .pair/intent.md into the review context", async () => {
    await mkdir(join(cwd, ".pair"), { recursive: true });
    await writeFile(join(cwd, ".pair", "intent.md"), "# Intent\n\nShip the checkout flow only.", "utf8");
    const provider = new MockProvider((messages) => {
      const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      if (user.includes("Review the CURRENT STATE")) {
        expect(user).toContain("Ship the checkout flow only.");
        return "APPROVE";
      }
      return "APPROVE";
    });
    const r = await reviewWork({ goal: "g", cwd }, { config: mockConfig, provider });
    expect(r.verdict).toBe("APPROVE");
  });

  it("rejects a blank goal up front", async () => {
    await expect(
      reviewWork({ goal: "   ", cwd }, { config: mockConfig, provider: new MockProvider(visionScript("APPROVE")) }),
    ).rejects.toThrow(/goal is required/);
  });

  it("throws an actionable error when unconfigured", async () => {
    const realHome = process.env.HOME;
    const fakeHome = await mkdtemp(join(tmpdir(), "empty-home-"));
    process.env.HOME = fakeHome;
    try {
      await expect(reviewWork({ goal: "g", cwd })).rejects.toThrow(/not configured/i);
    } finally {
      process.env.HOME = realHome;
      await rm(fakeHome, { recursive: true, force: true });
    }
  });
});
