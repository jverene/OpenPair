# OpenPair Marketing Plan — "Verdicts, not vibes"

_Planning doc for the post-MCP-pivot go-to-market. Product state as of 2026-10-06: v0.2.0 ships `pair_review` / `pair_run` / `pair_preflight` as a stdio MCP server, auto-registers into Claude Code, Cursor, Codex CLI, Gemini CLI, and ZCode, and has a real Claude Code plugin marketplace manifest. This plan is not committed dogfood; it is the playbook._

---

## 1. Executive summary

The pivot changed what we sell. Until now, OpenPair marketed a **process** (a two-agent loop, note files, handoffs) to an audience that had to understand it before wanting it. The MCP pivot lets us sell an **end product**: an independent APPROVE/REVISE verdict on work that already exists, grounded in an artifact manifest of what is actually on disk — plus, for whole tasks, a reviewed pair that returns verified artifacts.

Marketing consequence in one sentence: **we stop competing in the crowded "agent framework / code review" categories and create the "verification layer for agentic coding" category, distributed through the channels MCP tools already flow through (official registry, directories, plugin marketplaces), sold with a single visceral demo: watching a coding agent get caught claiming work that doesn't exist.**

Budget: $0. Currency: developer attention. Timeline: 8 weeks, launch on **Tuesday 2026-10-20** (HN Show posts perform best Tue–Thu).

---

## 2. What changed, strategically

| Dimension | Before (CLI product) | After (MCP product) |
|---|---|---|
| What we sell | A process: two agents, phases, note files | An outcome: a verdict on work that already exists |
| Who installs it | People who want to run a different workflow | People already vibecoding — OpenPair joins their existing workflow |
| Concept load on the buyer | High (understand the loop first) | Near zero ("add a reviewer to your CLI") |
| Distribution | npm + word of mouth | npm + official MCP Registry + 5 directories + Claude Code plugin marketplace + one-command setup wizard |
| Competitive frame | Agent frameworks (crowded, blurry) | Code-review tools (crowded) **→ we reframe to verification** (open) |
| The demo | Hard (whole loop, minutes) | 30 seconds: agent claims done → `pair_review` → REVISE, file missing |
| End product to show | Notes/dashboard-ish artifacts (which we explicitly do NOT want to lead with) | The verdict line + the catch |

The "sell the end product, not the process or another dashboard" rule, operationalized for every asset we make:

- **Lead with the verdict** (`REVISE — deliverable X claimed but absent from manifest`), never with architecture.
- **The `.pair/` notes are the residue, not the hook.** They appear in messaging as "a paper trail you didn't have to write," never as the headline feature.
- **No screenshots of files or notes as hero imagery.** Hero imagery is always a terminal verdict.

---

## 3. Positioning

### 3.1 The wedge: completion hallucination

Every vibecoder knows the moment: the agent says "Done! Tests pass, file saved as `auth.py`" — and it isn't, or it is but it's wrong, or it did something else entirely. Platform vendors review **diffs and PRs**; nobody verifies **the agent's claim against the user's actual goal and the actual disk**. That gap is OpenPair's wedge. The pain is visceral, universal, and currently solved by "re-read everything yourself and hope."

### 3.2 Positioning statement

> For developers who build with AI coding CLIs, **OpenPair** is a verification layer that reviews your agent's work against your goal and against reality — returning an APPROVE or REVISE verdict grounded in an artifact manifest of what actually exists on disk. Unlike code-review tools (including Claude Code's built-in review), it doesn't read diffs for correctness — it checks whether the work **accomplishes the intent and can prove its deliverables exist**. Unlike SaaS reviewers, it runs locally, uses your own API key, keeps no telemetry, and leaves a durable decision trail in your repo.

Shorter: **"Your agent says it's done. OpenPair makes it prove it."**

### 3.3 Category naming (important — do not say "code review")

Anthropic ships multi-agent code review natively in Claude Code; CodeRabbit/Greptile/Ellipsis own PR review SaaS; `code-review-mcp` and siblings own the generic "second opinion" MCP niche. Calling OpenPair a code reviewer puts it in the most crowded shelf in the store, judged on criteria it doesn't win (static correctness of diffs).

