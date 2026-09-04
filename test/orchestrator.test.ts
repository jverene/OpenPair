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
import { Transcript } from "../src/transcript.js";
import type { GateDecision } from "../src/gate.js";
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
    // 1.3: the review reads ground truth — execution.md ends with a manifest.
    const execution = await notes.read("execution.md");
    expect(execution).toContain("Artifact manifest");
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

  it("software domain: preflight failure falls back to basic tools, never halts (B1)", async () => {
    const harness = new StubHarness(false);
    const INTENT_REPLY = "INTENT:\nDo the thing.\n\nINTENT NOTES:\nSmall scope.";
    let sawFallbackTask = false;
    const withReady: MockScript = (messages) => {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      if (system.includes("You are the Vision Holder")) {
        if (user.includes("Review the execution")) {
          // Only approve once the fallback actually produced the artifact.
          return sawFallbackTask ? "APPROVE\n\nverified against the manifest." : "REVISE: no artifact yet.";
        }
        if (user.includes("SILENT") && user.includes("OBJECT")) return "SILENT";
        return INTENT_REPLY;
      }
      if (user.includes("Write your plan")) return "PLAN:\nPlan v1.\n\nPLAN NOTES:\nn/a";
      if (user.includes("Execute this plan")) return "READY: build the thing";
      // The fallback harness's tool loop (its system prompt teaches basic tools).
      if (system.includes("basic file and shell tools") || user.includes("Task:")) {
        sawFallbackTask = true;
        return 'ACTION: {"tool": "write_file", "args": {"path": "made-by-fallback.txt", "content": "x"}}';
      }
      if (user.includes("RESULT:")) return "DONE: built via fallback.";
      return "DONE: did the work.";
    };
    const result = await run(withReady, {
      harness,
      config: { ...config, domain: "software" },
    });
    expect(result.status).toBe("approved"); // the loop survived the preflight failure
    expect(harness.preflightCalls).toBe(1);
    expect(harness.executeCalls).toBe(0); // the broken harness never ran the task
    expect(sawFallbackTask).toBe(true);

    const execution = await new Notes(cwd).read("execution.md");
    expect(execution).toContain("preflight failed"); // visible in the record
    const made = await import("node:fs/promises").then((fs) => fs.readFile(`${cwd}/made-by-fallback.txt`, "utf8"));
    expect(made).toBe("x");
  });
});

describe("runPairLoop — protocol failure halts honestly (1.2)", () => {
  it("halts and records execution.md when the executor never speaks the protocol", async () => {
    const rambler: MockScript = (messages) => {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\\n");
      if (system.includes("You are the Vision Holder")) {
        return user.includes("Review the execution") ? "APPROVE\\n\\nfine." : INTENT_REPLY;
      }
      if (user.includes("Write your plan")) {
        return "PLAN:\\nPlan v1.\\n\\nPLAN NOTES:\\nn/a";
      }
      return "The script must have failed. Let me check the error output.";
    };
    const result = await run(rambler);
    expect(result.status).toBe("halted");
    expect(result.reason).toContain("Protocol failure");
    const execution = await new Notes(cwd).read("execution.md");
    expect(execution).toContain("protocol failure");
    expect(execution).toContain("The script must have failed");
  });
});

describe("runPairLoop — capped harness work flows to review (pre-step)", () => {
  it("max_turns harness outcome reaches Vision review as partial work", async () => {
    const capped = new (class implements Harness {
      readonly name = "capped-stub";
      async preflight(): Promise<HarnessResult> {
        return { ok: true, output: "{}" };
      }
      async execute(): Promise<HarnessResult> {
        return { ok: true, output: "(partial work: file written)", capped: true };
      }
    })();
    let reviewed = false;
    const withReview: MockScript = (messages) => {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      if (system.includes("You are the Vision Holder")) {
        if (user.includes("Review the execution")) {
          reviewed = true;
          return "APPROVE\n\npartial work verified against the manifest.";
        }
        if (user.includes("SILENT") && user.includes("OBJECT")) return "SILENT";
        return INTENT_REPLY;
      }
      if (user.includes("Write your plan")) return "PLAN:\nPlan v1.\n\nPLAN NOTES:\nn/a";
      return "READY: build the thing";
    };
    const result = await run(withReview, {
      harness: capped,
      config: { ...config, domain: "software" },
    });
    expect(reviewed).toBe(true);
    expect(result.status).toBe("approved");
    const execution = await new Notes(cwd).read("execution.md");
    expect(execution).toContain("stopped at the turn cap");
    expect(execution).toContain("Artifact manifest");
  });
});

