/**
 * agents/toolLoop.ts — the shared tool-use conversation loop.
 *
 * Tool calling is a prompt-level JSON protocol (one code path across all
 * providers): the model replies with a directive on the first line —
 *
 *   ACTION: {"tool": "<name>", "args": {...}}   → run the tool, feed back RESULT
 *   QUESTION: <question for the Vision agent>   → pause, hand off via qa.md
 *   DONE: <summary>                             → finish
 *
 * Used by the Executor for the research/writing domains and by the
 * fallback harness for the software domain.
 */
import type { ChatMessage, ChatProvider } from "../providers/types.js";
import type { Tool } from "../tools/registry.js";

export type ToolLoopStatus = "done" | "question" | "max_turns";

export interface ToolLoopOutcome {
  status: ToolLoopStatus;
  /** Summary text (done/max_turns) or the question text (question). */
  text: string;
  /** Append-only log of actions and results for execution.md. */
  transcript: string[];
  /** The full conversation, so the loop can resume after a Q&A answer. */
  messages: ChatMessage[];
}

const DEFAULT_MAX_TURNS = 15;
const MAX_NUDGES = 2;

export function renderToolDocs(tools: Tool[]): string {
  return tools
    .map(
      (t) =>
        `- ${t.name}: ${t.description}\n  args JSON schema: ${JSON.stringify(t.parameters)}`,
    )
    .join("\n");
}

export async function runToolLoop(opts: {
  provider: ChatProvider;
  tools: Tool[];
  system: string;
  task: string;
  cwd: string;
  maxTurns?: number;
  /** Prior conversation when resuming after a Q&A answer. */
  messages?: ChatMessage[];
}): Promise<ToolLoopOutcome> {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const messages: ChatMessage[] = opts.messages ?? [
    { role: "system", content: opts.system },
    { role: "user", content: opts.task },
  ];
  const transcript: string[] = [];
  let nudges = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    const reply = (await opts.provider.chat(messages)).trim();
    messages.push({ role: "assistant", content: reply });
    const directive = parseDirective(reply);

    if (directive.kind === "action") {
      const tool = opts.tools.find((t) => t.name === directive.tool);
      let result: string;
      if (!tool) {
        result = `ERROR: unknown tool "${directive.tool}". Available: ${opts.tools.map((t) => t.name).join(", ")}`;
      } else {
        try {
          result = await tool.execute(directive.args, opts.cwd);
        } catch (err) {
          result = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      transcript.push(`ACTION ${directive.tool}(${JSON.stringify(directive.args)})\n${result}`);
      messages.push({ role: "user", content: `RESULT:\n${result}` });
      continue;
    }

    if (directive.kind === "question") {
      return { status: "question", text: directive.text, transcript, messages };
    }
    if (directive.kind === "done") {
      return { status: "done", text: directive.text, transcript, messages };
    }

    // No recognizable directive: nudge toward the protocol, then accept.
    if (nudges < MAX_NUDGES) {
      nudges++;
      messages.push({
        role: "user",
        content:
          "Reply with exactly one directive on the first line: " +
          'ACTION: {"tool": "...", "args": {...}} — or QUESTION: <question> — or DONE: <summary>.',
      });
      continue;
    }
    return { status: "done", text: reply, transcript, messages };
  }

  return {
    status: "max_turns",
    text: `Stopped after ${maxTurns} turns. Last state is in the transcript.`,
    transcript,
    messages,
  };
}

type Directive =
  | { kind: "action"; tool: string; args: Record<string, unknown> }
  | { kind: "question"; text: string }
  | { kind: "done"; text: string }
  | { kind: "ready"; text: string }
  | { kind: "unknown" };

export function parseDirective(reply: string): Directive {
  const firstLine = reply.trimStart().split("\n", 1)[0] ?? "";
  if (firstLine.startsWith("ACTION:")) {
    const json = firstLine.slice("ACTION:".length).trim();
    try {
      const parsed = JSON.parse(json) as { tool?: unknown; args?: unknown };
      if (typeof parsed.tool === "string") {
        return {
          kind: "action",
          tool: parsed.tool,
          args:
            typeof parsed.args === "object" && parsed.args !== null
              ? (parsed.args as Record<string, unknown>)
              : {},
        };
      }
    } catch {
      // fall through to unknown
    }
    return { kind: "unknown" };
  }
  if (firstLine.startsWith("READY:")) {
    const rest = reply.trimStart();
    return { kind: "ready", text: rest.slice(rest.indexOf("READY:") + "READY:".length).trim() };
  }
  if (firstLine.startsWith("QUESTION:")) {
    const rest = reply.trimStart();
    return { kind: "question", text: rest.slice(rest.indexOf("QUESTION:") + "QUESTION:".length).trim() };
  }
  if (firstLine.startsWith("DONE:")) {
    const rest = reply.trimStart();
    return { kind: "done", text: rest.slice(rest.indexOf("DONE:") + "DONE:".length).trim() };
  }
  return { kind: "unknown" };
}
