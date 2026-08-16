/**
 * agents/prompts.ts — system prompts per role × domain, and the task
 * prompt builders. Hardcoded by design: custom agent definitions are
 * explicitly out of v0.1 scope (see V01PRD.md "What Is Not In v0.1").
 */
import type { Domain } from "../config.js";
import { renderToolDocs } from "./toolLoop.js";
import type { Tool } from "../tools/registry.js";

export const VISION_SYSTEM = `You are the Vision Holder in a two-agent pair programming system.
You own the "why": goals, constraints, definition of done. You NEVER write code — you write intent.
You communicate only through structured notes content; your words are written to markdown files by the orchestrator.

Rules:
- Be specific about scope: what is in, what is out, what done looks like.
- When reviewing execution, ask: "Does this actually do what we set out to do?" — this is an intent review, not a code review.
- When the Executor asks a question, answer decisively and briefly.`;

export const EXECUTOR_SYSTEM_BASE = `You are the Executor in a two-agent pair programming system.
You own the "how": read the vision, pick the right tools, build the thing, report what you found.
You NEVER decide what to build — when the intent is ambiguous, ask; do not guess.
Document tradeoffs as you go: every rejected alternative deserves a tombstone with the reason.`;

export function executorSystem(domain: Domain, tools: Tool[], usesHarness: boolean): string {
  if (usesHarness) {
    return `${EXECUTOR_SYSTEM_BASE}

You execute by delegating coding tasks to a headless coding harness. You do not call file or shell tools yourself.
Before delegating, check the plan for ambiguity: if anything is unclear, reply with:
  QUESTION: <your question for the Vision Holder>
Otherwise reply with:
  READY: <the exact task briefing for the harness>`;
  }
  return `${EXECUTOR_SYSTEM_BASE}

You work autonomously inside the working directory using tools. Reply with exactly one directive on the first line:
  ACTION: {"tool": "<name>", "args": {...}}   — call a tool; you will receive RESULT: <output>
  QUESTION: <question for the Vision Holder>   — when the intent is ambiguous; then stop
  DONE: <summary of what was done, findings, blockers>   — when finished
Available tools:
${renderToolDocs(tools)}`;
}

export function intentPrompt(goal: string): string {
  return `The human's goal:

${goal}

Write the project intent. Reply in exactly this format:

INTENT:
<goal, constraints, success criteria, and context — what we are trying to do>

INTENT NOTES:
<why this scope and not a larger one, what is explicitly excluded, what assumptions you are making>`;
}

export function planPrompt(intent: string, intentNotes: string, reviewFeedback?: string): string {
  const revision = reviewFeedback
    ? `\n\nThe Vision Holder reviewed your previous execution and found gaps. Address every one:\n${reviewFeedback}`
    : "";
  return `Write your plan for this intent. Do not execute yet — plan only.

<intent>
${intent}
</intent>

<intent-notes>
${intentNotes}
</intent-notes>${revision}

Reply in exactly this format:

PLAN:
<numbered steps describing how you will approach the problem>

PLAN NOTES:
<why this approach, what alternatives you considered and rejected (with reasons — every dead end gets a tombstone), what risks you are accepting>`;
}

export function executePrompt(plan: string, intent: string): string {
  return `Execute this plan now.

<intent>
${intent}
</intent>

<plan>
${plan}
</plan>`;
}

export function reviewPrompt(intent: string, plan: string, execution: string): string {
  return `Review the execution against the original intent. This is an intent review, not a code review: did it solve the right problem? Are there missed edge cases? Is the approach sound?

<intent>
${intent}
</intent>

<plan>
${plan}
</plan>

<execution>
${execution}
</execution>

Reply with the verdict on the first line — exactly APPROVE or REVISE — followed by your reasoning. If REVISE, list each gap concretely so the Executor can address it.`;
}

export function answerPrompt(intent: string, question: string): string {
  return `The Executor is blocked on a question about the intent. Answer decisively and briefly.

<intent>
${intent}
</intent>

<question>
${question}
</question>`;
}
