/**
 * yield.test.ts — v0.2 handoff-model verification:
 *   (a) every turn-end invokes the peer
 *   (b) tool-call sub-steps do not
 *   (c) SILENT returns control to the executor
 *   (d) forced compaction produces a summary + transcript event the peer sees
 *   (e) review cannot occur before execution.md + manifest exist
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { MockProvider, type MockScript } from "../src/providers/mock.js";
import { runPairLoop } from "../src/orchestrator.js";
import { Transcript } from "../src/transcript.js";
import { UI } from "../src/ui.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "openpair-yield-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const config: Config = { provider: "custom", domain: "writing", model: "mock" };

interface Recorded {
  /** vision | executor, derived from the system prompt. */
  who: string;
  user: string;
}

/**
 * Records every LLM call in order and answers from a small state machine:
 * intent → plan → handoff(SILENT) → tool step → tool step → DONE → review.
 */
function recorder(log: Recorded[], behavior: { secondTool?: boolean; question?: boolean; compaction?: boolean }) {
  let toolCalls = 0;
  const script: MockScript = (messages) => {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const who = system.includes("You are the Vision Holder") ? "vision" : "executor";
    log.push({ who, user });

    if (who === "vision") {
      if (user.includes("Review the execution")) return "APPROVE\n\nverified against the manifest.";
      if (user.includes("blocked on a question")) return "Use SQLite.";
      if (user.includes("SILENT") && user.includes("OBJECT")) return "SILENT";
      return "INTENT:\nDo the thing.\n\nINTENT NOTES:\nSmall scope.";
    }
    // executor
    if (user.includes("Write your plan")) {
      return "PLAN:\n1. Write a file. 2. Verify.\n\nPLAN NOTES:\nOnly approach.";
    }
    if (user.includes("Compact your working state")) {
      return behavior.compaction ? "COMPACTED:\n- goal: test\n- decisions: none yet" : "unreachable";
    }
    if (user.includes("Execute this plan")) {
      if (behavior.question && toolCalls === 0) {
        toolCalls++;
        return "QUESTION: which storage?";
      }
      toolCalls++;
      return 'ACTION: {"tool": "write_file", "args": {"path": "out.txt", "content": "v1"}}';
    }
    if (user.includes("RESULT:")) {
      if (behavior.secondTool && toolCalls < 2) {
        toolCalls++;
        return 'ACTION: {"tool": "write_file", "args": {"path": "out2.txt", "content": "v2"}}';
      }
      return "DONE: wrote the files.";
    }
    return "DONE: wrote the files.";
  };
  return script;
}

function signatures(log: Recorded[]): string[] {
  const sig = (r: Recorded): string => {
    if (r.who === "vision") {
      if (r.user.includes("Review the execution")) return "vision:review";
      if (r.user.includes("blocked on a question")) return "vision:answer";
      if (r.user.includes("SILENT") && r.user.includes("OBJECT")) return "vision:handoff";
      return "vision:intent";
    }
    if (r.user.includes("Write your plan")) return "exec:plan";
    if (r.user.includes("Compact your working state")) return "exec:compaction";
    if (r.user.includes("Execute this plan")) return "exec:turn-start";
    if (r.user.includes("RESULT:")) return "exec:tool-step";
    return "exec:other";
  };
  return log.map(sig);
}

async function run(script: MockScript, contextLimit?: number) {
  const transcript = new Transcript(cwd);
  await transcript.init();
  return runPairLoop({
    goal: "test goal",
    config,
    provider: new MockProvider(script),
    cwd,
    ui: new UI(true),
    transcript,
    contextLimit,
  });
}

