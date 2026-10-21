# Context Engineering

How AI tooling in this repo curates the **optimal set of tokens** at each step of an agent's
work — rather than relying on ever-larger prompts. This is the umbrella doc for the three
mechanisms the repo uses: **subagent delegation**, **progressive disclosure**, and
**structured memory** — plus the **saved workflows** (§4) that run them across many features at once.
Read it before adding or refactoring a skill, an agent, a workflow, or a `CLAUDE.md`.

> Prompt engineering asks "what do I tell the model?" Context engineering asks "what should be
> in the window — and what should *not* — when the model acts?" Every pattern below removes
> noise from the window where the decision is made.

---

## 1. Subagent delegation (`.claude/agents/`)

Heavy, read-mostly work runs in an **isolated subagent window** and returns a condensed digest,
so the orchestrator's window holds conclusions, not raw file dumps. The fleet:

| Agent | Role | Returns | Called by |
|---|---|---|---|
| `codebase-discovery` | Find real file paths / symbols / config keys / proto fields for a service or step | `path:line` evidence digest (+ `## Not found`) | `/sdd-spec` Step 3, `/sdd-execute` Phase 1 |
| `spec-reviewer` | Apply review criteria to a spec | Structured pass/warn/fail verdict per criterion | `/sdd-review` Modes A & B |
| `feature-overlap` | Scan other feature dirs for config-key / proto-field / migration / file collisions | Collision report | `/sdd-review` overlap checks |
| `service-briefing` | Distill a service's `CLAUDE.md` + relevant patterns | Compact service briefing | `/sdd-spec`, `/sdd-execute` when entering an unfamiliar service |
| `design-proposer` | Propose ONE concrete architecture grounded in `recon.md` | Structured proposal (decisions + reuses + assumptions) | `/sdd-design` Phase 1 (grilling) |
| `design-adversary` | Attack a proposed design; cite Constitution IDs it would violate | Structured objections + rejected-alternative trade-offs | `/sdd-design` Phase 1 (grilling) |
| `dry-reviewer` | Find semantic DRY violations a token scanner misses (renamed-but-equivalent helpers, parallel type shapes, cross-language repetition) | Compact findings report with a suggested canonical home | Pre-PR review (advisory) |
| `qa-tester` | Design a test plan (layer, file, RED assertion, exact command), inventory what is tested, spot side defects | Test plan + inventory table + SEV-tagged defect digest | `/sdd-qa` `design`/`gaps`, `/sdd-execute` TDD gate |

**When to delegate:** the work reads many files or runs many greps, *and* the orchestrator only
needs the conclusion. **When not to:** a single-file read, or work that must interleave with
user confirmation gates (keep those in the orchestrator).

**Rules for agents.** Read-only by default (tight `tools:` allowlist — no Write/Edit/Bash unless
the role demands it). Return digests, never pasted files. Cite `path:line`. Never invent — report
`## Not found` instead. Put skill-specific procedure in the skill's `reference/` files and have the
agent *read* them, so the orchestrator never loads the procedure just to pass it along.

**Authoring a new agent:** one Markdown file in `.claude/agents/<name>.md` with frontmatter
(`name`, `description`, `tools`, `model`) and a body that states the operating rules, the
method, and an **explicit output format**. The `description` is what the orchestrator matches on —
make it say *when* to use the agent and *what it returns*.

**Model tier.** Pin `model` to a tier alias by the agent's reasoning load and the cost of a wrong
answer — never `inherit`, which lets a cheap orchestrator silently downgrade a gate. Aliases (not
full IDs) so a model release needs no bump.

| Tier | Use for | e.g. |
|---|---|---|
| `opus` | Open-ended synthesis/adversarial reasoning, or a verdict that gates an irreversible write | `design-adversary`, `feature-synthesizer` (gates artifact deletion) |
| `sonnet` | Grounded judgment or classification against criteria, where an invented path/verdict propagates downstream | `spec-reviewer`, `codebase-discovery` |
| `haiku` | Mechanical scan or summarize, output trivially checkable by the caller | `feature-overlap`, `service-briefing` |

---

## 2. Progressive disclosure (lean skill routers + `reference/` + nested `CLAUDE.md`)

Load detail only at the moment it is needed.

**Skills.** A `SKILL.md` is a **router**: the always-true core (boot, control flow, safety rails)
plus pointers. Bulky, conditional, or mode-specific material lives in sibling files the router
names at the point of use:

```
.claude/skills/<skill>/
  SKILL.md                 # lean router — always loaded
  reference/<topic>.md     # loaded only when that branch activates
  templates/<artifact>.md  # rendered output bodies
```

