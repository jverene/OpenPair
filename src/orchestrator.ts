/**
 * orchestrator.ts — the yield-based pair loop (v0.2).
 *
 * DESIGN (v0.2): RESTRICT AUTHORITY, NOT OBSERVATION.
 *   - A shared append-only transcript (.pair/transcript.jsonl, §2.1) records
 *     every agent output, question, answer, tool call, and result. Both
 *     agents see all of it; the orchestrator enforces what each may DO.
 *   - Handoffs are YIELD-BASED (§2.2): the peer agent is invoked at every
 *     genuine turn-end — intent posted, plan posted (SILENT or OBJECT),
 *     question asked (answer), DONE declared (review). Tool-call sub-steps
 *     within a turn never yield the keyboard.
 *   - Notes are distilled deliverables produced at handoffs (§2.3); the
 *     review verifies them against the artifact manifest (§1.3).
 *   - Compaction is orchestrator-triggered, self-authored, peer-notified,
 *     and only at yield boundaries (§2.4).
 *
 * The orchestrator retains: role-authority enforcement, spin detection,
 * the review-cycle cap (3), the Q&A cap (5), and the human gate.
 */
import type { Config } from "./config.js";
import type { ChatProvider } from "./providers/types.js";
import type { Harness } from "./harness/types.js";
import { VisionAgent } from "./agents/vision.js";
import { ExecutorAgent } from "./agents/executor.js";
import { Notes } from "./notes.js";
import { UI } from "./ui.js";
import { Transcript } from "./transcript.js";
import { TrackingProvider, UsageTracker } from "./usage.js";
import { renderManifest } from "./artifacts.js";
import { humanGate, type GateDecision } from "./gate.js";

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
  /** Shared transcript (§2.1); created when omitted. */
  transcript?: Transcript;
  /** Context limit for compaction; defaults to OPENPAIR_CONTEXT_LIMIT or 128k. */
  contextLimit?: number;
  /** Circuit-breaker gate (B5). Defaults to the interactive terminal gate;
   *  tests and non-TTY runs inject alternatives. */
  gate?: (state: GateState) => Promise<GateDecision>;
}

export interface GateState {
  /** How many review cycles the loop already spent (revisions so far). */
  reviewCycles: number;
  /** Remaining revisions before the loop stops for the human. */
  remaining: number;
  /** Absolute cap. */
  cap: number;
}

