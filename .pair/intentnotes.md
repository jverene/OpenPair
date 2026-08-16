# Intent Notes — Why this scope

_Agent: Vision (human-directed). The reasoning behind intent.md._

## [2026-08-16T14:19:46Z] Why this scope and not a larger one

v0.1 proves the core thesis: two agents plus mandatory documentation produce better, more legible work than one agent in a black box. Everything that does not serve that proof is excluded. The PRD's "What Is Not In v0.1" list (browser automation, parallel execution, custom agents, cost tracking) is treated as binding, not aspirational.

## Explicitly excluded (and why)

- **Web dashboard / browser automation** — the CLI terminal is sufficient to show phases, handoffs, and Q&A pauses. A dashboard adds surface area without testing the thesis.
- **Parallel execution** — the pair metaphor is one workstation, two engineers, sequential turns. Parallelism would also complicate the handoff contract (who reads which write?).
- **Custom agent definitions** — the two-agent pattern is the product. Configurable rosters dilute it.
- **Cost tracking / budget limits** — users manage their own keys and spend in v0.1. The token-safety mechanisms (hash gating, cycle cap, spin-loop detection) exist to prevent *waste inside the loop*, not to meter spend.
- **Wikilinks in notes** — Obsidian compatibility is nice-to-have; plain markdown with timestamps is the v0.1 contract. (PRD open question, resolved: no.)

## Assumptions

- Node.js >= 18 runtime; users install via `npx openpair`.
- Users bring their own API keys (OpenAI/Anthropic) or run Ollama locally.
- OpenCode is optional but preferred for the software domain; when absent, the fallback harness keeps the loop functional.
- Single machine, single project directory per run.
- The `.pair/` notes are git-tracked by the user's own repo habits; OpenPair does not manage version control for notes.

## Resolved PRD open questions

- Wikilinks: **no** for v0.1.
- Direct agent messaging vs notes-only: **notes-only, strictly** — documentation is the point.
- Default LLM per domain: **provider-level defaults suggested in the wizard, user-overridable** (e.g. a Claude default, a GPT default, a Llama default for Ollama). Not hardcoded per domain.
- Tombstones for rejected alternatives in plannotes.md: **yes** — rejected option, reason, rejecting agent.
