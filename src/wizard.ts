/**
 * wizard.ts — first-run setup: LLM provider, model, credentials, domain.
 * Saves ~/.openpair/config.json. Re-runnable via `openpair --reconfigure`.
 */
import prompts from "prompts";
import { createProvider } from "./providers/index.js";
import { describeProviderError } from "./errors.js";
import {
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  DOMAINS,
  PROVIDERS,
  resolveApiKey,
  saveConfig,
  type Config,
  type Domain,
  type ProviderName,
} from "./config.js";

/** One cheap live call to prove the config works before anything is saved. */
async function validateConfig(config: Config): Promise<string | undefined> {
  try {
    const provider = createProvider(config);
    const reply = await provider.chat([{ role: "user", content: "Reply with exactly: OK" }], { maxTokens: 10 });
    if (typeof reply !== "string" || reply.trim() === "") return "The model returned an empty reply.";
    return undefined;
  } catch (err) {
    return describeProviderError(err, config.model, config.provider);
  }
}

export async function runWizard(): Promise<Config | null> {
  const answers = await prompts(
    [
      {
        type: "select",
        name: "provider",
        message: "LLM provider",
        choices: PROVIDERS.map((p) => ({ title: p, value: p })),
      },
      {
        type: (prev: ProviderName) => (prev === "ollama" || prev === "custom" ? "text" : null),
        name: "baseURL",
        message: "Base URL (OpenAI-compatible endpoint)",
        initial: (prev: ProviderName) => DEFAULT_BASE_URLS[prev] ?? "",
      },
      {
        type: "text",
        name: "model",
        message: "Model",
        initial: (prev: string, values: { provider: ProviderName }) =>
          DEFAULT_MODELS[values.provider],
      },
      {
        type: (prev: string, values: { provider: ProviderName }) =>
          values.provider === "ollama" ? null : "password",
        name: "apiKey",
        message:
          "API key — recommended: leave blank and set OPENAI_API_KEY (or ANTHROPIC_API_KEY) in your environment instead of storing it in a file",
      },
      {
        type: "select",
        name: "domain",
        message: "Domain",
        // research first: the safest, most self-explanatory first-run path.
        choices: (["research", "writing", "software"] as Domain[]).map((d) => ({ title: d, value: d })),
      },
    ],
    { onCancel: () => null },
  );

  if (!answers.provider || !answers.domain || !answers.model) return null;

  const config: Config = {
    provider: answers.provider,
    domain: answers.domain as Domain,
    model: answers.model,
    baseURL: answers.baseURL || undefined,
    apiKey: answers.apiKey || undefined,
  };

  // Validate before saving: a broken config must never feel "installed".
  // (resolveApiKey lets an env var satisfy the check when the key is blank.)
  console.log("Checking that this configuration works...");
  for (let attempt = 0; attempt < 3; attempt++) {
    const failure = await validateConfig({ ...config, apiKey: resolveApiKey(config) });
    if (!failure) break;
    console.warn(failure);
    if (attempt === 2) {
      console.warn("Giving up after 3 attempts. Nothing was saved; fix the issue and re-run `openpair --reconfigure`.");
      return null;
    }
    console.warn("Re-prompting — fix the issue or press Ctrl+C to abort.");
    // The provider is fixed at retry time, so prompts are chosen up front
    // instead of via dynamic type-callers (those only see sibling answers).
    const needsBaseUrl = config.provider === "ollama" || config.provider === "custom";
    const needsKey = config.provider !== "ollama";
    const retry = await prompts(
      [
        ...(needsBaseUrl
          ? [
              {
                type: "text" as const,
                name: "baseURL",
                message: "Base URL (OpenAI-compatible endpoint)",
                initial: config.baseURL ?? "",
              },
            ]
          : []),
        { type: "text" as const, name: "model", message: "Model", initial: config.model },
        ...(needsKey
          ? [
              {
                type: "password" as const,
                name: "apiKey",
                message: "API key — recommended: leave blank and set the provider's env var instead",
              },
            ]
          : []),
      ],
      { onCancel: () => null },
    );
    if (retry.baseURL !== undefined) config.baseURL = retry.baseURL || undefined;
    if (retry.model) config.model = retry.model;
    if (retry.apiKey !== undefined) config.apiKey = retry.apiKey || undefined;
  }

  const warning = await saveConfig(config);
  if (warning) console.warn(warning);
  return config;
}
