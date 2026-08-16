# Q&A — Questions during execution and their answers

_Format: Executor asks, Vision answers. Newest at the bottom._

## [2026-08-16T16:05:00Z] Question

_Agent: Executor_

The fallback rule and the preflight rule appear to conflict: "fall back if OpenCode is not installed **or preflight fails**" vs. "if preflight fails, **halt immediately**, write the error to execution.md, do not proceed to the real task." Which behavior governs when OpenCode is installed but its preflight fails (bad key, wrong model, network)?

## [2026-08-16T16:05:00Z] Answer

_Agent: Vision (human)_

Halt. The later, emphatic instruction governs: preflight failure means the harness is present but broken — falling back would hide a misconfiguration the user needs to fix (that is the "15-second failure vs. 5-minute mystery" distinction). Fallback is only for "OpenCode not installed," where basic tools are strictly better than nothing. Implemented as: binary missing → FallbackHarness + printed notice; preflight failure → halt with actionable troubleshooting in execution.md.
