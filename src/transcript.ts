/**
 * transcript.ts — the shared, append-only .pair/transcript.jsonl.
 *
 * v0.2 principle: RESTRICT AUTHORITY, NOT OBSERVATION. Both agents see
 * every event — every agent output, question, answer, tool call, tool
 * result, verdict, manifest, and compaction — while the orchestrator
 * enforces what each agent may DO. The distilled .pair/*.md notes remain
 * the human-facing deliverables, produced at handoffs; this transcript is
 * the machine-facing medium the agents actually read.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type TranscriptActor = "Vision" | "Executor" | "Orchestrator";

export type TranscriptKind =
  | "system" // loop start/stop, harness notice
  | "intent" // Vision posted the intent
  | "plan" // Executor posted a plan
  | "silent" // invoked peer raised no objection
  | "object" // invoked peer objected (plan corrections)
  | "question" // Executor asked; turn yielded
  | "answer" // Vision answered; Executor resumes
  | "tool_call" // one tool invocation (inside a turn — no yield)
  | "tool_result" // its result
  | "execution" // Executor declared DONE with a summary
  | "manifest" // orchestrator's artifact manifest before review
  | "review" // Vision verdict (APPROVE/REVISE)
  | "compaction" // an agent's memory was compacted (summary attached)
  | "halt"; // loop halted; reason attached

export interface TranscriptEvent {
  ts: string;
  actor: TranscriptActor;
  kind: TranscriptKind;
  text: string;
}

export class Transcript {
  private readonly file: string;

  constructor(cwd: string) {
    this.file = join(cwd, ".pair", "transcript.jsonl");
  }

  async init(): Promise<void> {
    await mkdir(join(this.file, ".."), { recursive: true });
  }

  async append(actor: TranscriptActor, kind: TranscriptKind, text: string): Promise<void> {
    const event: TranscriptEvent = { ts: new Date().toISOString(), actor, kind, text };
    await appendFile(this.file, JSON.stringify(event) + "\n", "utf8");
  }

  /** All events so far (empty array before the first write). */
  async events(): Promise<TranscriptEvent[]> {
    try {
      const raw = await readFile(this.file, "utf8");
      return raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as TranscriptEvent);
    } catch {
      return [];
    }
  }

  /** Events after the given index (exclusive) — the tail an agent reads. */
  async since(index: number): Promise<TranscriptEvent[]> {
    return (await this.events()).slice(index + 1);
  }

  /**
   * Events after `index` rendered as markdown for prompts. The newest events
   * win: the render is capped at `charLimit` characters (measured from the
   * end) so a long session can never push the review call past the model's
   * context window.
   */
  async renderSince(index: number, charLimit = 50_000): Promise<string> {
    const tail = await this.since(index);
    if (tail.length === 0) return "(no events yet)";
    const lines = tail.map((e) => `- [${e.ts}] ${e.actor}/${e.kind}: ${e.text}`);
    let total = 0;
    let first = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      total += lines[i].length + 1;
      if (total > charLimit) {
        first = i + 1;
        break;
      }
      first = i;
    }
    const kept = lines.slice(first);
    const marker = first > 0 ? `(… ${first} earlier event(s) omitted — transcript tail only)\n` : "";
    return marker + kept.join("\n");
  }
}
