/**
 * review.ts — standalone artifact-grounded review, the engine behind the
 * MCP `pair_review` tool: the Vision agent passes a verdict on work it did
 * NOT supervise (usually the caller's own coding agent), with the artifact
 * manifest and git state as ground truth instead of an execution record.
 *
 * The verdict is the product — APPROVE or REVISE with concrete findings —
 * and it lands in .pair/review.md like every loop review, so the paper
 * trail stays the source of truth. No transcript is written: this is not a
 * loop turn, and .pair/review.md already records the exchange.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { loadConfig, resolveApiKey, type Config } from "./config.js";
import { createProvider } from "./providers/index.js";
import type { ChatProvider } from "./providers/types.js";
import { buildManifest, renderEntries } from "./artifacts.js";
import { Notes } from "./notes.js";
import { parseVerdict } from "./agents/vision.js";
import { VISION_SYSTEM, standaloneReviewPrompt } from "./agents/prompts.js";

const exec = promisify(execFile);

/** Enough of a diff to review by; larger diffs are truncated with a marker. */
const MAX_DIFF_CHARS = 12_000;

export interface ReviewArgs {
  goal: string;
  focus?: string;
  /** Injection seam for tests. */
  cwd?: string;
}

/** Test seams: skip config loading / substitute the provider or git. */
export interface ReviewDeps {
  config?: Config;
  provider?: ChatProvider;
  runGit?: (args: string[]) => Promise<string | undefined>;
}

export interface ReviewResult {
  verdict: "APPROVE" | "REVISE";
  /** The full review body, verdict line included. */
  findings: string;
  manifestCount: number;
  gitDetected: boolean;
  reviewPath: string;
}

async function runGitIn(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await exec("git", args, { cwd, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim() || "";
  } catch {
    // Not a repo, git missing, or the command is invalid here (e.g. `diff HEAD` with no commits).
    return undefined;
  }
}

/** Review the current working directory against a stated goal. Exported for tests; the MCP tool wraps it. */
export async function reviewWork(args: ReviewArgs, deps: ReviewDeps = {}): Promise<ReviewResult> {
  if (!args.goal.trim()) {
    throw new Error("goal is required — state what this work was supposed to accomplish.");
  }
  const cwd = args.cwd ?? process.cwd();
  const base = deps.config ?? await loadConfig();
  if (!base) {
    throw new Error(
      "OpenPair is not configured. Run `npx @jverene/openpair` once interactively to set it up (or set a config at ~/.openpair/config.json).",
    );
  }
  if (!deps.provider && !resolveApiKey(base) && base.provider !== "ollama") {
    throw new Error(
      "No API key found. Set the provider's environment variable (OPENAI_API_KEY / ANTHROPIC_API_KEY) for the MCP process.",
    );
  }
  const provider = deps.provider ?? createProvider(base);

  // Ground truth first: what is actually on disk, and what changed.
  const entries = await buildManifest(cwd);
  const manifest = renderEntries(entries);
  const runGit = deps.runGit ?? ((gitArgs: string[]) => runGitIn(cwd, gitArgs));
  const gitDetected = (await runGit(["rev-parse", "--is-inside-work-tree"])) === "true";
  let gitStatus: string | undefined;
  let gitDiff: string | undefined;
  if (gitDetected) {
    gitStatus = await runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
    const stat = await runGit(["diff", "HEAD", "--stat"]);
    const full = await runGit(["diff", "HEAD"]);
    gitDiff = [stat, full && full.length > MAX_DIFF_CHARS ? `${full.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated at ${MAX_DIFF_CHARS} chars)` : full]
      .filter((part) => part !== undefined)
      .join("\n\n") || undefined;
  }

  const notes = new Notes(cwd);
  await notes.init();
  await notes.ensure("review.md", "Review");
  const intent = await notes.read("intent.md");

  const reply = (
    await provider.chat([
      { role: "system", content: VISION_SYSTEM },
      { role: "user", content: standaloneReviewPrompt({ goal: args.goal, focus: args.focus, intent, manifest, gitStatus, gitDiff }) },
    ])
  ).trim();
  const verdict = parseVerdict(reply);

  await notes.append("review.md", "Vision", "Standalone review (pair_review)", reply);

  return {
    verdict: verdict.decision,
    findings: reply,
    manifestCount: entries.length,
    gitDetected,
    reviewPath: join(cwd, ".pair", "review.md"),
  };
}
