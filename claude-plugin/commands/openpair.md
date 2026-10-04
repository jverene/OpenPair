---
description: Run OpenPair on a goal — or get an independent APPROVE/REVISE review of work already done
argument-hint: <goal> [domain:research|writing|software] | review <goal>
---

If the arguments start with `review`, the work already exists and only needs a verdict:

1. Call the `pair_review` MCP tool with everything after `review` as the `goal` (and an optional `focus` concern).
2. Report the verdict — APPROVE or REVISE — and the findings. On REVISE, list the concrete gaps the reviewer named and offer to fix them; the full review is in `.pair/review.md`.

Otherwise, delegate the goal to the pair and get back reviewed, verified work:

1. Decide the domain: default to `research` for analysis/report tasks, `writing` for documents, `software` only when code must be built in this working directory.
2. Call the `pair_run` MCP tool with `goal` (plus `domain` to override the configured default). If the pair_* tools are not available, fall back to `npx @jverene/openpair "<goal>"`; if that reports OpenPair is unconfigured, run the setup wizard first and tell the user what it asked.
3. When it finishes, read `.pair/review.md` and the `.pair/` notes, then summarize for the user:
   - the review verdict and the Vision agent's reasoning
   - what artifacts were produced (verify against the artifact manifest in `.pair/execution.md` — files must actually exist)
   - anything the pair flagged as unfinished or blocked
4. If the loop ended in `needs_human` or `halted`, present the blocker and ask the user how to redirect, then re-run with their feedback as the new goal.
