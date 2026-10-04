/**
 * mcp.ts — OpenPair as an MCP server, so any coding CLI (Claude Code,
 * Cursor, Codex, Gemini CLI, ZCode, …) can call the pair as a tool.
 *
 *   claude mcp add openpair -- npx @jverene/openpair mcp
 *
 * Tools (the end products, not the process):
 *   pair_review    — independent verdict on work that already exists:
 *                    APPROVE/REVISE grounded in an artifact manifest.
 *   pair_run       — delegate a whole task; get back reviewed artifacts.
 *   pair_preflight — is OpenPair configured (provider, key, harness)?
 *
 * pair_review is the fast path: it reviews the caller's working directory
 * (typically what their own coding agent just produced) without running the
 * loop. pair_run runs the full pair loop headlessly (quiet UI); artifacts
 * and .pair/ notes land in the caller's cwd, so the CLI can read them like
 * any files.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, resolveApiKey, type Config, type Domain, type HarnessChoice } from "./config.js";
import { createProvider } from "./providers/index.js";
import { createHarness } from "./harness/index.js";
import { runPairLoop } from "./orchestrator.js";
import { Transcript } from "./transcript.js";
import { UI } from "./ui.js";
import { Notes } from "./notes.js";
import { reviewWork, type ReviewResult } from "./review.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

export interface PairRunArgs {
  goal: string;
  domain?: "research" | "writing" | "software";
  harness?: HarnessChoice;
  /** Injection seam for tests. */
  cwd?: string;
}

/** Test seams: skip config loading / substitute the provider. */
export interface PairRunDeps {
  config?: Config;
  provider?: import("./providers/types.js").ChatProvider;
}

export interface PairRunResult {
  status: string;
  reason?: string;
  reviewCycles: number;
  config: { provider: string; model: string; domain: string; harness: string };
  artifacts: string[];
  reviewTail: string;
  notesDir: string;
}

/** Run the pair loop headlessly. Exported for tests; the MCP tool wraps it. */
export async function pairRun(args: PairRunArgs, deps: PairRunDeps = {}): Promise<PairRunResult> {
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
  const config: Config = {
    ...base,
    domain: (args.domain ?? base.domain) as Domain,
    harness: args.harness ?? base.harness ?? "auto",
  };

  const provider = deps.provider ?? createProvider(config);
  const transcript = new Transcript(cwd);
  await transcript.init();
  const { harness } = config.domain === "software"
    ? await createHarness({ config, provider, cwd, transcript })
    : { harness: undefined };

  const result = await runPairLoop({
    goal: args.goal,
    config,
    provider,
    cwd,
    ui: new UI(true),
    harness,
    transcript,
  });

  // Summarize what the loop produced so the calling agent knows where to look.
  const notes = new Notes(cwd);
  const review = await notes.read("review.md");
  const reviewTail = review.split("\n").slice(1, 14).join("\n").trim();
  const { buildManifest } = await import("./artifacts.js");
  const artifacts = (await buildManifest(cwd)).map((e) => e.path);

  return {
    status: result.status,
    reason: result.reason?.split("\n")[0],
    reviewCycles: result.reviewCycles,
    config: { provider: config.provider, model: config.model, domain: config.domain, harness: config.harness ?? "auto" },
    artifacts,
    reviewTail,
    notesDir: `${cwd}/.pair`,
  };
}

/** Readiness check. Exported for tests; the pair_preflight tool wraps it. */
export async function preflight(): Promise<string> {
  const config = await loadConfig();
  if (!config) {
    return "NOT CONFIGURED — run `npx @jverene/openpair` once interactively.";
  }
  const keyOk = Boolean(resolveApiKey(config)) || config.provider === "ollama";
  let harness = "n/a (research/writing)";
  if (config.domain === "software") {
    const provider = createProvider(config);
    const picked = await createHarness({ config, provider, cwd: process.cwd() });
    harness = `${picked.harness.name}${picked.notice ? " (notice: " + picked.notice + ")" : ""}`;
  }
  return `provider=${config.provider} model=${config.model} domain=${config.domain} key=${keyOk ? "present" : "MISSING"} harness=${harness}`;
}

/** Start the stdio MCP server. */
export async function startMcpServer(): Promise<void> {
  const server = new McpServer({ name: "openpair", version });

  server.tool(
    "pair_preflight",
    "One-shot readiness check for the OpenPair tools: provider, API key, and which coding harness the software domain would use. Run this first if any pair_* tool fails.",
    {},
    async () => {
      try {
        return { content: [{ type: "text", text: await preflight() }] };
      } catch (err) {
        return { content: [{ type: "text", text: `preflight error: ${String(err)}` }] };
      }
    },
  );

  server.tool(
    "pair_review",
    "Independent APPROVE/REVISE verdict on the current working directory against a stated goal — a second pair of eyes for work you or your coding agent already did. " +
      "Deliverables are verified against an artifact manifest of what actually exists on disk (a claimed-but-missing file is an automatic REVISE, not a judgment call), " +
      "and in a git repository the uncommitted diff is reviewed too. The full review is appended to .pair/review.md. Fast (one model call) — prefer it over pair_run when the work already exists.",
    {
      goal: z.string().describe("What this work was supposed to accomplish — the yardstick for the verdict"),
      focus: z.string().optional().describe("A specific concern to check first (optional)"),
    },
    async (args) => {
      try {
        const r: ReviewResult = await reviewWork(args);
        const text = [
          `verdict: ${r.verdict}`,
          `files on disk: ${r.manifestCount}`,
          `git: ${r.gitDetected ? "uncommitted diff reviewed" : "not a repository — judged by the artifact manifest"}`,
          "",
          r.findings,
          "",
          `full review: ${r.reviewPath}`,
        ].join("\n");
        return { content: [{ type: "text", text }], structuredContent: { ...r } };
      } catch (err) {
        return { content: [{ type: "text", text: `pair_review failed: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  server.tool(
    "pair_run",
    "Delegate a self-contained task and get back reviewed, verified work: a Vision agent writes the intent, an Executor builds it, and the result is reviewed against an artifact manifest of what actually exists on disk — phantom deliverables fail automatically. " +
      "Returns the final status (approved / needs_human / halted), the review verdict, and the artifact list; deliverables plus a durable decision trail land in the current directory and .pair/. " +
      "Can take several minutes — to review work that already exists, use pair_review instead.",
    {
      goal: z.string().describe("What the pair should build, research, or write"),
      domain: z.enum(["research", "writing", "software"]).optional().describe("Override the configured domain"),
      harness: z.enum(["auto", "claude", "opencode", "fallback"]).optional().describe("Software domain only: execution harness"),
    },
    async (args) => {
      try {
        const r = await pairRun(args);
        const text = [
          `status: ${r.status}${r.reason ? ` — ${r.reason}` : ""}`,
          `review cycles: ${r.reviewCycles}`,
          `config: ${r.config.provider}/${r.config.model} domain=${r.config.domain} harness=${r.config.harness}`,
          `notes: ${r.notesDir}`,
          "",
          "review.md (head):",
          r.reviewTail,
        ].join("\n");
        return { content: [{ type: "text", text }], structuredContent: { ...r } };
      } catch (err) {
        return { content: [{ type: "text", text: `pair_run failed: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  await server.connect(new StdioServerTransport());
}

// `node dist/mcp.js` starts the server directly; the CLI's `openpair mcp`
// subcommand imports this module without triggering the guard. stdout is
// the protocol stream — startup errors must go to stderr.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startMcpServer().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
