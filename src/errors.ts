/**
 * errors.ts — translate provider/network failures into human guidance.
 *
 * First-hour fix (dogfood finding B3): every misconfiguration used to crash
 * with a raw Node stack dump. The loop is still "let it crash" internally;
 * the CLI boundary catches known API/network error shapes and prints one
 * actionable sentence instead. Unknown errors keep their message (but no
 * stack) and exit non-zero.
 */
import type { APIError } from "openai";

export function describeProviderError(err: unknown, model: string, provider: string): string {
  const anyErr = err as { status?: number; code?: string; message?: string; cause?: { code?: string } };
  const status = anyErr?.status;
  const msg = String(anyErr?.message ?? "");
  const netCode = anyErr?.cause?.code ?? anyErr?.code;

  if (status === 401 || /unauthorized|invalid.*api key|authentication/i.test(msg)) {
    return (
      "Your API key was rejected.\n" +
      "Fix: check the key, then re-run `openpair --reconfigure` or set it via the provider's environment variable (recommended)."
    );
  }
  if (netCode === "ENOTFOUND" || netCode === "EAI_AGAIN") {
    return (
      `Could not reach the API endpoint.\n` +
      "Fix: check the base URL in your config (`openpair --reconfigure`) and your network connection."
    );
  }
  if (netCode === "ECONNREFUSED") {
    if (provider === "ollama") {
      return (
        "Could not reach Ollama at localhost:11434.\n" +
        "Fix: is `ollama serve` running? Start it, then re-run."
      );
    }
    return (
      "Connection refused by the endpoint.\n" +
      "Fix: check the base URL and that the service is running (`openpair --reconfigure`)."
    );
  }
  if (status === 400 && /model/i.test(msg)) {
    // Provider messages of this shape list the valid models — pass them through.
    return `Model "${model}" was rejected.\nAPI said: ${msg}\nFix: pick a listed model (\`openpair --reconfigure\`).`;
  }
  if (status === 429) {
    return "Rate limited or out of quota.\nFix: wait and retry, or check your provider balance/plan.";
  }
  return `Unexpected error: ${msg || String(err)}\n(Re-run with OPENPAIR_DEBUG=1 for the full stack trace.)`;
}
