# OpenPair

Two agents. One has the vision. One executes. They review each other's work — and every decision, every dead end, every tradeoff gets written down.

OpenPair is pair programming plus startup speed plus the documentation hygiene of a mature engineering org. Not a swarm of agents playing make-believe software company. Not a single agent coding in a black box. Two agents, one workstation, and a paper trail.

## The two agents

- **Vision Holder (Agent A)** owns the *why*. Writes the goal, constraints, and definition of done. Reviews the Executor's work against the original intent — "does this actually solve the problem?" Never writes code.
- **Executor (Agent B)** owns the *how*. Reads the vision, plans, builds, and documents tradeoffs as it goes. When the intent is ambiguous, it asks — it never guesses. Never decides what to build.

## The loop

The agents never chat in a side channel. They communicate through timestamped markdown notes in `.pair/`, and the orchestrator passes the keyboard reactively: every note write immediately triggers the agent who reads that file next.

1. **Intent** — Vision writes `.pair/intent.md` and `.pair/intentnotes.md`.
2. **Plan + Execute** — Executor writes `plan.md` + `plannotes.md` (a cheap, reviewable call), then executes. Questions go to `qa.md`; Vision answers; Executor resumes automatically. Findings land in `execution.md`.
3. **Review** — Vision writes `review.md` with a verdict: `APPROVE` or `REVISE`.
4. **Handoff** — `REVISE` auto-triggers the Executor to re-execute. `APPROVE` stops the loop and prompts the human. The human is the circuit breaker, not the project manager.

Safety rails: the orchestrator hashes every note an agent reads and skips invocations whose inputs haven't changed (no wasted tokens); an agent repeating itself byte-for-byte halts the loop; three review cycles is the hard cap before the human is asked.

## The notes are the product

```
.pair/intent.md       — what we are trying to do
.pair/intentnotes.md  — why this scope, what was excluded, assumptions
.pair/plan.md         — how we will approach it
.pair/plannotes.md    — why this approach, rejected alternatives (with tombstones), accepted risks
.pair/execution.md    — what was actually done, findings, blockers
.pair/qa.md           — questions that came up and their answers
.pair/review.md       — does the execution match the intent?
```

Code is cheap; context is expensive. Six months from now, `plannotes.md` answers "why this database?", `intentnotes.md` answers "why not that feature?", and `review.md` answers "did anyone check this against the goal?"

## Install and run

```bash
npx openpair "Build a Stripe checkout with discount codes"
```

First run asks for your LLM provider (OpenAI, Anthropic, Ollama, or any OpenAI-compatible endpoint), model, API key, and domain (software, research, or writing). Config lives at `~/.openpair/config.json`; API keys may also come from the usual environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`), which take precedence.

```bash
openpair --reconfigure   # re-run the setup wizard
openpair --mock "…"      # full loop against a scripted provider — no API keys needed
```

## Domains

- **software** — the Executor delegates coding to [OpenCode](https://opencode.ai) headless (`opencode run --auto --format json`). A 15-second preflight smoke test runs before every real task; if it fails, the loop halts with actionable troubleshooting in `execution.md` rather than burning five minutes on a mystery. Credentials pass through as environment variables only — OpenCode's config files are never touched. If OpenCode isn't installed, OpenPair falls back to basic file/shell tools and tells you.
- **research** — file, shell, and Python tools.
- **writing** — file tools only.

## What v0.1 is not

No browser automation or computer use. No parallel execution. No custom agent definitions — the two-agent pattern is the product. No cost tracking; you manage your own keys and spend. See `V01PRD.md` for the full product spec.

## Development

```bash
npm install
npm test           # vitest: notes, registry, orchestrator (mock provider), harness (mock spawn)
npm run typecheck  # tsc --noEmit
npm run build      # emits dist/
```

This repository dogfoods its own pipeline: `.pair/` in the project root documents why OpenPair itself is built the way it is.
