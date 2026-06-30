# SDD Constitution

The binding rules of the xstockstrat Spec-Driven Development (SDD) pipeline — the platform's
"code of honor." These rules already live, scattered, across the root `CLAUDE.md`, each skill's
HARD CONSTRAINTS, and the pattern docs. This file consolidates them into one authoritative,
**ID'd** reference so every gate can cite a violation precisely (e.g. "violates **F-03**") instead
of re-deriving the rule each time.

> Read this when authoring or reviewing any SDD artifact. The review gate (`/sdd-review`) and the
> design-adversary (`/sdd-design`) cite constraint IDs in their findings; `/sdd-execute`'s HARD
> CONSTRAINTS are the enforcement arm of the **Floor** section below.

## How to use this document

- **Cite by ID.** Reviewers, the design-adversary, and deviation notes reference a rule as
  `C-0N` / `P-0N` / `F-0N`, not by paraphrase.
- **Three tiers, three strengths:**
  - **Commandments (`C-*`)** — always-do. Overridable only with an **explicit user sign-off
    recorded in `context.md`** (and, where relevant, the `## Deviation Log`).
  - **Process & Chain-of-Command principles (`P-*`)** — how the skills and subagents operate. The
    governance spine. Treated as Commandments for override purposes.
  - **Floor (`F-*`)** — never-do, **non-overridable**. "Proceed anyway" does **not** bypass a Floor
    item. A Floor rejection halts the current phase (see **F-11**).
- **IDs are stable.** Append new IDs; never renumber an existing one (other docs cite them).

---

## Commandments (`C-*`) — always-do

| ID | Rule | Source of record |
|---|---|---|
| **C-01** | **Zero-assumption / evidence-cited steps.** Every spec step cites real `path:line` found via Read/grep/discovery; never invent a path, symbol, or line. | `.claude/skills/sdd-spec/SKILL.md` (CRITICAL RULE; zero-assumption rule) |
| **C-02** | **Read `context.md` before writing.** Every SDD skill reloads the feature's `context.md` at session start; never touch a feature file without it. | `docs/patterns/context-engineering.md` §3; `docs/roadmap/features/CLAUDE.md` Key Rules |
| **C-03** | **Propagate platform headers.** Every backend service forwards `x-user-id`, `x-access-scope`, `x-trace-id` on all outbound gRPC calls. | root `CLAUDE.md` § Header Propagation Convention |
| **C-04** | **Prefer enums over strings** for closed, deployment-time value sets; every enum has a zero-value `<NAME>_UNSPECIFIED = 0`. | root `CLAUDE.md` § Proto Contract Governance |
| **C-05** | **Config key naming** is `<service>.<category>.<key>`; services subscribe at startup; defaults are declared in each service's `CLAUDE.md`; sensitive keys use the `secret.*` prefix. | root `CLAUDE.md` § Config Governance Rules |
| **C-06** | **Branch from `main-dev`, never `main`** (features); `claude/*` branches also branch from and PR into `main-dev`. | `docs/runbooks/feature-workflow.md` § Branch Model |
| **C-07** | **Migration naming** is `NNN_description.up.sql` + `.down.sql`, `NNN` = last in that service's `migrations/` + 1. | `.claude/skills/sdd-spec/SKILL.md` Step 2; `docs/patterns/database.md` |
| **C-08** | **Test-step pairing.** Every non-frontend `service` step has a paired `test` step whose verification meets the service's CI coverage threshold. | `.claude/skills/sdd-spec/reference/spec-template.md` § Test step pairing rule |
| **C-09** | **Proto verification.** Every `proto` step runs `buf lint` and `buf breaking` against the feature branch; run `./scripts/buf-gen.sh` after any `.proto` change. | `.claude/skills/sdd-spec/SKILL.md` Step 2; root `CLAUDE.md` § Proto Contract Governance |

---

## Process & Chain-of-Command principles (`P-*`) — how the pipeline operates

These codify the operating model that keeps a multi-agent SDD run honest. Most elevate behavior
already implied by the read-only-subagent design into **named, citable law**.

