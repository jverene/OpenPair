# Intent — Build OpenPair v0.1

_Agent: Vision (human-directed). Written before any source code, per the pipeline this project itself implements._

## [2026-08-16T14:19:46Z] Goal

Implement OpenPair v0.1 exactly as specified in `V01PRD.md` (as amended with "Phase 4: Handoff"): a two-agent CLI, runnable as `npx openpair "<goal>"`, in which a Vision Holder (Agent A) and an Executor (Agent B) collaborate through timestamped markdown notes in `.pair/` to produce working artifacts plus a complete decision record.

## Constraints

- Two hardcoded agents. No custom agent definitions, no third agent, no configurable system prompts.
- Agents communicate **only** through `.pair/` notes files. No side channels.
- Reactive handoff: the orchestrator triggers the next agent immediately after each note write. No polling, no `fs.watch`, no timers, no background processes.
- Sequential, not parallel. CLI is the only interface.
- Software domain: Executor uses the OpenCode headless harness (with mandatory preflight and a same-interface fallback). Research: file/shell/python tools. Writing: file tools only.
- No browser automation, no computer use, no cost tracking, no budget limits.
- Notes are plain markdown with ISO timestamps. No wikilinks.

## Success criteria

1. `npm run typecheck` clean, `npm test` green (notes, registry, orchestrator with mock provider covering: happy path, Q&A round-trip, REVISE→auto-re-execute→APPROVE, hash-gating skip, spin-loop halt, 3-review-cycle cap; harness preflight/fallback with mocked spawn).
2. `npx openpair "<goal>"` runs: first-run wizard (provider + domain), then the full loop with color-coded, visible handoffs.
3. OpenCode harness: preflight before every real task; halt with actionable troubleshooting in `execution.md` on preflight failure; env-only credential pass-through; fallback harness exposes the identical `execute(task, context) -> Promise<HarnessResult>` interface.
4. Token safety: content-hash gating keyed by `(agentName, filePath)`, 3-review-cycle hard cap, spin-loop detection.
5. This `.pair/` directory exists and documents the build of OpenPair itself — the dogfood proof.

## Context

The human supplied the PRD, directed the reactive-handoff and OpenCode-harness revisions, and approved the implementation plan after two review rounds. Their explicit emphases are incorporated: event-driven dispatch after every `notes.write()`, mandatory preflight, hash gating in `notes.ts`, separate plan/execute LLM calls for the Executor, and per-milestone `execution.md` entries.
