/**
 * toolLoop.test.ts — the shared tool loop: native tool calling round-trip,
 * text-directive fallback (single-line, multiline, fenced, bare-name,
 * malformed), DONE/QUESTION parsing, and the accept-after-nudges behavior.
 */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseActionPayload, parseDirective, runToolLoop } from "../src/agents/toolLoop.js";
import { fileTools } from "../src/tools/files.js";
import type { ChatMessage, ChatProvider, ChatResult } from "../src/providers/types.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "openpair-toolloop-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("parseDirective — ACTION payloads (fallback protocol)", () => {
  it("parses the classic single-line form (regression)", () => {
    const d = parseDirective('ACTION: {"tool": "read_file", "args": {"path": "a.txt"}}');
    expect(d).toEqual({ kind: "action", tool: "read_file", args: { path: "a.txt" } });
  });

  it("parses multiline pretty-printed JSON", () => {
    const reply = 'ACTION: {\n  "tool": "write_file",\n  "args": {\n    "path": "x.md",\n    "content": "hi }\\"there\\""\n  }\n}';
    const d = parseDirective(reply);
    expect(d).toEqual({ kind: "action", tool: "write_file", args: { path: "x.md", content: 'hi }"there"' } });
  });

  it("parses JSON fenced in a code block", () => {
    const reply = 'ACTION: ```json\n{"tool": "run_shell", "args": {"command": "ls"}}\n```';
    const d = parseDirective(reply);
    expect(d).toEqual({ kind: "action", tool: "run_shell", args: { command: "ls" } });
  });

  it("parses bare tool name with JSON args on the next line (the r1 failure mode)", () => {
    const d = parseDirective('ACTION: read_file\n{"path": "report.md"}');
    expect(d).toEqual({ kind: "action", tool: "read_file", args: { path: "report.md" } });
  });

  it("returns unknown for malformed JSON (never fabricates)", () => {
    expect(parseDirective('ACTION: {"tool": "x", ')).toEqual({ kind: "unknown" });
    expect(parseDirective("ACTION: not json at all")).toEqual({ kind: "unknown" });
    expect(parseDirective('ACTION: {"args": {"a": 1}}')).toEqual({ kind: "unknown" }); // no tool name anywhere
  });

  it("still parses QUESTION/DONE/READY on the first line", () => {
    expect(parseDirective("QUESTION: which db?")).toEqual({ kind: "question", text: "which db?" });
    expect(parseDirective("DONE: finished")).toEqual({ kind: "done", text: "finished" });
    expect(parseDirective("READY: briefing")).toEqual({ kind: "ready", text: "briefing" });
  });
});

describe("parseActionPayload (exported helper)", () => {
  it("handles content with braces inside JSON strings", () => {
    const r = parseActionPayload(' {"tool": "write_file", "args": {"content": "if (x) { return; }"}}');
    expect(r).toEqual({ tool: "write_file", args: { content: "if (x) { return; }" } });
  });
});

/** A provider that speaks native tool calling from a scripted queue. */
class NativeProvider implements ChatProvider {
  readonly name = "native-mock";
  constructor(private readonly replies: ChatResult[]) {}
  async chat(): Promise<string> {
    throw new Error("chat() should not be called in native mode");
  }
  async chatStructured(): Promise<ChatResult> {
    return this.replies.shift() ?? { content: "DONE: nothing left" };
  }
}

const writeTool = fileTools.find((t) => t.name === "write_file")!;

describe("runToolLoop — native tool calling round-trip", () => {
  it("executes structured tool calls and feeds results back as tool messages", async () => {
    const provider = new NativeProvider([
      {
        content: null,
        toolCalls: [{ id: "call_1", name: "write_file", args: { path: "hello.txt", content: "hi" } }],
        usage: { promptTokens: 100, completionTokens: 10 },
      },
      { content: "DONE: wrote hello.txt", usage: { promptTokens: 150, completionTokens: 5 } },
    ]);
    const outcome = await runToolLoop({
      provider,
      tools: [writeTool],
      system: "You are the test executor.",
      task: "write the file",
      cwd,
    });
    expect(outcome.status).toBe("done");
    expect(outcome.text).toBe("wrote hello.txt");
    expect(outcome.transcript.length).toBe(1);
    expect(outcome.transcript[0]).toContain("ACTION write_file");
    expect(outcome.usage).toEqual({ promptTokens: 250, completionTokens: 15 });
    // Conversation shape: system, user, assistant(toolCalls), tool, assistant(done)
    const written = await import("node:fs/promises").then((fs) => fs.readFile(join(cwd, "hello.txt"), "utf8"));
    expect(written).toBe("hi");
    const roles = outcome.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "tool", "assistant"]);
    const toolMsg = outcome.messages.find((m) => m.role === "tool") as Extract<ChatMessage, { role: "tool" }>;
    expect(toolMsg.toolCallId).toBe("call_1");
  });

  it("keeps DONE:/QUESTION: text semantics in native mode", async () => {
    const provider = new NativeProvider([{ content: "QUESTION: what format?" }]);
    const outcome = await runToolLoop({
      provider,
      tools: [writeTool],
      system: "s",
      task: "t",
      cwd,
    });
    expect(outcome.status).toBe("question");
    expect(outcome.text).toBe("what format?");
  });
});

describe("runToolLoop — text fallback still works", () => {
  it("executes a single-line ACTION and finishes on DONE", async () => {
    const provider: ChatProvider = {
      name: "text-mock",
      chat: async () => 'ACTION: {"tool": "write_file", "args": {"path": "t.txt", "content": "v1"}}',
    };
    // First call returns the ACTION, then DONE — emulate with a counter.
    let n = 0;
    const scripted: ChatProvider = {
      name: "text-mock",
      chat: async () =>
        n++ === 0
          ? 'ACTION: {"tool": "write_file", "args": {"path": "t.txt", "content": "v1"}}'
          : "DONE: wrote t.txt",
    };
    const outcome = await runToolLoop({
      provider: scripted,
      tools: [writeTool],
      system: "s",
      task: "t",
      cwd,
    });
    expect(outcome.status).toBe("done");
    expect(outcome.text).toBe("wrote t.txt");
    const written = await import("node:fs/promises").then((fs) => fs.readFile(join(cwd, "t.txt"), "utf8"));
    expect(written).toBe("v1");
    expect(provider.name).toBe("text-mock");
  });

  it("executes a multiline ACTION (the failure that broke the benchmark)", async () => {
    let n = 0;
    const scripted: ChatProvider = {
      name: "text-mock",
      chat: async () =>
        n++ === 0
          ? 'ACTION: write_file\n{"path": "m.txt", "content": "multiline ok"}'
          : "DONE: done",
    };
    const outcome = await runToolLoop({ provider: scripted, tools: [writeTool], system: "s", task: "t", cwd });
    expect(outcome.status).toBe("done");
    const written = await import("node:fs/promises").then((fs) => fs.readFile(join(cwd, "m.txt"), "utf8"));
    expect(written).toBe("multiline ok");
  });

  it("halts with protocol_failure after exhausting nudges — never fabricates DONE", async () => {
    let calls = 0;
    const rambler: ChatProvider = {
      name: "text-mock",
      chat: async () => {
        calls++;
        return "The script must have failed. Let me check the error output.";
      },
    };
    const outcome = await runToolLoop({ provider: rambler, tools: [writeTool], system: "s", task: "t", cwd });
    expect(calls).toBe(3); // initial + 2 nudges
    expect(outcome.status).toBe("protocol_failure");
    expect(outcome.text).toContain("Protocol failure");
    expect(outcome.text).toContain("The script must have failed");
  });
});
