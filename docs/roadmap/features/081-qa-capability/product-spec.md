# Product Spec: qa-capability

**Created**: 2026-07-29
**Revised**: 2026-07-29 (post-`/sdd-design` — the design round returned BLOCKED; see § Revision note)

---

## Problem Statement

Three parts of the testing lifecycle are unowned. Nothing in `.claude/` helps **design or write** a
test — all seven subagents are SDD spec/design reviewers. **Coverage is never aggregated** — each CI
job enforces its own threshold with nothing reporting across services. And **flaky tests are
silently absorbed**: `playwright.config.ts:106` sets `retries: 1` in CI, so a flaky spec passes on
retry and leaves no trace, while Go, pytest, and `node:test` have no retry at all.

`/test-data` covers only a sliver: mocked *data* for `xstockstrat-ui`, nothing about test design,
execution, or defects.

## Revision note — what the design round changed

`/sdd-design qa-capability quick` returned **BLOCKED** on an **F-04** breach. The original FR-5 was
built on `gh issue create`, but **GitHub Issues are disabled** on `davcs86/xstockstrat`
(`POST /issues` → `410 Issues has been disabled`, recorded in `067/context.md:20`,
`074/feature.md:7`, `075`–`078`, and `docs/CLAUDE.md:15`). The premise that "step 1 of defect
handling has no owner" was **wrong** — it has a documented owner: evidence-direct `/sdd-triage` with
an issue-less slug, plus `docs/reports/`, used by six features.

Two further defects were caught before any code shipped:

- **Severity misrouting.** `bug-report.yml:53` labels a checkbox group `SEV-1 safety check`. GitHub
  renders group labels into the issue body, and `/sdd-triage` T-2 tests `Contains "SEV-1"` **first**
  (`sdd-triage/SKILL.md:97-99`). Every filed defect — including a SEV-3 UI nit — would have routed to
  Track A: branch from `main`, PR to `main`. The original AC-7 would have **passed while wrong**.
- **The write boundary forbade the core job.** "Never edit `src/`, `app/`, `internal/`" blocks
  test-writing for 8 of 12 services: Go tests live in `internal/` and `cmd/`, Node tests in
  `src/__tests__/`, vitest in `src/`.

## User Story

As a developer, I want an agent that designs tests at the right layer, runs them, reports coverage
gaps across all services, detects flaky tests, and records the defects it discovers where
`/sdd-triage` can route them — so that test authoring, coverage assessment, and defect capture stop
being ad hoc.

## Functional Requirements

FR-1. A read-only `qa-tester` subagent designs a test plan (layer, file, cases, RED assertion, test
data, exact run command), inventories test coverage, and reports side defects with SEV-1..3 severity,
impact type, and `path:line` evidence. It never writes, runs, or files (**P-01**).

FR-2. A write-capable `sdd-qa` skill is the sole actor that writes test files and executes suites.
Sub-commands: `design` (default) · `run` · `gaps` · `flake` · `defect` · `audit` · `add <domain>` ·
`update <fixture-symbol>`.

FR-3. `sdd-qa gaps` with no argument sweeps every service into one table, sourcing thresholds from
`.github/workflows/ci.yml` (the authority — `docs/patterns/ci-overview.md` has already drifted). Every
number prints beside the exact command that produced it.

FR-4. `sdd-qa flake <target> [--runs N]` re-runs a suite N times and reports any test that is not
unanimous. It passes `--retries=0 --max-failures=0 --reporter=json` per invocation — `retries=0` is
mandatory, since the configured `retries: 1` is precisely what hides flakes. **No config file is
edited.** A run failing identically every time is classified broken, not flaky.

FR-5. `sdd-qa defect` writes `docs/reports/<ISO-date>-<slug>-defect.md` carrying the fields
`/sdd-triage` needs, and prints `/sdd-triage --from-report <path>`. Severity is emitted as exactly
**one** unambiguous `SEV-N` token in the whole document.

FR-6. `/sdd-triage` gains a `--from-report <path>` entry point beside its issue-number one, skipping
T-1's `gh issue view` and parsing the report instead.

FR-7. `/test-data`'s three sub-commands move to `sdd-qa` unchanged in behavior; the old skill
directory is deleted and every reference updated.

FR-8. A new Constitution **C-13** states the language-agnostic test-data rule and **names a canonical
fixture home per language**; **C-12** narrows to "the `xstockstrat-ui` instance of C-13."

FR-9. `sdd-qa`'s boot refuses to write into the `**Files**` of a live `implementation-spec.md` step,
printing the plan and `/sdd-execute <slug>` instead (**F-08**, **F-10**).

FR-10. The `sdd-design` Phase 0 coverage read extends `codebase-discovery`'s existing per-service
spawn via `discovery-checklist.md` — it does **not** add a second agent
(`recon-checklist.md:8`: "reuse the existing discovery recipe").

