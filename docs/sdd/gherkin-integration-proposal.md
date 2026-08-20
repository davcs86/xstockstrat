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

`## Acceptance Criteria` in `product-spec.md` is retained as a short human-readable summary; the
`.feature` file is the authoritative, testable form. (Alternatively, the AC section may become a
one-line pointer to `acceptance.feature` — decide at adoption.)

---

## 4. Pipeline integration — per-skill touchpoints

Each change is additive and surgical; no new skills are created.

### 4.1 `/sdd-story` (Phase 1 — writes the artifact)
- After writing `product-spec.md`, generate `acceptance.feature` with a `Feature:` block and one
  tagged `Scenario:` per acceptance criterion, derived from the FRs and the user story.
- Add `acceptance.feature` to the `## Artifacts` list in `feature.md` and to the file-list echoed to
  the operator.
- The SKILL's `allowed-tools` already permit `Write`; no tooling change.

### 4.2 `/sdd-review product-spec` (Phase 1.5 — gates the artifact)
- Add review criteria (in `reference/product-spec-criteria.md`): `acceptance.feature` exists; every
  `FR-N` maps to ≥1 scenario; every scenario is well-formed (concrete values, observable `Then`,
  no implementation leakage); IDs are unique.
- A malformed or missing `.feature` is a `BLOCKER` citing the new Constitution ID (§4.8), keeping the
  `draft → spec-ready` gate meaningful.

### 4.3 `/sdd-design` (Phase 1.75 — grills the scenarios)
- Phase-0 recon and the proposer read `acceptance.feature`; the **design-adversary** attacks it:
  missing edge cases, unobservable outcomes, scenarios that cannot be reached through the named
  consumer surface (`C-14`).
- `design.md` records which scenario IDs each design decision satisfies. New scenarios discovered
  during the debate are added back to `acceptance.feature` (the one place they live).

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
- **`/sdd-archiver`**: decide its fate at archive time. **Recommendation: keep it** (do *not* add it
  to the deletion allowlist alongside `product-spec.md`/`recon.md`/`design.md`/`implementation-spec.md`).
  The acceptance contract is durable regression memory — the kind of thing the archiver is meant to
  *preserve*, not prune. Alternatively, fold its scenarios into the `## Archive Synthesis` block and
  then delete. **Open question O-1.**
- **`docs/roadmap/features/CLAUDE.md`**: add `acceptance.feature` to the "Files in Each Feature
  Directory" table (created by `/sdd-story`).
- **`/sdd-status`**: probe for `acceptance.feature` presence and report scenario count (optional,
  low priority).
- **`/sdd-triage` (Track C bugs)**: bug features may add a regression scenario reproducing the defect
  — a natural anti-regression fit, but **optional** for v1.

### 4.8 Constitution (`docs/sdd/constitution.md`)
- Add one Commandment at the next free ID — **C-15**: *"Every acceptance scenario in
  `acceptance.feature` traces to at least one test step / RED assertion; an uncovered scenario blocks
  impl-spec review. Scenario IDs (`@AC-*`) are append-only per feature."*
- Amend the note on **C-08** to reference scenario coverage as the source of the behaviors the paired
  tests must cover.
- IDs are append-only, so this is non-breaking to every doc that cites existing IDs.

---

## 5. Rollout

1. **Docs/spec first** (this proposal + the skill/Constitution edits) — a docs-only PR to `main-dev`.
2. **Opt-in** on the next 2–3 *new* features to prove the format and the traceability check.
3. **Do not backfill.** The 32 features that still have a `product-spec.md` are not retrofitted;
   archived features have no `product-spec.md` at all. Backfilling would be pure token cost with no
   regression caught.
4. **Promote to enforced** (C-15 becomes a hard `/sdd-review` blocker) only after the opt-in features
   validate the workflow.

---

## 6. Cost / benefit summary

| Dimension | Impact |
|---|---|
| New tooling / CI | **None** (spec-layer only) |
| New per-feature file | One (`acceptance.feature`) |
| Skills touched | 6 edited (`story`, `review`, `design`, `spec`, `execute`, `qa`) + 2 plumbing (`sync`, `archiver`) + inventory docs |
| Constitution | +1 ID (`C-15`), 1 amended note |
| Recurring token cost | Low — one text artifact read/written per feature; scenario↔test check is a diff, not a model pass |
| Anti-slop | Concrete, falsifiable behavior pinned before design; adversary grills scenarios |
| Anti-regression | Mechanical scenario↔test coverage check at spec/review; durable acceptance contract retained through archive |

---

## 7. Open questions

- **O-1** — Archiver policy: **keep** `acceptance.feature` as durable regression memory (recommended),
  or fold-and-delete into `## Archive Synthesis`?
- **O-2** — `## Acceptance Criteria` in `product-spec.md`: keep as a human summary, or reduce to a
  pointer at `acceptance.feature`?
- **O-3** — Should Track-C bug fixes be *required* to add a regression scenario in v1, or is that a
  later phase?
- **O-4** — Enforcement timing: how many opt-in features before C-15 flips from advisory to blocking?