Worked example — `/sdd-execute`: the 1.4k-word SEQUENTIAL-MODE driver lives in
`reference/sequential-mode.md` and loads **only** when the selector is `sequential`; the deviation
protocol and repo conventions load only when those paths activate. A routine `next`-step run never
pays for them. Apply the same split to any skill whose `SKILL.md` exceeds ~1.2k words or has
clearly mode-gated sections.

**`CLAUDE.md` files.** The root `CLAUDE.md` is itself a router: its **Context Guide** table maps a
task to the one doc to read, and nested `CLAUDE.md` files (per `docs/*` dir, per service) load by
directory locality. When you add a doc, add a Context Guide row — don't inline its contents into
the root. Keep each `CLAUDE.md` at the right *altitude*: enough to act, with a pointer for depth.

---

## 3. Structured memory (`context.md`)

A feature's `context.md` is its **durable memory** — what lets any future session resume without
the prior conversation. Sessions get compacted; `context.md` does not. It has two parts: a
structured header (fast to scan, the current state) and an append-only session log (the history).

### Schema

```markdown
# Context: <slug>

**Feature**: .../feature.md
**Product Spec**: .../product-spec.md
**Implementation Spec**: .../implementation-spec.md

## Decisions
- <durable choice + 1-line rationale> (e.g. "trufflehog + gitleaks for secret CI — chosen over …")

## Open Threads
- [ ] <unresolved item> — earliest step/PR where it can be addressed

## Files Modified
- `path/to/file` — <what changed, which step>

---

## Session <ISO timestamp> — <skill or actor>
- <append-only log entry; never edited after the session>
```

### Rules

- **Header = live state; log = history.** Update `## Decisions` / `## Open Threads` /
  `## Files Modified` in place as state changes; **append** `## Session …` entries, never rewrite
  them — with exactly two sanctioned exceptions that *compact* the log without losing meaning:
  `/sdd-distill` mid-lifecycle (below) and `/sdd-archiver` at terminal state.