## Out of Scope

- **`gh issue create`** — impossible on this repo today.
- **Historical flake tracking** — trends, quarantine lists. Needs cross-run persistence that does not
  exist. `sdd-qa flake` detects non-determinism *now*.
- **Creating fixture inventories ahead of demand.** C-13 names homes; this feature creates **zero**
  directories.
- **Editing runtime code, committing, or pushing.**
- **Any `services/xstockstrat-ui/**` change beyond two comment/catalog lines** — FR-4's CLI-flag
  approach removes the `playwright.config.ts` edit entirely.
- **Backfilling missing tests.** This ships the capability, not the coverage.

## Affected Services

None. All work is repo-level tooling (`.claude/`), governance (`docs/`), and `.github/`. The only
`services/**` touches are two comment lines in `services/xstockstrat-ui/e2e/fixtures/`
(`INVENTORY.md:5`, `index.ts:11`) repointing `/test-data` → `sdd-qa`.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch: `feature/qa-capability` (from `main-dev`).

Approval gates (per `docs/runbooks/feature-workflow.md`):

- [x] **Platform lead** — appends Constitution **C-13**, narrows **C-12**, and defines the **P-01**
      boundary for a write-capable skill paired with an advisory subagent
- [ ] Service owner — **not required**: no service code changes (the `xstockstrat-ui` gate disappeared
      when FR-4 dropped the `playwright.config.ts` edit)
- [ ] Breaking proto / schema migration — n/a

**Merge-order**: this feature deletes `.claude/skills/test-data/SKILL.md`; open PR **#810** edits that
same file. Land #810 first, then rebase. Not recorded in `merge-order.md` — that table tracks hard
constraints keyed by *feature slug*, and #810 is a `claude/*` branch with a trivially-resolved
delete/modify conflict.

## Acceptance Criteria

1. `.claude/agents/qa-tester.md` has `tools: Glob, Grep, Read` and `model: inherit` — no Write, Edit,
   or Bash, matching all seven existing agents (**P-01**).
2. `.claude/skills/sdd-qa/SKILL.md` declares an explicit `allowed-tools` containing **no** git-write
   verb, no `gh pr`, and no `gh issue`. The mechanical absence is the guard, not the prose.
3. `sdd-qa`'s write boundary is expressed as a **file-pattern allowlist** and demonstrably permits
   `**/*_test.go`, `**/*.test.ts`, `**/__tests__/**`, `**/tests/test_*.py`.
4. **Removal gate A — dead path**: `grep -rn "\.claude/skills/test-data"` returns nothing,
   `.claude/skills/test-data/` is absent, `context-map.yaml` has no `name: test-data`.
5. **Removal gate B — dead invocation**: `grep -rnE '`/test-data (audit|add|update)'` returns nothing.
   *(Gate on symbols that cease to exist, never the bare word — `fails.md` 2026-07-29 / feature 079.)*
6. `./scripts/check-context-map.sh` prints `OK` at **every** commit, and its `SRCS` now scans
   `.claude/agents/*.md`.
7. `bash .claude/hooks/session-start.sh` lists `sdd-qa` and does not list `/test-data`.
8. `sdd-qa audit` reproduces `/test-data audit`'s output on `services/xstockstrat-ui/e2e` — the
   absorption regression test.
9. A `sdd-qa defect` dry run produces a report containing **exactly one** `SEV-N` token, and
   `/sdd-triage --from-report` classifies it at that severity — verified by executing the parser, not
   by inspection.
10. `qa-tester`'s output contains **no coverage percentage** — it has no Bash and cannot measure one.
    Proxy rows are labelled proxy.
11. **Interlock**: `sdd-qa design` against a file inside a live `implementation-spec.md` step refuses
    and defers to `/sdd-execute`.
12. `git diff --stat` shows zero new fixture directories and no `services/xstockstrat-ui/**` change
    beyond the two comment lines.
13. C-13 names a canonical home for all four languages; C-12 reads as a pointer to it; and C-13's
    enforcement text appears at all four duplicated sites (`constitution.md`,
    `step-constraints.md:30`, `discovery-checklist.md:39-40`, `repo-conventions.md:33`).

## Open Questions

- [ ] **Known trap — `fails.md` 079**: an unexecuted gate is a claim, not a check. AC-5, AC-9, and
      AC-11 must each be *run* against the post-change tree before the PR is called done.
- [ ] **Known trap — `fails.md` 074**: a suite exiting 0 while asserting nothing is not coverage.
      Carried into `reference/test-design.md`; must also constrain `sdd-qa run` and `sdd-qa flake`.
- [ ] Should `/sdd-triage`'s T-2 be hardened to parse a `### Severity` section rather than a bare
      substring? Not needed for the `--from-report` path (we control the format), but the issue path
      stays fragile if Issues are ever re-enabled. Deferred, not resolved.
