/** config.test.ts — B2: key storage permissions. */
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveConfig, type Config } from "../src/config.js";

const REAL_HOME = process.env.HOME;
let fakeHome: string;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "openpair-home-"));
  process.env.HOME = fakeHome;
});
afterEach(async () => {
  process.env.HOME = REAL_HOME;
  await rm(fakeHome, { recursive: true, force: true });
});

const config: Config = { provider: "custom", domain: "research", model: "m", apiKey: "sk-test" };

describe("saveConfig permissions (B2)", () => {
  it("creates the config owner-only (0600)", async () => {
    await saveConfig(config);
    const info = await stat(join(fakeHome, ".openpair", "config.json"));
    // eslint-disable-next-line no-bitwise
    expect(info.mode & 0o777).toBe(0o600);
  });

  it("tightens a pre-existing group/world-readable config and returns a warning", async () => {
    await mkdir(join(fakeHome, ".openpair"), { recursive: true });
    const p = join(fakeHome, ".openpair", "config.json");
    await writeFile(p, "{}\n");
    await chmod(p, 0o644);
    const warning = await saveConfig(config);
    expect(warning).toContain("readable by group/others");
    const info = await stat(p);
    // eslint-disable-next-line no-bitwise
    expect(info.mode & 0o777).toBe(0o600);
  });

  it("no warning when replacing an already-tight config", async () => {
    await saveConfig(config);
    const warning = await saveConfig(config);
    expect(warning).toBeUndefined();
  });
});
