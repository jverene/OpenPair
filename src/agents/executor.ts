/**
 * agents/executor.ts — Agent B, the Executor.
 * Owns the "how": plans (a cheap, tool-less LLM call), then executes
 * (the expensive call — harness for software, tool loop for research/
 * writing). Never decides what to build; ambiguity becomes a QUESTION.
 *
 * Planning and execution are deliberately separate calls so the Vision
 * agent can review the plan before execution burns tokens.
 */
import type { Domain } from "../config.js";
import type { ChatMessage, ChatProvider } from "../providers/types.js";
import type { Harness } from "../harness/types.js";
import { FallbackHarness } from "../harness/fallback.js";
import { toolsForDomain } from "../tools/registry.js";
import { executorSystem, executePrompt, planPrompt } from "./prompts.js";
import { parseDirective, runToolLoop } from "./toolLoop.js";
import { COMPACTION_PROMPT } from "./prompts.js";
import type { Transcript } from "../transcript.js";

export interface PlanDoc {
  plan: string;
  planNotes: string;
}

export type ExecuteStatus = "done" | "question" | "halt" | "max_turns" | "protocol_failure";

export interface ExecuteOutcome {
  status: ExecuteStatus;
  /** Summary (done), question text (question), or error + troubleshooting (halt). */
  text: string;
  /** Action/result log for execution.md. */
  transcript: string[];
}

export class ExecutorAgent {
  readonly name = "Executor";
  private readonly usesHarness: boolean;
  /** Conversation state for the current execution, kept so a Q&A answer can resume it. */
  private messages: ChatMessage[] | undefined;
  private lastOutcome: ToolLoopMessages | undefined;

  constructor(
    private readonly provider: ChatProvider,
    private readonly domain: Domain,
    private readonly cwd: string,
    harness?: Harness,
    private readonly transcript?: Transcript,
    private readonly onNotice?: (message: string) => void,
    private readonly askPeer?: (question: string) => Promise<string>,
  ) {
    this.harness = harness;
    this.usesHarness = domain === "software" && harness !== undefined;
  }

  private harness?: Harness;
  /** Notice emitted when a failed preflight forced the fallback switch. */
  private fallbackNotice: string | undefined;

  /** Transcript sink for tool events; wired by the orchestrator (§2.1). */
  private onToolEvent = (kind: "tool_call" | "tool_result", text: string): void => {
    // The orchestrator stamps the actor; tool events are always the Executor's.
    void this.transcript?.append("Executor", kind, text);
  };

  async writePlan(intent: string, intentNotes: string, reviewFeedback?: string): Promise<PlanDoc> {
    // A new plan invalidates any in-flight execution conversation.
    this.messages = undefined;
    this.lastOutcome = undefined;

    const reply = await this.provider.chat([
      { role: "system", content: EXECUTOR_SYSTEM_FOR_PLAN },
      { role: "user", content: planPrompt(intent, intentNotes, reviewFeedback) },
    ]);
    return parsePlanReply(reply);
  }

  /** Execute the plan. May return "question" — resume with resumeWithAnswer(). */
  async execute(plan: string, intent: string): Promise<ExecuteOutcome> {
    if (this.usesHarness) return this.executeViaHarness(plan, intent);
    return this.executeViaToolLoop(plan, intent);
  }

  /** Continue execution after the Vision Holder answered a question. */
  async resumeWithAnswer(answer: string): Promise<ExecuteOutcome> {
    if (this.usesHarness) {
      if (!this.messages) {
        return { status: "halt", text: "Cannot resume: no execution conversation in flight.", transcript: [] };
      }
      this.messages.push({ role: "user", content: `The Vision Holder answered: ${answer}` });
      return this.continueHarness();
    }
    if (!this.lastOutcome) {
      return { status: "halt", text: "Cannot resume: no tool loop in flight.", transcript: [] };
    }
    const tools = toolsForDomain(this.domain);
    const outcome = await runToolLoop({
      provider: this.provider,
      tools,
      system: executorSystem(this.domain, false),
      task: "",
      cwd: this.cwd,
      onEvent: this.onToolEvent,
      askPeer: this.askPeer,
      messages: [
        ...this.lastOutcome.messages,
        { role: "user", content: `The Vision Holder answered your question: ${answer}\nContinue.` },
      ],
    });
    this.lastOutcome = outcome;
    return toExecuteOutcome(outcome);
  }

  /**
   * Self-authored compaction at a yield boundary (§2.4). Called by the
   * orchestrator when the executor's live conversation is near the context
   * limit. Replaces older conversation with the agent's own summary and
   * appends the compaction event to the shared transcript so the peer knows
   * memory was lost. Returns the summary, or null when nothing to compact.
   */
  async maybeCompact(lastPromptTokens: number, contextLimit: number): Promise<string | null> {
    if (!this.lastOutcome || this.lastOutcome.messages.length === 0) return null;
    if (lastPromptTokens < contextLimit * 0.75) return null;
    const system = executorSystem(this.domain, this.usesHarness);
    const summary = (
      await this.provider.chat([
        { role: "system", content: system },
        { role: "user", content: COMPACTION_PROMPT },
      ])
    ).trim();
    const compacted = summary.replace(/^COMPACTED:?\s*/m, "").trim() || summary;
    this.lastOutcome = {
      ...this.lastOutcome,
      messages: [
        ...this.lastOutcome.messages.slice(0, 1), // keep the system prompt
        {
          role: "user",
          content:
            `MEMORY COMPACTION occurred. Your prior conversation was replaced by your own summary; ` +
            `the shared transcript records the event. Resume from:\n\n${compacted}`,
        },
      ],
    };
    await this.transcript?.append("Orchestrator", "compaction", `Executor compacted at ~${Math.round((lastPromptTokens / contextLimit) * 100)}% of context. Summary:\n${compacted}`);
    return compacted;
  }

