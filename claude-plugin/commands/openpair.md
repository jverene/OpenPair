---
description: Run the OpenPair two-agent loop (Vision plans and reviews, Executor builds) on a goal
argument-hint: <goal> [domain:research|writing|software]
---

Run OpenPair on this goal: $ARGUMENTS

Steps:
1. Decide the domain: default to `research` for analysis/report tasks, `writing` for documents, `software` only when code must be built in this working directory.
2. Run: `npx @jverene/openpair "<goal>"` with the `domain` set in `~/.openpair/config.json` (or via `openpair --reconfigure`). If it is not configured, run the setup wizard first and tell the user what it asked.
3. When it finishes, read `.pair/review.md` and the `.pair/` notes, then summarize for the user:
   - the review verdict and the Vision agent's reasoning
   - what artifacts were produced (verify against the artifact manifest in `.pair/execution.md` — files must actually exist)
   - anything the pair flagged as unfinished or blocked
4. If the loop ended in `needs_human` or `halted`, present the blocker and ask the user how to redirect, then re-run with their feedback as the new goal.
