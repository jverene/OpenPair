# Plan Notes — Why this approach

_Agent: Executor. Alternatives considered, tombstones for the rejected, risks accepted._

## [2026-08-16T14:19:46Z] Decisions and rejected alternatives

### Reactive handoff over static phase sequencing

Chosen: every note write is a trigger event; the orchestrator dispatches the next reader immediately.

- **Rejected: human re-trigger between phases.** Reason: idle agents, breaks the pair metaphor — the whole point is the keyboard passing back and forth without the human as project manager. Rejected by: Vision (human).
- **Rejected: `fs.watch` / timers / background processes.** Reason: the orchestrator performs every write, so it already knows exactly when files change; filesystem watching adds failure modes (cross-platform quirks, missed events) for zero benefit. Rejected by: Vision (human).

### OpenCode harness for the software domain

- **Rejected: building a custom file/shell/git tool loop for the software domain.** Reason: the OpenCode harness already solves this. OpenPair's value is the 2-agent coordination and documentation layer, not the coding mechanics. Rejected by: Vision (human).
- Fallback harness implements the identical `execute(task, context) -> Promise<HarnessResult>` interface so the Executor never branches. Preflight (15s smoke test) is mandatory before every real task — a 15-second failure beats a 5-minute mystery.

### Notes written by the orchestrator, content authored by agents

- **Rejected: agents write notes via file tools.** Reason: format drift and missed timestamps are guaranteed at some model quality level; the notes are the product, so their structure cannot be best-effort. The orchestrator owns structure (filenames, ISO timestamps, hashing); agents own the words. Rejected by: Executor, concurred by Vision.

### Content-hash gating in notes.ts

Every agent read hashes the file content, stored by `(agentName, filePath)`. Before any invocation, the orchestrator compares current hashes against last-read hashes; unchanged inputs mean no invocation. Plus: byte-identical agent output twice in a row halts to the human (spin-loop detection), and 3 review cycles is the hard cap.

### Separate plan and execute LLM calls for the Executor

Planning is a cheap, tool-less call; execution is the expensive, tool/harness-heavy call. This gives the Vision agent a review point before tokens burn, and makes REVISE cycles cheaper (re-plan, then re-execute).

### Provider layer on official SDKs

- **Rejected: zero-dependency hand-rolled fetch clients.** Reason: we would own every tool-call wire-format edge case across two APIs; the SDKs are battle-tested and the dependency cost is two packages. Rejected by: Vision (human, chose Approach 1).
- Ollama and custom providers use the OpenAI-compatible `baseURL` path — four provider options, two client implementations.

### Other resolutions

- Plain markdown, no wikilinks (PRD open question: no).
- Strict notes-only agent communication (PRD open question: yes — it is the product's core mechanic; trivial-question latency accepted).
- Provider-level model defaults with user override (PRD open question: resolved).
- Tombstones for rejected alternatives: this file is the proof (PRD open question: yes).
- No eslint/prettier in v0.1 — `tsc --noEmit` is the only gate. Rejected by: Executor. Reason: config churn without correctness benefit at this size; revisit when the repo has multiple contributors.

## Risks accepted

- A model may still fail to produce parseable REVISE/APPROVE verdicts; the orchestrator treats unparseable reviews as REVISE-with-explanation up to the 3-cycle cap, then escalates to the human.
- OpenCode's `--format json` output shape may vary by version; the harness validates parseability during preflight, so version drift fails fast and loudly in `execution.md` rather than mid-task.
- The mock-provider `--mock` mode proves the loop mechanics but not model behavior; real-provider smoke requires user keys and is flagged as optional in verification.

## [2026-08-16T15:40:00Z] Tombstone added during execution

- **Rejected: provider-native tool calling (OpenAI tools / Anthropic tool_use) for the Executor's tool loop.** Reason: native tool-result plumbing differs per provider (tool_call_ids, tool-result message roles) and would have leaked provider specifics into the agent layer; Ollama tool support is also model-dependent. Chosen instead: a prompt-level JSON directive protocol (`ACTION:` / `QUESTION:` / `DONE:` / `READY:`) over a text-only ChatProvider interface — one code path across all four provider options, trivially testable with scripted mocks. Rejected by: Executor, mid-build, when the abstraction started to sprawl. Risk accepted: weaker models may malform directives; mitigated by protocol nudges (2) and the turn cap.
