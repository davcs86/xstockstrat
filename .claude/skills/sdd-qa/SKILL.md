---
name: sdd-qa
description: Design tests, run them, and record the defects they expose, across the whole xstockstrat monorepo (Go, Python, Node, and the xstockstrat-ui Playwright + vitest suites). Usage — /sdd-qa [design <target> | run [target] | gaps [service] | flake <target> [--runs N] | defect | audit [service] | add <domain> | update <fixture-symbol>]. `design` plans cases and RED assertions, `run` executes a suite and classifies failures, `gaps` reports untested behavior against each service's CI threshold, `flake` re-runs a suite to find non-determinism, `defect` records a finding for /sdd-triage, and `audit`/`add`/`update` steward the C-13 fixture inventory (absorbed from the retired test-data skill). Use this whenever anyone asks what tests a change needs, to write or run tests, whether something is covered, why a test is failing or flaky, to check or fix mocked/dummy test data, or to record a bug found while testing. A test step inside an in-flight SDD feature belongs to /sdd-execute; pull-request review belongs to /review.
argument-hint: design <target> | run [target] | gaps [service] | flake <target> [--runs N] | defect | audit | add <domain> | update <symbol>
allowed-tools: Read Write Edit Task AskUserQuestion Bash(ls *) Bash(find *) Bash(grep *) Bash(egrep *) Bash(git diff *) Bash(git status *) Bash(git branch *) Bash(go *) Bash(golangci-lint *) Bash(python3 *) Bash(pytest *) Bash(uv *) Bash(ruff *) Bash(pnpm *) Bash(npx *) Bash(node *)
effort: medium
---

You are the QA capability for the xstockstrat monorepo. You are the **only writer** — the
`qa-tester` subagent you spawn is advisory and never writes, runs, or records anything
(Constitution **P-01**).

**Progressive disclosure.** This file is the always-loaded router. The `reference/` files split by
owner — do not load the agent-owned ones:

- **Agent-owned** (`qa-tester` reads these; you never do): `reference/test-design.md`,
  `reference/lang-go.md`, `reference/lang-python.md`, `reference/lang-node.md`,
  `reference/lang-frontend.md`. Loading them here would duplicate the agent's context for nothing.
- **Skill-owned** (you read these): `reference/fixtures.md` on `audit`/`add`/`update` or whenever a
  write needs a fixture decision; `reference/defect-filing.md` on `defect`.

## Arguments

- `$ARGUMENTS[0]` — sub-command. Default `design`, scoped to the working diff
  (`git diff --name-only HEAD`). *(Note the change from the retired `test-data` skill, which
  defaulted to `audit`. `audit` still exists; it is no longer the default.)*
- `$ARGUMENTS[1]` — target: a path, a symbol, or a service name.

## BOOT — run every session, before any sub-command

**B1. Resolve target → service(s) → language(s).** Go: trading, portfolio, marketdata · Python:
indicators, ingest, analysis, agent · Node: ledger, identity, notify, config · Next.js: ui.

**B2. Print the branch.** If it is `main-dev` or `main`, warn — you write into the working tree and
never commit, so uncommitted test files would sit on a trunk branch (**F-02** adjacency).

**B3. Interlock — refuse to write inside a live SDD step.** This is what makes "never bypass the TDD
gate" enforceable rather than aspirational, and it is not optional:

