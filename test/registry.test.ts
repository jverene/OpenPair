/**
 * registry.test.ts — the PRD's domain → capability contract:
 *   software: harness only (no direct tools), research: file+shell+python,
 *   writing: file only; fallback harness: file+shell.
 */
import { describe, expect, it } from "vitest";
import { fallbackTools, toolsForDomain } from "../src/tools/registry.js";

describe("toolsForDomain", () => {
  it("software domain gets no direct tools (execution goes through the harness)", () => {
    expect(toolsForDomain("software")).toEqual([]);
  });

  it("research domain gets file, shell, and python tools", () => {
    const names = toolsForDomain("research").map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("list_dir");
    expect(names).toContain("run_shell");
    expect(names).toContain("run_python");
  });

  it("writing domain gets file tools only", () => {
    const names = toolsForDomain("writing").map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).not.toContain("run_shell");
    expect(names).not.toContain("run_python");
  });

  it("fallback harness gets basic file + shell tools (no python)", () => {
    const names = fallbackTools().map((t) => t.name);
    expect(names).toContain("run_shell");
    expect(names).not.toContain("run_python");
  });

  it("every tool carries prompt-renderable docs", () => {
    for (const tool of toolsForDomain("research")) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toHaveProperty("type", "object");
    }
  });
});
