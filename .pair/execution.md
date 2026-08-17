# Execution Log — Building OpenPair v0.1

_Agent: Executor. One entry per milestone, appended as work proceeds._

## [2026-08-16T14:19:46Z] Milestone: PRD amended + dogfood notes written

- Applied the human-supplied "Phase 4: Handoff" text to `V01PRD.md`, replacing "Phase 4: Iterate or Ship".
- Scaffolded `package.json` (bin: openpair, ESM, deps: openai, @anthropic-ai/sdk, commander, prompts, picocolors; dev: typescript, vitest, tsx, @types/node, @types/prompts), `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`.
- Wrote `.pair/intent.md`, `.pair/intentnotes.md`, `.pair/plan.md`, `.pair/plannotes.md` before any source code, per the pipeline.
- No blockers.

## [2026-08-16T15:10:00Z] Milestone: notes + config modules

- `src/notes.ts`: `.pair/` writer — ISO-timestamped appends are the only write path, so timestamps are guaranteed by construction. Content-hash gating lives here: `readFor(agent, file)` records a SHA-256 keyed by `(agentName, filePath)`; `inputsChanged(agent, files)` is the orchestrator's skip check.
- `src/config.ts`: `~/.openpair/config.json` load/save, provider-level default models, env-var API key resolution (environment wins over file).

## [2026-08-16T15:40:00Z] Milestone: provider layer

- `src/providers/`: `types.ts` (text-only `ChatProvider`), `openai.ts` (also Ollama/custom via `baseURL`), `anthropic.ts`, `mock.ts` (scripted provider for tests and `--mock`), `index.ts` (factory).
- Finding (recorded as a tombstone in plannotes.md): switched from provider-native tool calling to a prompt-level JSON directive protocol (`ACTION:`/`QUESTION:`/`DONE:`/`READY:`). Native tool-result plumbing differs per provider and would have leaked into the agent layer; the text-only interface keeps one code path across all four provider options.

## [2026-08-16T16:05:00Z] Milestone: tools + harnesses

- `src/tools/`: `files.ts` (cwd-sandboxed read/write/list), `shell.ts` (60s timeout, output cap), `python.ts` (research), `registry.ts` (domain → capability set per PRD).
- `src/harness/`: `opencode.ts` — spawns `opencode run --auto --format json --dir <cwd>`, mandatory 15s preflight before every real task (300s task timeout), env-only credential pass-through (`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`/`OPENCODE_MODEL`), actionable troubleshooting on failure. `fallback.ts` — same `Harness` interface over basic file/shell tools; the Executor never branches on which harness is active.
- Interpretation call (logged in qa.md): "OpenCode not installed" → fallback with notice; "installed but preflight fails" → halt with troubleshooting, real task not attempted. Based on the human's emphases, preflight failure is a halt condition, not a fallback trigger.

## [2026-08-16T16:50:00Z] Milestone: agents, orchestrator, UI, CLI

- `src/agents/`: `vision.ts` (intent, Q&A answers, APPROVE/REVISE review — unparseable verdicts conservatively treated as REVISE), `executor.ts` (separate plan and execute LLM calls; conversation state kept so a Q&A answer resumes execution), `prompts.ts`, `toolLoop.ts` (shared JSON-directive loop).
- `src/orchestrator.ts`: reactive handoff — after every notes write, the dispatch table triggers the next reader immediately. No polling, no `fs.watch`, no timers, no background processes. Hash-gated invocations, 3-review-cycle hard cap, spin-loop detection (byte-identical output twice → halt to human), 5-round Q&A cap.
- `src/ui.ts`: color-coded `[Vision]` / `[Executor]` lines, phase banners, visible handoffs. `src/cli.ts` + `src/wizard.ts`: `openpair "<goal>"`, first-run wizard, `--reconfigure`, `--mock`.

## [2026-08-16T17:31:00Z] Milestone: tests green, smoke verified

- 26 tests passing across notes, registry, orchestrator (happy path, Q&A round-trip, REVISE→auto-re-execute→APPROVE, spin-loop halt, 3-cycle cap, preflight halt) and harness (preflight outcomes, env pass-through, fallback selection, shared interface). `tsc --noEmit` clean.
- Two test bugs found and fixed during the run (mock scripts matched on the substring "Vision Holder", which also appears in the Executor's system prompt; two tests recreated their script closure per call, resetting counters). No production-code bugs found by the suite beyond the mock-matching one in `mock.ts`, which was the same substring issue.
- Smoke: `npm run build` clean; `node dist/cli.js --help` correct; `--mock` run in a scratch directory completed the full loop with visible handoffs and produced a correctly structured `.pair/` (verified `review.md` APPROVE entry and `execution.md` transcript).
- Not run: real-provider and real-OpenCode smoke (requires the user's API keys and OpenCode install). The OpenCode paths are covered by mocked-spawn tests only.
- `README.md` written (philosophy, install, domains, safety rails, dev commands).

## [2026-08-17T04:59:21Z] Milestone: npm publish — renamed to scoped package

- `npm publish` of `openpair` was rejected by the registry (E403): "Package name too similar to existing package openai" — typo-squatting protection, not a name-availability issue (`npm view openpair` had returned 404).
- Resolution (npm's own suggestion): renamed to the scoped package `@jverene/openpair`, published with `--access=public`. Bin name stays `openpair`; usage becomes `npx @jverene/openpair`.
- Updated `package.json` name, README install line, and the PRD's first-run snippet to match. Tombstone-worthy lesson: a 404 on `npm view` does not mean a name is publishable.