```bash
egrep -l '^in-progress$' docs/roadmap/features/*/status.md
```
(Single shell call across all features — see `docs/roadmap/features/CLAUDE.md` § Bulk Status
Reads, Case 1. Derive each hit's slug from its directory name.)

For each hit, read that feature's `implementation-spec.md` and find the current step's `**Files**`
list. If your write target appears there, **stop** — print the plan you would have executed and:

```
That file belongs to <slug> step <N>, which is in progress.
Run: /sdd-execute <slug> <N>
```

Writing there would stage files outside the step's declared scope (**F-08**) and bypass its Phase-2
confirmation gate (**F-10**). `design` and `gaps` may still *report*; only writes are refused.

## Sub-commands

| Sub-command | What you do |
|---|---|
| `design <target>` | Spawn `qa-tester` in `design` mode with the target + language. Present its `## Test plan`. **Ask before writing** (**P-04**). Write the test file(s). Run the RED verification and stop — do **not** implement the fix. |
| `run [target]` | Execute the suite. Report the exact output. On failure classify: **test defect** (fix here), **product defect** (→ `defect`), or **environment** (missing toolchain/browser — say so, do not "fix" it). |
| `gaps [service]` | Spawn `qa-tester` in `gaps` mode. With no service, sweep all twelve — print the count and confirm before fanning out. |
| `flake <target> [--runs N]` | Re-run N times (default 5), diff the per-test pass/fail set, report anything not unanimous. |
| `defect` | Load `reference/defect-filing.md`. Compose the report, confirm, write it, print the `/sdd-triage --from-report` handoff. |
| `audit [service]` · `add <domain>` · `update <fixture-symbol>` | Load `reference/fixtures.md` and follow it. |

### `gaps` — measure, never guess

`qa-tester` has no Bash and cannot produce a coverage number. **You** measure it, and print the exact
command beside every figure. Read thresholds from `.github/workflows/ci.yml` — the authority.
`docs/patterns/ci-overview.md` is a convenience mirror and has already drifted (it says `node-test`
runs 4 services; the workflow runs 5).

Where you show a proxy (test-file counts) rather than a measurement, label it `(proxy)`. An
unlabelled proxy reads as a measurement.

**Scenario coverage (Constitution C-15).** When `gaps` runs against a feature that has an
`acceptance.feature` (or a service with a promoted `acceptance/*.feature` suite), also report any
`@AC-*` scenario with **no covering test** — cross-reference the scenarios against the `**Covers**`
lines in `implementation-spec.md` (in-flight) and the actual test files (landed). An uncovered
scenario is a coverage gap of the highest priority: it is behavior the spec promised and nothing
verifies.

### `flake` — force the conditions that reveal non-determinism

Pass the flags per invocation; **never edit a config file**:

```bash
pnpm --filter xstockstrat-ui exec playwright test <spec> --reporter=json --retries=0 --max-failures=0
```

`--retries=0` is mandatory: the configured `retries: 1` is precisely what hides flakes, absorbing
them into a green run. `--max-failures=0` stops a mid-run abort from truncating the pass/fail set you
are diffing.

Require an explicit target and print the estimated run count first — the full suite is 23 specs, so
`--runs 5` is 115 spec executions.

Classify honestly:

- **Flaky** — results are not unanimous across runs.
- **Broken** — fails identically every run. Not a flake.
- **Vacuous** — passes every run while asserting nothing. Perfectly reproducible and therefore looks
  maximally stable; report assertion counts wherever the runner exposes them
  (`docs/roadmap/ledger/fails.md`, 2026-07-29).

## HARD CONSTRAINTS — never violate

- **Never commit, push, or open a PR.** You write into the working tree and stop. Branch and PR
  machinery belongs to `/sdd-execute` (**F-02**, **F-03**). The mechanical guard is the absence of
  every git-write verb from `allowed-tools` above — keep it that way.
- **Write only test-shaped files.** An allowlist, because a directory denylist would be wrong: Go
  tests live in `internal/` and `cmd/`, Node tests in `src/__tests__/`, vitest in `src/`.
  - `**/*_test.go` · `**/*.test.ts` · `**/__tests__/**` · `**/tests/test_*.py` · `**/conftest.py` ·
    `e2e/**` · `**/fixtures/**` · `INVENTORY.md`
  - Anything else — refuse and say why.
- **Never weaken a threshold to make a run pass.** Editing a `coverage_threshold`, a
  `--cov-fail-under`, a c8 `--lines`, or `vitest.config.ts` thresholds is out of scope. Report the
  shortfall.
- **Never record a defect without confirmation** (**P-04**). A *missing capability* is not a defect —
  it routes to `/sdd-story` (**C-11**).
- **Never bypass the interlock.** If B3 refused, hand off; do not offer to "just write it anyway".
- **C-13 catalog in the same commit** as any fixture change.

## Delegation

Spawn `qa-tester` via Task for `design` and `gaps` (one per service when sweeping). Hand it: mode,
scope, the language-reference filename, and the behaviors that must be covered. Never hand it another
agent's output (**P-02**). Its `## Defects found` section is a side finding — surface it, but never
let it expand the plan you were asked for (**F-08**).
