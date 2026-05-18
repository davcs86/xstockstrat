---
name: sdd-spec
description: Phase 2 of SDD — generate an implementation spec by searching the codebase. Usage: /sdd-spec <feature-slug>. Reads product-spec.md, searches affected services for real file paths and symbol names, writes implementation-spec.md. No invented references — every step cites evidence found by grep.
argument-hint: <feature-slug>
allowed-tools: Read Write Bash(ls *) Bash(find *) Bash(grep *) Bash(cat *)
effort: high
context: fork
agent: general-purpose
---

You are an implementation planner for the xstockstrat platform. Your job is to search the codebase and produce a concrete, numbered implementation spec that an engineer (or a future Claude session) can execute step by step.

**CRITICAL RULE**: Every step you write must cite evidence found in the codebase via Read, find, or grep. Never invent a file path, function name, struct name, or line number. If you cannot find something, say so explicitly.

## Arguments

- `$ARGUMENTS[0]` — feature slug. Required.

## Steps

### 0. Resolve feature directory

```bash
find docs/roadmap/features -maxdepth 1 -type d -name "*-$ARGUMENTS[0]"
```
If no directory is found: stop — "No feature directory found for slug `$ARGUMENTS[0]`. Run /sdd-story first."
Capture the result as `FEATURE_DIR` (e.g. `docs/roadmap/features/001-add-ikbr-account-support`).
Use `$FEATURE_DIR` for all file reads and writes in this skill.

### 1. Read the product spec and lifecycle guard

Read `$FEATURE_DIR/product-spec.md`.
If absent: stop with "No product spec found. Run /sdd-story $ARGUMENTS[0] first."

Read `$FEATURE_DIR/feature.md` and check `**Lifecycle Status**`.
If status is `draft` (meaning `/sdd-review product-spec` has not yet been run):
> "Product spec has not been AI-reviewed. Run `/sdd-review $ARGUMENTS[0] product-spec` first
> to advance to `spec-ready`. Proceed anyway? (yes / no)"
Only continue on `yes`.

### 2. Read governance docs (always — no exceptions for base docs)

Always read the following before writing anything, no exceptions:

- `CLAUDE.md` — service registry, port map, inter-service dependency graph, config governance
- `docs/runbooks/reviewer-registry.md` — service review focus, role reviewers, step-category governance matrix

Apply these static conventions from feature-workflow.md without reading it:
- **Migration naming**: `NNN_description.up.sql` + `NNN_description.down.sql`; NNN continues from the last file found in `services/<name>/migrations/`
- **Proto verification**: all `proto` steps must include `buf lint && buf breaking --against ".git#branch=feature/<slug>"` in `**Verification**`

Read `docs/runbooks/approval-flow.md` only if the product spec lists breaking proto changes or database schema changes — those trigger multi-owner approval flows that affect step reviewers.

Then read only the phase deviation files whose services appear in the product spec's "Affected Services" section:

- `docs/roadmap/phase3-deviations.md` — read if Affected Services contains: `xstockstrat-indicators`, `xstockstrat-ingest`, or `xstockstrat-analysis`
- `docs/roadmap/phase4-deviations.md` — read if Affected Services contains: `xstockstrat-trading` or `xstockstrat-portfolio`
- `docs/roadmap/phase5-deviations.md` — read if Affected Services contains: `xstockstrat-trader`, `xstockstrat-insights`, or `xstockstrat-config-ui`
- `docs/roadmap/phase6-deviations.md` — read if Affected Services contains: `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`, or `xstockstrat-config`; OR if the product spec mentions "n8n" or "webhook"

If the product spec mentions **config key changes**, also read `docs/runbooks/config-rollout.md`.
If the product spec mentions **proto changes**, also read `docs/runbooks/proto-versioning.md`.

### 3. Search each affected service

For every service listed in the product spec's "Affected Services" section:

a. Read `services/<name>/CLAUDE.md`
b. Run `find services/<name> -type f | sort` — real file inventory
c. Read the service's main entry point:
   - Go: `services/<name>/cmd/server/main.go`
   - Python: `services/<name>/app/main.py`
   - Node.js: `services/<name>/src/index.ts`
d. Read the handler/servicer file (contains existing RPC implementations):
   - Go: grep for `func.*Server` or `func.*Handler`
   - Python: `services/<name>/app/handlers/servicer.py`
   - Node.js: grep for `export.*function\|router\.\(get\|post\|put\)`
