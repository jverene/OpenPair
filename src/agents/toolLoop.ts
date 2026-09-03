/**
 * agents/toolLoop.ts — the shared tool-use conversation loop.
 *
 * Two protocols, chosen automatically per provider capability:
 *
 *  1. NATIVE tool calling (preferred): when the provider implements
 *     chatStructured, tool definitions go through the API and tool calls
 *     come back structured — no text parsing for actions at all.
 *     DONE:/QUESTION: remain first-line text directives for termination.
 *
 *  2. TEXT-directive fallback (Ollama and other providers without native
 *     tool calling): the model replies with a directive on the first line —
 *       ACTION: {"tool": "<name>", "args": {...}}   → run the tool, feed back RESULT
 *       QUESTION: <question for the Vision agent>   → pause, hand off via qa.md
 *       DONE: <summary>                             → finish
 *     parseDirective is tolerant of multiline and fenced JSON payloads.
 *
 * Used by the Executor for the research/writing domains and by the fallback
 * harness for the software domain.
 */
import type { ChatMessage, ChatProvider, ChatToolDef } from "../providers/types.js";
import type { Tool } from "../tools/registry.js";

export type ToolLoopStatus = "done" | "question" | "max_turns" | "protocol_failure";

export interface ToolLoopUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ToolLoopOutcome {
  status: ToolLoopStatus;
  /** Summary text (done/max_turns) or the question text (question). */
  text: string;
  /** Append-only log of actions and results for execution.md. */
  transcript: string[];
  /** The full conversation, so the loop can resume after a Q&A answer. */
  messages: ChatMessage[];
  /** Cumulative token usage across this loop's calls, when reported. */
  usage?: ToolLoopUsage;
}

const DEFAULT_MAX_TURNS = 25;
const MAX_NUDGES = 2;

export function renderToolDocs(tools: Tool[]): string {
  return tools
    .map(
      (t) =>
        `- ${t.name}: ${t.description}\n  args JSON schema: ${JSON.stringify(t.parameters)}`,
    )
    .join("\n");
}

function toChatTools(tools: Tool[]): ChatToolDef[] {
  return tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/** Protocol block appended to the caller's system prompt, per mode. */
function nativeProtocolBlock(): string {
  return [
    "You call tools directly: the runtime offers each tool natively; call one per step and you will receive its result.",
    "Reply with exactly one directive on the first line when you are not calling a tool:",
    "  QUESTION: <question for the Vision Holder>   — when the intent is ambiguous; then stop",
    "  DONE: <summary of what was done, findings, blockers>   — when finished",
  ].join("\n");
}

function textProtocolBlock(): string {
  return [
    "Reply with exactly one directive on the first line:",
    '  ACTION: {"tool": "<name>", "args": {...}}   — call a tool; you will receive RESULT: <output>',
    "  QUESTION: <question for the Vision Holder>   — when the intent is ambiguous; then stop",
    "  DONE: <summary of what was done, findings, blockers>   — when finished",
  ].join("\n");
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
  /** Optional sink for transcript events (shared visibility, §2.1). */
  onEvent?: (kind: "tool_call" | "tool_result", text: string) => void;
}): Promise<ToolLoopOutcome> {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  // Native tool calling when the provider supports it AND there are tools.
  const nativeChat =
    opts.tools.length > 0 ? opts.provider.chatStructured?.bind(opts.provider) : undefined;
  const system = [
    opts.system,
    "",
    nativeChat ? nativeProtocolBlock() : textProtocolBlock(),
    "",
    "Available tools:",
    renderToolDocs(opts.tools),
  ].join("\n");

  const messages: ChatMessage[] = opts.messages ?? [
    { role: "system", content: system },
    { role: "user", content: opts.task },
  ];
  const transcript: string[] = [];
  const usage: ToolLoopUsage = { promptTokens: 0, completionTokens: 0 };
  let nudges = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    let reply: string;

    if (nativeChat) {
      const result = await nativeChat(messages, { tools: toChatTools(opts.tools) });
      if (result.usage) {
        usage.promptTokens += result.usage.promptTokens;
        usage.completionTokens += result.usage.completionTokens;
      }
      reply = (result.content ?? "").trim();
      if (result.toolCalls && result.toolCalls.length > 0) {
        messages.push({ role: "assistant", content: result.content ?? "", toolCalls: result.toolCalls });
        for (const call of result.toolCalls) {
          const callText = `${call.name}(${JSON.stringify(call.args)})`;
          opts.onEvent?.("tool_call", callText);
          const result2 = await runTool(call.name, call.args, opts.tools, opts.cwd);
          opts.onEvent?.("tool_result", result2.slice(0, 2_000));
          transcript.push(`ACTION ${call.name}(${JSON.stringify(call.args)})\n${result2}`);
          messages.push({ role: "tool", toolCallId: call.id, content: result2 });
        }
        continue;
      }
      messages.push({ role: "assistant", content: reply });
    } else {
      reply = (await opts.provider.chat(messages)).trim();
      messages.push({ role: "assistant", content: reply });
    }

    const directive = parseDirective(reply);

    if (directive.kind === "action") {
      const callText = `${directive.tool}(${JSON.stringify(directive.args)})`;
      opts.onEvent?.("tool_call", callText);
      const result = await runTool(directive.tool, directive.args, opts.tools, opts.cwd);
      opts.onEvent?.("tool_result", result.slice(0, 2_000));
      transcript.push(`ACTION ${directive.tool}(${JSON.stringify(directive.args)})\n${result}`);
      messages.push({ role: "user", content: `RESULT:\n${result}` });
      continue;
    }

    if (directive.kind === "question") {
      return withUsage({ status: "question", text: directive.text, transcript, messages }, usage);
    }
    if (directive.kind === "done") {
      return withUsage({ status: "done", text: directive.text, transcript, messages }, usage);
    }

    // No recognizable directive: nudge toward the protocol, then accept.
    if (nudges < MAX_NUDGES) {
      nudges++;
      messages.push({
        role: "user",
        content: nativeChat
          ? "Call one of the offered tools to make progress, or reply with exactly one directive on the first line: QUESTION: <question> — or DONE: <summary>."
          : 'Reply with exactly one directive on the first line: ' +
            'ACTION: {"tool": "...", "args": {...}} — or QUESTION: <question> — or DONE: <summary>.',
      });
      continue;
    }
    // NO SILENT ACCEPT: a reply that still carries no usable directive is a
    // protocol failure, not a DONE. Fabricating completion here let whole
    // runs "finish" with zero work in the field. Halt and surface it.
    return withUsage(
      {
        status: "protocol_failure",
        text:
          `Protocol failure: no usable directive after ${nudges} nudges. ` +
          `The run stops rather than fabricating a DONE. Last reply:\n${reply}`,
        transcript,
        messages,
      },
      usage,
    );
  }

  return withUsage(
    {
      status: "max_turns",
      text: `Stopped after ${maxTurns} turns. Last state is in the transcript.`,
      transcript,
      messages,
    },
    usage,
  );
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  tools: Tool[],
  cwd: string,
): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return `ERROR: unknown tool "${name}". Available: ${tools.map((t) => t.name).join(", ")}`;
  }
  try {
    return await tool.execute(args, cwd);
  } catch (err) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function withUsage(
  outcome: Omit<ToolLoopOutcome, "usage">,
  usage: ToolLoopUsage,
): ToolLoopOutcome {
  return usage.promptTokens + usage.completionTokens > 0 ? { ...outcome, usage } : outcome;
}

