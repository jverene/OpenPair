/**
 * orchestrator.ts — the reactive handoff loop.
 *
 * The orchestrator makes every notes write, so after each one it asks
 * "who reads this file next?" and immediately invokes them. No polling,
 * no fs.watch, no timers, no background processes — the documentation
 * itself is the handoff signal (V01PRD.md, "Phase 4: Handoff").
 *
 * Dispatch table:
 *   Vision writes intent.md + intentnotes.md   → Executor plans + executes
 *   Executor writes a question to qa.md        → Vision answers → Executor resumes
 *   Executor writes execution.md               → Vision writes review.md
 *   Vision writes review.md with REVISE        → Executor re-executes
 *   Vision writes review.md with APPROVE       → stop; prompt the human
 *
 * Token safety (all mandatory):
 *   - Content-hash gating (notes.ts): skip an invocation when the agent's
 *     input files haven't changed since their last read.
 *   - Hard cap: 3 review cycles, then stop for human judgment.
 *   - Spin-loop detection: byte-identical agent output twice → halt.
 */
import type { Config } from "./config.js";
import type { ChatProvider } from "./providers/types.js";
import type { Harness } from "./harness/types.js";
import { VisionAgent } from "./agents/vision.js";
import { ExecutorAgent } from "./agents/executor.js";
import { Notes } from "./notes.js";
import { UI } from "./ui.js";

export const MAX_REVIEW_CYCLES = 3;
const MAX_QA_ROUNDS = 5;

export type LoopStatus =
  | "approved" // Vision approved; human is prompted to ship.
  | "needs_human" // review-cycle cap hit; human judgment required.
  | "halted"; // preflight/execution failure or spin-loop; see execution.md.

export interface LoopResult {
  status: LoopStatus;
  reason?: string;
  reviewCycles: number;
}

export interface RunOptions {
  goal: string;
  config: Config;
  provider: ChatProvider;
  cwd: string;
  ui: UI;
  /** Prebuilt harness (software domain). Tests and --mock inject here. */
  harness?: Harness;
  maxReviewCycles?: number;
}

