/**
 * tools/files.ts — read_file, write_file, list_dir.
 * All paths are sandboxed to the working directory: any resolution that
 * escapes the cwd is rejected outright.
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Tool } from "./registry.js";

/** Resolve a user-supplied path inside cwd, rejecting escapes. */
export function sandboxPath(cwd: string, userPath: string): string {
  const resolved = resolve(cwd, userPath);
  if (resolved !== cwd && !resolved.startsWith(cwd + sep)) {
    throw new Error(`Path escapes the working directory: ${userPath}`);
  }
  return resolved;
}

export const readFileTool: Tool = {
  name: "read_file",
  description: "Read a text file inside the working directory.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "Path relative to the working directory." } },
    required: ["path"],
  },
  async execute(args, cwd) {
    const target = sandboxPath(cwd, String(args.path ?? ""));
    return await readFile(target, "utf8");
  },
};

export const writeFileTool: Tool = {
  name: "write_file",
  description: "Write a text file inside the working directory, creating parent directories.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the working directory." },
      content: { type: "string", description: "Full file content to write." },
    },
    required: ["path", "content"],
  },
  async execute(args, cwd) {
    const target = sandboxPath(cwd, String(args.path ?? ""));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, String(args.content ?? ""), "utf8");
    return `Wrote ${String(args.path)}`;
  },
};

export const listDirTool: Tool = {
  name: "list_dir",
  description: "List entries of a directory inside the working directory.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "Directory path relative to the working directory.", default: "." } },
    required: [],
  },
  async execute(args, cwd) {
    const target = sandboxPath(cwd, String(args.path ?? "."));
    const entries = await readdir(target, { withFileTypes: true });
    return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n");
  },
};

export const fileTools: Tool[] = [readFileTool, writeFileTool, listDirTool];