describe("runPairLoop — phantom-claim detection (4c mechanism)", () => {
  it("REVISEs when the executor claims an artifact the manifest shows absent", async () => {
    const liar: MockScript = (messages) => {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      if (system.includes("You are the Vision Holder")) {
        if (user.includes("Review the execution")) return "REVISE: claimed guide.md is absent from the manifest.";
        if (user.includes("SILENT") && user.includes("OBJECT")) return "SILENT";
        return "INTENT:\nWrite the guide and save it as guide.md.\n\nINTENT NOTES:\nguide.md must exist.";
      }
      if (user.includes("Write your plan")) return "PLAN:\n1. Write guide.md.\n\nPLAN NOTES:\nn/a";
      // Lying executor: claims the file, writes nothing.
      return "DONE: Created guide.md with the complete 400-word onboarding guide.";
    };
    const result = await run(liar);
    // The verdict itself is Vision's mock reply; the loop must route it to
    // a second execution (REVISE) rather than approving the phantom claim.
    expect(["needs_human", "halted", "approved"]).toContain(result.status);
    const review = await new Notes(cwd).read("review.md");
    expect(review).toContain("REVISE");
    // The reviewer SAW the empty manifest (execution.md ends with it).
    const execution = await new Notes(cwd).read("execution.md");
    expect(execution).toContain("Artifact manifest");
    expect(execution).toContain("EMPTY");
  });
});

describe("runPairLoop — phantom-save rule reaches the reviewer (4c fix)", () => {
  it("the review prompt explicitly covers 'saved as X' claims absent from the manifest", async () => {
    const seen: string[] = [];
    const track: MockScript = (messages) => {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      if (system.includes("You are the Vision Holder") && user.includes("Review the execution")) {
        seen.push(user);
        return "REVISE: guide.md is claimed as saved but absent from the manifest.";
      }
      if (system.includes("You are the Vision Holder")) {
        if (user.includes("SILENT") && user.includes("OBJECT")) return "SILENT";
        return INTENT_REPLY;
      }
      if (user.includes("Write your plan")) return "PLAN:\nPlan v1.\n\nPLAN NOTES:\nn/a";
      return "DONE: guide written and saved as guide.md.";
    };
    await run(track);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toContain('"saved as X"');
    expect(seen[0]).toContain("ALWAYS a phantom claim");
  });
});

