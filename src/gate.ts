/**
 * gate.ts — the human circuit breaker (v0.2 first-hour fix, B5).
 *
 * The old final gate TOLD the human to approve/request changes/ask questions
 * but offered no mechanism. This gate implements one:
 *   [a] approve — ship, exit clean
 *   [r] request changes — feedback typed here is injected into the loop and
 *       counts against the review-cycle cap
 *   [q] quit — stop; the .pair notes stand
 * Non-TTY (piped, CI): the gate state is printed and the run ends cleanly
 * without blocking on input that will never come.
 */
import { createInterface } from "node:readline";
import picocolors from "picocolors";
import type { GateState } from "./orchestrator.js";

export interface GateDecision {
  kind: "approve" | "changes" | "quit";
  /** The human's change request (kind === "changes"). */
  feedback?: string;
}

function isTTY(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Ask one question, TTY-aware. Resolves null for EOF/non-TTY. */
function ask(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!isTTY()) {
      resolve(null);
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function humanGate(state: GateState): Promise<GateDecision> {
  console.log(
    picocolors.yellow(
      `\nThe pair has finished. Read .pair/review.md — you are the circuit breaker.` +
        ` (review cycles used: ${state.reviewCycles}/${state.cap})`,
    ),
  );

  if (!isTTY()) {
    // Non-TTY: print the gate state and end cleanly — never block.
    console.log(
      picocolors.yellow(
        "Non-interactive session: the gate cannot ask for input. " +
          "Notes stand in .pair/. Re-run with a follow-up goal to continue.",
      ),
    );
    return { kind: "approve" };
  }

  for (;;) {
    const choice = await ask(picocolors.yellow("[a] approve  [r] request changes  [q] quit  > "));
    const c = (choice ?? "q").trim().toLowerCase();
    if (c === "a" || c === "approve") return { kind: "approve" };
    if (c === "q" || c === "quit") return { kind: "quit" };
    if (c === "r" || c === "changes" || c === "request") {
      const feedback = await ask("What should change? > ");
      return { kind: "changes", feedback: (feedback ?? "").trim() || undefined };
    }
    console.log("Choose [a] approve, [r] request changes, or [q] quit.");
  }
}
