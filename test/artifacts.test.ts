/**
 * artifacts.test.ts — the artifact manifest: recursion, exclusions, and
 * the empty-directory case the reviewer must see.
 */
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildManifest, renderManifest } from "../src/artifacts.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "openpair-manifest-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("artifact manifest", () => {
  it("lists files recursively with sizes and mtimes, excluding .pair/node_modules/.git", async () => {
    await writeFile(join(cwd, "report.md"), "hello world");
    await mkdir(join(cwd, "sub"));
    await writeFile(join(cwd, "sub", "data.csv"), "a,b\n1,2\n");
    await mkdir(join(cwd, ".pair"));
    await writeFile(join(cwd, ".pair", "intent.md"), "hidden from review");
    await mkdir(join(cwd, "node_modules", "x"), { recursive: true });
    await writeFile(join(cwd, "node_modules", "x", "y.js"), "");

    const manifest = await buildManifest(cwd);
    const paths = manifest.map((e) => e.path);
    expect(paths).toEqual(["report.md", "sub/data.csv"]);
    expect(manifest[0].bytes).toBe(11);
    expect(manifest[0].modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("renders an explicit EMPTY marker when nothing was produced", async () => {
    const rendered = await renderManifest(cwd);
    expect(rendered).toContain("EMPTY");
    expect(rendered).toContain("no files were produced");
  });
});
