# Proposal: Integrating Gherkin (BDD) into the SDD Workflow

**Status**: Proposal — for review, not yet adopted
**Created**: 2026-08-20
**Scope**: SDD pipeline skills, the Constitution, and the per-feature artifact set. No service code.

---

## 1. Purpose — tie every decision to the SDD mandate

The SDD workflow exists to **prevent AI slop**, **catch regressions**, and **do both without
burning tokens**. This proposal is judged only against those three goals; any Gherkin machinery that
does not clearly serve them is out of scope by construction ("write the minimum that solves the
stated problem").

The value of Gherkin here is **not** a new test runner. It is a *specification and traceability*
layer:

- **Anti-slop**: Given/When/Then with concrete example values forces behavior to be pinned down —
  before design, before code. The design-adversary and `/sdd-review` grill precise, falsifiable
  scenarios instead of vague prose ("the system should handle invalid input").
- **Anti-regression**: every scenario carries a stable ID and must trace to at least one test /
  RED assertion. A dropped or uncovered scenario becomes a *mechanically visible* coverage hole at
  review time, instead of silently rotting.
- **Token-frugal**: it is one text artifact per feature and a handful of lines added to existing
  skills — no new toolchain, no new CI jobs, no second source of executable-test truth.
- **Faster context (deeper integration, §2.3/§4.3)**: the accumulated scenarios become a durable,
  per-service map of *existing business rules* that the recon and design phases read directly — so a
  designer sees what the platform already guarantees without reconstructing it from specs and code,
  and a design that would break an existing guarantee is caught as a regression at design time.

---

## 2. Decisions taken (with rationale)

### 2.1 Spec-layer Gherkin, **not** executable BDD runners

**Decision**: scenarios are a specification + traceability artifact. The existing language-native
tests (Go `testing` + pgxmock, `pytest`, `node:test`/`vitest`, Playwright) remain the executors —
each tagged to the scenario ID(s) it verifies. We do **not** add `godog` / `pytest-bdd` /
`cucumber-js`.

**Why**: executable BDD would introduce three new frameworks plus step-definition glue in every
language, grow the CI matrix, and stand up a *parallel* test tree that must be kept in lockstep with
the `C-08` paired tests the pipeline already produces — a direct DRY violation and exactly the
token/maintenance bloat the mandate guards against. The red-before-green TDD gate (`P-06`) already
gives us executable regression coverage; BDD's *unique* contribution is the slop-prevention of
example-based specification, which the spec layer captures in full at near-zero recurring cost.

### 2.2 A separate `acceptance.feature` file per feature

**Decision**: scenarios live in a standalone `acceptance.feature` in the feature directory — the
**8th** per-feature artifact — authored in Gherkin syntax.

**Why**: keeps the specification in real `.feature` syntax (editor tooling, syntax highlighting,
and a clean path if executable BDD is ever revisited) rather than as a fenced block buried in
`product-spec.md`. The cost is plumbing: the file must be threaded through the systems that know the
per-feature file set (§4.7). That cost is one-time and enumerated below.

**Trade-off accepted**: this is more plumbing than embedding scenarios inside
`product-spec.md`'s `## Acceptance Criteria`. It was chosen deliberately to keep the artifact
first-class and format-clean.

### 2.3 Durable, per-service business-rule suites (the deeper integration)

**Decision**: a scenario has **two lifecycles**. The per-feature `acceptance.feature` (§2.2) is the
*pending* contract for one feature. When that feature's behavior becomes real in the trunk, its
scenarios are **promoted** into a **durable, per-service business-rule suite** that the recon and
design phases read to get fast, structured context on what the platform *already guarantees*.

Three sub-decisions (all taken):

- **Home** → **per-service, co-located**: `services/xstockstrat-<svc>/acceptance/*.feature`, with a
  platform-level `docs/sdd/business-rules/platform.feature` for cross-cutting rules. This mirrors the
  repo's existing homes — fixture homes (`internal/testdata/`, `e2e/fixtures/`), per-service
  `CLAUDE.md`, and the per-module context-constitutions in `services/*/docs/`. It is the **behavioral
  sibling** of `docs/context-constitution.md`'s *structural* invariants (`PLAT-*` platform-wide,
  `<MODULE>-*` per-service). Recon loads only the *affected* services' suites, so token cost scales
  with the feature's blast radius, not with total feature count.