Own this language instead: **verification layer for agentic coding**, **intent review**, **completion verification**, **phantom-claim detection**, **proof of work for AI agents**. Every asset, directory tag, and headline uses the verification vocabulary. "Review" appears only in the tool name `pair_review` and inside comparisons.

### 3.4 Differentiation matrix (memorize this; it becomes landing-page table)

| | Platform-native review (Claude Code) | Review SaaS (CodeRabbit et al.) | Generic review MCPs | **OpenPair** |
|---|---|---|---|---|
| What it judges | Diff/PR correctness | Diff/PR correctness | Diff quality | **Intent vs. reality: did the work accomplish the goal** |
| Ground truth | The diff | The diff | The diff | **Artifact manifest — what actually exists on disk** |
| Catches "agent says done but isn't" | No | No | No | **Yes — automatic REVISE** |
| Scope discipline (bloat check) | Partial | Partial | Rare | **First-class REVISE condition** |
| Where it runs | Claude Code only | Cloud | In-CLI | **In-CLI (5 CLIs), local** |
| Cost/privacy | Bundle | Per-seat SaaS | BYO key | **BYO key, no telemetry, MIT** |
| Leaves a decision trail | No | No | No | **`.pair/` notes in-repo** |

### 3.5 The independence caveat (integrity rule)

`pair_review` is architecturally independent (separate context, manifest ground truth, conservative verdict protocol) but runs on **whatever provider the user configured** — by default possibly the same vendor as their coding CLI. Marketing must never claim "a different model reviews your code." Instead, turn it into a tip and a feature: *"Point OpenPair at a different provider than your CLI (e.g., GPT reviews Claude's work) for cross-model verification."* This is honest, differentiating, and drives the setup wizard's provider choice.

---

## 4. Personas & jobs-to-be-done

**P1 — The Vibecoder (primary).** Uses Claude Code or Cursor daily, ships side projects, has been burned by confident-wrong agents. JTBD: "When my agent says it finished, I want to know it actually did — before I find out in production — so I can trust the work or send it back." Channels: X/Twitter, r/ClaudeAI, HN, directories. Message: verdicts not vibes.

**P2 — The Skeptical Senior (secondary, highest passion).** Reviews AI-generated PRs from juniors or themselves; hates unexplained magic. JTBD: "When AI writes code, I want the reasoning and the rejected alternatives written down, so the codebase stays legible in six months." Message: the paper trail — "documentation hygiene you don't have to ask for."

**P3 — The Solo-Founder-in-a-Hurry.** Wants features, not philosophy. JTBD: "When I hand off a whole task, I want it built AND verified in one step, so I only think about what, never how." Message: `pair_run` — delegate, get back reviewed artifacts.

P1 is the launch audience; P2 supplies the stars and the essays; P3 converts on the demo of `pair_run`.

---

## 5. Messaging & copy bank

### 5.1 Ladder

- **10 words:** Your agent says it's done. OpenPair makes it prove it.
- **30 seconds:** OpenPair is an MCP server that adds an independent reviewer to your coding CLI. When your agent finishes, `pair_review` checks the work against your goal and against an artifact manifest of what actually exists on disk. A claimed file that isn't there is an automatic REVISE. It reviews the uncommitted diff, flags scope bloat, and writes the full review to `.pair/review.md`. Local, bring-your-own-key, no telemetry.
- **3 minutes:** the demo script in §6.1.

### 5.2 Pillars → proof points

1. **Verdicts, not vibes.** APPROVE/REVISE, first line, every time. Unparseable = REVISE (conservative by design).
2. **Grounded in reality.** The manifest is generated from disk, not from the agent's claims; phantom deliverables cannot pass.
3. **Reviews the intent, not just the diff.** Bloat (doing MORE than asked) is a REVISE condition, same as gaps.
4. **Zero lock-in.** MIT, local, BYO key, stdio MCP, five CLIs, no telemetry, no dashboard.
5. **A paper trail you didn't have to write.** `.pair/` answers "why" six months later.

### 5.3 Copy bank (use verbatim)

**Directory description (~240 chars, Glama/Smithery/registry):**
> Independent APPROVE/REVISE verdict on your AI agent's work — grounded in an artifact manifest of what actually exists on disk. Catches phantom deliverables automatically. Claude Code, Cursor, Codex, Gemini CLI, ZCode. Local, BYO key, no telemetry.