export async function runPairLoop(opts: RunOptions): Promise<LoopResult> {
  const { goal, config, provider, cwd, ui } = opts;
  const maxReviewCycles = opts.maxReviewCycles ?? MAX_REVIEW_CYCLES;

  const notes = new Notes(cwd);
  await notes.init();
  await Promise.all([
    notes.ensure("intent.md", "Intent"),
    notes.ensure("intentnotes.md", "Intent Notes"),
    notes.ensure("plan.md", "Plan"),
    notes.ensure("plannotes.md", "Plan Notes"),
    notes.ensure("execution.md", "Execution Log"),
    notes.ensure("qa.md", "Q&A"),
    notes.ensure("review.md", "Review"),
  ]);

  const vision = new VisionAgent(provider);
  const executor = new ExecutorAgent(provider, config.domain, cwd, opts.harness);

  // Spin-loop detection: last output produced by each agent.
  const lastOutput = new Map<string, string>();
  /** Returns true (and reports) when an agent repeated itself byte-for-byte. */
  const spinDetected = (agent: string, output: string): boolean => {
    const repeated = lastOutput.get(agent) === output;
    lastOutput.set(agent, output);
    return repeated;
  };
  const spinHalt = async (agent: string): Promise<LoopResult> => {
    const reason = `Spin-loop detected: ${agent} produced identical output twice in a row. Halting for human judgment.`;
    await notes.append("execution.md", "Orchestrator", "Halted: spin-loop detected", reason);
    ui.system(reason);
    return { status: "halted", reason, reviewCycles: 0 };
  };

  // ── Phase 1: Intent ─────────────────────────────────────────────────────
  ui.phase("Phase 1: Intent");
  ui.vision(`Writing intent for: ${goal}`);
  const intentDoc = await vision.writeIntent(goal);
  if (spinDetected(vision.name, intentDoc.intent)) return spinHalt(vision.name);
  await notes.append("intent.md", vision.name, "Intent", intentDoc.intent);
  await notes.append("intentnotes.md", vision.name, "Intent notes", intentDoc.intentNotes);
  ui.vision("Done. Wrote intent.md and intentnotes.md.");

  // Handoff: intent files written → the Executor reads them next.
  let reviewFeedback: string | undefined;
  let reviewCycles = 0;

  // ── Phases 2–4: Plan → Execute → Review, with reactive handoffs ─────────
  for (;;) {
    // Token-safety gate: does the Executor actually have new input?
    const executorInputs = reviewFeedback
      ? (["intent.md", "intentnotes.md", "review.md"] as const)
      : (["intent.md", "intentnotes.md"] as const);
    if (!(await notes.inputsChanged(executor.name, [...executorInputs]))) {
      ui.system("Executor inputs unchanged since last read — skipping invocation (no new information).");
      return { status: "needs_human", reason: "Loop stalled: no agent had new input.", reviewCycles };
    }

    // Phase 2a: Plan (cheap, tool-less call — reviewable before tokens burn).
    ui.phase("Phase 2: Plan + Execute");
    ui.executor("Reading intent. Writing plan...");
    const intent = await notes.readFor(executor.name, "intent.md");
    const intentNotes = await notes.readFor(executor.name, "intentnotes.md");
    if (reviewFeedback) await notes.readFor(executor.name, "review.md");
    const planDoc = await executor.writePlan(intent, intentNotes, reviewFeedback);
    if (spinDetected(executor.name, planDoc.plan)) return { ...(await spinHalt(executor.name)), reviewCycles };
    await notes.append("plan.md", executor.name, reviewFeedback ? "Plan (revision)" : "Plan", planDoc.plan);
    await notes.append("plannotes.md", executor.name, "Plan notes", planDoc.planNotes);
    ui.executor("Done. Wrote plan.md and plannotes.md.");

    // Phase 2b: Execute, with Q&A handoffs.
    ui.executor("Executing plan...");
    let outcome = await executor.execute(planDoc.plan, intent);
    let qaRounds = 0;

    while (outcome.status === "question") {
      // Handoff: question written to qa.md → Vision is triggered to answer.
      await notes.append("qa.md", executor.name, "Question", outcome.text);
      ui.executor(`Done. Wrote question to qa.md: ${outcome.text.split("\n")[0]}`);

      if (!(await notes.inputsChanged(vision.name, ["qa.md"]))) {
        ui.system("Vision inputs unchanged — skipping answer invocation.");
        break;
      }
      if (++qaRounds > MAX_QA_ROUNDS) {
        const reason = `Q&A exceeded ${MAX_QA_ROUNDS} rounds; stopping for the human.`;
        await notes.append("execution.md", "Orchestrator", "Halted: Q&A round cap", reason);
        return { status: "halted", reason, reviewCycles };
      }

      ui.vision("Reading qa.md and answering...");
      await notes.readFor(vision.name, "qa.md");
      const answer = await vision.answerQuestion(intent, outcome.text);
      if (spinDetected(vision.name, answer)) return { ...(await spinHalt(vision.name)), reviewCycles };
      // Handoff: answer written → the Executor auto-resumes.
      await notes.append("qa.md", vision.name, "Answer", answer);
      ui.vision("Done. Wrote answer to qa.md.");
      ui.executor("Resuming with the answer...");

      outcome = await executor.resumeWithAnswer(answer);
    }

    if (outcome.status === "halt") {
      // e.g. harness preflight failed — error + troubleshooting go to execution.md.
      await notes.append("execution.md", executor.name, "Execution halted", outcome.text);
      ui.executor("Halted. Wrote the error and troubleshooting to execution.md.");
      return { status: "halted", reason: outcome.text, reviewCycles };
    }

    const executionBody = [
      outcome.status === "max_turns" ? "_(stopped at the turn cap)_\n\n" : "",
      outcome.text,
      outcome.transcript.length > 0
        ? `\n\n### Transcript\n\n${outcome.transcript.map((t) => "```\n" + t.slice(0, 10_000) + "\n```").join("\n\n")}`
        : "",
    ].join("");
    await notes.append("execution.md", executor.name, reviewFeedback ? "Execution (revision)" : "Execution", executionBody);
    ui.executor("Done. Wrote execution.md.");

    // Handoff: execution.md written → Vision is triggered to review.
    if (!(await notes.inputsChanged(vision.name, ["execution.md"]))) {
      ui.system("Vision inputs unchanged since last read — skipping review invocation.");
      return { status: "needs_human", reason: "Loop stalled: no agent had new input.", reviewCycles };
    }

    // Phase 3: Review (intent review, not code review).
    ui.phase("Phase 3: Review");
    ui.vision("Reading execution.md and reviewing...");
    const execution = await notes.readFor(vision.name, "execution.md");
    const plan = await notes.readFor(vision.name, "plan.md");
    const verdict = await vision.review(intent, plan, execution);
    if (spinDetected(vision.name, verdict.body)) return { ...(await spinHalt(vision.name)), reviewCycles };
    await notes.append("review.md", vision.name, `Review: ${verdict.decision}`, verdict.body);
    ui.vision(`Done. Wrote review.md — verdict: ${verdict.decision}.`);

    // Phase 4: Handoff — the review verdict decides who gets the keyboard.
    if (verdict.decision === "APPROVE") {
      ui.phase("Phase 4: Handoff");
      ui.human("The pair has finished. Read .pair/review.md, then approve, request changes, or ask questions. You are the circuit breaker.");
      return { status: "approved", reviewCycles };
    }

    reviewCycles++;
    if (reviewCycles >= maxReviewCycles) {
      const reason = `Review-cycle cap reached (${maxReviewCycles}). Stopping for human judgment; see .pair/review.md.`;
      await notes.append("execution.md", "Orchestrator", "Stopped: review-cycle cap", reason);
      ui.human(reason);
      return { status: "needs_human", reason, reviewCycles };
    }

    // Handoff: REVISE → the Executor is auto-triggered to re-execute.
    reviewFeedback = verdict.body;
    ui.executor("Review found gaps. Revising plan and re-executing...");
  }
}
