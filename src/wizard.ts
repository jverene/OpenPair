/**
 * wizard.ts — first-run setup: LLM provider, model, credentials, domain.
 * Saves ~/.openpair/config.json. Re-runnable via `openpair --reconfigure`.
 */
import prompts from "prompts";
import {
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  DOMAINS,
  PROVIDERS,
  saveConfig,
  type Config,
  type Domain,
  type ProviderName,
} from "./config.js";

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
        message: "API key (leave blank to use the environment variable)",
      },
      {
        type: "select",
        name: "domain",
        message: "Domain",
        choices: DOMAINS.map((d) => ({ title: d, value: d })),
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
  await saveConfig(config);
  return config;
}
