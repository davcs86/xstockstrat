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
| **C-08** | **Test-step pairing.** Every non-frontend `service` step has a paired `test` step whose verification meets the service's CI coverage threshold. The behaviors those tests must cover are the feature's acceptance scenarios (`acceptance.feature`, `@AC-*`) — see **C-15** for the scenario↔test traceability that pairs with this coverage requirement. | `.claude/skills/sdd-spec/reference/spec-template.md` § Test step pairing rule |
| **C-09** | **Proto verification.** Every `proto` step runs `buf lint` and `buf breaking` against the feature branch; run `./scripts/buf-gen.sh` after any `.proto` change. | `.claude/skills/sdd-spec/SKILL.md` Step 2; root `CLAUDE.md` § Proto Contract Governance |
| **C-10** | **Integration completeness across shared/duplicated surfaces.** When a feature adds or changes something exposed through a surface **shared with other features** or **duplicated across code paths**, it updates *every* instance and proves it with a test — the change is not "done" at the first instance. Canonical seams: (a) a new UI page/route MUST be registered in the shared nav (`PLATFORM_SUBNAV` in `PlatformHeader.tsx`) with a nav-reachability test; (b) a displayed value with an authoritative source (broker mark-to-market, etc.) MUST be surfaced consistently by **every** RPC/read path that exposes it, with a parity test (e.g. portfolio `ListPositions` ↔ `ListPortfolios`); (c) a **seeded/shared resource another service depends on** MUST be protected from mutation (RPC guard + read-only UI), and any new ownership sentinel (e.g. `author="system"`) recorded as a governance convention. | `docs/roadmap/ledger/fails.md` (2026-07-01 entries); PR #735 |
| **C-11** | **No feature implementation without minimum SDD grounding.** Any request to add or change platform capability (a new UI page/route, endpoint, service behavior, tool, or config surface) — however it arrives (GitHub issue, chat message, or a direct task/session instruction to "implement X") — runs at minimum `/sdd-story` → `/sdd-design <slug> quick` → the design-phase ledger touch (read always; write when a pattern/trap surfaced) before any implementation write. `quick` mode is the fast-track: Phase 0 Recon runs in full and a single mandated grilling round still happens — it shortens the debate, it never skips Phase 0/Phase 1 entirely. Confirmed bug fixes are exempt — they route through `docs/runbooks/bug-triage.md` (Track A/B/C), whose own `skip` design-depth option applies to bugs, not new capability. | root `CLAUDE.md` § Feature Roadmap; `docs/runbooks/bug-triage.md` Track C |
| **C-12** | **Frontend test mocks come from the test-data inventory.** The `xstockstrat-ui` instance of **C-13** — see C-13 for the general rule. Any step that adds or modifies `xstockstrat-ui` tests (Playwright specs, `e2e/mock-backend.ts` handlers, or vitest unit tests using domain objects) imports its mocked/dummy domain data from `services/xstockstrat-ui/e2e/fixtures/` (auth from `e2e/helpers/auth.ts`) instead of declaring inline literals. A new domain object gets a fixture module + `INVENTORY.md` catalog row in the same step; a second consumer of an inline literal forces centralization. Scenario one-offs (error payloads, `{ ...FIXTURE, override }` spreads, reserved sentinel ids) stay inline. | `docs/patterns/test-data-inventory.md`; `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`; `.claude/skills/sdd-spec/reference/step-constraints.md` §B |
| **C-13** | **Test data comes from the service's canonical fixture home — in any language.** Generalizes C-12 beyond `xstockstrat-ui`. A step that adds or modifies tests using mocked/dummy **domain** data imports it from that service's canonical home rather than declaring an inline literal. The homes are: **Next.js** `e2e/fixtures/*.ts` + `INVENTORY.md` (auth `e2e/helpers/auth.ts`) · **Python** `tests/conftest.py` · **Go** `internal/testdata/` · **Node** `src/__tests__/fixtures/`. The rule **materializes lazily**: a literal may stay inline while it has exactly **one** consumer; the **second consumer** forces centralization into the home plus a catalog row, in the same step. It never requires building a fixture home ahead of demand — `xstockstrat-ui` and the Python `conftest.py` files are the only homes that exist today, and a service with one test file is expected to create none. Shape follows proto (Connect-JSON camelCase in TS/Node; generated message classes in Go/Python). Scenario one-offs stay inline, as in C-12. | `docs/patterns/test-data-inventory.md`; `.claude/skills/sdd-qa/SKILL.md` (`reference/fixtures.md`); `.claude/skills/sdd-spec/reference/step-constraints.md` §B |
| **C-14** | **Name the consumer surface, keep it in scope.** Every feature that changes backend behavior with an end-user-visible consequence names, in its product spec's `## Consumer Surface(s)`, the UI segment(s) (`/trader` / `/insights` / `/config-ui` in `xstockstrat-ui`) and/or the Agent MCP tool(s) (`xstockstrat-agent`) through which a user actually reaches the capability — or explicitly marks itself internal/platform-only with a stated reason. Each named surface earns its own implementation step(s); a feature is **not** "done" when only the backing service is updated and the consumer surface stays stale (the exact failure this rule exists to prevent). Distinct from **C-10**: C-10 is "update *every* instance of a surface you touch", C-14 is "name and reach the consumer surface *at all*." Overridable only with explicit user sign-off recorded in `context.md` — and deferring a surface counts only when it points at a **named follow-up feature**, never a vague "later". | root `CLAUDE.md` § Service Registry (UI segments, Agent); `docs/roadmap/ledger/fails.md` |
| **C-15** | **Acceptance scenarios trace to tests.** Every feature carries an `acceptance.feature` (Gherkin) whose `Scenario:` blocks each have a stable `@AC-N` tag and at least one `@FR-N` tag; every `FR-N` in `product-spec.md` is covered by ≥1 scenario. Every scenario must be covered by at least one `test` step / RED assertion (the step body names it: `**Covers**: AC-2, AC-5`); an **uncovered scenario blocks `impl-spec` review**. Scenario IDs (`@AC-*`) are **append-only per feature** — never renumbered, because test steps and RED assertions cite them. `acceptance.feature` replaces the prose `## Acceptance Criteria` list as the single source of acceptance truth. | `.claude/skills/sdd-story/SKILL.md` (acceptance.feature); `.claude/skills/sdd-spec/reference/spec-template.md` § Scenario coverage; `docs/sdd/gherkin-integration-proposal.md` |
| **C-16** | **Business-rule regression guard.** Recon (`/sdd-design` Phase 0) reads the durable business-rule suites of every affected service (`services/xstockstrat-<svc>/acceptance/*.feature` + `docs/sdd/business-rules/platform.feature`) and lists them in `recon.md`. A design that would **break an existing `@AC-*` guarantee is a regression** and is blocked (the design-adversary cites the rule ID, as it does a `C-*`/`F-*` breach). **Changing** (not merely adding to) an existing business rule requires **explicit user sign-off recorded in `context.md`**; `design.md` records which existing rules the approach preserves, extends, or changes. On launch/integration a feature's scenarios are **promoted** into the affected services' durable suites (`/sdd-execute` integration PR, `/promote` backstop); `/sdd-archiver` never deletes them, it curates them. | `.claude/skills/sdd-design/reference/recon-checklist.md`; `.claude/skills/sdd-design/reference/grilling-protocol.md`; `docs/sdd/gherkin-integration-proposal.md` |

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
| **F-06** | **Never exceed the shared DB connection budget (~22 usable).** Each **direct** service caps its pool so the sum of *direct* pool maxes stays safe; the six PgBouncer-pooled Go/Python services (`DB_PGBOUNCER`, `:25061`) do **not** count 1:1 — their backend cap is the pool `size`, and they leave `DB_POOL_MAX` unset. Raising a direct pool (or adding a new direct DB service) requires re-checking the budget table. | root `CLAUDE.md` § Connection Pool Budget |
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
- **root `CLAUDE.md` § Feature Roadmap** is where **C-11** is enforced at the point a request first
  reaches any session — including one told, in plain language, to "just implement" a feature. That
  framing requests the capability, not a license to skip the pipeline.
