/**
 * registrations.ts — register the OpenPair MCP server (`npx @jverene/openpair mcp`)
 * into whichever coding CLIs are present on the machine.
 *
 * The MCP tools (pair_review, pair_run, pair_preflight) are the product;
 * registration is how "most users" get them without hand-editing config.
 * Every writer is idempotent and never clobbers keys it does not own: JSON
 * files are read-merged-written, the Codex TOML is appended to, and a file
 * that exists but does not parse aborts with a manual-fallback note rather
 * than being overwritten.
 */
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER_COMMAND = "npx";
export const SERVER_ARGS = ["@jverene/openpair", "mcp"];
const SERVER_SPEC = { command: SERVER_COMMAND, args: SERVER_ARGS };

export type CliId = "claude" | "cursor" | "codex" | "gemini" | "zcode";

export interface RegistrationDeps {
  /** Injection seams for tests. */
  home?: string;
  packageRoot?: string;
  runExec?: (cmd: string, args: string[]) => Promise<{ code: number; stderr: string }>;
}

export interface RegistrationOutcome {
  ok: boolean;
  /** Human-readable line for the setup summary (success, skip, or failure + manual fallback). */
  note: string;
}

export const defaultExec = (cmd: string, args: string[]) =>
  new Promise<{ code: number; stderr: string }>((resolve) => {
    execFile(cmd, args, { timeout: 60_000 }, (error, _stdout, stderr) => {
      const anyError = error as (Error & { code?: number | string }) | null;
      const code = typeof anyError?.code === "number" ? anyError?.code : anyError ? 1 : 0;
      resolve({ code, stderr: String(stderr || anyError?.message || "") });
    });
  });

/** Source of the bundled slash-command file (ships in the npm package). */
export function bundledCommandPath(packageRoot?: string): string {
  const root = packageRoot ?? fileURLToPath(new URL("..", import.meta.url));
  return join(root, "claude-plugin", "commands", "openpair.md");
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Which CLIs look present? Claude via its binary; the rest via their config dirs. */
export async function detectClis(deps: RegistrationDeps = {}): Promise<Map<CliId, boolean>> {
  const home = deps.home ?? homedir();
  const run = deps.runExec ?? defaultExec;
  const claude = await run("claude", ["--version"]);
  return new Map<CliId, boolean>([
    ["claude", claude.code === 0],
    ["cursor", await dirExists(join(home, ".cursor"))],
    ["codex", await dirExists(join(home, ".codex"))],
    ["gemini", await dirExists(join(home, ".gemini"))],
    ["zcode", await dirExists(join(home, ".zcode"))],
  ]);
}

export const CLI_LABELS: Record<CliId, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  zcode: "ZCode",
};

/** The one-liner a user can run/inspect manually if setup could not do it for them. */
export const MANUAL_HINTS: Record<CliId, string> = {
  claude: "claude mcp add --scope user openpair -- npx @jverene/openpair mcp",
  cursor: `add {"mcpServers":{"openpair":${JSON.stringify(SERVER_SPEC)}}} to ~/.cursor/mcp.json`,
  codex: `append [mcp_servers.openpair] (command = "npx", args = ["@jverene/openpair", "mcp"]) to ~/.codex/config.toml`,
  gemini: `add {"mcpServers":{"openpair":${JSON.stringify(SERVER_SPEC)}}} to ~/.gemini/settings.json`,
  zcode: `add mcp.servers.openpair (${JSON.stringify(SERVER_SPEC)}) to ~/.zcode/cli/config.json`,
};

/**
 * Read-merge-write a JSON config. `set` mutates the parsed root; keys it
 * does not touch are preserved byte-for-byte in spirit (re-serialized).
 * An existing-but-unparseable file aborts — we never clobber user config.
 */
async function mergeJsonConfig(path: string, set: (root: Record<string, unknown>) => void): Promise<void> {
  let root: Record<string, unknown>;
  let existed = false;
  try {
    root = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    existed = true;
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      root = {};
    } else {
      throw new Error(`${path} exists but is not valid JSON — leaving it untouched`);
    }
  }
  if (existed && (typeof root !== "object" || root === null || Array.isArray(root))) {
    throw new Error(`${path} is not a JSON object — leaving it untouched`);
  }
  set(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(root, null, 2) + "\n", "utf8");
}

