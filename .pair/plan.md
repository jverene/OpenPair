# Plan — How OpenPair v0.1 will be built

_Agent: Executor (Kimi Code, human-supervised). Condensed from the approved implementation plan._

## [2026-08-16T14:19:46Z] Approach

TypeScript + Node.js (>= 18), ESM, `npx`-runnable via a `bin` entry. Provider layer on official SDKs (`openai`, `@anthropic-ai/sdk`); Ollama and custom providers ride the OpenAI-compatible `baseURL` path, giving four provider options with two client implementations.

### Module map

- `src/cli.ts` — entry: parse goal, run wizard if unconfigured, start the loop. `--mock` runs the loop against a mock provider for keyless verification.
- `src/wizard.ts` — first-run setup: provider (Ollama/OpenAI/Anthropic/custom), credentials/baseURL/model, domain (software/research/writing). Saves `~/.openpair/config.json`.
- `src/config.ts` — config load/save; API keys from env.
- `src/notes.ts` — `.pair/` writer: ISO-timestamped appends; content hashing keyed by `(agentName, filePath)` for handoff gating.
- `src/orchestrator.ts` — reactive handoff: after every notes write, consult the dispatch table and invoke the next agent if their inputs changed. 3-review-cycle cap; spin-loop detection.
- `src/agents/` — `vision.ts` (intent, Q&A, review; never touches code), `executor.ts` (plan call, then separate execute call; never sets scope), `prompts.ts` (per role × domain).
- `src/providers/` — `types.ts` (ChatProvider interface), `openai.ts`, `anthropic.ts`.
- `src/harness/` — `opencode.ts` (spawn `opencode run --auto --format json --dir <cwd>`, 15s preflight, env credential pass-through, 300s task timeout) and `fallback.ts` (basic file/shell). Both implement `execute(task, context) -> Promise<HarnessResult>`; the Executor never branches on which is active.
- `src/tools/` — `registry.ts` (software: `[invokeOpenCode]` or fallback; research: `[file, shell, python]`; writing: `[file]`), `files.ts`, `shell.ts`, `python.ts`.
- `src/ui.ts` — color-coded agent names, phase banners, visible handoff lines.

### Build order

1. PRD Phase 4 edit (done).
2. Scaffold + install.
3. This `.pair/` note set.
4. notes + config + tests.
5. Providers.
6. Tools + harnesses.
7. Agents, orchestrator, ui.
8. cli + wizard.
9. Full test suite (mock provider): happy path, Q&A round-trip, REVISE→auto-re-execute→APPROVE, hash-gating skip, spin-loop halt, 3-cycle cap; harness preflight/fallback with mocked spawn.
10. README.
11. Final execution.md entries + review.md.

### Verification

`npm run typecheck` clean; `npm test` green; `node dist/cli.js --help` and `--mock` dry-run smoke.
