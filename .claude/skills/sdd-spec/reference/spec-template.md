# sdd-spec — implementation-spec.md template

Write `$FEATURE_DIR/implementation-spec.md` using this exact structure.

```markdown
# Implementation Spec: <slug>

**Status**: `pending`
**Created**: <ISO date>
**Feature**: `docs/roadmap/features/<NNN-slug>/feature.md`
**Total Steps**: N
**Feature Branch**: `feature/<slug>`

---

## Execution Summary

<2–4 sentences explaining the implementation order and why>

## Step Dependencies

- Step N requires Step M: <reason>
- (list all ordering constraints)

---

### Step N — <category>: <title>

**Status**: `pending`
**Service**: `xstockstrat-<name>` (or `packages/proto`, `docs/runbooks/`, etc.)
**Files**:
- `exact/path/to/file` — modify | create | delete
(For `service` steps that introduce a new environment variable or port: also list
`docker-compose.yml`, `.do/app.dev.yaml`, and `.do/app.yaml` as modify — confirmed absent
via the deployment-file audit in discovery.)

**Reviewers**: <role1> — <focus phrase from registry>, <role2> — <focus phrase>
(Look up step category + **Service** in docs/runbooks/reviewer-registry.md governance matrix.
For `proto-gen` steps: inherit reviewers from the immediately preceding `proto` step.
For `docs` steps: write "none".)

**Codebase Evidence**:
- Confirmed via: `grep -n "SymbolName" services/.../file.ext` → line N
- Existing pattern: `<direct quote or close paraphrase of actual code found>`

**TDD**: `red-green required` (code-bearing `service`/`test` steps) | `N/A (<reason>)` for
non-code-bearing categories (`proto`, `proto-gen`, `migration`, `config`, `docs`). When red-green is
required, `/sdd-execute` proves the paired test fails before implementation, then passes after — see
`.claude/skills/sdd-execute/reference/tdd-gate.md`.

**Covers**: `AC-2, AC-5` — the `@AC-*` scenario ID(s) from `acceptance.feature` this step verifies
(Constitution **C-15**). Required on every `test` step; omit (`—`) on non-test steps. Every scenario
in `acceptance.feature` must appear in some step's `**Covers**` (see § Scenario coverage rule).

**Instructions**:
<Precise, actionable steps that cite real file paths and real symbol names confirmed above>

**Verification**:
<Exact bash command to run, or exact output/behavior to observe>

---

(repeat for all steps)

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
```

Categories to use for step naming: `proto`, `proto-gen`, `migration`, `service`, `config`, `docs`, `test`.

## Scenario coverage rule (Constitution C-15)

Read `acceptance.feature`. **Every `@AC-*` scenario must be covered by at least one step's
`**Covers**` line** — normally a `test` step, occasionally a Playwright/e2e step for a UI scenario.
Build the mapping explicitly:

- In `## Execution Summary` (or a short `## Scenario Coverage` block), list each `@AC-N` → the step
  number(s) that cover it. An uncovered scenario is a spec defect — either add the covering test step
  or, if the scenario is out of scope for this feature, that is a product-spec problem to resolve in
  `/sdd-review`, not to paper over here.
- A `test` step's `**Verification**` still enforces the CI coverage threshold (**C-08**); `**Covers**`
  is the orthogonal behavioral traceability that makes a dropped scenario visible.
- `/sdd-execute` reuses these IDs: the RED assertion for a covered step names its `@AC-*`
  (`reference/tdd-gate.md`).

This mirrors the consumer-surface rule below: C-14 is "reach every named surface"; C-15 is "cover
every named scenario."

## Consumer-surface coverage rule (Constitution C-14)

Read the product spec's `## Consumer Surface(s)`. For **every** surface it names, the spec MUST
contain at least one step that lands the change on that surface:

- A named **UI** segment (`/trader` / `/insights` / `/config-ui`) → a `service` step touching
  `services/xstockstrat-ui/` (page/route/component + its client call), plus — for a new page/route —
  the `PLATFORM_SUBNAV` nav registration and reachability test that **C-10** already requires.
- A named **Agent** tool → a `service` step touching `services/xstockstrat-agent/` (the MCP tool
  definition / arg / response mapping).

Do not stop at the backend step that produces the data. A spec that updates the RPC but never the
UI/Agent that exposes it is the exact "backing service updated, consumer surface stale" failure
C-14 exists to catch. If the product spec marked the surface `None — internal/platform-only`, no
such step is required — restate that in `## Execution Summary` so the reader knows it was a decision,
not an omission. A deferred surface must name its follow-up feature in `## Step Dependencies`.

## Migration step verification is offline — never bring up a database

A `migration` step is non-code-bearing (`**TDD**: N/A`). Its `**Verification**` must be an
**offline, no-DB** check the execute loop can run in seconds — never a command that starts or waits
on a database. Write it as: both `NNN_*.up.sql` and `NNN_*.down.sql` exist with the correct next
`NNN`, and the `.down.sql` reverses the `.up.sql` by inspection. Example:

```
ls services/<name>/migrations/<NNN>_*.up.sql services/<name>/migrations/<NNN>_*.down.sql
# then read both: confirm every CREATE/ALTER/ADD in .up has an inverse DROP/ALTER in .down
```

The real apply-and-rollback runs in CI / at deploy against the managed database — that is where a
live migration is proven, not in `/sdd-execute`. Do **not** spec `docker run postgres`, a `migrate`
apply, or `psql` against a spun-up instance as a step verification (v5 executors hang waiting on the
container). This mirrors `/sdd-execute`'s HARD CONSTRAINT.

## Test step pairing rule

Every `service` step for a non-frontend service must have a corresponding `test` step (Constitution
**C-08**). Place it immediately after the `service` step, or declare it in `## Step Dependencies`
(e.g. "Step 5 [test] covers Step 4 [service]"). The `test` step's `**Verification**` must be a
runnable bash command enforcing the CI coverage threshold, and must also include the
language's lint command per `reference/step-constraints.md` §B (lint + coverage together
satisfy the code-quality gate).

**Author the paired test to fail first (red-before-green, Constitution P-06).** The `test` step must
be written so that, run against the pre-implementation tree, it **fails** — it asserts the new
behavior, not a tautology. `/sdd-execute` enforces this: for code-bearing steps it captures the
failing run before the implementation step and the passing run after (`reference/tdd-gate.md`). Both
the `service` step and its `test` step carry `**TDD**: red-green required`.

Coverage thresholds and verification commands:

| Service | Threshold | Verification command |
|---|---|---|
| xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata | 40% | `cd services/<name> && GOWORK=off COVERPKGS=$(go list ./... \| grep -Ev '/(cmd\|handler\|repository\|telemetry\|service)(/\|$)' \| tr '\n' ',' \| sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out \| grep "^total:"` — confirm ≥ 40% |
| xstockstrat-indicators | 50% | `cd services/xstockstrat-indicators && pytest --cov=app --cov-fail-under=50` |
| xstockstrat-ingest, xstockstrat-analysis | 40% | `cd services/<name> && pytest --cov=app --cov-fail-under=40` |
| xstockstrat-config, xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify | 40% | `cd services/<name> && pnpm run test:coverage` — confirm threshold passes |
| xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui | n/a | No coverage threshold — use `pnpm test:e2e` or note existing E2E coverage applies |

If new code lands only in Go packages excluded from CI measurement (`cmd/`, `handler/`,
`repository/`, `telemetry/`, `service/`), note this in the `test` step:
"New logic is in an excluded package — no coverage threshold applies; integration test
verification is sufficient." A `test` step is still required.
