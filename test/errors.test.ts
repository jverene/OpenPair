/** errors.test.ts — B3: provider/network error translation. */
import { describe, expect, it } from "vitest";
import { describeProviderError } from "../src/errors.js";

describe("describeProviderError (B3)", () => {
  it("401 -> key guidance mentioning --reconfigure and env var", () => {
    const out = describeProviderError(
      { status: 401, message: "Authentication Fails, Your api key: ****2345 is invalid" },
      "deepseek-chat",
      "custom",
    );
    expect(out).toContain("API key was rejected");
    expect(out).toContain("--reconfigure");
    expect(out).toContain("environment variable");
  });

  it("ENOTFOUND -> base URL guidance", () => {
    const out = describeProviderError(
      { cause: { code: "ENOTFOUND" }, message: "request failed" },
      "m",
      "custom",
    );
    expect(out).toContain("base URL");
  });

  it("ECONNREFUSED + ollama -> is ollama serve running?", () => {
    const out = describeProviderError(
      { cause: { code: "ECONNREFUSED" }, message: "connection refused" },
      "llama3.1",
      "ollama",
    );
    expect(out).toContain("ollama serve");
  });

  it("model rejection passes through the API's valid-model list", () => {
    const apiMsg =
      'The supported API model names are deepseek-v4-pro, deepseek-v4-flash, and deepseek-v4-flash-vision-exp, but you passed gpt-nonexistent-99.';
    const out = describeProviderError({ status: 400, message: apiMsg }, "gpt-nonexistent-99", "custom");
    expect(out).toContain("deepseek-v4-pro"); // the list survives
    expect(out).toContain("--reconfigure");
  });
});