describe("yield-based handoff (§2.2)", () => {
  it("(a) every turn-end invokes the peer: plan → vision handoff → … → done → vision review", async () => {
    const log: Recorded[] = [];
    const result = await run(recorder(log, { secondTool: true }));
    expect(result.status).toBe("approved");
    const sigs = signatures(log);
    // intent posted → executor invoked
    expect(sigs.indexOf("exec:plan")).toBeGreaterThan(sigs.indexOf("vision:intent"));
    // plan posted → vision invoked (the handoff)
    expect(sigs).toContain("vision:handoff");
    expect(sigs.indexOf("vision:handoff")).toBeGreaterThan(sigs.indexOf("exec:plan"));
    // done declared → vision review
    expect(sigs.indexOf("vision:review")).toBeGreaterThan(sigs.lastIndexOf("exec:tool-step"));
  });

  it("(b) tool-call sub-steps never invoke the peer mid-turn", async () => {
    const log: Recorded[] = [];
    await run(recorder(log, { secondTool: true }));
    const sigs = signatures(log);
    const first = sigs.indexOf("exec:turn-start");
    const last = sigs.lastIndexOf("exec:tool-step");
    // Between the turn start and the final tool step, only executor calls.
    for (let i = first; i <= last; i++) {
      expect(sigs[i].startsWith("exec")).toBe(true);
    }
  });

  it("(c) SILENT returns control to the executor, who proceeds to execution", async () => {
    const log: Recorded[] = [];
    await run(recorder(log, {}));
    const sigs = signatures(log);
    const handoff = sigs.indexOf("vision:handoff");
    expect(sigs[handoff + 1]).toBe("exec:turn-start");
  });

  it("(d) forced compaction: self-authored summary + transcript event the peer can see", async () => {
    const log: Recorded[] = [];
    // Tiny context limit so the executor's question-time context trips 75%.
    const result = await run(recorder(log, { question: true, compaction: true }), 50);
    expect(result.status).toBe("approved");
    const sigs = signatures(log);
    expect(sigs).toContain("exec:compaction");
    // Compaction happens at the yield boundary: after the vision answer,
    // before the executor resumes.
    expect(sigs.indexOf("exec:compaction")).toBeGreaterThan(sigs.indexOf("vision:answer"));
    // The peer sees it: transcript carries the event with the summary.
    const events = await new Transcript(cwd).events();
    const compaction = events.find((e) => e.kind === "compaction");
    expect(compaction).toBeDefined();
    expect(compaction?.actor).toBe("Orchestrator");
    expect(compaction?.text).toContain("goal: test");
    // The executor's post-compaction context contains its own summary.
    const postCompaction = log[sigs.indexOf("exec:compaction") + 1];
    expect(postCompaction.who).toBe("executor");
    expect(log.some((r) => r.user.includes("MEMORY COMPACTION"))).toBe(true);
  });

  it("(e) review cannot occur before execution.md + manifest exist", async () => {
    const log: Recorded[] = [];
    await run(recorder(log, {}));
    // The review prompt must contain the manifest (execution.md ends with it).
    const reviewCall = log[signatures(log).indexOf("vision:review")];
    expect(reviewCall.user).toContain("Artifact manifest");
    // And in the transcript, the manifest event precedes the review event.
    const events = await new Transcript(cwd).events();
    const manifestIdx = events.findIndex((e) => e.kind === "manifest");
    const reviewIdx = events.findIndex((e) => e.kind === "review");
    expect(manifestIdx).toBeGreaterThanOrEqual(0);
    expect(reviewIdx).toBeGreaterThan(manifestIdx);
    // The execution note (deliverable) exists before both.
    const executionIdx = events.findIndex((e) => e.kind === "execution");
    expect(executionIdx).toBeGreaterThanOrEqual(0);
    expect(manifestIdx).toBeGreaterThan(executionIdx);
  });

  it("full transcript is written with every kind of event", async () => {
    const log: Recorded[] = [];
    await run(recorder(log, {}));
    const kinds = (await new Transcript(cwd).events()).map((e) => e.kind);
    for (const expected of ["system", "intent", "plan", "silent", "execution", "manifest", "review"]) {
      expect(kinds).toContain(expected);
    }
  });
});