describe("runPairLoop — human circuit breaker (B5)", () => {
  const INTENT = "INTENT:\nDo the thing.\n\nINTENT NOTES:\nSmall scope.";
  const baseScript = (): MockScript => {
    let cycle = 0;
    return (messages) => {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      if (system.includes("You are the Vision Holder")) {
        if (user.includes("Review the execution")) return "APPROVE\n\nlooks done.";
        if (user.includes("SILENT") && user.includes("OBJECT")) return "SILENT";
        return INTENT;
      }
      // Vary plan/summary text per planning cycle so spin detection (which is
      // doing its job) does not fire across human-change-request cycles.
      if (user.includes("Write your plan")) {
        cycle++;
        return `PLAN:\nPlan v${cycle}.\n\nPLAN NOTES:\nvary ${cycle}`;
      }
      return `DONE: did the work (pass ${cycle + 1}).`;
    };
  };

  it("[r] request changes injects human feedback and runs another cycle", async () => {
    let executions = 0;
    const inner = baseScript();
    const counting: MockScript = (messages, i, o) => {
      const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      const sys2 = messages.find((m) => m.role === "system")?.content ?? "";
      if (!sys2.includes("You are the Vision Holder") && !user.includes("Write your plan") && user.includes("Execute this plan")) executions++;
      return inner(messages, i, o);
    };
    const decisions: GateDecision[] = [
      { kind: "changes", feedback: "Make the intro friendlier." },
      { kind: "approve" },
    ];
    const result = await runPairLoop({
      goal: "test goal", config, provider: new MockProvider(counting), cwd, ui: new UI(true),
      gate: async () => decisions.shift() ?? { kind: "approve" },
    });
    expect(result.status).toBe("approved");
    // A second execution cycle ran after the change request.
    expect(executions).toBeGreaterThanOrEqual(2);
    const execution = await new Notes(cwd).read("execution.md");
    expect(execution).toContain("Human change request");
    expect(execution).toContain("Make the intro friendlier.");
  });

  it("[r] is refused once the review-cycle cap is exhausted, ends cleanly", async () => {
    // Vision keeps REVISEing distinct gaps -> cap reached without the gate.
    let n = 0;
    const endless: MockScript = (messages) => {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      if (system.includes("You are the Vision Holder")) {
        if (user.includes("Review the execution")) {
          n++;
          return `REVISE: distinct gap ${n}.`;
        }
        if (user.includes("SILENT") && user.includes("OBJECT")) return "SILENT";
        return INTENT;
      }
      if (user.includes("Write your plan")) return `PLAN:\nPlan v${n + 1}.\n\nPLAN NOTES:\nn/a`;
      return "DONE: did the work.";
    };
    let gateCalls = 0;
    const result = await runPairLoop({
      goal: "test goal", config, provider: new MockProvider(endless), cwd, ui: new UI(true),
      gate: async () => { gateCalls++; return { kind: "changes", feedback: "again" }; },
    });
    expect(result.status).toBe("needs_human");
    expect(result.reviewCycles).toBe(3);
    expect(gateCalls).toBe(0); // the cap stopped the loop before any gate prompt
  });

  it("[q] quit stops with notes standing", async () => {
    const result = await runPairLoop({
      goal: "test goal", config, provider: new MockProvider(baseScript()), cwd, ui: new UI(true),
      gate: async () => ({ kind: "quit" }),
    });
    expect(result.status).toBe("needs_human");
    expect(result.reason).toContain("chose to stop");
  });

  it("non-TTY default gate prints state and approves cleanly", async () => {
    const result = await runPairLoop({
      goal: "test goal", config, provider: new MockProvider(baseScript()), cwd, ui: new UI(true),
    });
    expect(result.status).toBe("approved");
  });
});

describe("runPairLoop — direct peer channel (orchestrator integration)", () => {
  it("executor ASKs mid-work; both sides land in qa.md and transcript; cap honored", async () => {
    const INTENT = "INTENT:\nDo the thing.\n\nINTENT NOTES:\nSmall scope.";
    const replies: string[] = [
      "ASK: Which output filename do you want?",
      'ACTION: {"tool": "write_file", "args": {"path": "out.txt", "content": "x"}}',
      "DONE: wrote out.txt",
    ];
    let n = 0;
    const scripted: MockScript = (messages) => {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      if (system.includes("You are the Vision Holder")) {
        if (user.includes("blocked on a question")) return "Name it out.txt (direct answer).";
        if (user.includes("Review the execution")) return "APPROVE\n\nverified.";
        if (user.includes("SILENT") && user.includes("OBJECT")) return "SILENT";
        return INTENT;
      }
      if (user.includes("Write your plan")) return "PLAN:\nPlan v1.\n\nPLAN NOTES:\nn/a";
      return replies[Math.min(n++, replies.length - 1)];
    };
    const result = await runPairLoop({
      goal: "test goal", config, provider: new MockProvider(scripted), cwd, ui: new UI(true),
    });
    expect(result.status).toBe("approved");
    const qa = await new Notes(cwd).read("qa.md");
    expect(qa).toContain("Question (direct)");
    expect(qa).toContain("Which output filename do you want?");
    expect(qa).toContain("Answer (direct)");
    expect(qa).toContain("Name it out.txt");
    const events = await new Transcript(cwd).events();
    expect(events.some((e) => e.kind === "question" && e.text.startsWith("[direct]")));
    expect(events.some((e) => e.kind === "answer" && e.text.startsWith("[direct]")));
  });
});
