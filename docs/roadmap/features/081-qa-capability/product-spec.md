# Product Spec: qa-capability

**Created**: 2026-07-29

---

## Problem Statement

Three parts of the testing lifecycle are unowned. Nothing in `.claude/` helps **design or write** a
test — all seven subagents are SDD spec/design reviewers. Nothing **files** a defect: `/sdd-triage`
is entry-gated on an existing GitHub issue number (`gh issue view $ARGUMENTS[0]`, T-1) and
`grep "gh issue create" .claude/` returns zero hits, so triage owns steps 2→N of defect handling
while step 1 has no owner. And **coverage is never aggregated** — each CI job enforces its own
threshold with nothing reporting across services, while flaky tests are silently absorbed by
Playwright's `retries: 1` and leave no trace.

`/test-data` covers only a sliver of this: mocked *data* for `xstockstrat-ui`, nothing about test
design, execution, or defects.

## User Story

As a developer, I want an agent that designs tests at the right layer, runs them, reports coverage
gaps across all services, detects flaky tests, and files the defects it discovers as GitHub issues
that `/sdd-triage` can route — so that test authoring, coverage assessment, and defect intake stop
being unowned.

## Functional Requirements

FR-1. A read-only `qa-tester` subagent designs a test plan (layer, file, cases, RED assertion, test
data, exact run command), assesses coverage gaps, and reports side defects with SEV-1..3 severity,
impact type, and `path:line` evidence. It never writes, runs, or files anything (**P-01**).

FR-2. A write-capable `/qa` skill is the sole actor that writes test files, executes suites, and
files issues. Sub-commands: `design` (default) · `run` · `gaps` · `flake` · `defect` · `audit` ·
`add <domain>` · `update <fixture-symbol>`.

FR-3. `/qa gaps` with no argument sweeps every service into one table, each row carrying that
service's own CI threshold. This is the only cross-service coverage view in the repo.

FR-4. `/qa flake <target> [--runs N]` re-runs a suite N times (default 5), diffs the pass/fail set
per test, and reports any test that is not unanimous. A run that fails **identically** every time is
classified broken, not flaky.

FR-5. `/qa defect` composes an issue body matching how GitHub renders `bug-report.yml`, files it via
`gh issue create`, and prints `/sdd-triage <n>`. The body must satisfy `/sdd-triage`'s parsers: T-2
greps for the literal `SEV-1|SEV-2|SEV-3`; T-3 looks for a checked `[x]` and for
`config-propagation`. When `gh` is unavailable it prints the composed body instead of erroring.

FR-6. `/test-data`'s three sub-commands move to `/qa` unchanged in behavior; the old skill directory
is deleted and every reference updated.

FR-7. Constitution **C-12** widens from `xstockstrat-ui`-only to any language, materialized lazily:
a mock literal may stay inline while it has exactly one consumer; the **second consumer** forces
centralization plus a catalog row in the same step.

FR-8. `qa-tester` is wired into `sdd-execute`'s TDD gate (supplying the RED assertion when a step
doesn't dictate one) and `sdd-design`'s Phase 0 recon (reporting existing coverage per service).

## Out of Scope

- **Historical flake tracking** — trends, quarantine lists, "failed 4 of the last 30 runs." Requires
  persisting results across runs, which nothing in the repo does today. `/qa flake` detects
  non-determinism *now*; it does not track it over time.
- **Creating fixture inventories ahead of demand.** C-12 widens, but this feature creates **zero**
  new fixture directories. With identity at 1 test file, notify at 1, and config/ledger at 2, the
  expected near-term outcome is that no new inventory is created at all.
- **Writing runtime code.** `/qa` touches test files, fixture modules, and catalogs only.
- **Committing, pushing, or opening PRs.** Branch/PR machinery stays in `/sdd-execute`.
- **Backfilling missing tests across the monorepo.** This ships the capability, not the coverage.

## Affected Services

Exact service names from CLAUDE.md Service Registry:

- `xstockstrat-ui` — two edits only: a `json` reporter added to `playwright.config.ts` so `/qa flake`
  has a machine-readable result, and comment/catalog updates in `e2e/fixtures/`. **No `src/` runtime
  code is touched.**

All other work is repo-level tooling (`.claude/`), governance (`docs/`), and `.github/`. No backend
service code changes.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/qa-capability` (branch from `main-dev`)

Approval gates required (per docs/runbooks/feature-workflow.md):

- [x] 1 service owner approval — `xstockstrat-ui` owner, for the two `services/xstockstrat-ui/**` edits
- [x] Platform lead — this amends the SDD Constitution (**C-12**) and defines the **P-01** boundary
      for a write-capable skill paired with an advisory subagent
- [ ] 2 service owners + platform lead (breaking proto change) — n/a
- [ ] DBA review + service owner (schema migration) — n/a

**Merge-order dependency**: this feature deletes `.claude/skills/test-data/SKILL.md`; open PR **#810**
edits that same file. Land #810 first, then rebase. Record in `docs/roadmap/features/merge-order.md`.

## Acceptance Criteria

1. `.claude/agents/qa-tester.md` exists with `tools: Glob, Grep, Read` and `model: inherit` — no
   Write, Edit, or Bash, matching all seven existing agents (**P-01**).
2. `.claude/skills/qa/SKILL.md` exists with all eight sub-commands and the HARD CONSTRAINTS section;
   its seven `reference/` files exist and every path they cite resolves.
3. `./scripts/check-context-map.sh` prints `OK` at **every** commit in the series, not just the last.
4. **The dead path ceases to exist**: `grep -rn "\.claude/skills/test-data"` returns nothing,
   `.claude/skills/test-data/` is absent, and `context-map.yaml` has no `name: test-data` entry.
   *(Gate on the path, never on the string `/test-data` — prose documenting the removal legitimately
   keeps using it. See `fails.md` 2026-07-29 / feature 079.)*
5. `bash .claude/hooks/session-start.sh` lists `/qa` and does not list `/test-data`.
6. `/qa audit` reproduces `/test-data audit`'s output on `services/xstockstrat-ui/e2e` — the
   regression test for the absorption.
7. A `/qa defect` dry run produces a body where every `validations: required` field of
   `bug-report.yml` is present, and `/sdd-triage`'s T-2 and T-3 greps both match it.
8. C-12's amended text contains no `xstockstrat-ui`-only trigger, states the second-consumer rule,
   and `docs/patterns/test-data-inventory.md` no longer claims the inventory is frontend-only.
9. `git diff --stat` shows **zero** new fixture directories created.
10. `.github/ISSUE_TEMPLATE/bug-report.yml` lists `xstockstrat-ui` and `xstockstrat-agent`, and no
    longer lists `xstockstrat-trader (UI)`, `xstockstrat-insights (UI)`, or `xstockstrat-config-ui (UI)`.

## Open Questions

- [ ] **Known trap — `fails.md` 2026-07-29 (079)**: a removal feature's gates must key on symbols
      that cease to exist, never on vocabulary the docs must keep using. Applied in AC-4; re-check at
      design time that no other gate in this feature repeats the mistake.
- [ ] **Known trap — `fails.md` 2026-07-29 (074)**: a suite that exits 0 while asserting nothing is
      not coverage. `reference/test-design.md` must carry the silent-skip rule, and `/qa run` and
      `/qa flake` must distinguish *passed* from *passed without asserting*.
- [ ] Should `scripts/check-context-map.sh` be hardened to scan `.claude/agents/*.md`? It currently
      does not, so `qa-tester`'s pointers to `reference/` files are unvalidated. One-line change;
      decide at design time whether it belongs in this feature or a follow-up.