type Directive =
  | { kind: "action"; tool: string; args: Record<string, unknown> }
  | { kind: "question"; text: string }
  | { kind: "done"; text: string }
  | { kind: "ready"; text: string }
  | { kind: "unknown" };

export function parseDirective(reply: string): Directive {
  const trimmed = reply.trimStart();
  const firstLine = trimmed.split("\n", 1)[0] ?? "";
  if (firstLine.startsWith("ACTION:")) {
    const rest = trimmed.slice(trimmed.indexOf("ACTION:") + "ACTION:".length);
    const action = parseActionPayload(rest);
    if (action) return { kind: "action", tool: action.tool, args: action.args };
    return { kind: "unknown" };
  }
  if (firstLine.startsWith("READY:")) {
    return { kind: "ready", text: trimmed.slice(trimmed.indexOf("READY:") + "READY:".length).trim() };
  }
  if (firstLine.startsWith("QUESTION:")) {
    return { kind: "question", text: trimmed.slice(trimmed.indexOf("QUESTION:") + "QUESTION:".length).trim() };
  }
  if (firstLine.startsWith("DONE:")) {
    return { kind: "done", text: trimmed.slice(trimmed.indexOf("DONE:") + "DONE:".length).trim() };
  }
  return { kind: "unknown" };
}

/**
 * Tolerant ACTION payload parser. Accepts:
 *   ACTION: {"tool": "x", "args": {...}}            — single line (classic)
 *   ACTION: {"tool": "x",                           — multiline pretty-printed JSON
 *            "args": {...}}
 *   ACTION: ```json {…} ```                          — fenced JSON
 *   ACTION: read_file\n{"path": "x"}                 — bare tool name, JSON after
 * Anything unparseable returns null (caller nudges; never fabricates).
 */
export function parseActionPayload(rest: string): { tool: string; args: Record<string, unknown> } | null {
  let s = rest.trim();
  // Strip a code fence around the JSON, if present.
  const fence = s.match(/```[a-z]*\s*([\s\S]*?)\s*```/);
  if (fence && fence[1].trimStart().startsWith("{")) s = fence[1].trim();

  const start = s.indexOf("{");
  if (start === -1) return null;
  const json = balancedJson(s, start);
  if (json === null) return null;

  // A bare tool name between "ACTION:" and the JSON object ("ACTION: read_file\n{…}").
  const prefix = s.slice(0, start).trim().replace(/:$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.tool === "string") {
    return {
      tool: obj.tool,
      args: typeof obj.args === "object" && obj.args !== null ? (obj.args as Record<string, unknown>) : {},
    };
  }
  if (prefix && /^[\w.-]+$/.test(prefix)) {
    // The object itself is the args; the prefix names the tool.
    return { tool: prefix, args: obj };
  }
  return null;
}

/** Scan from the '{' at `start` for a balanced, string-aware JSON object. */
function balancedJson(s: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') inString = !inString;
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
