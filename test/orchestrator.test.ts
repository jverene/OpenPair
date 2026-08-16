/**
 * orchestrator.test.ts — the reactive handoff loop, end to end against a
 * scripted MockProvider: happy path, Q&A round-trip, REVISE→re-execute→
 * APPROVE, spin-loop halt, review-cycle cap, and preflight halt.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { MockProvider, type MockScript } from "../src/providers/mock.js";
import type { Harness, HarnessResult } from "../src/harness/types.js";
import { runPairLoop } from "../src/orchestrator.js";
import { Notes } from "../src/notes.js";
import { UI } from "../src/ui.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "openpair-loop-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const config: Config = { provider: "custom", domain: "writing", model: "mock" };

class StubHarness implements Harness {
  readonly name = "stub";
  preflightCalls = 0;
  executeCalls = 0;
  constructor(private readonly preflightOk = true) {}
  async preflight(): Promise<HarnessResult> {
    this.preflightCalls++;
    return this.preflightOk
      ? { ok: true, output: "{}" }
      : { ok: false, output: "", error: "Likely cause: missing or invalid API key. Fix: set the env var." };
  }
  async execute(): Promise<HarnessResult> {
    this.executeCalls++;
    return { ok: true, output: "(stub harness output)" };
  }
}

const INTENT_REPLY = "INTENT:\nDo the thing.\n\nINTENT NOTES:\nSmall scope.";

/**
 * Script builder: vision replies are fixed apart from the review verdicts,
 * which come from `reviews` in order. Executor plan replies cycle with a
 * counter so spin-loop detection doesn't false-positive across revisions.
 */
function script(opts: {
  reviews: string[];
  executeReplies?: string[];
  planPrefix?: string;
}): MockScript {
  let reviewCall = 0;
  let planCall = 0;
  let executeCall = 0;
  return (messages) => {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const user = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");

    if (system.includes("You are the Vision Holder")) {
      if (user.includes("Review the execution")) {
        return opts.reviews[Math.min(reviewCall++, opts.reviews.length - 1)];
      }
      if (user.includes("blocked on a question")) return "Use the simple approach.";
      return INTENT_REPLY;
    }
    if (user.includes("Write your plan")) {
      planCall++;
      return `PLAN:\n${opts.planPrefix ?? "Plan"} v${planCall}.\n\nPLAN NOTES:\nOnly approach considered.`;
    }
    const execReplies = opts.executeReplies ?? ["DONE: did the work."];
    return execReplies[Math.min(executeCall++, execReplies.length - 1)];
  };
}

function run(scriptFn: MockScript, overrides: { harness?: Harness; config?: Config } = {}) {
  return runPairLoop({
    goal: "test goal",
    config: overrides.config ?? config,
    provider: new MockProvider(scriptFn),
    cwd,
    ui: new UI(true),
    harness: overrides.harness,
  });
}

describe("runPairLoop", () => {
  it("happy path: intent → plan → execute → APPROVE, all notes written", async () => {
    const result = await run(script({ reviews: ["APPROVE\n\nLooks right."] }));
    expect(result.status).toBe("approved");
    expect(result.reviewCycles).toBe(0);

    const notes = new Notes(cwd);
    for (const file of ["intent.md", "intentnotes.md", "plan.md", "plannotes.md", "execution.md", "review.md"] as const) {
      const content = await notes.read(file);
      expect(content.length).toBeGreaterThan(0);
      expect(content).toMatch(/## \[\d{4}-\d{2}-\d{2}T/);
    }
    expect(await notes.read("review.md")).toContain("APPROVE");
  });

  it("Q&A round-trip: question → Vision answers → Executor resumes", async () => {
    const result = await run(
      script({
        reviews: ["APPROVE\n\nGood."],
        executeReplies: ["QUESTION: Which approach?", "DONE: used the simple approach."],
      }),
    );
    expect(result.status).toBe("approved");

    const qa = await new Notes(cwd).read("qa.md");
    expect(qa).toContain("Question");
    expect(qa).toContain("Which approach?");
    expect(qa).toContain("Answer");
    expect(qa).toContain("Use the simple approach.");
  });

  it("REVISE triggers automatic re-execution, then APPROVE ships", async () => {
    const executorPlans: string[] = [];
    const inner = script({ reviews: ["REVISE: gap one.", "APPROVE\n\nFixed."] });
    const track: MockScript = (messages, i, o) => {
      const reply = inner(messages, i, o);
      const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      if (user.includes("Write your plan")) executorPlans.push(reply as string);
      return reply;
    };
    const result = await run(track);
    expect(result.status).toBe("approved");
    expect(result.reviewCycles).toBe(1);
    // Executor planned twice: once initially, once after REVISE.
    expect(executorPlans.length).toBe(2);

    const review = await new Notes(cwd).read("review.md");
    expect(review).toContain("REVISE");
    expect(review).toContain("APPROVE");
  });

  it("halts for the human after 3 review cycles", async () => {
    let n = 0;
    const inner = script({ reviews: ["x", "x", "x"], planPrefix: "Plan" });
    const endless: MockScript = (messages, i, o) => inner(messages, i, o);
    // Distinct REVISE bodies (else spin-loop fires first — correctly).
    const scripted: MockScript = (messages, i, o) => {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      if (system.includes("You are the Vision Holder") && user.includes("Review the execution")) {
        n++;
        return `REVISE: gap number ${n}.`;
      }
      return endless(messages, i, o);
    };
    const result = await run(scripted);
    expect(result.status).toBe("needs_human");
    expect(result.reviewCycles).toBe(3);
  });

  it("spin-loop detection halts on byte-identical agent output", async () => {
    const result = await run(script({ reviews: ["APPROVE\n\nSame every time."], executeReplies: ["DONE: same.", "DONE: same."] }));
    // Executor revises with an identical plan AND identical execution → spin halt.
    // (First review REVISEs so a second execution happens.)
    const spin: MockScript = (messages, i, o) => {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      if (system.includes("You are the Vision Holder") && user.includes("Review the execution")) {
        return "REVISE: try again.";
      }
      if (user.includes("Write your plan")) {
        return "PLAN:\nIdentical plan.\n\nPLAN NOTES:\nSame.";
      }
      return script({ reviews: [] })(messages, i, o);
    };
    const spinResult = await run(spin);
    expect(spinResult.status).toBe("halted");
    expect(spinResult.reason).toContain("Spin-loop");
    expect(result.status).toBe("approved"); // sanity: distinct replies don't trip it
  });

  it("software domain: preflight failure halts before the real task", async () => {
    const harness = new StubHarness(false);
    const ready = script({ reviews: ["APPROVE"] });
    const withReady: MockScript = (messages, i, o) => {
      const reply = ready(messages, i, o) as string;
      const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      if (user.includes("Execute this plan")) return "READY: build the thing";
      return reply;
    };
    const result = await run(withReady, {
      harness,
      config: { ...config, domain: "software" },
    });
    expect(result.status).toBe("halted");
    expect(harness.preflightCalls).toBe(1);
    expect(harness.executeCalls).toBe(0); // real task never attempted

    const execution = await new Notes(cwd).read("execution.md");
    expect(execution).toContain("preflight failed");
    expect(execution).toContain("API key"); // actionable troubleshooting
  });
});
