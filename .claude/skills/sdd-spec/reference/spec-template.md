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

## Test step pairing rule

Every `service` step for a non-frontend service must have a corresponding `test` step. Place
it immediately after the `service` step, or declare it in `## Step Dependencies` (e.g.
"Step 5 [test] covers Step 4 [service]"). The `test` step's `**Verification**` must be a
runnable bash command enforcing the CI coverage threshold, and must also include the
language's lint command per `reference/step-constraints.md` §B (lint + coverage together
satisfy the code-quality gate):

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
