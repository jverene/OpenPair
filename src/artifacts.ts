/**
 * artifacts.ts — the artifact manifest appended to execution.md before
 * every review, so the Vision agent verifies WORK, not claims.
 *
 * Motivation (benchmark finding 4c): v0.1 reviews approved prose claims of
 * files that were never written. The manifest gives the reviewer ground
 * truth about what actually exists in the working directory.
 */
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const EXCLUDED = new Set([".pair", "node_modules", ".git"]);

export interface ManifestEntry {
  path: string;
  bytes: number;
  modified: string;
}

/** Recursive listing of the working directory (relative paths, sizes, mtimes). */
export async function buildManifest(cwd: string): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (EXCLUDED.has(item.name)) continue;
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full);
        continue;
      }
      const info = await stat(full);
      entries.push({
        path: relative(cwd, full),
        bytes: info.size,
        modified: info.mtime.toISOString(),
      });
    }
  };
  await walk(cwd);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/** Render the manifest as the markdown block appended to execution.md. */
export async function renderManifest(cwd: string): Promise<string> {
  const entries = await buildManifest(cwd);
  if (entries.length === 0) {
    return "Artifact manifest (working directory, excluding .pair/node_modules/.git): EMPTY — no files were produced.";
  }
  const lines = entries.map((e) => `- ${e.path} — ${e.bytes} bytes, modified ${e.modified}`);
  return `Artifact manifest (working directory, excluding .pair/node_modules/.git):\n${lines.join("\n")}`;
}
