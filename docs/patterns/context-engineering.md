# Context Engineering

How AI tooling in this repo curates the **optimal set of tokens** at each step of an agent's
work — rather than relying on ever-larger prompts. This is the umbrella doc for the three
mechanisms the repo uses: **subagent delegation**, **progressive disclosure**, and
**structured memory**. Read it before adding or refactoring a skill, an agent, or a `CLAUDE.md`.

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

**When to delegate:** the work reads many files or runs many greps, *and* the orchestrator only
needs the conclusion. **When not to:** a single-file read, or work that must interleave with
user confirmation gates (keep those in the orchestrator).

**Rules for agents.** Read-only by default (tight `tools:` allowlist — no Write/Edit/Bash unless
the role demands it). Return digests, never pasted files. Cite `path:line`. Never invent — report
`## Not found` instead. Put skill-specific procedure in the skill's `reference/` files and have the
agent *read* them, so the orchestrator never loads the procedure just to pass it along.

**Authoring a new agent:** one Markdown file in `.claude/agents/<name>.md` with frontmatter
(`name`, `description`, `tools`, `model: inherit`) and a body that states the operating rules, the
method, and an **explicit output format**. The `description` is what the orchestrator matches on —
make it say *when* to use the agent and *what it returns*.

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
  them.
- **Read before you write code.** Every SDD skill reloads `context.md` at session start (see each
  skill's boot sequence) — the root `CLAUDE.md` requires reading it before touching a related file.
- **No vague deferrals.** An unresolved item becomes an `## Open Threads` checkbox with a target
  step — mirroring `/sdd-execute`'s deviation protocol. Don't write "deferred" with no anchor.
- **Backward compatible.** The header is additive: features created before this schema keep their
  plain session logs and remain valid. Adopt the header when a feature accumulates decisions worth
  scanning at a glance.

### Cross-feature memory — the Ledger

`context.md` is scoped to **one** feature. The **Ledger** (`docs/roadmap/ledger/insights.md` +
`fails.md`) is the cross-feature counterpart: lessons that should inform *every* future feature, not
just the one that produced them. `/sdd-story`, `/sdd-design`, and `/sdd-spec` **read** it to reuse
what worked and avoid known traps; `/sdd-execute` **writes** to it (a `fails.md` entry at a recurring
deviation, an `insights.md` entry at integration). It is append-only, like the session log, and is
the durable complement to the `dry-reviewer` agent (which detects duplication live but persists
nothing). A recurring `fails.md` entry is a candidate to promote into a binding rule in
`docs/sdd/constitution.md`.

---

## How the three compose

A typical `/sdd-execute` step: the router (progressive disclosure) reaches Phase 1, delegates
re-verification to `codebase-discovery` (subagent), which returns a digest; the orchestrator
confirms with the user, executes, then records the outcome in `context.md` (structured memory).
Each mechanism keeps a different kind of noise out of the decision window — file contents, unused
procedure, and stale history respectively.

When you extend the tooling, ask the context-engineering question first: *what needs to be in the
window when this decision is made, and how do I keep everything else out?*