- **Read before you write code.** Every SDD skill reloads `context.md` at session start (see each
  skill's boot sequence) — the root `CLAUDE.md` requires reading it before touching a related file.
- **No vague deferrals.** An unresolved item becomes an `## Open Threads` checkbox with a target
  step — mirroring `/sdd-execute`'s deviation protocol. Don't write "deferred" with no anchor.
- **Backward compatible.** The header is additive: features created before this schema keep their
  plain session logs and remain valid. Adopt the header when a feature accumulates decisions worth
  scanning at a glance.

### Mid-lifecycle distillation (`/sdd-distill`)

An append-only log grows without bound, and every session reloads all of it — so a long-running
feature pays a rising per-session tax. `/sdd-distill` compacts an **in-progress** feature's
`context.md` **non-destructively**: the `context-distiller` subagent (read-only, the mid-lifecycle
sibling of `feature-synthesizer`) hoists durable state into the header and compresses older
`## Session` blocks into short summaries — the most recent sessions stay verbatim — then an
adversarial `verify` pass proves nothing irrecoverable is dropped, a consent gate precedes the
single-writer rewrite, and the commit leaves the original prose recoverable in git history. It is the
one mid-lifecycle rewriter of the log; `/sdd-archiver` is its terminal-state counterpart (which also
distils the Ledger and deletes the verbose specs). Distillation itself never writes the Ledger — only
archival does.

### Cross-feature memory — the Ledger

`context.md` is scoped to **one** feature. The **Ledger** (`docs/roadmap/ledger/insights.md` +
`fails.md`) is the cross-feature counterpart: lessons that should inform *every* future feature, not
just the one that produced them. `/sdd-story`, `/sdd-design`, and `/sdd-spec` **read** it to reuse
what worked and avoid known traps; `/sdd-execute` **writes** to it (a `fails.md` entry at a recurring
deviation, an `insights.md` entry at integration). It is append-only, like the session log, and is
the durable complement to the `dry-reviewer` agent (which detects duplication live but persists
nothing). A recurring `fails.md` entry is a candidate to promote into a binding rule in
`docs/sdd/constitution.md`.

## 4. Saved workflows (`.claude/workflows/`)

A **saved workflow** is a deterministic JavaScript orchestration script that Claude Code runs as a
slash command (`/<meta.name>`; edits load on `/reload-skills` or a new session). Use one when the same
SDD phases must run for **many features in parallel** — a job no single skill session can do, because
**subagents cannot spawn subagents**: every SDD skill delegates to read-only agents (`spec-reviewer`,
`feature-overlap`, `codebase-discovery`, `design-proposer`/`design-adversary`, `scenario-promoter`)
and `/sdd-design`'s P-02 rule needs the proposer and adversary in separate windows, mediated by an
orchestrator. In a workflow **the script is that orchestrator**: it spawns the read-only roles as
their `agentType`, passes only its own synthesis between proposer and adversary, and gives each
feature exactly one writer per stage (P-01), each in its own git worktree.

| Workflow | Runs | Stops at |
|---|---|---|
| `/sdd-batch` (`.claude/workflows/sdd-batch.js`) | per feature, in parallel: preflight → `/sdd-review product-spec` → `/sdd-design` Phase 0 + full debate (2–5 rounds) → `/sdd-spec` → `/sdd-review impl-spec` | each design gate (default) · a demoted-duplicate match · any preflight problem |
| `/sdd-batch-execute` (`.claude/workflows/sdd-batch-execute.js`) | per feature, in parallel: `/sdd-execute <slug> sequential` — re-spec validation, one commit per step on the feature branch (discovery → TDD gate → verification), C-16 promotion, integration PR | the up-front confirm · every smart checkpoint (default) · every blocker · merge-order · the promotion confirm |

**Invocation contract** (both take structured `args`; required fields throw if missing):

- `date` (ISO), `trailer` (the calling session's commit attribution lines, verbatim) and
  `features: [{slug, decisions?}]` (`decisions` = binding operator constraints, recorded in
  `context.md`). `/sdd-batch-execute` also needs `prFooter` (PR-body attribution) and
  `modeEntryConfirmed: true` — the sequential mode-entry confirmation (`sequential-mode.md` §5.1b) is
  asked in the main session before launch, never inside the script.
- `approvals: {<slug>: {gate, decision}}` — how a halted gate is answered: relaunch the same
  workflow with the operator's answer and each feature resumes from its lifecycle status (`draft` →
  … → `implementation-ready`; spec step statuses for execution), so finished phases are never
  re-run. The design debate's state survives between runs in a `sdd-batch-design-state` block in
  `context.md`; the approved C-16 plan in a `sdd-batch-promotion-plan` block.
- `designGate: 'halt'` (default — P-04 strict) or `'auto'`; `checkpoints: 'halt'` (default) or
  `'report'`. Each unattended mode requires `authorizationRef` (where the operator's standing
  authorization is recorded). `auto` never approves with an unresolved Floor breach (F-11), a
  blocking objection, or a CHANGE to an existing `@AC-*` rule no operator decision covers (C-16).
- `baseBranch` (default `main-dev`) — where a not-yet-branched feature directory must exist.

**Preflight guards** run before any write: a slug must resolve to exactly one
`docs/roadmap/features/*-<slug>` directory (skills resolve features by suffix — a reused slug of a
launched feature is ambiguous), and its NNN must not be held by another slug on `main-dev` or any
remote branch.

**Operational notes.** Writers commit **and push after each artifact edit** — one file per commit,
pushed before the next file is touched — so an interrupted run loses at most the file in progress;
the only multi-file commit is an execute step's code change with its own spec/context status, made
after verification passes (`/sdd-execute` HARD CONSTRAINT). They commit on a detached HEAD and push
`HEAD:refs/heads/<dev-branch>` (a named branch can be checked out in only one worktree). `.claude/worktrees/` holds the per-agent
worktrees and is git-ignored; remove clean, already-pushed ones with `git worktree remove`. A run cut
short (e.g. by the session usage limit) resumes with `Workflow({scriptPath, resumeFromRunId})` and
**unchanged args** — completed agents replay from cache. Read-only agents read the main checkout, so
the preflight passes branch-only artifacts to them inline; launch from an up-to-date checkout.

**Tests.** `scripts/workflow-tests/` runs each script against scripted agent replies (no tokens) and
asserts every gate path — `node --test scripts/workflow-tests/*.test.mjs`, also in CI's
`context-map` job. Change a gate rule → change its test first.

---

## How the three compose

A typical `/sdd-execute` step: the router (progressive disclosure) reaches Phase 1, delegates
re-verification to `codebase-discovery` (subagent), which returns a digest; the orchestrator
confirms with the user, executes, then records the outcome in `context.md` (structured memory).
Each mechanism keeps a different kind of noise out of the decision window — file contents, unused
procedure, and stale history respectively.

When you extend the tooling, ask the context-engineering question first: *what needs to be in the
window when this decision is made, and how do I keep everything else out?*