e. Run: `grep -rn "func \|def \|export function\|export const\|register\|handler\|servicer" services/<name>/` — locate real symbols with line numbers
f. Run: `ls services/<name>/migrations/ 2>/dev/null | sort` — find last NNN migration number
g. Run: `grep -rn "GetConfig\|WatchConfig\|config\." services/<name>/` — find config key read patterns
h. Grep all three deployment files to record the service's current env var wiring
   and detect missing entries for new variables the feature requires:
   ```bash
   grep -n "<service-name>" docker-compose.yml .do/app.dev.yaml .do/app.yaml
   ```
   For each new env var the feature will introduce (e.g. a new upstream endpoint key),
   confirm it is absent from all three files:
   ```bash
   grep -n "NEW_VAR_NAME" docker-compose.yml .do/app.dev.yaml .do/app.yaml
   ```
   Record the result: **absent** (must add in the step's `**Files**` + `**Instructions**`) or
   **present** (no change needed). New ports must also be absent from the `ports:` block in
   `docker-compose.yml` and from port-related entries in the app specs.

### 4. Search proto files (if proto changes required)

- Read `packages/proto/<service>/v1/<service>.proto` for each affected service
- Read existing stubs in `packages/proto/gen/go/`, `gen/python/`, `gen/ts/` to understand generated code shape

### 5. Apply the zero-assumption rule

Before writing any step instruction, verify you have grep or Read evidence for every reference. Specifically:

- ✗ "add a handler function" → ✓ "add `def ingest_signal(self, stream)` to `services/xstockstrat-ingest/app/handlers/servicer.py` after `query_signals` at L88, matching its signature pattern"
- ✗ "create a migration" → ✓ "create `services/xstockstrat-ingest/migrations/002_add_signals_table.up.sql` — confirmed last file is `001_newsletter_signals.up.sql` via `ls`"
- ✗ "update the config handler" → ✓ "add key `ingest.signals.polygon.enabled` following the SetConfig call pattern at `services/xstockstrat-config/src/handlers/config.ts:L34`"
- If a file or function is not found: write "**Not found** — this must be created from scratch; no existing pattern available in the codebase"
- ✗ "add the env var to docker-compose" → ✓ "add `NEW_ENDPOINT: http://xstockstrat-new:8061` to the `xstockstrat-<name>` `environment:` block in `docker-compose.yml` (confirmed absent: `grep -n NEW_ENDPOINT docker-compose.yml` → no match); add `- key: NEW_ENDPOINT` / `value: ${xstockstrat-new.PRIVATE_URL}` to the `xstockstrat-<name>` `envs:` block in `.do/app.dev.yaml` and `.do/app.yaml` (confirmed absent: same grep)"

### 6. Write implementation-spec.md

Write `$FEATURE_DIR/implementation-spec.md`:

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
via the grep run in Step 3h.)

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

**Test step pairing rule**: Every `service` step for a non-frontend service must have a
corresponding `test` step. Place it immediately after the `service` step, or declare it in
`## Step Dependencies` (e.g. "Step 5 [test] covers Step 4 [service]"). The `test` step's
`**Verification**` must be a runnable bash command enforcing the CI coverage threshold:

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

### 7. Update feature.md status

Edit `$FEATURE_DIR/feature.md`:
- Change `**Lifecycle Status**: \`draft\`` (or `spec-ready`) to `**Lifecycle Status**: \`implementation-ready\``
- Append a row to the Status History table:
  `| <ISO date> | <prev> → \`implementation-ready\` | /sdd-spec | Implementation spec generated with N steps |`
- Update the Artifacts section: replace `_not yet generated_` with `[Implementation Spec](implementation-spec.md)`
- Finalize the `## Reviewers` table: collect all distinct `**Reviewers**` values from
  all steps in implementation-spec.md, deduplicate, and write the canonical snapshot table.
  This is the stable snapshot — it will not change unless `/sdd-spec` is re-run.
- Update Next Action to: `` `/sdd-review <slug> impl-spec` — validate implementation spec, then `/sdd-execute <slug>` ``

### 8. Append to context.md

Append to `$FEATURE_DIR/context.md`:

```markdown
## Session <ISO timestamp> — sdd-spec

- Generated implementation-spec.md with N steps. Status → implementation-ready.
- Key codebase findings:
  - <finding 1 — e.g. last migration file, exact handler location, config key pattern>
  - <finding 2>
  - <finding 3 if relevant>
```

### 9. Report to user

```
Implementation spec written to docs/roadmap/features/<NNN-slug>/implementation-spec.md
Total steps: N
Feature status: implementation-ready

Next: /sdd-review <slug> impl-spec
```
