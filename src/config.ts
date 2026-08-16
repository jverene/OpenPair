/**
 * config.ts — load/save of ~/.openpair/config.json and env-var API keys.
 *
 * Users manage their own keys and spend (v0.1 ships no cost tracking).
 * Keys may live in the config file (written by the wizard) or in the
 * environment; the environment wins so CI and power users can override.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const PROVIDERS = ["openai", "anthropic", "ollama", "custom"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export const DOMAINS = ["software", "research", "writing"] as const;
export type Domain = (typeof DOMAINS)[number];

export interface Config {
  provider: ProviderName;
  domain: Domain;
  model: string;
  /** OpenAI-compatible base URL. Required for ollama/custom, ignored otherwise. */
  baseURL?: string;
  /** May be omitted when the key comes from the environment. */
  apiKey?: string;
}

/** Sensible provider-level defaults; the wizard lets the user override. */
export const DEFAULT_MODELS: Record<ProviderName, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-5",
  ollama: "llama3.1",
  custom: "gpt-4o",
};

export const DEFAULT_BASE_URLS: Partial<Record<ProviderName, string>> = {
  ollama: "http://localhost:11434/v1",
};

/** Env var each provider reads its key from. Ollama needs none. */
export const API_KEY_ENV: Partial<Record<ProviderName, string>> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  custom: "OPENAI_API_KEY",
};

export function configPath(): string {
  return join(homedir(), ".openpair", "config.json");
}

export async function loadConfig(): Promise<Config | null> {
  try {
    const raw = await readFile(configPath(), "utf8");
    return JSON.parse(raw) as Config;
  } catch {
    return null;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(join(homedir(), ".openpair"), { recursive: true });
  await writeFile(configPath(), JSON.stringify(config, null, 2) + "\n", "utf8");
}

/**
 * Resolve the API key for a config: environment first, then the file.
 * Returns undefined for providers that need no key (ollama).
 */
export function resolveApiKey(config: Config): string | undefined {
  const envVar = API_KEY_ENV[config.provider];
  if (envVar && process.env[envVar]) return process.env[envVar];
  return config.apiKey;
}