/** Point `mcpServers.openpair` (Cursor/Gemini shape) at the server, preserving neighbors. */
async function registerMcpServersJson(configPath: string): Promise<RegistrationOutcome> {
  let already = false;
  await mergeJsonConfig(configPath, (root) => {
    const servers = (root.mcpServers ??= {}) as Record<string, unknown>;
    if (servers.openpair) {
      already = true;
      return;
    }
    servers.openpair = { ...SERVER_SPEC };
  });
  return already
    ? { ok: true, note: "already registered — left as-is" }
    : { ok: true, note: `registered in ${configPath}` };
}

/**
 * Register with one CLI. Idempotent: a present entry is a success, not an error.
 */
export async function registerWithCli(id: CliId, deps: RegistrationDeps = {}): Promise<RegistrationOutcome> {
  const home = deps.home ?? homedir();
  const run = deps.runExec ?? defaultExec;
  try {
    switch (id) {
      case "claude": {
        const mcp = await run("claude", ["mcp", "add", "--scope", "user", "openpair", "--", SERVER_COMMAND, ...SERVER_ARGS]);
        const problems: string[] = [];
        if (mcp.code !== 0) {
          problems.push(`MCP registration failed: ${mcp.stderr.slice(0, 200)} — add manually: ${MANUAL_HINTS.claude}`);
        }
        // The slash command keeps an npx fallback, so it is useful even when
        // MCP registration fails — install it either way.
        try {
          const destDir = join(home, ".claude", "commands");
          await mkdir(destDir, { recursive: true });
          await copyFile(bundledCommandPath(deps.packageRoot), join(destDir, "openpair.md"));
        } catch (err) {
          problems.push(`Slash-command install failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (mcp.code === 0 && problems.length === 0) {
          return { ok: true, note: "registered (user scope) + /openpair command installed" };
        }
        return mcp.code === 0
          ? { ok: true, note: `registered (user scope); ${problems.join(" ")}` }
          : { ok: false, note: problems.join(" ") };
      }
      case "cursor":
        return await registerMcpServersJson(join(home, ".cursor", "mcp.json"));
      case "gemini":
        return await registerMcpServersJson(join(home, ".gemini", "settings.json"));
      case "codex": {
        const configPath = join(home, ".codex", "config.toml");
        let existing = "";
        try {
          existing = await readFile(configPath, "utf8");
        } catch {
          // No config yet — we will create it.
        }
        if (/^\[mcp_servers\.openpair\]/m.test(existing)) {
          return { ok: true, note: "already registered — left as-is" };
        }
        const block = `\n[mcp_servers.openpair]\ncommand = "${SERVER_COMMAND}"\nargs = [${SERVER_ARGS.map((a) => `"${a}"`).join(", ")}]\n`;
        await mkdir(dirname(configPath), { recursive: true });
        await writeFile(configPath, existing + (existing.endsWith("\n") || existing === "" ? "" : "\n") + block, "utf8");
        return { ok: true, note: `registered in ${configPath}` };
      }
      case "zcode": {
        const configPath = join(home, ".zcode", "cli", "config.json");
        let already = false;
        await mergeJsonConfig(configPath, (root) => {
          const mcp = (root.mcp ??= {}) as Record<string, unknown>;
          const servers = (mcp.servers ??= {}) as Record<string, unknown>;
          if (servers.openpair) {
            already = true;
            return;
          }
          servers.openpair = { ...SERVER_SPEC };
        });
        return already
          ? { ok: true, note: "already registered — left as-is" }
          : { ok: true, note: `registered in ${configPath}` };
      }
    }
  } catch (err) {
    return {
      ok: false,
      note: `registration failed: ${err instanceof Error ? err.message : String(err)} — add manually: ${MANUAL_HINTS[id]}`,
    };
  }
}
