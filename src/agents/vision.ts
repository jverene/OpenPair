/**
 * agents/vision.ts — Agent A, the Vision Holder.
 * Owns the "why": writes intent, answers Executor questions, reviews
 * execution against intent. Never writes code, never touches tools.
 */
import type { ChatProvider } from "../providers/types.js";
import {
  VISION_SYSTEM,
  answerPrompt,
  intentPrompt,
  planHandoffPrompt,
  reviewPrompt,
} from "./prompts.js";

export interface IntentDoc {
  intent: string;
  intentNotes: string;
}

export interface Verdict {
  decision: "APPROVE" | "REVISE";
  body: string;
}

export class VisionAgent {
  readonly name = "Vision";

  constructor(private readonly provider: ChatProvider) {}

  async writeIntent(goal: string): Promise<IntentDoc> {
    const reply = await this.provider.chat([
      { role: "system", content: VISION_SYSTEM },
      { role: "user", content: intentPrompt(goal) },
    ]);
    return parseIntentReply(reply);
  }

  async answerQuestion(intent: string, question: string): Promise<string> {
    return (
      await this.provider.chat([
        { role: "system", content: VISION_SYSTEM },
        { role: "user", content: answerPrompt(intent, question) },
      ])
    ).trim();
  }

  /**
   * Yield boundary after the Executor posts a plan: SILENT (proceed) or
   * OBJECT with concrete corrections. Anything not starting with OBJECT is
   * treated as SILENT — the default at a handoff is "no objection".
   */
  async respondToPlan(intent: string, plan: string, planNotes: string): Promise<string> {
    const reply = (
      await this.provider.chat([
        { role: "system", content: VISION_SYSTEM },
        { role: "user", content: planHandoffPrompt(intent, plan, planNotes) },
      ])
    ).trim();
    if (reply.toUpperCase().startsWith("OBJECT")) {
      return reply.slice("OBJECT:".length).trim() || reply;
    }
    return "SILENT";
  }

  async review(intent: string, plan: string, execution: string, transcriptTail?: string): Promise<Verdict> {
    const reply = (
      await this.provider.chat([
        { role: "system", content: VISION_SYSTEM },
        { role: "user", content: reviewPrompt(intent, plan, execution, transcriptTail) },
      ])
    ).trim();

    const firstLine = (reply.split("\n", 1)[0] ?? "").trim().toUpperCase();
    if (firstLine.startsWith("APPROVE")) return { decision: "APPROVE", body: reply };
    // Unparseable verdicts are treated as REVISE (conservative; see plannotes.md).
    return { decision: "REVISE", body: reply };
  }
}

/** Split a "INTENT: … INTENT NOTES: …" reply into its two documents. */
export function parseIntentReply(reply: string): IntentDoc {
  const marker = reply.indexOf("INTENT NOTES:");
  if (marker === -1) {
    return { intent: stripLabel(reply, "INTENT:"), intentNotes: "(none provided)" };
  }
  return {
    intent: stripLabel(reply.slice(0, marker), "INTENT:"),
    intentNotes: reply.slice(marker + "INTENT NOTES:".length).trim(),
  };
}

function stripLabel(text: string, label: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith(label) ? trimmed.slice(label.length).trim() : trimmed;
}
