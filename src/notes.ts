/**
 * notes.ts — the .pair/ notes writer and the home of content-hash gating.
 *
 * The notes are the product. The orchestrator owns structure (filenames,
 * ISO timestamps, hashing); agents own the words. Every agent read is
 * recorded as a content hash keyed by (agentName, filePath) so the
 * orchestrator can skip invocations whose inputs have not changed —
 * the token-safety mechanism described in V01PRD.md "Phase 4: Handoff".
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The seven canonical note files, per the PRD. */
export const NOTE_FILES = [
  "intent.md",
  "intentnotes.md",
  "plan.md",
  "plannotes.md",
  "execution.md",
  "qa.md",
  "review.md",
] as const;

export type NoteFile = (typeof NOTE_FILES)[number];

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export class Notes {
  private readonly dir: string;
  /** (agentName, filePath) -> content hash at the agent's last read. */
  private readonly lastReadHashes = new Map<string, string>();

  constructor(cwd: string) {
    this.dir = join(cwd, ".pair");
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private path(name: NoteFile): string {
    return join(this.dir, name);
  }

  /** Create a note file with a header if it does not exist yet. */
  async ensure(name: NoteFile, title: string): Promise<void> {
    try {
      await readFile(this.path(name), "utf8");
    } catch {
      await writeFile(this.path(name), `# ${title}\n`, "utf8");
    }
  }

  /**
   * Append a timestamped entry. This is the only way notes are written,
   * so every entry in every note carries an ISO timestamp by construction.
   * Returns the full file content after the append (used for spin-loop
   * detection and hash gating).
   */
  async append(name: NoteFile, agent: string, title: string, body: string): Promise<string> {
    const entry = `\n## [${new Date().toISOString()}] ${title}\n\n_Agent: ${agent}_\n\n${body.trim()}\n`;
    await appendFile(this.path(name), entry, "utf8");
    return this.read(name);
  }

  /** Raw read; returns "" when the file does not exist. Does not record a hash. */
  async read(name: NoteFile): Promise<string> {
    try {
      return await readFile(this.path(name), "utf8");
    } catch {
      return "";
    }
  }

  /**
   * Read on behalf of an agent and record the content hash under
   * (agentName, filePath). Agents always read through this method.
   */
  async readFor(agent: string, name: NoteFile): Promise<string> {
    const content = await this.read(name);
    this.lastReadHashes.set(`${agent}:${name}`, hashContent(content));
    return content;
  }

  /**
   * Token-safety gate: have any of the given files changed since this
   * agent last read them? Files the agent never read count as changed.
   */
  async inputsChanged(agent: string, names: NoteFile[]): Promise<boolean> {
    for (const name of names) {
      const key = `${agent}:${name}`;
      const current = hashContent(await this.read(name));
      if (this.lastReadHashes.get(key) !== current) return true;
    }
    return false;
  }

  /** Mark files as read without returning content (used right after an agent wrote them). */
  async markRead(agent: string, names: NoteFile[]): Promise<void> {
    for (const name of names) {
      this.lastReadHashes.set(`${agent}:${name}`, hashContent(await this.read(name)));
    }
  }
}