  // ---- software domain: delegate to the harness -------------------------

  private async executeViaHarness(plan: string, intent: string): Promise<ExecuteOutcome> {
    this.messages = [
      { role: "system", content: executorSystem(this.domain, true) },
      { role: "user", content: executePrompt(plan, intent) },
    ];
    return this.continueHarness(plan, intent);
  }

  private async continueHarness(plan = "", intent = ""): Promise<ExecuteOutcome> {
    if (!this.messages || !this.harness) {
      return { status: "halt", text: "No harness configured for the software domain.", transcript: [] };
    }
    const reply = (await this.provider.chat(this.messages)).trim();
    this.messages.push({ role: "assistant", content: reply });
    const directive = parseDirective(reply);

    if (directive.kind === "question") {
      return { status: "question", text: directive.text, transcript: [] };
    }

    const task = directive.kind === "ready" ? directive.text : plan; // READY: briefing, else the plan itself.

    // Mandatory preflight before every real task: a 15-second failure beats
    // a 5-minute mystery. On failure the loop NEVER halts — it falls back
    // to the basic-tools harness with a visible notice (v0.2 first-hour fix).
    const preflight = await this.harness.preflight();
    if (!preflight.ok) {
      const reason = (preflight.error ?? preflight.output ?? "").split("\n")[0];
      this.harness = new FallbackHarness(this.provider, this.cwd, this.transcript);
      this.fallbackNotice = `Harness preflight failed (${reason}) — fell back to basic file/shell tools for this task.`;
      this.onNotice?.(this.fallbackNotice);
      await this.transcript?.append(
        "Orchestrator",
        "system",
        `Harness preflight failed; switched to the fallback harness. ${reason}`,
      );
    }

    const result = await this.harness.execute(task, intent ? `Intent:\n${intent}` : "");
    if (!result.ok) {
      return {
        status: "halt",
        text: `Harness execution failed.\n\n${result.error ?? result.output}`,
        transcript: [result.output],
      };
    }

    // One summarization call turns raw harness output into execution notes.
    const capNote = result.capped ? "The harness stopped at its TURN CAP with partial work. " : "";
    this.messages.push({
      role: "user",
      content: `${capNote}The harness completed. Raw output:\n${result.output.slice(0, 20_000)}\n\nReply with DONE: <what was done, findings, blockers>${result.capped ? ", and what remains unfinished because of the turn cap" : ""}.`,
    });
    const summary = (await this.provider.chat(this.messages)).trim();
    const summaryDirective = parseDirective(summary);
    const summaryText =
      summaryDirective.kind === "done" || summaryDirective.kind === "ready"
        ? summaryDirective.text
        : summary;
    const notice = this.fallbackNotice;
    this.fallbackNotice = undefined;
    return {
      // max_turns flows to review as partial work (execution.md is marked);
      // only protocol_failure and preflight failures halt.
      status: result.capped ? "max_turns" : "done",
      text: notice ? `${notice}\n\n${summaryText}` : summaryText,
      transcript: [result.output],
    };
  }

  // ---- research/writing domains: direct tool loop -----------------------

  private async executeViaToolLoop(plan: string, intent: string): Promise<ExecuteOutcome> {
    const tools = toolsForDomain(this.domain);
    const outcome = await runToolLoop({
      provider: this.provider,
      tools,
      system: executorSystem(this.domain, false),
      task: executePrompt(plan, intent),
      cwd: this.cwd,
      onEvent: this.onToolEvent,
      askPeer: this.askPeer,
      messages: this.lastOutcome?.messages,
    });
    this.lastOutcome = outcome;
    return toExecuteOutcome(outcome);
  }
}

type ToolLoopMessages = Awaited<ReturnType<typeof runToolLoop>>;

function toExecuteOutcome(outcome: ToolLoopMessages): ExecuteOutcome {
  return {
    status: outcome.status,
    text: outcome.text,
    transcript: outcome.transcript,
  };
}

const EXECUTOR_SYSTEM_FOR_PLAN = `You are the Executor in a two-agent pair programming system.
You own the "how". Right now your only job is to plan — do not execute anything.
Document tradeoffs: every rejected alternative gets a tombstone with the reason.`;

/** Split a "PLAN: … PLAN NOTES: …" reply into its two documents. */
export function parsePlanReply(reply: string): PlanDoc {
  const marker = reply.indexOf("PLAN NOTES:");
  if (marker === -1) {
    return { plan: stripLabel(reply, "PLAN:"), planNotes: "(none provided)" };
  }
  return {
    plan: stripLabel(reply.slice(0, marker), "PLAN:"),
    planNotes: reply.slice(marker + "PLAN NOTES:".length).trim(),
  };
}

function stripLabel(text: string, label: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith(label) ? trimmed.slice(label.length).trim() : trimmed;
}
