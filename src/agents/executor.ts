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
import { toolsForDomain } from "../tools/registry.js";
import { executorSystem, executePrompt, planPrompt } from "./prompts.js";
import { parseDirective, runToolLoop } from "./toolLoop.js";

export interface PlanDoc {
  plan: string;
  planNotes: string;
}

export type ExecuteStatus = "done" | "question" | "halt" | "max_turns";

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
    private readonly harness?: Harness,
  ) {
    this.usesHarness = domain === "software" && harness !== undefined;
  }

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
      system: executorSystem(this.domain, tools, false),
      task: "",
      cwd: this.cwd,
      messages: [
        ...this.lastOutcome.messages,
        { role: "user", content: `The Vision Holder answered your question: ${answer}\nContinue.` },
      ],
    });
    this.lastOutcome = outcome;
    return toExecuteOutcome(outcome);
  }

  // ---- software domain: delegate to the harness -------------------------

  private async executeViaHarness(plan: string, intent: string): Promise<ExecuteOutcome> {
    this.messages = [
      { role: "system", content: executorSystem(this.domain, [], true) },
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
    // a 5-minute mystery. On failure: halt, do not proceed to the real task.
    const preflight = await this.harness.preflight();
    if (!preflight.ok) {
      return {
        status: "halt",
        text: `Harness preflight failed — real task NOT attempted.\n\n${preflight.error ?? preflight.output}`,
        transcript: [],
      };
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
    this.messages.push({
      role: "user",
      content: `The harness completed. Raw output:\n${result.output.slice(0, 20_000)}\n\nReply with DONE: <what was done, findings, blockers>.`,
    });
    const summary = (await this.provider.chat(this.messages)).trim();
    const summaryDirective = parseDirective(summary);
    return {
      status: "done",
      text:
        summaryDirective.kind === "done" || summaryDirective.kind === "ready"
          ? summaryDirective.text
          : summary,
      transcript: [result.output],
    };
  }

  // ---- research/writing domains: direct tool loop -----------------------

  private async executeViaToolLoop(plan: string, intent: string): Promise<ExecuteOutcome> {
    const tools = toolsForDomain(this.domain);
    const outcome = await runToolLoop({
      provider: this.provider,
      tools,
      system: executorSystem(this.domain, tools, false),
      task: executePrompt(plan, intent),
      cwd: this.cwd,
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
