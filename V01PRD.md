OpenPair PRD
OpenPair is a two-agent system that mirrors how the best engineering teams actually work. Not a swarm of twenty agents playing make-believe software company. Not a single agent that codes in a black box. Two agents. One has the vision. One executes. They review each other's work. And every decision — every yes, every no, every dead end — gets written down so anyone can pick up the project six months later and understand why things are the way they are.
This is pair programming plus startup speed plus the documentation hygiene of a mature engineering org. The best of all three worlds.
The Two Agents
Agent A: The Vision Holder
This agent owns the "why." It writes the goal, the constraints, the definition of done. It asks the hard questions. When Agent B produces something, Agent A reviews it against the original intent and says whether it actually solves the problem or just looks like it does. If Agent B is blocked or confused, Agent A is who they ask. The Vision Holder never writes code. They write intent.
Agent B: The Executor
This agent owns the "how." They read the vision, pick the right tools, build the thing, and report back what they found. They document their tradeoffs as they go. When something in the vision is ambiguous, they don't guess — they ask Agent A. The Executor never decides what to build. They decide how to build it.
This is exactly how a startup works when it is running well. One person has the product vision. One person ships it. They argue. They align. They ship better because of the argument.
The Loop
The two agents do not chat with each other in a side channel. They communicate through shared notes files that live in the project directory. This is intentional. It forces every piece of reasoning to be written down and timestamped. It also means a human can open any note at any time and see exactly what was decided and why.
Phase 1: Intent
Agent A reads the user's prompt and writes .pair/intent.md. This file contains the goal, the constraints, the success criteria, and any context the user provided. Agent A also writes .pair/intentnotes.md which captures the reasoning behind the intent: why this scope and not a larger one, what was explicitly excluded, what assumptions are being made.
Phase 2: Execution
Agent B reads intent.md and intentnotes.md. They write .pair/plan.md describing how they will approach the problem, and .pair/plannotes.md documenting why they chose this approach over alternatives. Then they execute. As they work, they write .pair/execution.md with findings, blockers, and results. If they hit ambiguity, they write a question to .pair/qa.md and stop. Agent A reads the question, answers it in qa.md, and Agent B continues.
Phase 3: Review
Agent A reads the execution output and the artifacts. They write .pair/review.md checking the work against the original intent. Did it solve the right problem? Are there edge cases that were missed? Is the approach sound? This is not a code review. It is an intent review. Agent A is asking: "Does this actually do what we set out to do?"
Phase 4: Handoff
In real pair programming, when you finish your work, you don't just walk away. You turn to your partner and say: "I'm done with this part. Here's what I did, and here's what needs to happen next." That handoff is what keeps the pair moving.
OpenPair automates this etiquette. When an agent finishes writing their notes, the orchestrator immediately triggers the next agent to read those notes and continue. Agent B finishes execution.md and the system tells Agent A: "Execution is done, review it." Agent A finishes review.md with REVISE and the system tells Agent B: "Review found gaps, fix them." The documentation itself is the handoff signal — the "what needs to happen next" is already written in the notes.
The human is only interrupted at the natural break: when the pair has done their work and needs approval to ship. Until then, the agents keep passing the keyboard back and forth, exactly like two engineers at one workstation.
Safety: The orchestrator tracks whether an agent's input files have actually changed since they last read them. If nothing changed, the agent is not re-invoked. This prevents wasted tokens. After three review cycles, the loop stops for human judgment.
The Notes
The notes are the product. Not the code. Not the figure. The notes. This is the core insight.
Every engineering organization that scales eventually learns that code is cheap and context is expensive. A new engineer can read the code and understand what it does. They cannot read the code and understand why it does it that way, what was tried and rejected, what tradeoff was accepted. OpenPair solves this by making the documentation mandatory and structured.
.pair/intent.md — What we are trying to do.
.pair/intentnotes.md — Why this scope, what was excluded, what assumptions we are making.
.pair/plan.md — How we will approach it.
.pair/plannotes.md — Why this approach, what alternatives were considered and rejected, what risks we are accepting.
.pair/execution.md — What was actually done, what was found, what blockers appeared.
.pair/qa.md — Questions that came up during execution and the answers.
.pair/review.md — Does the execution match the intent? What gaps remain?
These files are plain markdown. They are human-readable. They are git-tracked. They are the institutional memory of the project. If someone joins the project in six months and asks "Why did we use this database?" the answer is in plannotes.md. If they ask "Why didn't we support that feature?" the answer is in intentnotes.md. If they ask "What was tried before this approach?" the answer is in plannotes.md under rejected alternatives.
This is how Google writes design docs. This is how Amazon writes six-pagers. This is the hygiene that makes complex projects legible.
Artifacts
The agents produce two things: the notes and the artifacts.
Artifacts are the actual output of the project. In the software domain, this is code, tests, and a README. In the research domain, this is experiment scripts, results, and figures. In the writing domain, this is drafts and outlines. The artifacts live in the project root or in an artifacts/ directory, depending on the domain.
The relationship between notes and artifacts is strict: the notes explain the artifacts. You do not read the artifacts to understand the project. You read the notes. The artifacts are just the proof that the notes were followed.
First Run Experience
The user types one command:
plain
npx openpair "Build a Stripe checkout with discount codes"
A setup wizard appears asking for the LLM provider (Ollama, OpenAI, Anthropic, or custom) and the domain (software, research, writing, or data). The user selects their preferences. Then the agents begin.
The terminal shows live progress. Agent names are color-coded. The user sees the phase transitions: Intent, Plan, Execution, Review. When Agent B has a question, the terminal pauses and shows the question. Agent A answers. The loop continues.
When the loop completes, the user has a directory full of working artifacts and a .pair/ directory full of notes explaining every decision. The user can read the notes, approve the work, or ask the agents to iterate.
What Is In v0.1
The first version ships with three domains: software, research, and writing.
For software, the Executor has access to file operations, shell commands, and git. For research, the Executor has access to file operations, shell commands, and Python execution. For writing, the Executor has access to file operations and markdown editing.
The Vision Holder and Executor are hardcoded as two agents. There is no configuration for adding more agents. The loop is sequential, not parallel. The notes format is plain markdown with timestamps, not wikilinks.
The CLI is the only interface. There is no web dashboard. There is no browser automation. These come later.
What Is Not In v0.1
Computer use and browser automation are not in v0.1. The Executor cannot open a browser, rent a GPU, or interact with a web UI. They work with files and commands only.
Parallel execution is not in v0.1. The agents take turns. Agent A writes. Agent B reads and writes. Agent A reviews. There is no simultaneous work.
Custom agent definitions are not in v0.1. You cannot add a third agent or change the system prompts. The two-agent pattern is the product.
Cost tracking and budget limits are not in v0.1. The user manages their own API keys and their own spend.
Open Questions
Should the notes use wikilinks for cross-referencing between intent, plan, and execution? This would make them Obsidian-compatible but adds complexity.
Should there be a mode where Agent A and Agent B can message each other directly for urgent blocks, or should all communication be forced through the notes files? The strict notes-only approach ensures documentation but may slow down trivial clarifications.
What is the default LLM for each domain? Claude 3.5 Sonnet is strong for software. GPT-4o is strong for research. The user should be able to override, but sensible defaults matter.
Should rejected alternatives in plannotes.md include the reason for rejection and the person who rejected them? In this case, the "person" is Agent A, but the principle is the same: every dead end needs a tombstone.
The Core Principle
The highest-functioning engineering teams do not produce more code. They produce more context. A senior engineer is not someone who types faster. It is someone who makes the right decision and documents why so the next person does not have to relearn it.
OpenPair automates that habit. The agents argue. The agents document. The human decides. The project survives.