| ID | Principle | Why / source |
|---|---|---|
| **P-01** | **Single-orchestrator authority.** Exactly one actor — the orchestrating **skill** — owns every write, every user gate, every branch/PR/commit, and every escalation. Subagents are advisory only: they locate, assess, and report. They never write, commit, or change lifecycle state. | Codifies the read-only fleet + "keep user-confirmation gates in the orchestrator" in `docs/patterns/context-engineering.md` §1. |
| **P-02** | **No lateral subagent coordination — report up only.** A subagent returns a digest to the orchestrator and never calls, reads the output of, or coordinates with a sibling subagent. In the design debate, proposer and adversary never see each other's raw output — the orchestrator mediates every exchange, passing each only the synthesized state it needs. This is the structural guard against silent divergence between agents. | New (governance spine); consistent with the isolated-window model in `context-engineering.md` §1. |
| **P-03** | **No silent deviation — escalate, never guess.** On ambiguity, a missing symbol, or an in-scope-unresolvable gap, the actor surfaces it (subagent → `## Not found`; orchestrator → block the step and ask the user) and never substitutes a guess. A recurring ambiguity is logged to `docs/roadmap/ledger/fails.md`. | Elevates the discovery "report `## Not found`, never invent" rule + `/sdd-execute`'s "no vague deferrals" deviation protocol into binding law. |
| **P-04** | **Phase-gate approval, recorded.** Each phase advances only on explicit user approval, and the transition is recorded (a `## Status History` row in `feature.md` + a `context.md` session entry). | Codifies the per-phase confirmation gates across all SDD skills. |
| **P-05** | **Incremental checkpointing.** Decisions and outcomes are written to `context.md` (and, when cross-feature, the ledger) **as they happen** — not batched to session end — so a compaction or crash never loses state. | `context-engineering.md` §3 (header = live state); the durable-memory rule. |
| **P-06** | **Red-before-green.** A code-bearing step proves a failing test before implementation, then a passing one after (full protocol in `.claude/skills/sdd-execute/reference/tdd-gate.md`). | New; builds on the test-pairing rule **C-08**. |

---

## Floor (`F-*`) — never-do, non-overridable

A Floor item cannot be waived. The user's "proceed anyway" may override a Commandment (with sign-off)
but **never** a Floor rule. A reviewer or the design-adversary flagging a Floor violation **halts the
phase** (see **F-11**).

| ID | Rule | Source of record |
|---|---|---|
| **F-01** | **Never edit an applied `.up.sql` migration** (one committed to `main-dev`). Add a new numbered migration instead. | `.claude/skills/sdd-execute/SKILL.md` HARD CONSTRAINTS; `docs/patterns/database.md` |
| **F-02** | **Never push directly to `main-dev` or `main`.** All changes go through PRs. | `docs/runbooks/feature-workflow.md` § Branch Model; `.claude/skills/sdd-sync/SKILL.md` HARD CONSTRAINTS |
| **F-03** | **Never target `main-dev` or `main` in a step PR.** Always target the feature's `**Development Branch**`. | `.claude/skills/sdd-execute/SKILL.md` HARD CONSTRAINTS |
| **F-04** | **Never invent a file path or symbol.** If discovery does not find it, block the step. | `.claude/skills/sdd-execute/SKILL.md` HARD CONSTRAINTS; `.claude/agents/codebase-discovery.md` operating rules |
| **F-05** | **Never commit before the step's verification passes.** | `.claude/skills/sdd-execute/SKILL.md` HARD CONSTRAINTS |
| **F-06** | **Never exceed the 20-connection DB pool budget.** Each service caps its pool so the sum of all pool maxes stays ≤ 20; raising any pool requires re-checking the budget table. | root `CLAUDE.md` § Connection Pool Budget |
| **F-07** | **Never hardcode config values in source.** Read them via the `WatchConfig` stream. | root `CLAUDE.md` § Config Governance Rules |
| **F-08** | **Never stage files outside the step's `**Files**` section** plus `implementation-spec.md`, `feature.md`, and `context.md` (and the ledger when a ledger write is due). | `.claude/skills/sdd-execute/SKILL.md` HARD CONSTRAINTS |
| **F-09** | **`implementation-spec.md` step bodies are immutable during execution.** The only permitted change to a step is flipping `**Status**`. All divergence is recorded in the `## Deviation Log`, never by editing `**Instructions**`/`**Codebase Evidence**`/`**Verification**`/`**Files**`/`**Reviewers**`. | `.claude/skills/sdd-execute/SKILL.md` HARD CONSTRAINTS |
| **F-10** | **Never write or edit any file before the Phase-2 user confirmation.** | `.claude/skills/sdd-execute/SKILL.md` HARD CONSTRAINTS |
| **F-11** | **Floor rejection halts.** A Floor (`F-*`) violation flagged by `/sdd-review` or the design-adversary terminates the current phase: record it (in the review output and `context.md`) and stop. "Proceed anyway" never bypasses a Floor item. | New (the binding, non-overridable "constitutional floor"). |

---

## Relationship to the rest of the toolkit

- **`/sdd-review`** tags each `BLOCKER`/`WARNING` with the Constitution ID it violates.
- **`/sdd-design`** grills a proposed approach against this document; the adversary's job includes
  citing any `C-*`/`P-*`/`F-*` the approach would breach. A Floor breach blocks the design.
- **`/sdd-execute`'s** HARD CONSTRAINTS are the per-step enforcement of the Floor (and **C-08**/**P-06**
  for TDD). Sequential-mode carve-outs may relax Commandment-level confirmation cadence but **never**
  touch a Floor item.
- **The Ledger** (`docs/roadmap/ledger/`) is where a recurring violation or a hard-won pattern is
  recorded; a `fails.md` entry may propose promoting its lesson into a new Constitution ID.
