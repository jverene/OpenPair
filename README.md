# OpenPair

Two agents. One has the vision. One executes. They review each other's work — and every decision, every dead end, every tradeoff gets written down.

OpenPair is pair programming plus startup speed plus the documentation hygiene of a mature engineering org. Not a swarm of agents playing make-believe software company. Not a single agent coding in a black box. Two agents, one workstation, and a paper trail.

## The two agents

- **Vision Holder (Agent A)** owns the *why*. Writes the goal, constraints, and definition of done. Reviews the Executor's work against the original intent — "does this actually solve the problem?" Never writes code.
- **Executor (Agent B)** owns the *how*. Reads the vision, plans, builds, and documents tradeoffs as it goes. When the intent is ambiguous, it asks — it never guesses. Never decides what to build.

## The loop

Both agents see one shared, append-only transcript — `.pair/transcript.jsonl` records every agent output, question, answer, tool call, and result. Authority is restricted, not observation: the orchestrator enforces what each agent may *do*, while neither ever works from hidden state.

1. **Intent** — Vision writes `.pair/intent.md` and `.pair/intentnotes.md`.
2. **Plan** — Executor posts `plan.md` + `plannotes.md`. Vision is invoked at the handoff: it replies `SILENT` (no objection — proceed) or `OBJECT` with concrete corrections (one replan).
3. **Execute** — Executor runs the plan with real tools. Tool calls stream into the transcript; they never yield the keyboard. When the intent turns out to be ambiguous mid-work, the Executor asks Vision **directly** (`ASK:` / the `ask_vision` tool) and continues in the same working session — both sides of the exchange land in `qa.md` and the transcript. (The old `QUESTION:` handoff, which ends the execution, still exists for whole-task blockers.)
4. **Review** — the orchestrator snapshots an **artifact manifest** (what actually exists on disk, sizes and timestamps) into `execution.md`, then Vision reviews the work *and* the manifest against the intent. A claimed artifact that isn't on disk is a phantom claim — automatic `REVISE`.
5. **Circuit breaker** — on `APPROVE`, the human takes over at the interactive gate:

```
[a] approve  [r] request changes  [q] quit  >
```

`[r]` injects your feedback into the loop and the pair runs another cycle (it counts against the same review-cycle cap as Vision's own `REVISE` verdicts). `[q]` stops with all notes intact. Non-interactive sessions print the gate state and exit cleanly.

Safety rails: content-hash gating skips invocations whose inputs haven't changed (no wasted tokens); byte-identical repetition halts the loop; 3 review cycles and 5 Q&A rounds are hard caps; a tool loop that can't make progress halts with a `protocol failure` in `execution.md` rather than pretending to be done.

## The notes are the product

```
.pair/intent.md          — what we are trying to do
.pair/intentnotes.md     — why this scope, what was excluded, assumptions
.pair/plan.md            — how we will approach it
.pair/plannotes.md       — why this approach, rejected alternatives (with tombstones), accepted risks
.pair/execution.md       — what was actually done, findings, blockers, artifact manifest
.pair/qa.md              — questions that came up and their answers
.pair/review.md          — did the execution survive contact with the intent?
.pair/transcript.jsonl   — the full shared record: every message, call, and result
```

Code is cheap; context is expensive. Six months from now, `plannotes.md` answers "why this database?", `intentnotes.md` answers "why not that feature?", and `review.md` answers "did anyone check this against the goal?"

## Install and run

```bash
npx @jverene/openpair "Build a Stripe checkout with discount codes"
```

First run starts a setup wizard: provider (OpenAI, Anthropic, Ollama, or any OpenAI-compatible endpoint), model, key, and domain. The wizard **validates the configuration with a real API call before saving anything** — a typo'd key is caught at setup, not at your first run. Config lives at `~/.openpair/config.json` (permissions `0600`, owner-only); you can skip file storage entirely by leaving the key blank and using `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — the environment always wins.

```bash
openpair --reconfigure   # re-run the setup wizard
openpair --mock "…"      # full loop against a scripted provider — no API keys needed
```

The default domain is **research** — the friendliest first run. Provider and network failures are reported as one actionable sentence (which env var or URL to fix), not a stack trace.

## Domains

- **software** — the Executor delegates coding to [OpenCode](https://opencode.ai) headless when it's installed, with a 15-second preflight smoke test before every real task. If OpenCode is missing **or misbehaves**, OpenPair says so and **falls back to basic file/shell tools for that task** — the loop never dies on harness trouble. (Note: recent OpenCode versions need their own provider configuration to reach non-OpenAI backends; OpenPair works regardless via the fallback.) Credentials pass through as environment variables only — OpenCode's config files are never touched.
- **research** — file, shell, and Python tools.
- **writing** — file tools only.

In every domain the Executor's working rules apply: least code that fully works, stdlib over dependencies, build only what the intent asks, minimal diffs, tombstones for rejected alternatives — and **findings must be materialized to a file**, not left in the transcript.

## Cost and spend visibility

Every LLM call is appended as one JSON line — `{ts, model, prompt_tokens, completion_tokens, prompt_cache_hit_tokens, prompt_cache_miss_tokens}` — to `.pair/usage.jsonl`, or anywhere you like via `OPENPAIR_USAGE_LOG`. Point it at an absolute path per run for clean per-run cost accounting. DeepSeek cache-hit fields are captured when the backend reports them.

## What OpenPair is not

No browser automation or computer use. No parallel execution. No custom agent definitions — the two-agent pattern is the product. No spend caps; you manage your own keys and budget (the usage log gives you the numbers). See `V01PRD.md` for the product spec.

## Development

```bash
npm install
npm test           # vitest: notes, registry, orchestrator, harness, tool loop, yield model, gate
npm run typecheck  # tsc --noEmit
npm run build      # emits dist/
```

This repository dogfoods its own pipeline: `.pair/` in the project root documents why OpenPair itself is built the way it is.
