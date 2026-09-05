/**
 * mcp.ts — OpenPair as an MCP server, so Claude Code (or any MCP client)
 * can invoke the two-agent loop as a tool.
 *
 *   claude mcp add openpair -- npx @jverene/openpair mcp
 *
 * Tools:
 *   pair_preflight — is OpenPair configured (provider, key, harness)?
 *   pair_run       — run the full pair loop in the client's working
 *                    directory; returns status, verdict and where to look.
 *
 * The pair loop runs headlessly (quiet UI); artifacts and .pair/ notes land
 * in the caller's cwd, so Claude Code can then read them like any files.
 */
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

/** Start the stdio MCP server. */
export async function startMcpServer(): Promise<void> {
  const server = new McpServer({ name: "openpair", version: "0.2.0" });

  server.tool(
    "pair_preflight",
    "Check that OpenPair is configured: provider, key, and which software harness would be selected.",
    {},
    async () => {
      try {
        const config = await loadConfig();
        if (!config) {
          return { content: [{ type: "text", text: "NOT CONFIGURED — run `npx @jverene/openpair` once interactively." }] };
        }
        const keyOk = Boolean(resolveApiKey(config)) || config.provider === "ollama";
        let harness = "n/a (research/writing)";
        if (config.domain === "software") {
          const { createHarness: ch } = await import("./harness/index.js");
          const provider = createProvider(config);
          const picked = await ch({ config, provider, cwd: process.cwd() });
          harness = `${picked.harness.name}${picked.notice ? " (notice: " + picked.notice + ")" : ""}`;
        }
        return {
          content: [{
            type: "text",
            text: `provider=${config.provider} model=${config.model} domain=${config.domain} key=${keyOk ? "present" : "MISSING"} harness=${harness}`,
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `preflight error: ${String(err)}` }] };
      }
    },
  );

  server.tool(
    "pair_run",
    "Run the OpenPair two-agent loop (Vision + Executor with verified review) in the current working directory. " +
      "Returns loop status, the review verdict, and where the artifacts/notes landed. Can take several minutes.",
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
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `pair_run failed: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  await server.connect(new StdioServerTransport());
}