**npm/README tagline:** "Your agent says it's done. OpenPair makes it prove it."

**X thread (5 posts, launch day):**
1. Your AI agent's most dangerous sentence is "Done! ✅" — saved the file, tests pass, all working. Sometimes true. Sometimes a file that doesn't exist. You re-read everything yourself to find out. 🧵
2. OpenPair is an MCP server that adds an independent reviewer to your CLI. One call: pair_review(goal). It builds a manifest of what's actually on disk and reviews your agent's work against YOUR goal.
3. The rule that matters: a deliverable the agent claims that isn't in the manifest is an automatic REVISE. Not a judgment call. The reviewer literally cannot approve phantom work.
4. It also reviews the uncommitted diff, flags when your agent did MORE than you asked (bloat is a verdict too), and writes everything to .pair/review.md — a paper trail you didn't have to write.
5. MIT, local, bring-your-own-key, no telemetry. Works in Claude Code, Cursor, Codex, Gemini CLI, ZCode. npx @jverene/openpair → try it on your agent's last "Done!". Link + demo GIF.

**Show HN title options (pick 1):**
- "Show HN: OpenPair – MCP server that verifies your AI agent actually did the work" ✅ (plain, descriptive, states the outcome)
- "Show HN: OpenPair – Your agent says it's done. This makes it prove it."
- Avoid: anything with "two-agent", "orchestrator", "pair programming" (process words).

**Reddit r/ClaudeAI post title:** "I got tired of Claude saying 'Done' when it wasn't — so I built an MCP that verifies the work against what's on disk"

### 5.4 Vocabulary rules

| Say | Never say (to buyers) |
|---|---|
| verdict, verify, prove, catch, phantom, deliverable, on disk, ground truth | loop, orchestrator, harness, handoff, yield boundary, two-agent (in headlines) |
| independent reviewer | second Claude / another agent (implies redundancy) |
| paper trail / decision trail | documentation system, knowledge base (dashboard-adjacent) |

---

## 6. Assets to build (Week 0–1)

### 6.1 THE demo (single most important asset)

Script a reproducible phantom-claim catch, record the terminal (VHS by charmbracelet or asciinema → GIF/MP4 < 15s for hero; 60–90s version for the thread):