export async function runPairLoop(opts: RunOptions): Promise<LoopResult> {
  const { goal, config, provider, cwd, ui } = opts;
  const maxReviewCycles = opts.maxReviewCycles ?? MAX_REVIEW_CYCLES;
  const contextLimit = opts.contextLimit ?? Number(process.env.OPENPAIR_CONTEXT_LIMIT ?? 128_000);

  const notes = new Notes(cwd);
  await notes.init();
  const transcript = opts.transcript ?? new Transcript(cwd);
  await transcript.init();
  await transcript.append("Orchestrator", "system", `Loop started. Goal: ${goal}`);

  // Per-agent usage tracking (§2.4) — the raw provider is wrapped per role.
  const tracker = new UsageTracker();
  const visionProvider = new TrackingProvider(provider, tracker, "Vision");
  const executorProvider = new TrackingProvider(provider, tracker, "Executor");

  await Promise.all([
    notes.ensure("intent.md", "Intent"),
    notes.ensure("intentnotes.md", "Intent Notes"),
    notes.ensure("plan.md", "Plan"),
    notes.ensure("plannotes.md", "Plan Notes"),
    notes.ensure("execution.md", "Execution Log"),
    notes.ensure("qa.md", "Q&A"),
    notes.ensure("review.md", "Review"),
  ]);

  const vision = new VisionAgent(visionProvider);
  const executor = new ExecutorAgent(executorProvider, config.domain, cwd, opts.harness, transcript, (message) => {
    ui.system(message);
  });
  // Software fallback: route its tool loop through the tracked provider too.
  opts.harness?.setProvider?.(executorProvider);

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
    await transcript.append("Orchestrator", "halt", reason);
    ui.system(reason);
    return { status: "halted", reason, reviewCycles: 0 };
  };

  // ── Turn: Vision posts the intent ─────────────────────────────────────
  ui.phase("Phase 1: Intent");
  ui.vision(`Writing intent for: ${goal}`);
  const intentDoc = await vision.writeIntent(goal);
  if (spinDetected(vision.name, intentDoc.intent)) return spinHalt(vision.name);
  await notes.append("intent.md", vision.name, "Intent", intentDoc.intent);
  await notes.append("intentnotes.md", vision.name, "Intent notes", intentDoc.intentNotes);
  await transcript.append("Vision", "intent", intentDoc.intent);
  ui.vision("Done. Wrote intent.md and intentnotes.md.");

  // Turn-end: intent posted → the Executor is invoked.
  let reviewFeedback: string | undefined;
  let reviewCycles = 0;

  // ── Turns: plan → (SILENT/OBJECT) → execute → review, yielding at each ──
  for (;;) {
    // Token-safety gate: does the Executor actually have new input?
    const executorInputs = reviewFeedback
      ? (["intent.md", "intentnotes.md", "review.md"] as const)
      : (["intent.md", "intentnotes.md"] as const);
    if (!(await notes.inputsChanged(executor.name, [...executorInputs]))) {
      ui.system("Executor inputs unchanged since last read — skipping invocation (no new information).");
      return { status: "needs_human", reason: "Loop stalled: no agent had new input.", reviewCycles };
    }

    // Turn: Executor posts a plan.
    ui.phase("Phase 2: Plan + Execute");
    ui.executor("Reading intent. Writing plan...");
    const intent = await notes.readFor(executor.name, "intent.md");
    const intentNotes = await notes.readFor(executor.name, "intentnotes.md");
    if (reviewFeedback) await notes.readFor(executor.name, "review.md");
    let planDoc = await executor.writePlan(intent, intentNotes, reviewFeedback);
    if (spinDetected(executor.name, planDoc.plan)) return { ...(await spinHalt(executor.name)), reviewCycles };
    await notes.append("plan.md", executor.name, reviewFeedback ? "Plan (revision)" : "Plan", planDoc.plan);
    await notes.append("plannotes.md", executor.name, "Plan notes", planDoc.planNotes);
    await transcript.append("Executor", "plan", planDoc.plan);
    ui.executor("Done. Wrote plan.md and plannotes.md.");

    // Turn-end: plan posted → Vision is invoked (SILENT or OBJECT). Exactly
    // one objection round per planning pass; later corrections ride the
    // review loop, which owns them.
    if (!reviewFeedback) {
      ui.vision("Invoked at the plan handoff (SILENT or OBJECT)...");
      const response = await vision.respondToPlan(intent, planDoc.plan, planDoc.planNotes);
      if (response === "SILENT") {
        await transcript.append("Vision", "silent", "No objection to the plan; proceeding.");
        ui.vision("SILENT — no objection. Executor proceeds.");
      } else {
        await transcript.append("Vision", "object", response);
        await notes.append("plannotes.md", vision.name, "Plan objection (one replan allowed)", response);
        ui.vision(`OBJECT — replanning once. ${response.split("\n")[0]}`);
        planDoc = await executor.writePlan(intent, intentNotes, `Plan objection from the Vision Holder:\n${response}`);
        if (spinDetected(executor.name, planDoc.plan)) return { ...(await spinHalt(executor.name)), reviewCycles };
        await notes.append("plan.md", executor.name, "Plan (after objection)", planDoc.plan);
        await notes.append("plannotes.md", executor.name, "Plan notes (after objection)", planDoc.planNotes);
        await transcript.append("Executor", "plan", `${planDoc.plan}\n(replanned after Vision objection)`);
        await notes.markRead(executor.name, ["intent.md", "intentnotes.md"]);
      }
    }

    // Turn: Executor executes (tool sub-steps never yield the keyboard).
    ui.executor("Executing plan...");
    let outcome = await executor.execute(planDoc.plan, intent);
    let qaRounds = 0;

    while (outcome.status === "question") {
      // Turn-end: question asked → Vision answers via qa.md.
      await notes.append("qa.md", executor.name, "Question", outcome.text);
      await transcript.append("Executor", "question", outcome.text);
      ui.executor(`Done. Wrote question to qa.md: ${outcome.text.split("\n")[0]}`);

      if (!(await notes.inputsChanged(vision.name, ["qa.md"]))) {
        ui.system("Vision inputs unchanged — skipping answer invocation.");
        break;
      }
      if (++qaRounds > MAX_QA_ROUNDS) {
        const reason = `Q&A exceeded ${MAX_QA_ROUNDS} rounds; stopping for the human.`;
        await notes.append("execution.md", "Orchestrator", "Halted: Q&A round cap", reason);
        await transcript.append("Orchestrator", "halt", reason);
        return { status: "halted", reason, reviewCycles };
      }

      ui.vision("Reading qa.md and answering...");
      await notes.readFor(vision.name, "qa.md");
      const answer = await vision.answerQuestion(intent, outcome.text);
      if (spinDetected(vision.name, answer)) return { ...(await spinHalt(vision.name)), reviewCycles };
      await notes.append("qa.md", vision.name, "Answer", answer);
      await transcript.append("Vision", "answer", answer);
      ui.vision("Done. Wrote answer to qa.md.");
      ui.executor("Resuming with the answer...");

      // Yield boundary: self-authored compaction when context is ~75% full.
      await executor.maybeCompact(tracker.get("Executor").lastPromptTokens, contextLimit);

      outcome = await executor.resumeWithAnswer(answer);
    }

    if (outcome.status === "protocol_failure") {
      // The executor could not speak the tool protocol; halting beats a fabricated DONE.
      await notes.append("execution.md", executor.name, "Execution halted: protocol failure", outcome.text);
      await transcript.append("Orchestrator", "halt", outcome.text);
      ui.executor("Halted: protocol failure. Wrote the last reply and diagnosis to execution.md.");
      return { status: "halted", reason: outcome.text, reviewCycles };
    }

    if (outcome.status === "halt") {
      // e.g. harness preflight failed — error + troubleshooting go to execution.md.
      await notes.append("execution.md", executor.name, "Execution halted", outcome.text);
      await transcript.append("Orchestrator", "halt", outcome.text);
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
    await transcript.append("Executor", "execution", outcome.text);
    ui.executor("Done. Wrote execution.md.");

    // Turn-end: DONE declared → Vision reviews. Ground truth first: what
    // actually exists in the working directory (benchmark finding 4c).
    if (!(await notes.inputsChanged(vision.name, ["execution.md"]))) {
      ui.system("Vision inputs unchanged — skipping review invocation.");
      return { status: "needs_human", reason: "Loop stalled: no agent had new input.", reviewCycles };
    }
    const manifest = await renderManifest(cwd);
    await notes.append("execution.md", "Orchestrator", "Artifact manifest", manifest);
    await transcript.append("Orchestrator", "manifest", manifest);
    await notes.markRead(vision.name, ["execution.md"]);

    // Turn: Vision reviews (a review must precede APPROVE).
    ui.phase("Phase 3: Review");
    ui.vision("Reading execution.md, the artifact manifest, and the shared transcript...");
    const execution = await notes.readFor(vision.name, "execution.md");
    const plan = await notes.readFor(vision.name, "plan.md");
    const transcriptTail = await transcript.renderSince(-1);
    const verdict = await vision.review(intent, plan, execution, transcriptTail);
    // Spin detection guards revision loops; an APPROVE verdict ends the
    // loop (or hands to the human gate), so repeating it is legitimate —
    // the human re-triggered the cycle, not a stuck agent.
    if (verdict.decision !== "APPROVE" && spinDetected(vision.name, verdict.body)) {
      return { ...(await spinHalt(vision.name)), reviewCycles };
    }
    await notes.append("review.md", vision.name, `Review: ${verdict.decision}`, verdict.body);
    await transcript.append("Vision", "review", `${verdict.decision}: ${verdict.body}`);
    ui.vision(`Done. Wrote review.md — verdict: ${verdict.decision}.`);

    if (verdict.decision === "APPROVE") {
      // Phase 4: Handoff — the human circuit breaker (B5). [a] approve,
      // [r] request changes (counts against the review cap), [q] quit.
      ui.phase("Phase 4: Handoff");
      for (;;) {
        const decision = await (opts.gate ?? humanGate)({
          reviewCycles,
          remaining: maxReviewCycles - reviewCycles,
          cap: maxReviewCycles,
        });
        await transcript.append(
          "Orchestrator",
          "system",
          `Human gate: ${decision.kind}${decision.feedback ? ` — ${decision.feedback.slice(0, 200)}` : ""}`,
        );

        if (decision.kind === "approve") {
          await transcript.append("Orchestrator", "system", "Loop ended: approved by the human.");
          return { status: "approved", reviewCycles };
        }
        if (decision.kind === "quit") {
          const reason = "Human chose to stop. All notes stand in .pair/.";
          await notes.append("execution.md", "Orchestrator", "Stopped by human", reason);
          await transcript.append("Orchestrator", "halt", reason);
          return { status: "needs_human", reason, reviewCycles };
        }

        // Request changes: refused once the review-cycle cap is exhausted.
        if (reviewCycles >= maxReviewCycles) {
          const reason = `Review-cycle cap (${maxReviewCycles}) exhausted; cannot take more change requests. Notes stand in .pair/.`;
          await transcript.append("Orchestrator", "halt", reason);
          ui.human(reason);
          return { status: "needs_human", reason, reviewCycles };
        }
        reviewCycles++;
        reviewFeedback = decision.feedback?.trim()
          ? `The human requested changes:\n${decision.feedback.trim()}`
          : "The human requested changes (no specifics given): address any gaps in the current execution.";
        await notes.append("execution.md", "Orchestrator", "Human change request", reviewFeedback);
        await transcript.append("Orchestrator", "system", "Loop continues with the human's change request.");
        ui.executor("Human feedback received. Revising plan and re-executing...");
        break; // back to the plan/execute/review cycle
      }
      continue;
    }

    // Vision REVISE: auto-route back to the Executor (unchanged design).
    reviewCycles++;
    if (reviewCycles >= maxReviewCycles) {
      const reason = `Review-cycle cap reached (${maxReviewCycles}). Stopping for human judgment; see .pair/review.md.`;
      await notes.append("execution.md", "Orchestrator", "Stopped: review-cycle cap", reason);
      await transcript.append("Orchestrator", "halt", reason);
      ui.human(reason);
      return { status: "needs_human", reason, reviewCycles };
    }
    reviewFeedback = verdict.body;
    ui.executor("Review found gaps. Revising plan and re-executing...");  }
}