- **Promotion trigger** → **at launch / integration**: scenarios move into the durable suite when the
  feature lands in the trunk (the `/sdd-execute` final integration PR, backstopped by `/promote`), so
  recon sees a rule as soon as it ships. `/sdd-archiver` becomes the later **dedup / curation** pass,
  not the first point of durability.
- **No cross-service index for v1**: recon reads the affected-service suites directly (already scoped
  by the product spec's **Affected Services**). A generated catalog is deferred until wide
  "does a rule about X exist anywhere?" discovery is actually needed — machinery we don't pay for yet.

This is what makes Gherkin *load-bearing in recon/design* rather than just a per-feature acceptance
gate: the accumulated `@AC-*` scenarios become the platform's queryable, behavior-level memory.

---

## 3. The artifact — `acceptance.feature`

One `Feature:` per feature directory; one `Scenario:` per acceptance criterion, each with a stable
tag ID used everywhere downstream for traceability.

```gherkin
# docs/roadmap/features/<NNN-slug>/acceptance.feature
Feature: <slug>
  As a <persona>, I want <capability>, so that <outcome>.

  @AC-1 @FR-1
  Scenario: A walk-forward run splits the window correctly
    Given a 1000-trading-day price series
    And an in-sample window of 252 days and an out-of-sample window of 63 days
    When a walk-forward backtest is run
    Then 12 rolling windows are produced
    And each window's out-of-sample segment is exactly 63 days

  @AC-2 @FR-2
  Scenario: A window shorter than the in-sample size is rejected
    Given a 200-trading-day price series
    And an in-sample window of 252 days
    When a walk-forward backtest is run
    Then the run fails with error "insufficient history"
```

**Authoring rules (the slop guard):**

- Every `Scenario` has a `@AC-N` tag (stable ID) and at least one `@FR-N` tag linking it to the
  Functional Requirement it exercises. Every `FR-N` in `product-spec.md` must be covered by ≥1
  scenario.
- **Concrete example values only** — `252 days`, `"insufficient history"`, not "a valid window" or
  "an appropriate error." An untestable `When`/`Then` is a review blocker.
- `Then` clauses are **observable outcomes** (a returned value, a persisted row, a rendered element,
  an emitted event/alert), never implementation steps.
- Scenario IDs are **append-only within a feature** — never renumber `@AC-*`, because test steps and
  RED assertions cite them (mirrors the Constitution's stable-ID rule).

**Decision (resolves former O-2): `acceptance.feature` replaces the prose `## Acceptance Criteria`.**
The numbered `## Acceptance Criteria` list is removed from `product-spec.md`; scenarios in
`acceptance.feature` are the single source of acceptance truth, avoiding two-source drift (the same
reasoning that keeps lifecycle status only in `status.md`). `product-spec.md` keeps its `FR-N`
Functional Requirements and, in place of the old AC section, a one-line pointer:
`## Acceptance Criteria — see acceptance.feature (scenarios @AC-*)`.

---

## 4. Pipeline integration — per-skill touchpoints

Each change is additive and surgical; no new skills are created.

### 4.1 `/sdd-story` (Phase 1 — writes the artifact)
- After writing `product-spec.md`, generate `acceptance.feature` with a `Feature:` block and one
  tagged `Scenario:` per behavior, derived from the FRs and the user story.
- Change the `product-spec.md` template: **drop the numbered `## Acceptance Criteria` list**, replace
  it with the one-line pointer (§3), keep `FR-N`.
- Add `acceptance.feature` to the `## Artifacts` list in `feature.md` and to the file-list echoed to
  the operator.
- The SKILL's `allowed-tools` already permit `Write`; no tooling change.

### 4.2 `/sdd-review product-spec` (Phase 1.5 — gates the artifact)
- Add review criteria (in `reference/product-spec-criteria.md`): `acceptance.feature` exists; every
  `FR-N` maps to ≥1 scenario; every scenario is well-formed (concrete values, observable `Then`,
  no implementation leakage); IDs are unique.
- A malformed or missing `.feature` is a `BLOCKER` citing the new Constitution ID (§4.8), keeping the
  `draft → spec-ready` gate meaningful.

### 4.3 `/sdd-design` (Phase 1.75 — the deeper integration: recon reads existing rules, design guards them)

**Phase 0 (Recon) — load existing business rules as first-class context.**
- In `reference/recon-checklist.md`, add a step alongside the per-service `codebase-discovery`
  fan-out: for each service in **Affected Services**, read its durable business-rule suite
  (`services/xstockstrat-<svc>/acceptance/*.feature`) plus `docs/sdd/business-rules/platform.feature`.
  The **`service-briefing`** subagent already reads a service's own docs for the orchestrator; extend
  it to surface that service's `acceptance/` suite, so recon gets existing rules *in the briefing it
  already requests* — no extra orchestrator-window cost.
- `templates/recon.md` gains a section **`## Existing Business Rules (preserve / extend)`** — the
  behavioral counterpart to **Patterns to REUSE**. It lists the `@AC-*` scenarios the feature must not
  break and the ones it extends, each with its source suite. This is where "faster context of the
  existing business rules" is realized: the designer sees the current guarantees without reading specs
  or grepping code.

**Phase 1 (Grilling) — the adversary checks for regressions.**
- The proposer and **design-adversary** are handed both the new `acceptance.feature` and the relevant
  existing scenarios. A proposal that would **break an existing `@AC-*` guarantee is a regression
  objection**, cited by rule ID exactly as the adversary cites a `C-*`/`F-*` breach today.
- Changing (not just adding) an existing business rule requires **explicit user sign-off recorded in
  `context.md`** — a changed rule is a deliberate behavior change, never a silent edit. `design.md`
  records which existing rules the approach **preserves**, **extends**, or **changes** (the last with
  the sign-off reference).
- New scenarios discovered during the debate are added back to the feature's `acceptance.feature`
  (still the single authoring surface until promotion).

### 4.4 `/sdd-spec` (Phase 2 — the traceability spine)
- **Load-bearing change**: every `test` step body gains a `**Covers**: AC-2, AC-5` line naming the
  scenario IDs it verifies.
- New coverage rule in `reference/spec-template.md`: **every scenario in `acceptance.feature` must be
  covered by at least one test step.** An uncovered scenario blocks the spec (parallels the existing
  C-14 consumer-surface coverage rule).
- This is what converts "did we regress?" into a mechanical diff: scenarios ↔ test steps is now an
  explicit, checkable mapping.

### 4.5 `/sdd-execute` (Phase 3 — RED assertion ↔ scenario)
- In `reference/tdd-gate.md`, the RED assertion for a code-bearing step names the scenario ID it
  makes fail-then-pass. The red→green evidence block in the PR body and `context.md` records the ID
  (e.g. `red: AC-2 "insufficient history" not raised → green: passed`).
- No new gate; the existing red-before-green protocol simply cites the scenario.

### 4.6 `/sdd-qa` (cross-cutting — scenario ↔ test mapping)
- `design`/`gaps` map each scenario → RED assertion → test layer (unit / integration / Playwright).
- `gaps` reports any scenario with no covering test as an explicit coverage gap against the
  service's CI threshold.

### 4.7 Artifact-set plumbing (the cost of a separate file)
The per-feature file set is enumerated in several places; all must learn about `acceptance.feature`:

- **`/sdd-sync`**: add `acceptance.feature` to the synced set (the "seven SDD artifacts" list and the
  per-file 3-way-merge loop) — becomes eight.
- **`/sdd-execute` (final integration PR) + `/promote`**: **promote** the feature's
  `acceptance.feature` scenarios into the durable per-service suite(s) when the feature lands in the
  trunk (§2.3). Promotion = append the scenarios to `services/xstockstrat-<svc>/acceptance/*.feature`
  (or `platform.feature`), deduped against what's already there. This is the point durability begins.
- **`/sdd-archiver`**: **does not delete** the per-feature `acceptance.feature` (resolves O-1) — but it
  is no longer the *durable* copy either, since promotion already happened at launch. The archiver's
  role is the later **dedup / curation** pass over the per-service suites (collapse near-duplicate
  scenarios, retire rules a rollback invalidated), consistent with its existing "distill durable
  memory" job. The per-feature file may be pruned *after* its scenarios are confirmed present in the
  suite.
- **`docs/roadmap/features/CLAUDE.md`**: add `acceptance.feature` to the "Files in Each Feature
  Directory" table (created by `/sdd-story`).
- **`/sdd-status`**: probe for `acceptance.feature` presence and report scenario count (optional,
  low priority).
- **`/sdd-triage` (Track C bugs)**: bug features may add a regression scenario reproducing the defect
  — a natural anti-regression fit, but **optional** for v1.

### 4.8 Constitution (`docs/sdd/constitution.md`)
- Add a Commandment at the next free ID — **C-15**: *"Every acceptance scenario in
  `acceptance.feature` traces to at least one test step / RED assertion; an uncovered scenario blocks
  impl-spec review. Scenario IDs (`@AC-*`) are append-only per feature."*
- Add a second Commandment — **C-16 (business-rule regression guard)**: *"Recon reads the durable
  business-rule suites of every affected service; a design that would break an existing `@AC-*`
  guarantee is a regression and is blocked. Changing (not merely adding to) an existing business rule
  requires explicit user sign-off recorded in `context.md`."* This is the deeper-integration rule —
  it makes the accumulated scenarios a binding regression check at design time.
- Amend the note on **C-08** to reference scenario coverage as the source of the behaviors the paired
  tests must cover.
- IDs are append-only, so this is non-breaking to every doc that cites existing IDs.

---

## 5. Rollout

**Decision (resolves former O-4): binding immediately — no advisory pilot window.** C-15 and the
scenario↔test coverage gate are enforced from the adoption PR onward.

1. **One PR lands everything**: this proposal, the skill edits (§4.1–4.7), Constitution **C-15** +
   **C-16** (§4.8), and the seed per-service `acceptance/` directories with `platform.feature` —
   docs/skills-only, to `main-dev`.
2. **Applies to features entering the pipeline after adoption.** Any feature that reaches
   `/sdd-story` or `/sdd-review product-spec` after the adoption PR must carry a well-formed
   `acceptance.feature`; a missing/uncovered scenario is a hard `BLOCKER` citing C-15.
3. **Grandfather in-flight and completed work.** Features already at `spec-ready` or later are **not**
   re-gated, and the ~32 features with a `product-spec.md` are **not backfilled** (archived features
   have no `product-spec.md` at all). Backfilling would be pure token cost catching no regression.
4. **First real feature is the de-facto dogfood** — because the gate is binding, the first
   post-adoption feature both validates the format and is held to it; refine the templates by
   fast-follow PR if friction surfaces, not by relaxing the gate.

---

## 6. Cost / benefit summary

| Dimension | Impact |
|---|---|
| New tooling / CI | **None** (spec-layer only) |
| New per-feature file | One (`acceptance.feature`) |
| New durable artifact | Per-service `services/xstockstrat-<svc>/acceptance/*.feature` + `docs/sdd/business-rules/platform.feature` |
| Skills touched | 6 edited (`story`, `review`, `design`, `spec`, `execute`, `qa`) + 2 plumbing (`sync`, `archiver`) + `service-briefing` subagent + inventory docs |
| Constitution | +2 IDs (`C-15`, `C-16`), 1 amended note |
| Recurring token cost | Low — recon loads only *affected-service* suites (scales with blast radius, not feature count); scenario↔test check is a diff, not a model pass |
| Anti-slop | Concrete, falsifiable behavior pinned before design; adversary grills scenarios |
| Anti-regression | Two-layer: mechanical scenario↔test coverage at spec/review **and** a design-time regression guard (C-16) against the durable business-rule suites |
| Faster context | Recon surfaces existing business rules per affected service (via `service-briefing`) — the behavioral map the designer would otherwise reconstruct by reading specs/code |

---

## 7. Settled decisions & remaining open questions

**Settled:**

- Executability → **spec + traceability only** (no per-language BDD runners). §2.1.
- Placement → **separate `acceptance.feature`** file. §2.2.
- AC format → **`acceptance.feature` replaces** the prose `## Acceptance Criteria`. §3 (was O-2).
- Enforcement → **binding immediately** from the adoption PR; grandfather in-flight/completed work;
  no backfill. §5 (was O-4).
- Durable rule home → **per-service co-located** suites + `platform.feature`. §2.3.
- Promotion trigger → **at launch / integration**; archiver is the later curation pass. §2.3, §4.7
  (resolves O-1: per-feature file is not deleted, and the durable copy lives in the suite).
- Cross-service index → **none for v1**. §2.3.

**Still open:**

- **O-3** — Should Track-C bug fixes be *required* to add a regression scenario at adoption, or is that
  a fast-follow?
- **O-5** — Promotion mechanics: fully manual (the operator appends during the integration PR),
  assisted (a promotion helper/subagent dedups and appends), or a scripted check that CI enforces
  suite membership before `launched`? (Leaning assisted-but-manual for v1 to avoid new machinery.)