1. `claude "add input validation to checkout.ts and write TESTS.md with the test plan"` (or a staged repo where the agent's claimed `TESTS.md` was never written).
2. Agent replies confidently: done, saved TESTS.md.
3. `pair_review(goal="add input validation to checkout.ts and write TESTS.md with the test plan")` via `/openpair review ...`.
4. Output: `verdict: REVISE` — "TESTS.md is claimed but absent from the artifact manifest."
5. Fix, re-run → `verdict: APPROVE`.

Two recording variants: (a) real Claude Code session (credibility), (b) `openpair --mock` scripted run (deterministic, no keys, reproducible forever — also our CI-adjacent proof). The mock variant doubles as the fallback if the live model won't misbehave on cue.

### 6.2 Landing page (`openpair.dev` or GitHub Pages first)

Sections, in order:
1. **Hero:** headline "Your agent says it's done. OpenPair makes it prove it." + subhead ("An independent reviewer for your coding CLI. Verdicts grounded in what's actually on disk.") + install command + the 15s GIF.
2. **The moment everyone knows:** three-line story of the confident-wrong agent.
3. **How it works:** 3 steps — `npx @jverene/openpair` (wizard registers your CLIs) → vibe as usual → `/openpair review <goal>` or the `pair_review` tool.
4. **Proof:** the phantom-catch demo, annotated.
5. **pair_run:** "Hand off the whole task" — one paragraph + returned-verdict screenshot.
6. **The paper trail:** one paragraph, screenshot of `.pair/review.md` as *evidence*, not as the product.
7. **Comparison table** (§3.4).
8. **FAQ** (§10 objections, answered).
9. **Footer:** MIT · no telemetry · BYO key · GitHub.

CTA everywhere: one copyable line — `npx @jverene/openpair`.

### 6.3 Repo hygiene (these ARE marketing surfaces)

- GitHub topics: `mcp`, `mcp-server`, `claude-code`, `cursor`, `codex`, `gemini-cli`, `ai-agents`, `verification`, `code-review`, `developer-tools`.
- Badges: npm version, npm downloads, CI (add a GitHub Actions workflow running typecheck+test), license MIT.
- Pin a GitHub discussion "Show your REVISE" — users post their best phantom-claim catches (UGC flywheel).
- `server.json` + docs/registry metadata (§7.1).

---

## 7. Distribution (ranked; do in this order)

### 7.1 Official MCP Registry — registry.modelcontextprotocol.io (do FIRST)

PulseMCP and others ingest from it; it is the root of the directory tree. Ship a `server.json` at the repo root (or `.well-known/`) per the registry spec: name `openpair`, the npm package as the stdio command, description from §5.3, repository URL, tags. Verify the published package version on npm is current first.

### 7.2 Directories (≈30 min total, per 2026-era tooling writeups)

| Directory | How | Notes |
|---|---|---|
| [Glama](https://glama.ai) | Submit/claim listing | ~56k servers; security/license ratings — our MIT + no-telemetry + local-only story scores well here |
| [Smithery](https://smithery.ai) | CLI/GitHub submission | Distributes stdio servers; acquired by Arcade (Aug 2026) but still community-driven |
| [PulseMCP](https://pulsemcp.com) | Ingests official registry (§7.1) | No separate submit; email fallback exists |
| mcp.so, [mcpmarket.com](https://mcpmarket.com), [mcpservers.org](https://mcpservers.org) | Quick submits | Long-tail; also host our category page |
| `awesome-mcp-servers` (punkpeye) | PR | High-traffic curated list; PR title: "Add openpair — agent-work verification (intent review, phantom-claim detection)" |

### 7.3 Claude Code plugin marketplace (already live in-repo)

`claude plugin marketplace add jverene/OpenPair` works off `.claude-plugin/marketplace.json` (shipped this week). Mention in README + thread; it's the zero-config path for the biggest CLI audience, and `/openpair review` is discoverable in the `/` menu.

### 7.4 Launch-day earned channels (Tue 2026-10-20)

1. **Show HN** (morning PT). Reply to every comment within 2h; lead replies with the demo GIF. Have the skeptic-answers (§10) ready.
2. **X thread** (§5.3) ~1h after HN post; pin to profile.
3. **r/ClaudeAI + r/ChatGPTCoding** (check rules: build-share flair, no pure promo; lead with the burn story, not the link).
4. **r/localLLaMA / r/mcp** if traction warrants (BYO-key + Ollama support is the hook there).

### 7.5 Content (Weeks 2–8, one piece/week)

1. Dev.to / blog: "I made my coding agent prove its work" — build log + demo. Evergreen SEO: title targets "verify AI agent work".
2. "The phantom-claim benchmark": run `pair_review` on 10 archived agent sessions (ours + volunteered), publish catch stats. This is category-defining content only we can produce — it makes the problem measurable.
3. "Cross-model verification: make GPT grade Claude" — the honest-independence angle (§3.5), doubles as Ollama/local content.
4. "What `.pair/` answers six months later" — P2 essay on the paper trail.
5. YouTube/shorts: 60s screen recording of the catch (search: "claude code verify work").

SEO keyword set (weave into landing + content): verify AI agent work · AI code verification · claude code review mcp · agent hallucination check · vibe coding review · mcp server code verification.

---

## 8. Calendar

**Week 0 (Oct 6–10) — Foundation.** server.json + registry publish; directory submissions (§7.2); GitHub topics/badges/CI; record demo (both variants); landing page; copy bank sign-off; npm version bump to 0.3.0 (pair_review is the headline feature; it deserves a version).
**Week 1 (Oct 13–17) — Soft launch.** awesome-mcp-servers PR merges; directories index; landing live; share demo in 2–3 small communities (Discords, r/mcp) for feedback; fix onboarding paper cuts the wizard exposes; dry-run the HN thread with 3 friendly devs.
**Week 2 (Oct 20–24) — Launch.** Tue: Show HN + X thread + Reddit. Wed–Fri: reply-loop duty, ship fixes same-day, retweet best REVISE screenshots.
**Weeks 3–4 — Capitalize.** Content pieces 1–2; "Show your REVISE" discussion push; directory ratings follow-ups; case-study DMs to early users.
**Weeks 5–8 — Compound.** Content 3–5; the benchmark piece; v0.4 (async runs + `pair_resume` — also the "what's next" line in launch threads); evaluate paid experiments (likely skip; $0 discipline).

---

## 9. Metrics

- **North star:** weekly configured installs (proxy: npm-stat downloads of distinct versions; setup completions can't be tracked — no telemetry, and we say so proudly).
- **Activity proxies:** GitHub stars/clones/forks, `Show your REVISE` posts, directory click-outs (UTM on landing links from directories where allowed).
- **Funnel health:** npm page → repo visit ratio (README renders on npm — it must sell there), repo → star conversion (landing/README quality), star → npx (install friction; watch wizard abandonment complaints).
- **Review cadence:** weekly 30-min metrics pass; kill/iterate rule — any channel with <1% of traffic after 4 weeks gets dropped.
- HN launch success bar (be honest): 30+ points and a substantive comment thread = iterate; 100+ = pour time into reply-loop and content.

---

## 10. Objections & answers (FAQ + launch-thread replies)

- **"Why not just ask Claude to review its own work?"** Same context, same incentives, same blind spots — and nothing forces it to check the disk. `pair_review`'s verdict protocol is conservative by construction (unparseable = REVISE) and its ground truth is a manifest built from the filesystem, not from the agent's claims. Cross-model setup makes the independence even sharper.
- **"Doesn't Claude Code already do code review?"** It reviews diffs for correctness. OpenPair reviews the *work* against the *goal*: did the agent do what you asked, all of it, nothing more, and can it prove the deliverables exist? Different question — the one vibecoders actually lose sleep over.
- **"Another MCP server slowing my context."** One server, three tools, stdio, lazy-started by your CLI. `pair_review` is one model call.
- **"Where does my code go?"** Nowhere. Local process, your key, your provider endpoint, no telemetry, MIT. (Glama's security rating exists precisely for this question.)
- **"Is this a dashboard/SaaS?"** No dashboard, no seat pricing, no cloud. A verdict in your terminal and markdown notes in your repo.
- **"What if Anthropic builds intent verification?"** Platform review stays diff-shaped and Claude-only; OpenPair's verdict layer is cross-CLI, cross-model, manifest-grounded, and leaves an in-repo trail. If the platform commoditizes diff review further, that funnels searches toward verification — the category we're naming.

---

## 11. Risks

1. **Category confusion** ("isn't this code review?") — mitigate with §3.3 vocabulary discipline everywhere, especially directory tags and the HN title.
2. **Demo won't reproduce live** (agent behaves) — the `--mock` recording is the deterministic fallback; script both.
3. **First-run friction** (wizard + key before first verdict) — mitigate: consider a `pair_review --demo` path or a "try it on this repo" one-liner in Week 1 polish; measure via feedback, not telemetry.
4. **Same-model independence perception** — §3.5 rule: never overclaim; always attach the cross-model tip.
5. **Directory stagnation** (listed but buried) — the awesome-list PR and the benchmark content are the durable discoverability plays; directories are table stakes, not strategy.

---

## 12. Sources from landscape research

- Glama registry (~56k open-source MCP servers): [glama.ai](https://glama.ai)
- Smithery submission model + Arcade acquisition (Aug 2026): [tooldirectory.ai review](https://tooldirectory.ai)
- PulseMCP ingests the official registry; submission folklore: [CONTRIBUTING.md example](https://github.com) · [dev.to distribution-channels writeup](https://dev.to)
- Anthropic's built-in multi-agent code review for Claude Code (the category we must NOT name): [Claude Code docs](https://code.claude.com/docs/en/code-review) · [The New Stack coverage](https://thenewstack.io/anthropic-launches-a-multi-agent-code-review-tool-for-claude-code/)
- Adjacent review MCPs (differentiate on manifest + intent): [praneybehl/code-review-mcp](https://github.com/praneybehl/code-review-mcp) · [mcpmarket listing](https://mcpmarket.com/server/code-review-assistant) · [mcpservers.org skills library](https://mcpservers.org/agent-skills/category/code-review)
- MCP ecosystem measurement (what directories track): [arXiv study](https://arxiv.org)
